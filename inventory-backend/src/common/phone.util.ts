// src/common/phone.util.ts
// Shared phone-number normalization used by login and by write paths, so a
// number typed with spaces, dashes or a leading + still matches the stored
// value. We keep a digits-only form (with an optional leading country code) and
// compare on that.

/**
 * Normalize a phone number to a comparable form: keep an optional leading `+`
 * then digits only. Returns `null` for empty/invalid input.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const plus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  return (plus ? '+' : '') + digits;
}

/** True when the value looks like an email address (contains `@`). */
export function looksLikeEmail(value: string): boolean {
  return value.includes('@');
}
