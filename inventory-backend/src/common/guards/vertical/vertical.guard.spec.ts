// src/common/guards/vertical/vertical.guard.spec.ts
// The vertical boundary: a @Vertical(...) controller must only answer for a
// matching business type. This is what stops a HOSPITALITY organization from
// reading SERVICE/MANUFACTURING data through the API when its shared role
// template happens to hold the permission key (e.g. hospitality Manager holds
// `service.*`, retail Storekeeper holds `manufacturing.*`).
import { ForbiddenException } from '@nestjs/common';
import { BusinessType } from '@prisma/client';
import { VerticalGuard } from './vertical.guard';

/**
 * Minimal ExecutionContext stub exposing exactly what the guard reads. An
 * authenticated user is present by default (the JwtAuthGuard handles the
 * unauthenticated case); pass `user: undefined` to remove it.
 */
function ctx(request: Record<string, unknown>) {
  const req = { user: { sub: 1 }, ...request };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as any;
}

function makeGuard(
  orgType: BusinessType | null,
  allowed: BusinessType[] | undefined,
) {
  const reflector = {
    getAllAndOverride: jest.fn(() => allowed),
  };
  const prisma = {
    organization: {
      findUnique: jest.fn(async () =>
        orgType ? { businessType: orgType } : null,
      ),
    },
  };
  return {
    guard: new VerticalGuard(reflector as any, prisma as any),
    prisma,
  };
}

describe('VerticalGuard', () => {
  const original = process.env.VERTICAL_ENFORCEMENT;

  afterEach(() => {
    process.env.VERTICAL_ENFORCEMENT = original;
    jest.restoreAllMocks();
  });

  it('ignores controllers that are not marked @Vertical', async () => {
    process.env.VERTICAL_ENFORCEMENT = 'true';
    const { guard, prisma } = makeGuard(BusinessType.HOSPITALITY, undefined);

    await expect(guard.canActivate(ctx({ tenantId: 26 }))).resolves.toBe(true);
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
  });

  it('is a no-op when enforcement is off, and warns once', async () => {
    process.env.VERTICAL_ENFORCEMENT = 'false';
    const { guard } = makeGuard(BusinessType.HOSPITALITY, [
      BusinessType.SERVICE,
    ]);
    const warn = jest.spyOn((guard as any).logger, 'warn').mockImplementation();

    await expect(guard.canActivate(ctx({ tenantId: 26 }))).resolves.toBe(true);
    await expect(guard.canActivate(ctx({ tenantId: 26 }))).resolves.toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/enforcement is OFF/i);
  });

  it('rejects a hospitality organization on a SERVICE controller', async () => {
    process.env.VERTICAL_ENFORCEMENT = 'true';
    const { guard } = makeGuard(BusinessType.HOSPITALITY, [
      BusinessType.SERVICE,
    ]);

    await expect(
      guard.canActivate(ctx({ tenantId: 26 })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a retail organization on a MANUFACTURING controller', async () => {
    process.env.VERTICAL_ENFORCEMENT = 'true';
    const { guard } = makeGuard(BusinessType.RETAIL, [
      BusinessType.MANUFACTURING,
    ]);

    await expect(
      guard.canActivate(ctx({ tenantId: 24 })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a matching organization and caches the lookup', async () => {
    process.env.VERTICAL_ENFORCEMENT = 'true';
    const { guard, prisma } = makeGuard(BusinessType.SERVICE, [
      BusinessType.SERVICE,
    ]);

    await expect(guard.canActivate(ctx({ tenantId: 27 }))).resolves.toBe(true);
    await expect(guard.canActivate(ctx({ tenantId: 27 }))).resolves.toBe(true);
    expect(prisma.organization.findUnique).toHaveBeenCalledTimes(1);
  });

  it('allows any vertical for a multi-vertical controller', async () => {
    process.env.VERTICAL_ENFORCEMENT = 'true';
    const { guard } = makeGuard(BusinessType.HOSPITALITY, [
      BusinessType.HOSPITALITY,
      BusinessType.SERVICE,
    ]);

    await expect(guard.canActivate(ctx({ tenantId: 26 }))).resolves.toBe(true);
  });

  it('leaves platform admins exempt', async () => {
    process.env.VERTICAL_ENFORCEMENT = 'true';
    const { guard, prisma } = makeGuard(BusinessType.HOSPITALITY, [
      BusinessType.SERVICE,
    ]);

    await expect(
      guard.canActivate(ctx({ tenantId: 26, user: { isPlatformAdmin: true } })),
    ).resolves.toBe(true);
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
  });

  it('does not exempt ordinary owners (isSuperuser is per-org, not cross-org)', async () => {
    process.env.VERTICAL_ENFORCEMENT = 'true';
    const { guard } = makeGuard(BusinessType.HOSPITALITY, [
      BusinessType.SERVICE,
    ]);

    await expect(
      guard.canActivate(ctx({ tenantId: 26, user: { isSuperuser: true } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('skips the check when no active organization is resolvable', async () => {
    process.env.VERTICAL_ENFORCEMENT = 'true';
    const { guard, prisma } = makeGuard(BusinessType.HOSPITALITY, [
      BusinessType.SERVICE,
    ]);

    await expect(guard.canActivate(ctx({}))).resolves.toBe(true);
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
  });

  it('skips the check for an unauthenticated request', async () => {
    process.env.VERTICAL_ENFORCEMENT = 'true';
    const { guard, prisma } = makeGuard(BusinessType.HOSPITALITY, [
      BusinessType.SERVICE,
    ]);

    await expect(
      guard.canActivate(ctx({ tenantId: 26, user: undefined })),
    ).resolves.toBe(true);
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
  });

  it('fails open when the organization lookup errors', async () => {
    process.env.VERTICAL_ENFORCEMENT = 'true';
    const { guard, prisma } = makeGuard(null, [BusinessType.SERVICE]);
    prisma.organization.findUnique.mockRejectedValue(new Error('db down'));

    await expect(guard.canActivate(ctx({ tenantId: 26 }))).resolves.toBe(true);
  });
});
