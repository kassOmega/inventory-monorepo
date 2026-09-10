// src/i18n/localized.util.ts
// Helpers for resolving per-tenant localized content stored as JSON objects of
// the shape { en: string, am: string }. Fallback chain:
//   requested locale → tenant defaultLanguage → 'en' → 'am' → plain fallback.
import { Locale } from './i18n.context';

export interface LocalizedValue {
  en?: string | null;
  am?: string | null;
  [locale: string]: string | null | undefined;
}

const FALLBACK_ORDER: Locale[] = ['en', 'am'];

/** Resolve a localized JSON column to the best available string. */
export function pickLocalized(
  value: LocalizedValue | null | undefined,
  locale: Locale,
  tenantDefaultLanguage?: string | null,
  plainFallback?: string | null,
): string {
  if (value && typeof value === 'object') {
    const wanted: (string | null | undefined)[] = [
      locale,
      tenantDefaultLanguage && tenantDefaultLanguage !== locale
        ? tenantDefaultLanguage
        : null,
      ...FALLBACK_ORDER,
    ];
    for (const l of wanted) {
      if (!l) continue;
      const v = value[l];
      if (v && String(v).trim()) return String(v);
    }
  }
  if (plainFallback && String(plainFallback).trim()) return plainFallback;
  const en = value?.en;
  return en && String(en).trim() ? en : '';
}

/** Build a write-ready localized value from user input. */
export function mergeLocalized(
  existing: LocalizedValue | null | undefined,
  input: Partial<LocalizedValue> | undefined,
): object | undefined {
  if (!input) return undefined;
  const merged: Record<string, string> = {};
  if (existing && typeof existing === 'object') {
    for (const [k, v] of Object.entries(existing)) {
      if (v !== undefined && v !== null && String(v).trim()) {
        merged[k] = String(v).trim();
      }
    }
  }
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined && v !== null && String(v).trim()) {
      merged[k] = String(v).trim();
    }
  }
  return merged;
}
