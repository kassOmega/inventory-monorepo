// Localized date/time formatting.
//
//   • English ("en")   → Gregorian calendar, e.g. "Aug 21, 2026, 7:32 PM".
//   • Amharic ("am")   → Ethiopian calendar (native month names) with Western
//     digits, e.g. "ሰኔ 21, 2018, 7:32 ከሰዓት" — the standard domestic format.
//     Underlying data & date filters always stay Gregorian (ISO timestamps);
//     only the on-screen rendering is converted.
import { Locale, getActiveLocale } from "./locale";

function amFormatter(style: "date" | "datetime") {
  const options: Intl.DateTimeFormatOptions =
    style === "datetime"
      ? {
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }
      : { year: "numeric", month: "long", day: "numeric" };
  // Ethiopian calendar is preferred for Amharic output; some older browsers
  // lack it, so fall back to the (transliterated) Gregorian Amharic rendering.
  try {
    return new Intl.DateTimeFormat("am-ET", { ...options, calendar: "ethiopic" });
  } catch {
    return new Intl.DateTimeFormat("am-ET", options);
  }
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
const formatterByLocale = (locale: Locale, kind: "date" | "datetime") => {
  const key = `${locale}:${kind}`;
  let f = formatterCache.get(key);
  if (!f) {
    f =
      locale === "am"
        ? amFormatter(kind)
        : new Intl.DateTimeFormat("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
            ...(kind === "datetime"
              ? { hour: "numeric", minute: "2-digit" }
              : {}),
          });
    formatterCache.set(key, f);
  }
  return f;
};

/** Format an ISO date string as e.g. "Aug 21, 2026, 7:32 PM". */
export function formatDateTime(
  iso?: string | null,
  locale?: Locale,
): string {
  const l = locale ?? getActiveLocale();
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return formatterByLocale(l, "datetime").format(d);
}

/** Format an ISO date string as e.g. "Aug 21, 2026". */
export function formatDate(iso?: string | null, locale?: Locale): string {
  const l = locale ?? getActiveLocale();
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return formatterByLocale(l, "date").format(d);
}

/** Relative "time ago" label, localized (en + am). */
export function timeAgo(iso?: string | null, now = Date.now(), locale?: Locale): string {
  const l = locale ?? getActiveLocale();
  if (!iso) return "";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "";
  const diff = Math.max(0, now - d);
  const s = Math.floor(diff / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const days = Math.floor(h / 24);
  if (l === "am") {
    if (s < 45) return "አሁን";
    if (m < 2) return "1 ደቂቃ በፊት";
    if (m < 60) return `${m} ደቂቃ በፊት`;
    if (h < 2) return "1 ሰዓት በፊት";
    if (h < 24) return `${h} ሰዓታት በፊት`;
    if (days < 2) return "ትናንት";
    if (days < 7) return `${days} ቀናት በፊት`;
    return formatDate(iso, "am");
  }
  if (s < 45) return "now";
  if (m < 2) return "1 min ago";
  if (m < 60) return `${m} min ago`;
  if (h < 2) return "1 hour ago";
  if (h < 24) return `${h} hours ago`;
  if (days < 2) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return formatDate(iso, "en");
}

