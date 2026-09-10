// src/common/guards/verification/verification.guard.ts
// Global gate that enforces the account-verification policy:
//
//   - Public routes and routes marked @AllowUnverified() always pass.
//   - Platform admins / superusers are exempt (they run the review queue).
//   - A BLOCKED account is locked out of everything (it can only log in to see
//     the block notice; even verification uploads are denied).
//   - Owner accounts whose user verification is not APPROVED can only reach
//     verification / auth / notification endpoints.
//   - Any request with an active organization (tenant) is blocked until that
//     business verification is APPROVED — this also covers staff members, who
//     operate only inside verified businesses.
//
// Registered after JwtAuthGuard + TenantGuard so `req.user` and `req.tenantId`
// are populated. Org verification status is cached briefly to avoid a DB hit on
// every request.
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { VerificationStatus } from '@prisma/client';
import { ALLOW_UNVERIFIED_KEY } from '../../decorators/allow-unverified.decorator';
import { IS_PUBLIC_KEY } from '../../decorators/public.decorator';
import { JwtPayload } from '../../interfaces/jwt-payload.interface';
import { PrismaService } from '../../../prisma/prisma.service';

const ORG_STATUS_CACHE_TTL_MS = 5000;

interface CachedOrgStatus {
  status: VerificationStatus;
  timestamp: number;
}

@Injectable()
export class VerificationGuard implements CanActivate {
  private readonly orgCache = new Map<number, CachedOrgStatus>();

  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const allowUnverified = this.reflector.getAllAndOverride<boolean>(
      ALLOW_UNVERIFIED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowUnverified) return true;

    const user: JwtPayload | undefined = req.user;
    if (!user) return true; // JwtAuthGuard rejects unauthenticated requests

    // Platform admins run the verification review queue and are always exempt.
    // NOTE: `isSuperuser` is deliberately NOT exempting here — in the
    // multi-tenant model every business Owner role is `isSystem`, so owners must
    // still pass the business-level verification check for each organization.
    if (user.isPlatformAdmin) return true;

    // Permanently blocked for repeated fraudulent verification attempts.
    if (user.verificationStatus === VerificationStatus.BLOCKED) {
      throw new ForbiddenException(
        'Your account has been permanently blocked for repeated fraudulent verification attempts.',
      );
    }

    // User-level verification: owner accounts must be approved before they can
    // operate (staff are covered by the business-level check below).
    if (
      user.isOwnerAccount &&
      user.verificationStatus !== VerificationStatus.APPROVED
    ) {
      throw new ForbiddenException(
        'Your account must be verified before you can use the system. Please complete the verification steps.',
      );
    }

    // Business-level verification: the active organization must be approved.
    const tenantId = req.tenantId ?? null;
    if (tenantId != null) {
      const orgStatus = await this.getOrgStatus(tenantId);
      if (orgStatus === VerificationStatus.BLOCKED) {
        throw new ForbiddenException(
          'This business has been permanently blocked for repeated fraudulent verification attempts.',
        );
      }
      if (orgStatus !== VerificationStatus.APPROVED) {
        throw new ForbiddenException(
          'This business is not verified yet. Only verification actions are available until it is approved.',
        );
      }
    }

    return true;
  }

  private async getOrgStatus(orgId: number): Promise<VerificationStatus> {
    const now = Date.now();
    const cached = this.orgCache.get(orgId);
    if (cached && now - cached.timestamp < ORG_STATUS_CACHE_TTL_MS) {
      return cached.status;
    }

    let status: VerificationStatus = VerificationStatus.APPROVED;
    try {
      const org = await this.prisma.organization.findUnique({
        where: { id: orgId },
        select: { verificationStatus: true },
      });
      status = org?.verificationStatus ?? VerificationStatus.APPROVED;
    } catch {
      // If the org lookup fails, don't block traffic (other guards enforce
      // membership); the cache just misses on the next request.
    }

    this.orgCache.set(orgId, { status, timestamp: now });
    return status;
  }
}
