// src/i18n/i18n.middleware.ts
// Express middleware that resolves the request UI language from the
// x-locale / Accept-Language headers and runs the rest of the request inside
// the locale AsyncLocalStorage context. Registered globally in main.ts so
// guards (which run before interceptors) can also translate.
import { NextFunction, Request, Response } from 'express';
import { localeContext, normalizeLocale } from './i18n.context';

export function localeMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const header = (req.headers['x-locale'] as string) ??
    (req.headers['accept-language'] as string) ?? null;
  const locale = normalizeLocale(header);
  localeContext.run(locale, () => next());
}
