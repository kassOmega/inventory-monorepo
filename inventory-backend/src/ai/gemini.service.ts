// src/ai/gemini.service.ts
// Thin wrapper around the Google Gemini API (@google/genai).
//   - gemini-2.5-flash (GEMINI_FAST_MODEL): high-speed streaming chat + quick alerts
//   - gemini-2.5-pro   (GEMINI_PRO_MODEL): deep predictive forecasting & weekly reports
import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';

export type GeminiModelKind = 'fast' | 'pro';

export interface ChatTurn {
  role: 'user' | 'model';
  text: string;
}

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private client: GoogleGenAI | null = null;

  private getClient(): GoogleGenAI {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'AI is not configured. Set GEMINI_API_KEY in the backend .env file.',
      );
    }
    if (!this.client) {
      this.client = new GoogleGenAI({ apiKey });
    }
    return this.client;
  }

  private model(kind: GeminiModelKind): string {
    return kind === 'fast'
      ? (process.env.GEMINI_FAST_MODEL ?? 'gemini-3.5-flash')
      : (process.env.GEMINI_PRO_MODEL ?? 'gemini-3.5-flash');
  }

  /** Primary model followed by an optional fallback model. */
  private modelsFor(kind: GeminiModelKind): string[] {
    const primary = this.model(kind);
    const fallback = (
      process.env.GEMINI_FALLBACK_MODEL ??
      process.env.GEMINI_PRO_MODEL ??
      ''
    ).trim();
    return fallback && fallback !== primary ? [primary, fallback] : [primary];
  }

  /** Extract the provider HTTP/status code from a Google GenAI error. */
  private providerCode(err: unknown): number | null {
    const e = err as any;
    const direct = e?.status ?? e?.code ?? e?.error?.code;
    if (typeof direct === 'number') return direct;
    if (typeof direct === 'string' && /^\d{3}$/.test(direct)) {
      return Number(direct);
    }
    const message = typeof e?.message === 'string' ? e.message : '';
    try {
      const parsed = JSON.parse(message);
      const code = parsed?.error?.code ?? parsed?.code;
      if (typeof code === 'number') return code;
    } catch {
      // not JSON
    }
    const match = message.match(/"code"\s*:\s*(\d{3})/);
    return match ? Number(match[1]) : null;
  }

  private isTransient(err: unknown): boolean {
    const code = this.providerCode(err);
    // No code usually means a network/timeout failure.
    return code == null || [408, 429, 500, 502, 503, 504].includes(code);
  }

  private friendlyError(err: unknown): string {
    const code = this.providerCode(err);
    if (code === 401 || code === 403) {
      return 'The AI provider rejected the configured API key. Check GEMINI_API_KEY.';
    }
    if (code === 404) {
      return 'The configured AI model is unavailable. Check GEMINI_FAST_MODEL and GEMINI_FALLBACK_MODEL.';
    }
    if (code === 429) {
      return 'The AI provider is receiving too many requests. Please try again shortly.';
    }
    if (code === 500 || code === 502 || code === 503 || code === 504) {
      return 'The AI provider is busy right now. Please try again in a moment.';
    }
    return 'The AI service is temporarily unavailable. Please try again.';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Ask Gemini to produce structured JSON that conforms to `schema`.
   */
  async generateJson<T>(opts: {
    systemInstruction: string;
    prompt: string;
    schema: object;
    kind?: GeminiModelKind;
    temperature?: number;
  }): Promise<T> {
    const ai = this.getClient();
    try {
      const response = await ai.models.generateContent({
        model: this.model(opts.kind ?? 'pro'),
        contents: opts.prompt,
        config: {
          systemInstruction: opts.systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: opts.schema,
          temperature: opts.temperature ?? 0.4,
        },
      });
      return this.safeParse<T>(response.text ?? '');
    } catch (err) {
      const message = (err as Error).message ?? 'unknown error';
      this.logger.error(`Gemini generateJson failed: ${message}`);
      throw new BadGatewayException(
        'The AI service failed to generate a response. Please try again.',
      );
    }
  }

  /**
   * Ask Gemini to analyse an image (document scan / photo) and produce
   * structured JSON. Used by the account-verification AI agent.
   */
  async analyzeImage<T>(opts: {
    systemInstruction: string;
    prompt: string;
    imageMimeType: string;
    imageBase64: string; // base64 payload WITHOUT the data: prefix
    /** Optional additional photos (e.g. a second angle) appended to the prompt. */
    extraImages?: Array<{ mimeType: string; base64: string }>;
    schema: object;
  }): Promise<T> {
    const ai = this.getClient();
    try {
      const parts: any[] = [{ text: opts.prompt }];
      parts.push({
        inlineData: { mimeType: opts.imageMimeType, data: opts.imageBase64 },
      });
      for (const extra of opts.extraImages ?? []) {
        parts.push({
          inlineData: { mimeType: extra.mimeType, data: extra.base64 },
        });
      }
      const response = await ai.models.generateContent({
        model: this.model('fast'),
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction: opts.systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: opts.schema,
          temperature: 0.2,
        },
      });
      return this.safeParse<T>(response.text ?? '');
    } catch (err) {
      const message = (err as Error).message ?? 'unknown error';
      this.logger.error(`Gemini analyzeImage failed: ${message}`);
      throw new BadGatewayException(
        'The AI service failed to analyse the document. Please try again.',
      );
    }
  }

  /**
   * Stream a chat completion token-by-token (async generator of text deltas).
   *
   * Transient provider failures (429/5xx/network) are retried with exponential
   * backoff. If the primary model stays unavailable, the configured fallback
   * model is tried. Once any token has been emitted we cannot safely retry
   * without duplicating text, so a mid-stream failure is surfaced instead.
   */
  async *streamChat(opts: {
    systemInstruction: string;
    history: ChatTurn[];
    prompt: string;
  }): AsyncGenerator<string> {
    const ai = this.getClient();
    const contents = [
      ...opts.history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
      { role: 'user', parts: [{ text: opts.prompt }] },
    ];
    const models = this.modelsFor('fast');
    const maxAttemptsPerModel = 3;
    let lastError: unknown = null;

    for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
      const model = models[modelIndex];

      for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt++) {
        let emitted = false;
        try {
          const stream = await ai.models.generateContentStream({
            model,
            contents,
            config: {
              systemInstruction: opts.systemInstruction,
              temperature: 0.5,
            },
          });
          for await (const chunk of stream) {
            const delta = chunk.text ?? '';
            if (delta) {
              emitted = true;
              yield delta;
            }
          }
          return;
        } catch (err) {
          lastError = err;
          const code = this.providerCode(err);
          this.logger.error(
            `Gemini streamChat failed (model=${model}, attempt=${attempt}/${maxAttemptsPerModel}, code=${code ?? 'n/a'}): ${
              (err as Error).message ?? 'unknown error'
            }`,
          );

          if (emitted) {
            throw new BadGatewayException(
              'The AI connection was interrupted after it started responding. Please try again.',
            );
          }

          if (!this.isTransient(err)) {
            throw new BadGatewayException(this.friendlyError(err));
          }

          if (attempt < maxAttemptsPerModel) {
            const waitMs = 500 * 2 ** (attempt - 1);
            this.logger.warn(`Retrying Gemini chat in ${waitMs}ms...`);
            await this.sleep(waitMs);
            continue;
          }

          if (modelIndex < models.length - 1) {
            this.logger.warn(
              `Primary AI model unavailable; falling back to ${models[modelIndex + 1]}.`,
            );
            break;
          }

          throw new BadGatewayException(this.friendlyError(err));
        }
      }
    }

    throw new BadGatewayException(this.friendlyError(lastError));
  }

  /**
   * Agentic tool loop: sends a prompt with function declarations, executes any
   * predicted function calls via `executeTool`, and continues until the model
   * produces a final text answer or the iteration cap is reached.
   */
  async runToolLoop(opts: {
    systemInstruction: string;
    prompt: string;
    functionDeclarations: Record<string, unknown>[];
    executeTool: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
    maxIterations?: number;
  }): Promise<{ finalText: string; toolCalls: Array<{ name: string; args: unknown }> }> {
    const ai = this.getClient();
    const tools = [{ functionDeclarations: opts.functionDeclarations }] as never[];
    const contents: any[] = [{ role: 'user', parts: [{ text: opts.prompt }] }];
    const toolCalls: Array<{ name: string; args: unknown }> = [];
    const maxIterations = opts.maxIterations ?? 5;

    for (let i = 0; i < maxIterations; i++) {
      const response = await ai.models.generateContent({
        model: this.model('pro'),
        contents,
        config: {
          systemInstruction: opts.systemInstruction,
          temperature: 0.3,
          tools,
        },
      });

      // Use the raw parts so any thoughtSignature on function-call parts is
      // preserved when echoed back (required by thinking-capable models).
      const parts: any[] = response.candidates?.[0]?.content?.parts ?? [];
      const functionCallParts = parts.filter(
        (p) => p.functionCall && typeof p.functionCall.name === 'string',
      );
      if (functionCallParts.length === 0) {
        return { finalText: response.text ?? '', toolCalls };
      }

      contents.push({ role: 'model', parts });

      const functionResponses: Array<{
        name: string;
        response: Record<string, unknown>;
      }> = [];
      for (const part of functionCallParts) {
        const name = part.functionCall.name as string;
        const args = (part.functionCall.args ?? {}) as Record<string, unknown>;
        toolCalls.push({ name, args });
        try {
          const result = await opts.executeTool(name, args);
          functionResponses.push({ name, response: result });
        } catch (err) {
          this.logger.error(`Agent tool ${name} failed: ${(err as Error).message}`);
          functionResponses.push({
            name,
            response: { ok: false, error: (err as Error).message ?? 'Tool error' },
          });
        }
      }

      contents.push({
        role: 'user',
        parts: functionResponses.map((r) => ({ functionResponse: r })),
      });
    }

    return { finalText: '', toolCalls };
  }

  private safeParse<T>(text: string): T {
    const cleaned = text
      .replace(/^```(?:json)?/i, '')
      .replace(/```\s*$/m, '')
      .trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(cleaned.slice(start, end + 1)) as T;
        } catch {
          // fall through to the error below
        }
      }
      this.logger.warn('Gemini returned a non-JSON payload.');
      throw new BadGatewayException(
        'The AI service returned an invalid response.',
      );
    }
  }
}
