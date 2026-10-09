// src/common/guards/tenant/tenant.guard.ts
// Resolves the active organization (tenant) for the request and attaches it to
// `req.tenantId`. The active tenant is either:
//   - the `X-Tenant-Id` header (must be one of the user's memberships), or
//   - the user's default organization from the JWT.
// Registered as a global guard after JwtAuthGuard (so `req.user` is populated).
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../decorators/public.decorator';
import { JwtPayload } from '../../interfaces/jwt-payload.interface';
import { PrismaService } from '../../../prisma/prisma.service';
import { tr } from '../../../i18n/i18n.service';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const user: JwtPayload | undefined = req.user;
    if (!user) return true; // JwtAuthGuard already rejects unauthenticated requests

    const headerOrg = this.parseTenantHeader(req.headers?.['x-tenant-id']);

    let tenantId: number | null;
    if (headerOrg !== null) {
      const inPayload =
        user.memberships?.some((m) => m.organizationId === headerOrg) ?? false;
      if (!inPayload) {
        // The JWT validation payload can be up to 10s stale (cached), so right
        // after a membership change (e.g. a business was just created) the new
        // org is NOT in the payload even though the user is now a member.
        // Verify against the database before rejecting — this prevents the
        // post-creation reload from being treated as a session failure.
        const membership = await this.prisma.membership.findUnique({
          where: {
            userId_organizationId: {
              userId: user.sub,
              organizationId: headerOrg,
            },
          },
          select: { id: true },
        });
        if (!membership) {
          throw new ForbiddenException(
            tr('errors.notOrgMember'),
          );
        }
      }
      tenantId = headerOrg;
    } else {
      tenantId = user.organizationId ?? null;
    }

    req.tenantId = tenantId;

    // The JWT payload's `permissions`/`roleName`/`businessType`/`isSuperuser` are
    // derived from the user's FIRST membership, so switching to another business
    // would otherwise keep the wrong permission set (menu, guards and per-detail
    // redaction all key on `req.user.permissions`). Re-scope them to the active
    // tenant's membership — never merging across organizations.
    //
    // The JwtStrategy caches and reuses the SAME payload object across requests
    // for up to 10s, so we must NOT mutate it in place; we attach a shallow clone
    // to this request instead.
    if (tenantId != null && user.organizationId !== tenantId) {
      const scoped = await this.scopeUserToTenant(user, tenantId);
      if (scoped) req.user = scoped;
    }

    return true;
  }

  /**
   * Return a COPY of the request user with its tenant-derived fields replaced by
   * the active org's membership (role, permissions, business type). Returns null
   * when the user has no membership in the active tenant (other guards enforce
   * membership), leaving the payload untouched.
   */
  private async scopeUserToTenant(
    user: JwtPayload,
    tenantId: number,
  ): Promise<JwtPayload | null> {
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: { userId: user.sub, organizationId: tenantId },
      },
      include: {
        organization: { select: { businessType: true } },
        role: {
          include: { permissions: { include: { permission: true } } },
        },
      },
    });
    if (!membership) return null;

    return {
      ...user,
      organizationId: tenantId,
      businessType:
        membership.organization?.businessType ?? user.businessType,
      roleId: membership.roleId ?? null,
      roleName: membership.role?.name ?? null,
      // System (owner) roles bypass permission checks; mirror the payload logic.
      isSuperuser: membership.role?.isSystem ?? false,
      permissions:
        membership.role?.permissions?.map((p) => p.permission.key) ?? [],
    };
  }

  private parseTenantHeader(value: unknown): number | null {
    if (value === undefined || value === null) return null;
    const raw = Array.isArray(value) ? value[0] : value;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
}
