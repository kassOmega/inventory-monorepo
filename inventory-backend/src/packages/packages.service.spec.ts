// src/packages/packages.service.spec.ts
import { NotFoundException } from '@nestjs/common';
import { PackagesService } from './packages.service';

// getItemizedBill / computePackageOrderBilling resolve the tenant context.
jest.mock('../common/tenant/tenant.context', () => ({
  getCurrentTenantId: jest.fn(() => 1),
  requireTenantId: jest.fn(() => 1),
}));

const ADMIS_UTC_PLUS_3 = 'Africa/Addis_Ababa';

/**
 * Itemized guest bill:
 *  - line items carry createdAt, the business-local weekday + date, the source
 *    service, unit price and line total,
 *  - legacy rows without a unit-price snapshot fall back to gross / quantity,
 *  - the summary separates advance deposits, POS payments and net balance.
 */
describe('PackagesService itemized bill', () => {
  function makeService(folio: any, timezone: string | null = ADMIS_UTC_PLUS_3) {
    const prisma: any = {
      organization: {
        findUnique: jest.fn(() => Promise.resolve({ timezone })),
      },
      guestFolio: { findFirst: jest.fn(() => Promise.resolve(folio)) },
    };
    const service = new PackagesService(prisma, {} as any);
    return { service, prisma };
  }

  const baseFolio = (entries: any[]) => ({
    id: 'folio-1',
    status: 'OPEN',
    settledAt: null,
    packageValuePaid: 1000,
    totalPayments: 200,
    entries,
    packageGuest: {
      id: 'guest-1',
      guestName: 'Abebe',
      roomNumber: '12',
      checkInAt: new Date('2026-01-04T21:30:00Z'),
      checkOutAt: null,
      hotelReservationId: 5,
      status: 'CHECKED_IN',
      package: {
        name: 'Resort Package',
        price: 1000,
        hospitalityService: {
          serviceType: 'FOOD_AND_BEVERAGE',
          customName: null,
          customKey: null,
        },
      },
      hotelReservation: { status: 'CHECKED_IN', room: { number: '12' } },
    },
  });

  it('derives the business-local weekday/date and itemizes each line', async () => {
    const { service } = makeService(
      baseFolio([
        {
          id: 'e1',
          createdAt: new Date('2026-01-04T21:30:00Z'), // Sun 21:30 UTC = Mon 00:30 Addis
          sourceService: 'FOOD_AND_BEVERAGE',
          stationName: 'Kitchen',
          servedByName: 'Sara',
          itemName: 'Doro Wat',
          quantity: 2,
          unitPrice: 150,
          grossPrice: 300,
          packageDiscount: 300,
          netCharge: 0,
        },
        {
          id: 'e2',
          createdAt: new Date('2026-01-05T09:00:00Z'),
          sourceService: 'SPA_AND_WELLNESS',
          stationName: 'Spa',
          servedByName: 'Sara',
          itemName: 'Deep Tissue Massage',
          quantity: 1,
          unitPrice: 500,
          grossPrice: 500,
          packageDiscount: 0,
          netCharge: 500,
        },
      ]),
    );

    const bill = await service.getItemizedBill('guest-1');

    expect(bill.guestId).toBe('guest-1');
    expect(bill.roomNumber).toBe('12');
    expect(bill.items).toHaveLength(2);
    expect(bill.items[0]).toMatchObject({
      weekday: 'Monday',
      date: '2026-01-05',
      sourceService: 'FOOD_AND_BEVERAGE',
      itemName: 'Doro Wat',
      quantity: 2,
      unitPrice: 150,
      totalPrice: 300,
      netCharge: 0,
    });
    expect(bill.items[1]).toMatchObject({
      weekday: 'Monday',
      sourceService: 'SPA_AND_WELLNESS',
      unitPrice: 500,
      totalPrice: 500,
      netCharge: 500,
    });
  });

  it('summarizes advance deposits, partial payments and net balance due', async () => {
    const { service } = makeService(
      baseFolio([
        {
          id: 'e1',
          createdAt: new Date('2026-01-05T09:00:00Z'),
          sourceService: 'FOOD_AND_BEVERAGE',
          itemName: 'Doro Wat',
          quantity: 2,
          unitPrice: 150,
          grossPrice: 300,
          packageDiscount: 100,
          netCharge: 200,
        },
        {
          id: 'e2',
          createdAt: new Date('2026-01-05T10:00:00Z'),
          sourceService: 'SPA_AND_WELLNESS',
          itemName: 'Massage',
          quantity: 1,
          unitPrice: 500,
          grossPrice: 500,
          packageDiscount: 0,
          netCharge: 500,
        },
      ]),
    );

    const { summary } = await service.getItemizedBill('folio-1');

    expect(summary.packageValuePaid).toBe(1000);
    expect(summary.totalGross).toBe(800);
    expect(summary.totalPackageDiscount).toBe(100);
    expect(summary.totalAddOns).toBe(700);
    expect(summary.totalPayments).toBe(200);
    expect(summary.netBalanceDue).toBe(500);
  });

  it('backfills the unit price for legacy rows without a snapshot', async () => {
    const { service } = makeService(
      baseFolio([
        {
          id: 'legacy',
          createdAt: new Date('2026-01-05T09:00:00Z'),
          sourceService: null,
          itemName: 'Old Charge',
          quantity: 3,
          unitPrice: 0, // legacy row
          grossPrice: 300,
          packageDiscount: 0,
          netCharge: 300,
        },
      ]),
    );

    const bill = await service.getItemizedBill('guest-1');
    expect(bill.items[0].unitPrice).toBe(100);
    expect(bill.items[0].totalPrice).toBe(300);
  });

  it('throws when the folio does not exist', async () => {
    const { service } = makeService(null);
    await expect(service.getItemizedBill('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

/**
 * Cross-service entitlement matching + facility pass/credit consumption.
 */
describe('PackagesService cross-service entitlements', () => {
  function makeService() {
    const tx: any = {
      packageGuest: { findFirst: jest.fn() },
      packageGuestEntitlementUsage: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        upsert: jest.fn(() => Promise.resolve({})),
      },
      organization: {
        findUnique: jest.fn(() => Promise.resolve({ timezone: 'UTC' })),
      },
    };
    const prisma: any = {};
    const service = new PackagesService(prisma, {} as any);
    return { service, tx };
  }

  const entitlement = (over: any = {}) => ({
    id: 'e1',
    entitlementKind: 'ITEM',
    stationId: null,
    menuCategoryId: null,
    menuItemId: null,
    hospitalityServiceId: null,
    membershipTypeId: null,
    allowanceValue: 0,
    dailyLimit: null,
    ...over,
  });

  it('prefers item > category > station > service credit', () => {
    const { service } = makeService();
    const match = (service as any).matchEntitlement.bind(service);

    const item = entitlement({ id: 'item', stationId: 7, menuItemId: 42 });
    const cat = entitlement({ id: 'cat', stationId: 7, menuCategoryId: 3 });
    const station = entitlement({ id: 'station', stationId: 7 });
    const credit = entitlement({
      id: 'credit',
      entitlementKind: 'CREDIT',
      hospitalityServiceId: 'svc-fnb',
    });

    expect(
      match([credit, station, cat, item], {
        stationId: 7,
        menuCategoryId: 3,
        menuItemId: 42,
        hospitalityServiceId: 'svc-fnb',
      }).id,
    ).toBe('item');
    expect(
      match([credit, station, cat], {
        stationId: 7,
        menuCategoryId: 3,
        menuItemId: 99,
        hospitalityServiceId: 'svc-fnb',
      }).id,
    ).toBe('cat');
    expect(
      match([credit, station], {
        stationId: 7,
        menuCategoryId: 9,
        menuItemId: 99,
      }).id,
    ).toBe('station');
    // No station match -> the service-wide credit still covers it.
    expect(
      match([credit], {
        stationId: 8,
        menuCategoryId: 3,
        menuItemId: 42,
        hospitalityServiceId: 'svc-fnb',
      }).id,
    ).toBe('credit');
  });

  it('consumes a PASS entitlement at $0 for a facility visit', async () => {
    const { service, tx } = makeService();
    tx.packageGuest.findFirst.mockResolvedValue({
      id: 'g1',
      package: {
        entitlements: [
          entitlement({
            entitlementKind: 'PASS',
            hospitalityServiceId: 'svc-spa',
            dailyLimit: 1,
          }),
        ],
      },
    });

    const res = await service.computeFacilityEntitlement(tx, {
      organizationId: 1,
      packageGuestId: 'g1',
      hospitalityServiceId: 'svc-spa',
      amount: 500,
    });

    expect(res).toMatchObject({
      covered: true,
      entitlementId: 'e1',
      entitlementKind: 'PASS',
      packageDiscount: 500,
      netCharge: 0,
    });
    expect(tx.packageGuestEntitlementUsage.upsert).toHaveBeenCalled();
  });

  it('covers only the credit allowance and routes the overage', async () => {
    const { service, tx } = makeService();
    tx.packageGuest.findFirst.mockResolvedValue({
      id: 'g1',
      package: {
        entitlements: [
          entitlement({
            entitlementKind: 'CREDIT',
            hospitalityServiceId: 'svc-fnb',
            allowanceValue: 200,
          }),
        ],
      },
    });

    const res = await service.computeFacilityEntitlement(tx, {
      organizationId: 1,
      packageGuestId: 'g1',
      hospitalityServiceId: 'svc-fnb',
      amount: 500,
    });

    expect(res).toMatchObject({
      covered: false,
      packageDiscount: 200,
      netCharge: 300,
    });
  });

  it('leaves the charge untouched when no service entitlement exists', async () => {
    const { service, tx } = makeService();
    tx.packageGuest.findFirst.mockResolvedValue({
      id: 'g1',
      package: {
        entitlements: [entitlement({ hospitalityServiceId: 'svc-other' })],
      },
    });

    const res = await service.computeFacilityEntitlement(tx, {
      organizationId: 1,
      packageGuestId: 'g1',
      hospitalityServiceId: 'svc-spa',
      amount: 500,
    });

    expect(res).toMatchObject({
      covered: false,
      entitlementId: null,
      packageDiscount: 0,
      netCharge: 500,
    });
    expect(tx.packageGuestEntitlementUsage.upsert).not.toHaveBeenCalled();
  });

  it('stops covering once the daily limit is exhausted', async () => {
    const { service, tx } = makeService();
    tx.packageGuest.findFirst.mockResolvedValue({
      id: 'g1',
      package: {
        entitlements: [
          entitlement({
            entitlementKind: 'PASS',
            hospitalityServiceId: 'svc-spa',
            dailyLimit: 1,
          }),
        ],
      },
    });
    tx.packageGuestEntitlementUsage.findUnique.mockResolvedValue({
      quantityUsed: 1,
      valueUsed: 500,
    });

    const res = await service.computeFacilityEntitlement(tx, {
      organizationId: 1,
      packageGuestId: 'g1',
      hospitalityServiceId: 'svc-spa',
      amount: 500,
    });

    expect(res).toMatchObject({
      covered: false,
      packageDiscount: 0,
      netCharge: 500,
      remainingUnits: 0,
    });
    expect(tx.packageGuestEntitlementUsage.upsert).not.toHaveBeenCalled();
  });
});
