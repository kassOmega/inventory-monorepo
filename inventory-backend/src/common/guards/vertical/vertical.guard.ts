// src/common/guards/vertical/vertical.guard.ts
// Per-vertical access enforcement. Only controllers decorated with
// `@Vertical(...)` are checked; everything else passes untouched (so existing
// retail/hospitality routes are unaffected). For decorated controllers the
// active organization's businessType must match, otherwise the request is
// rejected with 403.
//
// Zero-risk design:
//   - businessType is resolved from the ACTIVE org (req.tenantId) via a cached
//     DB lookup — never from req.user.businessType (which is derived from the
//     user's FIRST membership and is stale when switching orgs).
//   - Platform admins are exempt.
//   - VERTICAL_ENFORCEMENT !== 'true' disables all enforcement (rollback flag).
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BusinessType } from '@prisma/client';
import { VERTICAL_KEY } from '../../decorators/vertical.decorator';
import { JwtPayload } from '../../interfaces/jwt-payload.interface';
import { PrismaService } from '../../../prisma/prisma.service';

const ORG_TYPE_CACHE_TTL_MS = 5000;

interface CachedOrgType {
  businessType: BusinessType | null;
  timestamp: number;
}

@Injectable()
export class VerticalGuard implements CanActivate {
  private readonly orgCache = new Map<number, CachedOrgType>();

  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (process.env.VERTICAL_ENFORCEMENT !== 'true') return true;

    const allowedTypes = this.reflector.getAllAndOverride<BusinessType[]>(
      VERTICAL_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!allowedTypes || allowedTypes.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const user: JwtPayload | undefined = req.user;
    if (!user) return true; // JwtAuthGuard rejects unauthenticated requests

    // Platform admins are exempt. NOTE: `isSuperuser` is NOT exempted — in the
    // multi-tenant model every business Owner role is `isSystem`, so owners must
    // still pass the per-vertical check for their active organization.
    if (user.isPlatformAdmin) return true;

    const tenantId = req.tenantId ?? null;
    if (tenantId == null) {
      // No active org → can't validate vertical; allow (other guards enforce
      // membership / permissions).
      return true;
    }

    const orgType = await this.getOrgBusinessType(tenantId);
    if (orgType && !allowedTypes.includes(orgType)) {
      throw new ForbiddenException(
        'This feature is not available for your industry.',
      );
    }
    return true;
  }

  private async getOrgBusinessType(orgId: number): Promise<BusinessType | null> {
    const now = Date.now();
    const cached = this.orgCache.get(orgId);
    if (cached && now - cached.timestamp < ORG_TYPE_CACHE_TTL_MS) {
      return cached.businessType;
    }

    let businessType: BusinessType | null = null;
    try {
      const org = await this.prisma.organization.findUnique({
        where: { id: orgId },
        select: { businessType: true },
      });
      businessType = org?.businessType ?? null;
    } catch {
      // Fail open on lookup errors.
    }

    this.orgCache.set(orgId, { businessType, timestamp: now });
    return businessType;
  }
}
