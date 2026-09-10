// src/common/business-number.util.ts
// Helpers for the per-business human-friendly numbers (e.g. CUST-001) that sit
// alongside the publicId UUIDs.

/** Zero-padded label, e.g. formatBusinessNumber('CUST', 7) → 'CUST-007'. */
export function formatBusinessNumber(
  prefix: string,
  value?: number | null,
): string | null {
  if (value == null) return null;
  return `${prefix}-${String(value).padStart(3, '0')}`;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the ref is a UUID publicId (vs a legacy numeric id). */
export function isPublicId(ref: string): boolean {
  return UUID_RE.test(ref);
}

/** Numeric id when the ref is a plain integer, otherwise null. */
export function asNumericId(ref: string): number | null {
  return /^\d+$/.test(ref) ? Number(ref) : null;
}
