// src/facilities/facilities.service.spec.ts
import { BadRequestException } from '@nestjs/common';
import { FacilitiesService } from './facilities.service';

// check-in resolves the request tenant.
jest.mock('../common/tenant/tenant.context', () => ({
  getCurrentTenantId: jest.fn(() => 1),
  requireTenantId: jest.fn(() => 1),
}));

/**
 * Facility check-in settlement routing:
 *  - a package guest's PASS/CREDIT entitlement covers the visit at $0,
 *  - any uncovered overage is routed by settlementMode: PAY_NOW queues a
 *    facility payment, DEFER_TO_FOLIO posts an itemized room-folio line.
 */
describe('FacilitiesService package check-in routing', () => {
  const serviceRow = {
    id: 'svc-spa',
    serviceType: 'SPA_AND_WELLNESS',
    organizationId: 1,
  };

  function makeService(coverage: any) {
    const tx: any = {
      facilityVisit: {
        create: jest.fn(() => Promise.resolve({ id: 'visit-1' })),
      },
      facilityPayment: {
        create: jest.fn(() => Promise.resolve({ id: 77 })),
      },
      guestFolioEntry: {
        create: jest.fn(() => Promise.resolve({ id: 'entry-1' })),
      },
      guestFolio: { update: jest.fn(() => Promise.resolve({})) },
    };
    const prisma: any = {
      hospitalityService: {
        findFirst: jest.fn(() => Promise.resolve(serviceRow)),
      },
      packageGuest: {
        findFirst: jest.fn(() =>
          Promise.resolve({
            id: 'g1',
            guestName: 'Abebe',
            roomNumber: '12',
            folio: { id: 'folio-1' },
          }),
        ),
      },
      membershipType: {
        findFirst: jest.fn(() =>
          Promise.resolve({ id: 'pass-1', name: 'Day Pass', price: 500 }),
        ),
      },
      organization: {
        findUnique: jest.fn(() => Promise.resolve({ settings: {} })),
      },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    const packages: any = {
      computeFacilityEntitlement: jest.fn(() => Promise.resolve(coverage)),
    };
    const service = new FacilitiesService(prisma, packages);
    return { service, prisma, tx, packages };
  }

  const creditCoverage = {
    covered: false,
    entitlementId: 'e1',
    entitlementKind: 'CREDIT',
    packageDiscount: 200,
    netCharge: 300,
    remainingUnits: null,
  };

  it('routes an uncovered overage to PAY_NOW (facility payment)', async () => {
    const { service, tx } = makeService(creditCoverage);

    const res = await service.checkIn(
      'svc-spa',
      {
        type: 'PACKAGE',
        packageGuestId: 'g1',
        amount: 500,
        settlementMode: 'PAY_NOW',
      } as any,
      5,
    );

    expect(tx.facilityPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 300 }),
      }),
    );
    expect(tx.guestFolioEntry.create).not.toHaveBeenCalled();
    expect(res).toMatchObject({
      settlementMode: 'PAY_NOW',
      netCharge: 300,
      paymentId: 77,
      folioEntryId: null,
    });
  });

  it('defers an uncovered overage to the guest folio', async () => {
    const { service, tx } = makeService(creditCoverage);

    const res = await service.checkIn(
      'svc-spa',
      {
        type: 'PACKAGE',
        packageGuestId: 'g1',
        amount: 500,
        settlementMode: 'DEFER_TO_FOLIO',
      } as any,
      5,
    );

    expect(tx.guestFolioEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceService: 'SPA_AND_WELLNESS',
          unitPrice: 300,
          packageDiscount: 200,
          netCharge: 300,
        }),
      }),
    );
    expect(tx.guestFolio.update).toHaveBeenCalled();
    expect(tx.facilityPayment.create).not.toHaveBeenCalled();
    expect(res).toMatchObject({
      settlementMode: 'DEFER_TO_FOLIO',
      folioEntryId: 'entry-1',
      paymentId: null,
    });
  });

  it('checks in at $0 when the entitlement fully covers the visit', async () => {
    const { service, tx } = makeService({
      covered: true,
      entitlementId: 'e1',
      entitlementKind: 'PASS',
      packageDiscount: 500,
      netCharge: 0,
      remainingUnits: 0,
    });

    const res = await service.checkIn(
      'svc-spa',
      { type: 'PACKAGE', packageGuestId: 'g1', amount: 500 } as any,
      5,
    );

    expect(tx.guestFolioEntry.create).not.toHaveBeenCalled();
    expect(tx.facilityPayment.create).not.toHaveBeenCalled();
    expect(res).toMatchObject({
      settlementMode: 'COVERED',
      covered: true,
      netCharge: 0,
    });
  });

  it('requires the package guest id', async () => {
    const { service } = makeService(creditCoverage);
    await expect(
      service.checkIn('svc-spa', { type: 'PACKAGE' } as any, 5),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
