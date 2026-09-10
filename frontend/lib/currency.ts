// Currency display configuration for the frontend.
//
// Defaults to the Ethiopian Birr (ETB). Override per deployment by setting
// NEXT_PUBLIC_CURRENCY_SYMBOL in the environment (e.g. "Br", "USD", "$").
// In Amharic mode amounts always render with the native "ብር" label using
// Western digits (1,234.00 ብር style per standard Ethiopian business usage).
import { Locale, getActiveLocale } from "./locale";

export const CURRENCY_SYMBOL: string = (
  process.env.NEXT_PUBLIC_CURRENCY_SYMBOL || "ETB"
).trim();

const numFmtCache = new Map<string, Intl.NumberFormat>();

function numFmt(locale: Locale, digits: number): Intl.NumberFormat {
  const key = `${locale}:${digits}`;
  let f = numFmtCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale === "am" ? "am-ET" : "en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    numFmtCache.set(key, f);
  }
  return f;
}

/** Format a plain number with grouping separators for the active locale. */
export function fmtNumber(
  n: number | string | null | undefined,
  digits = 2,
  locale: Locale = getActiveLocale(),
): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0";
  return numFmt(locale, digits).format(v);
}

/** Format an amount with the localized currency, e.g. "ETB 12,340.50" / "12,340.50 ብር". */
export function fmtCurrency(
  n: number | string | null | undefined,
  digits = 2,
  locale: Locale = getActiveLocale(),
): string {
  const v = Number(n);
  if (!Number.isFinite(v)) {
    return locale === "am" ? "0 ብር" : `${CURRENCY_SYMBOL} 0.00`;
  }
  const body = numFmt(locale, digits).format(v);
  return locale === "am" ? `${body} ብር` : `${CURRENCY_SYMBOL} ${body}`;
}

