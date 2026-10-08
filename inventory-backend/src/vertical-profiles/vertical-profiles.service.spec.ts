// src/vertical-profiles/vertical-profiles.service.spec.ts
import { BusinessType } from '@prisma/client';
import { VerticalProfilesService } from './vertical-profiles.service';

/**
 * Regression tests for the post-login 502:
 *
 *  - `findProfile` is the READ-ONLY lookup used by the business list
 *    (TenantsService.myOrganizations). It must never write, so a missing table
 *    or a concurrent request can never fail the auth flow.
 *  - `getProfile` must use `upsert` (not find-then-create) so two simultaneous
 *    first reads cannot collide on the unique `organizationId`.
 */
describe('VerticalProfilesService profile access', () => {
  function setup(businessType: BusinessType, existing: any) {
    const carWashProfile = {
      findUnique: jest.fn(() => Promise.resolve(existing)),
      create: jest.fn(() => Promise.resolve({ id: 1, organizationId: 7 })),
      upsert: jest.fn(() =>
        Promise.resolve(existing ?? { id: 1, organizationId: 7 }),
      ),
    };
    const prisma: any = {
      organization: {
        findUnique: jest.fn(() =>
          Promise.resolve({ businessType }),
        ),
      },
      carWashProfile,
    };
    return { svc: new VerticalProfilesService(prisma), carWashProfile };
  }

  it('findProfile returns null when no row exists and never writes', async () => {
    const { svc, carWashProfile } = setup(BusinessType.CAR_WASH, null);

    await expect(svc.findProfile(7)).resolves.toBeNull();
    expect(carWashProfile.findUnique).toHaveBeenCalledWith({
      where: { organizationId: 7 },
    });
    expect(carWashProfile.create).not.toHaveBeenCalled();
    expect(carWashProfile.upsert).not.toHaveBeenCalled();
  });

  it('findProfile returns the profile when it exists', async () => {
    const { svc } = setup(BusinessType.CAR_WASH, {
      id: 3,
      organizationId: 7,
      slotMinutes: 45,
    });

    await expect(svc.findProfile(7)).resolves.toEqual({
      businessType: BusinessType.CAR_WASH,
      id: 3,
      organizationId: 7,
      slotMinutes: 45,
    });
  });

  it('getProfile upserts so concurrent first reads cannot collide', async () => {
    const { svc, carWashProfile } = setup(BusinessType.CAR_WASH, null);

    const result = await svc.getProfile(7);
    expect(result).toMatchObject({
      businessType: BusinessType.CAR_WASH,
      organizationId: 7,
    });
    expect(carWashProfile.upsert).toHaveBeenCalledWith({
      where: { organizationId: 7 },
      update: {},
      create: { organizationId: 7 },
    });
    expect(carWashProfile.create).not.toHaveBeenCalled();
  });
});
