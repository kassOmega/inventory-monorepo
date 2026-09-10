// Locale helpers shared across the frontend.
//
// The active UI language is cached module-wide (setActiveLocale) so plain
// helper functions such as fmtCurrency / formatDate can react to the current
// locale without being React hooks.

export type Locale = "en" | "am";

export const SUPPORTED_LOCALES: Locale[] = ["en", "am"];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  am: "አማርኛ",
};

export const LOCALE_FLAGS: Record<Locale, string> = {
  en: "🇬🇧",
  am: "🇪🇹",
};

let activeLocale: Locale = "en";

export function setActiveLocale(locale: Locale) {
  activeLocale = locale;
}

export function getActiveLocale(): Locale {
  return activeLocale;
}

export function isAmharic(): boolean {
  return activeLocale === "am";
}

/** Normalize arbitrary input (browser tag, header value, stored pref) → Locale. */
export function normalizeLocale(value?: string | null): Locale {
  if (!value) return "en";
  const v = value.trim().toLowerCase();
  if (v === "am" || v === "am-et" || v === "am-ET" || v.startsWith("am")) return "am";
  return "en";
}

/** ETB currency display name in the active locale: "ETB" vs "ብር". */
export function birrWord(locale: Locale = getActiveLocale()): string {
  return locale === "am" ? "ብር" : "birr";
}

export const STORAGE_KEY_GLOBAL = "ui.locale";
export const STORAGE_KEY_TENANT_PREFIX = "ui.locale.tenant.";
