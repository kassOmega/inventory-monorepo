// src/verification/verification-ai.service.ts
// The account-verification AI agent: reviews an uploaded document scan/photo via
// Gemini vision and returns a decision. When the AI is unavailable (no API key,
// unsupported file type, upstream error) it returns `unavailable: true` so the
// submission is routed to the platform admin for manual review instead of being
// auto-approved.
import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { GeminiService } from '../ai/gemini.service';

export interface AiReviewResult {
  decision: 'CLEAR' | 'SUSPICIOUS';
  confidence: number;
  reasons: string[];
  /** The document type the AI detected in the upload (null if unidentifiable). */
  detectedType?: string | null;
  /** true when the AI could not review (manual review required). */
  unavailable: boolean;
}

export interface AiReviewRequest {
  documentType: 'NATIONAL_ID' | 'TRADE_LICENSE' | 'TIN_CERTIFICATE';
  filePath: string;
  mimeType: string;
  accountName: string; // the person / business the document should belong to
}

const AI_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];
const MAX_AI_FILE_BYTES = 8 * 1024 * 1024;

const SYSTEM_INSTRUCTION = [
  'You are the account-verification agent for a business inventory platform.',
  'You review photo/scan uploads of government and business documents submitted for identity verification.',
  'You must detect: forgeries, photocopies/screenshots of digital files presented as physical documents, edited or composited images, crops that hide fields, glare or blur that makes text unreadable, and name mismatches.',
  'NEVER approve a document that is not the exact document type the prompt asks for. For example, a driver\'s license, passport, or any other identity document uploaded where a national ID is required must be decided SUSPICIOUS no matter how clear or genuine it looks.',
  'Only approve documents that are genuine AND current (renewed, not expired, not visibly cancelled).',
  'Be conservative: when in doubt, decide SUSPICIOUS so a human admin reviews.',
  'Respond only with the requested JSON.',
].join('\n');
const PROMPTS: Record<AiReviewRequest['documentType'], string> = {
  NATIONAL_ID:
    "Verify this photo/scan of an ETHIOPIAN NATIONAL ID CARD submitted by \"{name}\". The upload is claimed to be the owner's national ID — if the document is a driver's license, passport, student ID, kebele card, or any other identity document, decide SUSPICIOUS regardless of how clear it is.\n" +
    'Check that: it is a clear photo of a physical national ID card (not a screen, not a printed copy of a digital file, not an edited composite); the holder name and photo are visible and match "{name}"; the ID number is legible; the card is current and valid (not expired or visibly cancelled); and there are no signs of tampering, cropping, or glare hiding text.\n' +
    'Decide CLEAR only if it is a genuine, legible, current national ID card.',
  TRADE_LICENSE:
    "Verify this photo/scan of a RENEWED TRADE LICENSE (business license) submitted for the business \"{name}\". The upload is claimed to be the business's trade license — if it is a receipt, invoice, registration certificate, tax clearance letter, TIN certificate, or any other document, decide SUSPICIOUS regardless of how clear it is.\n" +
    'Check that: it is a clear photo/scan of a physical trade license; the business name on it matches "{name}"; the license is current (renewal year visible and not obviously expired); the document is legible; and there are no signs of editing, compositing, or tampering.\n' +
    'Decide CLEAR only if it is a genuine, legible, currently renewed trade license for "{name}".',
  TIN_CERTIFICATE:
    "Verify this photo/scan of a TIN (taxpayer identification number) REGISTRATION CERTIFICATE submitted for the business \"{name}\". The upload is claimed to be a TIN registration certificate — if it is any other document, decide SUSPICIOUS regardless of how clear it is.\n" +
    'Check that: it is a clear photo/scan of a genuine TIN registration certificate; the business name on it matches "{name}"; the TIN number is legible; and there are no signs of editing or tampering.\n' +
    'Decide CLEAR only if it is a genuine, legible TIN registration certificate.',
};

@Injectable()
export class VerificationAiService {
  private readonly logger = new Logger(VerificationAiService.name);

