// src/i18n/i18n.context.ts
// Request-scoped UI language. Mirrors the tenant AsyncLocalStorage pattern:
// an Express middleware wraps every request in localeContext.run(locale, …) so
// guards, interceptors, services and exception filters can all read the active
// locale. Background jobs (cron / SSE) pass an explicit locale to translators.
import { AsyncLocalStorage } from 'node:async_hooks';

export type Locale = 'en' | 'am';

export const SUPPORTED_LOCALES: Locale[] = ['en', 'am'];

export const localeContext = new AsyncLocalStorage<Locale>();

export function getCurrentLocale(): Locale {
  return localeContext.getStore() ?? 'en';
}

export function isAmharic(): boolean {
  return getCurrentLocale() === 'am';
}

/** Normalize a header/user value to a supported locale ('en' default). */
export function normalizeLocale(value?: string | null): Locale {
  if (!value) return 'en';
  const v = value.trim().toLowerCase();
  if (v === 'am' || v === 'am-et' || v.startsWith('am')) return 'am';
  return 'en';
}
