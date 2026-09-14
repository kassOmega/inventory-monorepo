// src/restaurant/restaurant.pension.spec.ts
import { BadRequestException } from '@nestjs/common';
import { RestaurantService } from './restaurant.service';

// isAccommodationOnly / createOrder resolve the request tenant.
jest.mock('../common/tenant/tenant.context', () => ({
  getCurrentTenantId: jest.fn(() => 1),
  requireTenantId: jest.fn(() => 1),
}));

/**
 * Standalone pension rule: a HOSPITALITY business whose only enabled service is
 * ACCOMMODATION bills strictly room rates + front-desk add-ons — food &
 * beverage ordering and cross-service folio posting are rejected.
 */
describe('Standalone pension billing restriction', () => {
  function makeService(org: any) {
    const prisma: any = {
      organization: { findUnique: jest.fn(() => Promise.resolve(org)) },
      hospitalityService: { findMany: jest.fn(() => Promise.resolve([])) },
    };
    const service = new RestaurantService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, prisma };
  }

  it('flags an Accommodation-only hospitality business', async () => {
    const { service } = makeService({
      businessType: 'HOSPITALITY',
      enabledHospitalityServices: ['ACCOMMODATION'],
    });
    await expect((service as any).isAccommodationOnly(1)).resolves.toBe(true);
  });

  it('does not flag a hotel that also offers F&B', async () => {
    const { service } = makeService({
      businessType: 'HOSPITALITY',
      enabledHospitalityServices: ['ACCOMMODATION', 'FOOD_AND_BEVERAGE'],
    });
    await expect((service as any).isAccommodationOnly(1)).resolves.toBe(false);
  });

  it('falls back to the service rows for legacy orgs', async () => {
    const { service, prisma } = makeService({
      businessType: 'HOSPITALITY',
      enabledHospitalityServices: [],
    });
    prisma.hospitalityService.findMany.mockResolvedValue([
      { serviceType: 'ACCOMMODATION' },
    ]);
    await expect((service as any).isAccommodationOnly(1)).resolves.toBe(true);
  });

  it('ignores CUSTOM services when deciding', async () => {
    const { service } = makeService({
      businessType: 'HOSPITALITY',
      enabledHospitalityServices: ['ACCOMMODATION', 'CUSTOM'],
    });
    await expect((service as any).isAccommodationOnly(1)).resolves.toBe(true);
  });

  it('rejects food & beverage ordering for a pension', async () => {
    const { service } = makeService({
      businessType: 'HOSPITALITY',
      enabledHospitalityServices: ['ACCOMMODATION'],
    });
    await expect(
      service.createOrder(
        { items: [{ menuItemId: 1, quantity: 1 }] } as any,
        { sub: 1 } as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('never restricts a retail business', async () => {
    const { service } = makeService({
      businessType: 'RETAIL',
      enabledHospitalityServices: [],
    });
    await expect((service as any).isAccommodationOnly(1)).resolves.toBe(false);
  });
});
