// src/restaurant/restaurant.room-charge.spec.ts
import { BadRequestException } from '@nestjs/common';
import { RestaurantService } from './restaurant.service';

// createOrder / resolveRoomCharge resolve the request tenant.
jest.mock('../common/tenant/tenant.context', () => ({
  getCurrentTenantId: jest.fn(() => 1),
  requireTenantId: jest.fn(() => 1),
}));

/**
 * Charge-to-room (Option A):
 *  - a ROOM_CHARGE order linked to a checked-in stay is billed to that stay's
 *    folio with itemized FolioEntry lines (sourceService + unitPrice snapshot);
 *  - a stay that also has a package guest routes through entitlements instead
 *    (GuestFolioEntry), leaving the package behaviour untouched;
 *  - the target is validated and gated by the company policy.
 */
describe('RestaurantService charge-to-room', () => {
  const baseOrg = {
    businessType: 'HOSPITALITY',
    enabledHospitalityServices: ['ACCOMMODATION', 'FOOD_AND_BEVERAGE'],
    settings: { enableRoomFolioCharging: true, enablePackageRouting: false },
  };

  function makeService(
    options: {
      reservation?: any;
      packageBilling?: any;
      org?: any;
      guestFolioId?: string | null;
    } = {},
  ) {
    const orderCreate = jest.fn(({ data }: any) =>
      Promise.resolve({
        // `data.items` is a nested `create`, so override it with the real rows.
        ...data,
        id: 9,
        orderNumber: 'ORD-1',
        items: [{ id: 100, stationRoute: [] }],
      }),
    );
    const tx: any = {
      menuItem: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: 7,
            name: 'Doro Wat',
            price: 150,
            cost: 0,
            menuCategoryId: 2,
            menuCategory: { stationRoute: [] },
            stationRoute: null,
          }),
        ),
      },
      user: { findUnique: jest.fn(() => Promise.resolve({ name: 'Sara' })) },
      order: { create: orderCreate },
      guestFolio: {
        findFirst: jest.fn(() =>
          Promise.resolve(
            options.guestFolioId ? { id: options.guestFolioId } : null,
          ),
        ),
      },
      guestFolioEntry: {
        create: jest.fn(() => Promise.resolve({ id: 'gfe-1' })),
      },
      folio: {
        findFirst: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(() => Promise.resolve({ id: 'folio-1' })),
      },
      folioEntry: { create: jest.fn(() => Promise.resolve({ id: 1 })) },
      diningTable: { update: jest.fn(() => Promise.resolve({})) },
    };
    const prisma: any = {
      organization: {
        findUnique: jest.fn(() => Promise.resolve(options.org ?? baseOrg)),
      },
      hospitalityService: { findMany: jest.fn(() => Promise.resolve([])) },
      hotelReservation: {
        findFirst: jest.fn(() =>
          Promise.resolve(
            options.reservation === undefined
              ? {
                  id: 5,
                  guestName: 'John Doe',
                  room: { number: '104' },
                  packageGuests: [],
                }
              : options.reservation,
          ),
        ),
      },
      restaurantStation: { findMany: jest.fn(() => Promise.resolve([])) },
      orderStatusHistory: { create: jest.fn(() => Promise.resolve({})) },
      user: { findUnique: jest.fn(() => Promise.resolve({ name: 'Sara' })) },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    const packages: any = {
      computePackageOrderBilling: jest.fn(() =>
        Promise.resolve(options.packageBilling ?? null),
      ),
    };
    const recipes: any = {
      liveMenuItemCost: jest.fn(() => Promise.resolve(null)),
    };
    const notifications: any = {
      notifyRoleId: jest.fn(() => Promise.resolve()),
      notifyRole: jest.fn(() => Promise.resolve()),
    };
    const service = new RestaurantService(
      prisma,
      notifications,
      {} as any,
      packages,
      recipes,
    );
    return { service, prisma, tx, packages };
  }

  const user: any = {
    sub: 1,
    email: 'sara@x.com',
    roleName: 'Waiter',
    permissions: [],
  };

  it('bills a standard stay: itemized FolioEntry lines with sourceService + unitPrice', async () => {
    const { service, tx } = makeService();

    await service.createOrder(
      {
        items: [{ menuItemId: 7, quantity: 2 }],
        billing: {
          type: 'ROOM_CHARGE',
          hotelReservationId: 5,
          netChargeMode: 'DEFER_TO_FOLIO',
        },
      } as any,
      user,
    );

    // The order is linked to the stay, has no table, and defers to the folio.
    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          billingType: 'ROOM_CHARGE',
          hotelReservationId: 5,
          netChargeMode: 'FOLIO',
          tableId: null,
          guestTag: '[Room 104]',
        }),
      }),
    );
    // Itemized stay-folio line, mirroring GuestFolioEntry.
    expect(tx.folioEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceService: 'FOOD_AND_BEVERAGE',
          unitPrice: 150,
          amount: 300,
          description: 'Doro Wat × 2',
          type: 'CHARGE',
        }),
      }),
    );
    expect(tx.guestFolioEntry.create).not.toHaveBeenCalled();
    expect(tx.diningTable.update).not.toHaveBeenCalled();
  });

  it('routes through entitlements when the stay has a package guest', async () => {
    const { service, tx, packages } = makeService({
      reservation: {
        id: 5,
        guestName: 'John Doe',
        room: { number: '104' },
        packageGuests: [{ id: 'pg-1' }],
      },
      org: {
        businessType: 'HOSPITALITY',
        enabledHospitalityServices: ['ACCOMMODATION', 'FOOD_AND_BEVERAGE'],
        settings: { enableRoomFolioCharging: true, enablePackageRouting: true },
      },
      guestFolioId: 'gf-1',
      packageBilling: {
        packageId: 'pkg-1',
        packageName: 'All-Inclusive',
        roomNumber: '104',
        guestName: 'John Doe',
        sourceService: 'FOOD_AND_BEVERAGE',
        sourceServiceName: null,
        results: [{ index: 0, packageDiscount: 300, netCharge: 0 }],
        totalPackageDiscount: 300,
        folioEntries: [
          {
            stationName: 'Kitchen',
            servedByName: 'Sara',
            itemName: 'Doro Wat',
            quantity: 2,
            unitPrice: 150,
            grossPrice: 300,
            packageDiscount: 300,
            netCharge: 0,
          },
        ],
      },
    });

    await service.createOrder(
      {
        items: [{ menuItemId: 7, quantity: 2 }],
        billing: { type: 'ROOM_CHARGE', hotelReservationId: 5 },
      } as any,
      user,
    );

    // Resolved package guest wins: entitlements cover the line.
    expect(packages.computePackageOrderBilling).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ packageGuestId: 'pg-1' }),
    );
    expect(tx.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          billingType: 'ROOM_CHARGE',
          packageGuestId: 'pg-1',
          hotelReservationId: 5,
          packageDiscount: 300,
        }),
      }),
    );
    expect(tx.guestFolioEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceService: 'FOOD_AND_BEVERAGE',
          unitPrice: 150,
          netCharge: 0,
        }),
      }),
    );
    // No duplicate stay-folio line when a package folio covers the charge.
    expect(tx.folioEntry.create).not.toHaveBeenCalled();
  });

  it('rejects charge-to-room when room folio charging is disabled', async () => {
    const { service } = makeService({
      org: {
        businessType: 'HOSPITALITY',
        enabledHospitalityServices: ['ACCOMMODATION', 'FOOD_AND_BEVERAGE'],
        settings: { enableRoomFolioCharging: false },
      },
    });

    await expect(
      service.createOrder(
        {
          items: [{ menuItemId: 7, quantity: 1 }],
          billing: { type: 'ROOM_CHARGE', hotelReservationId: 5 },
        } as any,
        user,
      ),
    ).rejects.toThrow(/Room folio charging is disabled/);
  });

  it('rejects a stay that is not confirmed or checked in', async () => {
    const { service } = makeService({ reservation: null });

    await expect(
      service.createOrder(
        {
          items: [{ menuItemId: 7, quantity: 1 }],
          billing: { type: 'ROOM_CHARGE', hotelReservationId: 5 },
        } as any,
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires a package guest or a hotel reservation', async () => {
    const { service } = makeService();

    await expect(
      service.createOrder(
        {
          items: [{ menuItemId: 7, quantity: 1 }],
          billing: { type: 'ROOM_CHARGE' },
        } as any,
        user,
      ),
    ).rejects.toThrow(/requires a package guest or a hotel reservation/);
  });
});
