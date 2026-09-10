// frontend/lib/bizNumber.ts
/** Zero-padded per-business number label, e.g. formatBusinessNumber('CUST', 7) → 'CUST-007'. */
export function formatBusinessNumber(
  prefix: string,
  value?: number | null,
): string | null {
  if (value == null) return null;
  return `${prefix}-${String(value).padStart(3, "0")}`;
}
