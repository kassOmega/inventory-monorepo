// src/common/interceptors/localized-response.interceptor.ts
//
// Auto-localizes entity responses that carry localized JSON columns
// (nameI18n / descriptionI18n / brandI18n / baseNameI18n / roleNameI18n of the
// shape { en, am }). For every such object the plain field is resolved to the
// requesting user's language with graceful fallback to the tenant's
// defaultLanguage, so the frontend keeps reading `.name` / `.description` etc.
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, mergeMap } from 'rxjs';
import { getCurrentLocale } from '../../i18n/i18n.context';
import { pickLocalized } from '../../i18n/localized.util';
import { PrismaService } from '../../prisma/prisma.service';
import { getCurrentTenantId } from '../tenant/tenant.context';

const I18N_FIELD_MAP: Record<string, string> = {
  nameI18n: 'name',
  descriptionI18n: 'description',
  brandI18n: 'brand',
  baseNameI18n: 'baseName',
  roleNameI18n: 'roleName',
};

// Per-process tenant default-language cache (short TTL) so we do not query the
// database for every response object.
const DEFAULT_LANG_TTL_MS = 30_000;
const defaultLangCache = new Map<number, { lang: string; at: number }>();

@Injectable()
export class LocalizedResponseInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  private async getTenantDefaultLanguage(tenantId: number): Promise<string> {
    const cached = defaultLangCache.get(tenantId);
    if (cached && Date.now() - cached.at < DEFAULT_LANG_TTL_MS) {
      return cached.lang;
    }
    try {
      const org = await this.prisma.organization.findUnique({
        where: { id: tenantId },
        select: { defaultLanguage: true },
      });
      const lang = org?.defaultLanguage ?? 'en';
      defaultLangCache.set(tenantId, { lang, at: Date.now() });
      return lang;
    } catch {
      return 'en';
    }
  }

  private localize(value: unknown, locale: string, defaultLang: string): unknown {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        value[i] = this.localize(value[i], locale, defaultLang);
      }
      return value;
    }
    if (!value || typeof value !== 'object') return value;

    const obj = value as Record<string, unknown>;

    // Resolve localized fields on this object (before recursing is fine —
    // localized values are leaf strings/objects).
    for (const [i18nKey, plainKey] of Object.entries(I18N_FIELD_MAP)) {
      const i18nVal = obj[i18nKey];
      if (i18nVal && typeof i18nVal === 'object') {
        const resolved = pickLocalized(
          i18nVal as { en?: string | null; am?: string | null },
          locale as 'en' | 'am',
          defaultLang,
          (obj[plainKey] as string | null | undefined) ?? null,
        );
        if (resolved) obj[plainKey] = resolved;
      }
    }

    for (const key of Object.keys(obj)) {
      const child = obj[key];
      if (child && typeof child === 'object') {
        obj[key] = this.localize(child, locale, defaultLang);
      }
    }
    return value;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      mergeMap(async (response) => {
        const locale = getCurrentLocale();
        const tenantId = getCurrentTenantId();
        const defaultLang =
          tenantId != null
            ? await this.getTenantDefaultLanguage(tenantId)
            : 'en';
        return this.localize(response, locale, defaultLang);
      }),
    );
  }
}
