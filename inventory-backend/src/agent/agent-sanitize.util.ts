// src/agent/agent-sanitize.util.ts
// Input sanitization for the Autonomous Owner Agent. Business-controlled
// strings (product names, notes, category names, invoice numbers) are DATA,
// not instructions — but they are interpolated into the Gemini prompt, so we
// neutralize prompt-injection markers and control characters before sending
// them, and validate numeric tool arguments before acting on them.

const INJECTION_PATTERN =
  /(ignore|disregard|forget)\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier)\s+(instructions?|prompt|rules?|context)|system\s+prompt|as\s+an\s+ai|you\s+are\s+now/gi;

/** Normalize a business-controlled string into safe prompt data. */
export function sanitizeAgentString(value: unknown, maxLength = 200): string {
  if (value == null) return '';
  let text = String(value)
    // Strip control characters (newlines/tabs/null bytes) so a value cannot
    // inject a fake conversation turn or instruction block.
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (INJECTION_PATTERN.test(text)) {
    text = text.replace(INJECTION_PATTERN, '[filtered]');
  }
  return text.slice(0, maxLength);
}

/** Coerce an unknown tool argument to a safe integer (or null if invalid). */
export function toSafeInteger(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && Number.isFinite(n) ? n : null;
}

/** Coerce an unknown tool argument to a non-negative money amount (or null). */
export function toSafeAmount(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}
