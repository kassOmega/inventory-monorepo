// src/common/filters/localized-exception.filter.ts
//
// Boundary-level API-error localization. Translates the error message at the
// HTTP response edge instead of (only) at each throw site:
//
//   - Throws already converted to tr('errors.*') carry the translated text and
//     pass through unchanged.
//   - Any English message that exists in the English catalog (guards, DTO
//     validation arrays, un-converted services) is reverse-mapped to the key
//     and re-rendered in the request locale — so the moment a literal is added
//     to backend.en.ts/backend.am.ts it is localized for every code path.
//   - Messages not in the catalog pass through untouched (still English until
//     cataloged — see LOCALE_STATUS.md for the per-module sweep).
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { enMessages } from '../../i18n/backend.en';
import { getCurrentLocale, Locale } from '../../i18n/i18n.context';
import { translate } from '../../i18n/i18n.service';

function collect(node: Record<string, any>, path: string, out: Map<string, string>): void {
  for (const [k, v] of Object.entries(node)) {
    const keyPath = path ? `${path}.${k}` : k;
    if (v && typeof v === 'object') {
      collect(v, keyPath, out);
    } else if (typeof v === 'string') {
      // First cataloged key wins for a value; keys are unique per domain.
      if (!out.has(v)) out.set(v, keyPath);
    }
  }
}

// English value -> catalog key (built once per process).
const enValueIndex = new Map<string, string>();
collect(enMessages, '', enValueIndex);

function localizeText(text: string, locale: Locale): string {
  const key = enValueIndex.get(text);
  if (!key) return text;
  const localized = translate(key, undefined, locale);
  // A same-language render returns the English value; a successful translation
  // returns localized text. Empty lookup results fall back to the key itself,
  // so guard against emitting a key when the am dictionary lags.
  return localized && localized !== key ? localized : text;
}

function localizeValue(value: unknown, locale: Locale): unknown {
  if (Array.isArray(value)) return value.map((v) => localizeValue(v, locale));
  if (typeof value === 'string') return localizeText(value, locale);
  return value;
}

@Catch()
export class LocalizedExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const locale = getCurrentLocale();

    let status: number;
    let message: unknown;
    let error = '';
    let handled = false;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as { message?: unknown; error?: unknown };
        message = b.message ?? exception.message;
        error = typeof b.error === 'string' ? b.error : '';
      }
      handled = true;
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message =
        exception instanceof Error ? exception.message : 'Internal server error';
    }

    const payload: Record<string, unknown> = {
      statusCode: status,
      message: localizeValue(message, locale),
    };
    if (error) payload.error = error;
    if (!handled) {
      // Nest logs unexpected errors when they are re-thrown; the filter is the
      // terminal handler for the response, but keep the log line ourselves.
      console.error(exception);
    }

    res.status(status).json(payload);
  }
}
