// src/common/guards/subscription/subscription.guard.ts
// Global gate that enforces the tenant subscription policy:
//
//   - Public routes and routes marked @AllowExpired() always pass (the renewal
//     surface must stay reachable so an expired tenant can pay).
//   - Platform admins are exempt.
//   - FREE / LIFETIME tenants never expire.
//   - ACTIVE and GRACE tenants are fully usable (grace = the 2 days after expiry).
//   - EXPIRED tenants are READ-ONLY: every mutating request (POST/PATCH/PUT/
//     DELETE) is blocked; GET requests and the renewal endpoints keep working.
//
// Registered after JwtAuthGuard + TenantGuard so `req.user` and `req.tenantId`
// are populated. The subscription state is cached briefly to avoid a DB hit on
// every request.
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubscriptionStatus } from '@prisma/client';
import { ALLOW_EXPIRED_KEY } from '../../decorators/allow-expired.decorator';
import { IS_PUBLIC_KEY } from '../../decorators/public.decorator';
import { JwtPayload } from '../../interfaces/jwt-payload.interface';
import { PrismaService } from '../../../prisma/prisma.service';
import { classify } from '../../../subscriptions/subscription.constants';
import { tr } from '../../../i18n/i18n.service';

const CACHE_TTL_MS = 5000;
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

interface CachedState {
  expired: boolean;
  timestamp: number;
}

@Injectable()
export class SubscriptionGuard implements CanActivate {
  private readonly cache = new Map<number, CachedState>();

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

    const allowExpired = this.reflector.getAllAndOverride<boolean>(
      ALLOW_EXPIRED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowExpired) return true;

    const user: JwtPayload | undefined = req.user;
    if (!user) return true; // JwtAuthGuard rejects unauthenticated requests

    // Platform admins manage subscriptions and are always exempt.
    if (user.isPlatformAdmin) return true;

    // Reads are always allowed — an expired tenant keeps viewing its data.
    const method: string = req.method ?? 'GET';
    if (!MUTATING_METHODS.has(method)) return true;

    const tenantId = req.tenantId ?? null;
    if (tenantId == null) return true; // no active business → nothing to enforce

    if (await this.isExpired(tenantId)) {
      throw new ForbiddenException(tr('errors.subscriptionExpired'));
    }
    return true;
  }

  private async isExpired(orgId: number): Promise<boolean> {
    const now = Date.now();
    const cached = this.cache.get(orgId);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) return cached.expired;

    let expired = false;
    try {
      const sub = await this.prisma.tenantSubscription.findUnique({
        where: { organizationId: orgId },
        select: { status: true, expiresAt: true },
      });
      if (sub) {
        // FREE / LIFETIME never expire; otherwise classify by the expiry date.
        const notBilled =
          sub.status === SubscriptionStatus.FREE ||
          sub.status === SubscriptionStatus.LIFETIME;
        expired = notBilled ? false : classify(sub.expiresAt) === 'EXPIRED';
      }
    } catch {
      // If the lookup fails, don't block traffic; other guards still apply.
    }

    this.cache.set(orgId, { expired, timestamp: now });
    return expired;
  }
}
