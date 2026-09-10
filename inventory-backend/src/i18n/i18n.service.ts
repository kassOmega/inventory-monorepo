// src/i18n/i18n.service.ts
// Backend translation service. Pure functional API (plus a DI-friendly class)
// so any service/guard can translate without wiring Nest providers everywhere:
//
//   import { tr } from '../i18n/i18n.service';
//   throw new BadRequestException(tr('errors.saleNotFound'));
//
// tr() reads the request locale from AsyncLocalStorage automatically. For
// background jobs pass an explicit locale: tr('...', {}, 'am').
import { Injectable } from '@nestjs/common';
import { amMessages } from './backend.am';
import { enMessages } from './backend.en';
import { getCurrentLocale, Locale } from './i18n.context';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dictionaries: Record<Locale, Record<string, any>> = {
  en: enMessages,
  am: amMessages,
};

type Params = Record<string, string | number>;

function lookup(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: Record<string, any>,
  path: string[],
): unknown {
  let cur: unknown = node;
  for (const seg of path) {
    if (cur && typeof cur === 'object' && seg in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Translate a dot-separated key for a locale (fallback: en → raw key). */
export function translate(
  key: string,
  params?: Params,
  locale?: Locale,
): string {
  const l = locale ?? getCurrentLocale();
  const path = key.split('.');
  for (const candidate of [l, 'en']) {
    const val = lookup(dictionaries[candidate], path);
    if (typeof val === 'string') return interpolate(val, params);
  }
  return key;
}

/** Shortcut translate for request-scoped messages. */
export function tr(key: string, params?: Params): string {
  return translate(key, params);
}

@Injectable()
export class I18nService {
  t(key: string, params?: Params, locale?: Locale): string {
    return translate(key, params, locale);
  }
}
