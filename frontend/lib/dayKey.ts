// Local calendar-day keys for day-grouped lists.
//
// Kept dependency-free (no i18n, no formatting) so the same key can be derived
// in a component and in a plain data helper.

/**
 * The local calendar day a timestamp falls on, as `YYYY-MM-DD`.
 *
 * Day-grouped lists (the credits ledger and its payables tab) key their headers
 * with this, so every record made on the same date shares one header whatever
 * the browser timezone or locale does with time formatting.
 */
export function localDayKey(value?: string | number | Date | null): string {
  const d = value instanceof Date ? value : new Date(value ?? NaN);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
