// src/common/guards/tenant/tenant.guard.spec.ts
// Multi-business permission scoping: when the active tenant (X-Tenant-Id) differs
// from the user's FIRST membership, the request user's permissions/role/business
// type must be re-scoped to the ACTIVE tenant's membership (never merged).
import { TenantGuard } from './tenant.guard';

function makeContext(user: any, headers: Record<string, string> = {}) {
  const req: any = { user, headers };
  return {
    req,
    ctx: {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any,
  };
}

function makeGuard(membership: any) {
  const prisma: any = {
    membership: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(
          membership &&
            where.userId_organizationId.organizationId === membership.organizationId
            ? membership
            : null,
        ),
      ),
    },
  };
  const reflector: any = { getAllAndOverride: () => false };
  return new TenantGuard(reflector, prisma);
}

describe('TenantGuard multi-business scoping', () => {
  const payload = {
    sub: 7,
    organizationId: 48, // first membership = retail
    businessType: 'RETAIL',
    roleName: 'Owner',
    isSuperuser: true,
    permissions: ['products.view', 'reports.view'],
    memberships: [{ organizationId: 48 }, { organizationId: 61 }],
  };

  it('re-scopes permissions to the active tenant (car wash)', async () => {
    const guard = makeGuard({
      organizationId: 61,
      roleId: 9,
      organization: { businessType: 'CAR_WASH' },
      role: {
        name: 'Owner',
        isSystem: true,
        permissions: [
          { permission: { key: 'carwash.reports.financials' } },
          { permission: { key: 'carwash.reports.view' } },
        ],
      },
    });
    const { ctx, req } = makeContext({ ...payload }, { 'x-tenant-id': '61' });
    await guard.canActivate(ctx);
    expect(req.tenantId).toBe(61);
    expect(req.user.organizationId).toBe(61);
    expect(req.user.businessType).toBe('CAR_WASH');
    expect(req.user.permissions).toEqual([
      'carwash.reports.financials',
      'carwash.reports.view',
    ]);
    // Must NOT carry the retail permissions across.
    expect(req.user.permissions).not.toContain('products.view');
  });

  it('leaves the payload untouched when the active tenant is the first org', async () => {
    const guard = makeGuard({ organizationId: 48 });
    const user = { ...payload };
    const { ctx, req } = makeContext(user, { 'x-tenant-id': '48' });
    await guard.canActivate(ctx);
    expect(req.user).toBe(user); // same reference, not cloned/overridden
    expect(req.user.permissions).toEqual(['products.view', 'reports.view']);
  });

  it('does not mutate the shared cached payload object', async () => {
    const shared = { ...payload };
    const guard = makeGuard({
      organizationId: 61,
      roleId: 9,
      organization: { businessType: 'CAR_WASH' },
      role: { name: 'Owner', isSystem: true, permissions: [{ permission: { key: 'carwash.reports.view' } }] },
    });
    const { ctx, req } = makeContext(shared, { 'x-tenant-id': '61' });
    await guard.canActivate(ctx);
    // The original object must be unchanged (clone attached to the request).
    expect(shared.organizationId).toBe(48);
    expect(shared.permissions).toEqual(['products.view', 'reports.view']);
    expect(req.user).not.toBe(shared);
  });
});