  constructor(private readonly gemini: GeminiService) {}

  async review(req: AiReviewRequest): Promise<AiReviewResult> {
    if (!AI_IMAGE_TYPES.includes(req.mimeType)) {
      return {
        decision: 'SUSPICIOUS',
        confidence: 0,
        reasons: ['Unsupported file type — requires manual review.'],
        detectedType: null,
        unavailable: true,
      };
    }

    let base64: string;
    try {
      const buffer = readFileSync(req.filePath);
      if (buffer.byteLength > MAX_AI_FILE_BYTES) {
        return {
          decision: 'SUSPICIOUS',
          confidence: 0,
          reasons: ['File is too large for AI review — requires manual review.'],
          detectedType: null,
          unavailable: true,
        };
      }
      base64 = buffer.toString('base64');
    } catch (err) {
      this.logger.warn(
        `Could not read uploaded document for AI review: ${(err as Error).message}`,
      );
      return {
        decision: 'SUSPICIOUS',
        confidence: 0,
        reasons: ['Document file could not be read — requires manual review.'],
        detectedType: null,
        unavailable: true,
      };
    }

    try {
      const result = await this.gemini.analyzeImage<{
        decision: 'CLEAR' | 'SUSPICIOUS';
        confidence: number;
        documentType?: string;
        reasons: string[];
      }>({
        systemInstruction: SYSTEM_INSTRUCTION,
        prompt: (PROMPTS[req.documentType] ?? PROMPTS.NATIONAL_ID).replaceAll(
          '{name}',
          req.accountName,
        ),
        imageMimeType: req.mimeType,
        imageBase64: base64,
        schema: {
          type: 'object',
          properties: {
            decision: { type: 'string', enum: ['CLEAR', 'SUSPICIOUS'] },
            confidence: { type: 'number' },
            documentType: {
              type: 'string',
              enum: [
                'NATIONAL_ID',
                'TRADE_LICENSE',
                'TIN_CERTIFICATE',
                'DRIVERS_LICENSE',
                'PASSPORT',
                'OTHER',
              ],
            },
            reasons: { type: 'array', items: { type: 'string' } },
          },
          required: ['decision', 'confidence', 'reasons'],
        },
      });

      let decision: 'CLEAR' | 'SUSPICIOUS' =
        result.decision === 'CLEAR' ? 'CLEAR' : 'SUSPICIOUS';
      const confidence = Math.max(0, Math.min(1, Number(result.confidence) || 0));
      const reasons = Array.isArray(result.reasons)
        ? result.reasons.map((r) => String(r).slice(0, 300)).filter(Boolean)
        : [];
      const detectedType =
        typeof result.documentType === 'string' && result.documentType.trim()
          ? result.documentType.toUpperCase()
          : null;

      // Hard rule: never approve an upload whose detected document type is not
      // the exact type that was requested (e.g. a driver's license uploaded as
      // a national ID). The account is routed to a human reviewer instead.
      if (detectedType && detectedType !== req.documentType) {
        decision = 'SUSPICIOUS';
        reasons.unshift(
          `The uploaded document is a ${detectedType.replace(/_/g, ' ')}, not the required ${req.documentType.replace(/_/g, ' ')}.`,
        );
      }

      // Low-confidence CLEAR results still go to a human reviewer.
      if (decision === 'CLEAR' && confidence < 0.6) {
        return {
          decision: 'SUSPICIOUS',
          confidence,
          reasons: [...reasons, 'AI confidence was low — requires manual review.'],
          detectedType,
          unavailable: false,
        };
      }

      return { decision, confidence, reasons, detectedType, unavailable: false };
    } catch (err) {
      this.logger.warn(
        `AI verification review failed, routing to manual review: ${(err as Error).message}`,
      );
      return {
        decision: 'SUSPICIOUS',
        confidence: 0,
        reasons: ['AI review unavailable — requires manual review.'],
        detectedType: null,
        unavailable: true,
      };
    }
  }
}

