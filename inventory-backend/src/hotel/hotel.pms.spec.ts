// src/hotel/hotel.pms.spec.ts
// Front-desk PMS behaviour added by the hotel refactor:
//  - date-range room availability (with same-day turnover) + double-booking guard
//  - continuous room posting (one idempotent ACCOMMODATION line per stay)
//  - the consolidated stay bill (staff attribution per line)
//  - the single-modal atomic checkout
//  - the tenant-scoped guest ID-type registry
import { BadRequestException } from '@nestjs/common';
import { HotelService } from './hotel.service';

jest.mock('../common/tenant/tenant.context', () => ({
  getCurrentTenantId: jest.fn(() => 1),
  requireTenantId: jest.fn(() => 1),
}));

/** Shared Prisma double: every model is a jest mock, $transaction runs inline. */
function makeHarness() {
  const prisma: any = {
    organization: {
      findUnique: jest.fn(async () => ({
        taxEnabled: false,
        taxInclusive: true,
      })),
    },
    taxRate: { findFirst: jest.fn(async () => null) },
    hotelReservation: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      create: jest.fn(async (a: any) => ({ id: 99, ...a.data })),
      update: jest.fn(async (a: any) => ({ id: a.where.id, ...a.data })),
      delete: jest.fn(async () => ({})),
    },
    room: {
      findUnique: jest.fn(async () => null),
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      update: jest.fn(async (a: any) => ({ id: a.where.id, ...a.data })),
    },
    folio: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async (a: any) => ({ id: 500, ...a.data })),
      update: jest.fn(async (a: any) => ({ id: a.where.id, ...a.data })),
    },
    folioEntry: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async (a: any) => ({ id: 900, ...a.data })),
      update: jest.fn(async (a: any) => ({ id: a.where.id, ...a.data })),
    },
    guestIdType: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null),
      create: jest.fn(async (a: any) => ({ id: 7, ...a.data })),
      update: jest.fn(async (a: any) => ({ id: a.where.id, ...a.data })),
    },
    packageGuest: {
      findMany: jest.fn(async () => []),
      update: jest.fn(async (a: any) => ({ id: a.where.id, ...a.data })),
    },
    guestFolio: {
      update: jest.fn(async (a: any) => ({ id: a.where.id, ...a.data })),
    },
    user: {
      findUnique: jest.fn(async () => ({
        id: 7,
        name: 'Selam Tadesse',
        role: { name: 'Receptionist' },
      })),
    },
  };
  // The service always calls $transaction; run the callback against the same
  // mock so assertions can inspect the writes it made.
  prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));

  const finance = {
    postFolioIncome: jest.fn(async () => 1),
    postPackageFolioIncome: jest.fn(async () => 1),
  };
  const service = new HotelService(prisma, finance as any);
  return { service, prisma, finance };
}

describe('HotelService room availability', () => {
  it('excludes overlapping bookings and groups the rest by room type', async () => {
    const { service, prisma } = makeHarness();
    prisma.hotelReservation.findMany.mockResolvedValue([{ roomId: 1 }]);
    prisma.room.findMany.mockResolvedValue([
      {
        id: 2,
        number: '104',
        floor: '1',
        roomTypeId: 10,
        roomType: { id: 10, name: 'Deluxe', basePrice: 1200 },
      },
      {
        id: 3,
        number: '105',
        floor: '1',
        roomTypeId: 10,
        roomType: { id: 10, name: 'Deluxe', basePrice: 1200 },
      },
      {
        id: 4,
        number: '201',
        floor: '2',
        roomTypeId: 11,
        roomType: { id: 11, name: 'Suite', basePrice: 3000 },
      },
    ]);

    const result = await service.listAvailableRooms({
      checkInDate: '2026-01-04',
      checkOutDate: '2026-01-06',
    });

    // The busy room is filtered out at the DB level.
    expect(prisma.room.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { notIn: [1] } }),
      }),
    );
    expect(result.nights).toBe(2);
    expect(result.totalAvailable).toBe(3);
    const deluxe = result.roomTypes.find((g) => g.roomTypeId === 10)!;
    expect(deluxe.availableCount).toBe(2);
    expect(deluxe.totalForStay).toBe(2400);
    expect(deluxe.rooms.map((r) => r.number)).toEqual(['104', '105']);
    expect(
      result.roomTypes.find((g) => g.roomTypeId === 11)!.totalForStay,
    ).toBe(6000);
  });

  it('treats a stay ending on the requested check-in as a same-day turnover', async () => {
    const { service, prisma } = makeHarness();
    prisma.room.findMany.mockResolvedValue([]);

    await service.listAvailableRooms({
      checkInDate: '2026-01-06',
      checkOutDate: '2026-01-08',
    });

    // Half-open interval overlap: existing.checkIn < requested.checkOut AND
    // existing.checkOut > requested.checkIn — equal boundaries never clash.
    const clashQuery = prisma.hotelReservation.findMany.mock.calls[0][0];
    expect(clashQuery.where.checkIn).toEqual({ lt: new Date('2026-01-08') });
    expect(clashQuery.where.checkOut).toEqual({ gt: new Date('2026-01-06') });
    expect(clashQuery.where.status.in).toEqual(['CONFIRMED', 'CHECKED_IN']);
  });

  it('rejects an availability search whose check-out is not after check-in', async () => {
    const { service } = makeHarness();
    await expect(
      service.listAvailableRooms({
        checkInDate: '2026-01-06',
        checkOutDate: '2026-01-06',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to create a reservation that overlaps an active booking', async () => {
    const { service, prisma } = makeHarness();
    prisma.room.findUnique.mockResolvedValue({
      id: 2,
      roomType: { id: 10, basePrice: 1200 },
    });
    prisma.hotelReservation.findFirst.mockResolvedValue({
      id: 42,
      guestName: 'Existing Guest',
      checkIn: new Date('2026-01-04'),
      checkOut: new Date('2026-01-07'),
    });

    await expect(
      service.createReservation({
        roomId: 2,
        guestName: 'New Guest',
        checkIn: '2026-01-05',
        checkOut: '2026-01-06',
      }),
    ).rejects.toThrow(/already booked/i);
    expect(prisma.hotelReservation.create).not.toHaveBeenCalled();
  });
});
describe('HotelService check-in room posting', () => {
  const reservation = {
    id: 5,
    tenantId: 1,
    roomId: 9,
    guestName: 'John Doe',
    status: 'CONFIRMED',
    checkIn: new Date('2026-01-04'),
    checkOut: new Date('2026-01-06'),
    totalAmount: 2400,
    room: { id: 9, number: '104', roomType: { id: 10, name: 'Deluxe' } },
  };

  it('posts exactly one ACCOMMODATION line and records the registration + greeter', async () => {
    const { service, prisma } = makeHarness();
    prisma.hotelReservation.findFirst.mockResolvedValue({ ...reservation });

    await service.checkIn(
      5,
      {
        idTypeId: 1,
        idNumber: 'ET-123456',
        email: 'john@example.com',
        nationality: 'ET',
      },
      7,
    );

    // Registration + who checked the guest in.
    expect(prisma.hotelReservation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: expect.objectContaining({
          status: 'CHECKED_IN',
          checkedInById: 7,
          idTypeId: 1,
          idNumber: 'ET-123456',
          email: 'john@example.com',
          nationality: 'ET',
        }),
      }),
    );

    // Room line: itemized description, unit price and the posting user.
    expect(prisma.folioEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 1,
        folioId: 500,
        description: 'Room 104 — 2 nights × 1,200',
        amount: 2400,
        unitPrice: 1200,
        type: 'CHARGE',
        sourceService: 'ACCOMMODATION',
        createdById: 7,
      }),
    });
    expect(prisma.room.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { status: 'OCCUPIED' },
    });
  });

  it('re-posts the room line instead of duplicating it', async () => {
    const { service, prisma } = makeHarness();
    prisma.hotelReservation.findFirst.mockResolvedValue({ ...reservation });
    prisma.folioEntry.findFirst.mockResolvedValue({ id: 901 });

    await service.checkIn(5, undefined, 7);

    expect(prisma.folioEntry.create).not.toHaveBeenCalled();
    expect(prisma.folioEntry.update).toHaveBeenCalledWith({
      where: { id: 901 },
      data: {
        description: 'Room 104 — 2 nights × 1,200',
        amount: 2400,
        unitPrice: 1200,
      },
    });
  });

  it('refuses to check in a stay that is already checked out', async () => {
    const { service, prisma } = makeHarness();
    prisma.hotelReservation.findFirst.mockResolvedValue({
      ...reservation,
      status: 'CHECKED_OUT',
    });

    await expect(service.checkIn(5, undefined, 7)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('HotelService guest ID types', () => {
  it('filters to active types only when asked', async () => {
    const { service, prisma } = makeHarness();
    await service.listIdTypes(true);

    expect(prisma.guestIdType.findMany).toHaveBeenCalledWith({
      where: { tenantId: 1, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    prisma.guestIdType.findMany.mockClear();
    await service.listIdTypes(false);
    // No isActive filter -> the owner's settings screen sees deactivated types too.
    expect(prisma.guestIdType.findMany).toHaveBeenCalledWith({
      where: { tenantId: 1 },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  });

  it('derives a stable code from the name when none is given', async () => {
    const { service, prisma } = makeHarness();
    await service.createIdType({ name: 'Kebele ID' });

    expect(prisma.guestIdType.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 1,
        name: 'Kebele ID',
        code: 'KEBELE_ID',
        requiresExpiry: false,
        sortOrder: 0,
      }),
    });
  });

  it('rejects a duplicate code inside the same tenant', async () => {
    const { service, prisma } = makeHarness();
    prisma.guestIdType.findFirst.mockResolvedValue({ id: 4, code: 'PASSPORT' });

    await expect(
      service.createIdType({ name: 'Passport' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.guestIdType.create).not.toHaveBeenCalled();
  });

  it('deactivates a type instead of deleting it', async () => {
    const { service, prisma } = makeHarness();
    prisma.guestIdType.findFirst.mockResolvedValue({
      id: 3,
      tenantId: 1,
      isActive: true,
    });

    await service.updateIdType(3, { isActive: false });

    expect(prisma.guestIdType.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: expect.objectContaining({ isActive: false }),
    });
  });
});

describe('HotelService consolidated stay bill', () => {
  it('merges room and package lines with per-line staff attribution', async () => {
    const { service, prisma } = makeHarness();
    const d1 = new Date('2026-01-04T10:00:00Z');
    const d2 = new Date('2026-01-04T20:00:00Z');

    prisma.hotelReservation.findFirst.mockResolvedValue({
      id: 5,
      tenantId: 1,
      roomId: 9,
      guestName: 'John Doe',
      phone: '0911',
      status: 'CHECKED_IN',
      checkIn: new Date('2026-01-04'),
      checkOut: new Date('2026-01-06'),
      totalAmount: 2400,
      notes: null,
      email: null,
      address: null,
      nationality: null,
      idTypeId: 1,
      idType: { name: 'National ID' },
      idNumber: 'ET-1',
      idExpiryDate: null,
      idDocumentUrl: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
      checkedInBy: { name: 'Selam Tadesse', role: { name: 'Receptionist' } },
      room: { number: '104', roomType: { name: 'Deluxe' } },
      folios: [
        {
          id: 500,
          guestName: 'John Doe',
          status: 'OPEN',
          settledBy: null,
          entries: [
            {
              id: 1,
              description: 'Room 104 — 2 nights × 1,200',
              amount: 2400,
              unitPrice: 1200,
              type: 'CHARGE',
              sourceService: 'ACCOMMODATION',
              orderId: null,
              createdAt: d1,
              createdBy: {
                name: 'Selam Tadesse',
                role: { name: 'Receptionist' },
              },
            },
          ],
        },
      ],
    });
    prisma.packageGuest.findMany.mockResolvedValue([
      {
        id: 'g1',
        guestName: 'Abebe Bekele',
        roomNumber: null,
        status: 'CHECKED_IN',
        package: { id: 'p1', name: 'All-Inclusive', price: 1500 },
        folio: {
          id: 'gf1',
          status: 'OPEN',
          totalPayments: 0,
          settledBy: null,
          entries: [
            {
              id: 11,
              itemName: 'Bedele Beer',
              quantity: 2,
              unitPrice: 70,
              grossPrice: 140,
              packageDiscount: 0,
              netCharge: 140,
              sourceService: 'FOOD_AND_BEVERAGE',
              stationName: 'Bar',
              servedByName: 'Legacy POS Name',
              // No creator user -> falls back to the POS name snapshot.
              createdBy: null,
              createdAt: d2,
            },
          ],
        },
      },
    ]);

    const bill = await service.getReservationItemizedBill(5);

    // Both ledgers appear in one chronological bill.
    expect(bill.lines).toHaveLength(2);
    expect(bill.lines[0]).toMatchObject({
      source: 'STAY',
      description: 'Room 104 — 2 nights × 1,200',
      serviceLabel: 'Room',
      staffName: 'Selam Tadesse',
      staffRole: 'Receptionist',
    });
    expect(bill.lines[1]).toMatchObject({
      source: 'PACKAGE',
      guestName: 'Abebe Bekele',
      description: 'Bedele Beer',
      serviceLabel: 'Food & Beverage',
      staffName: 'Legacy POS Name',
    });

    expect(bill.guest).toMatchObject({
      idTypeName: 'National ID',
      idNumber: 'ET-1',
      checkedInBy: 'Selam Tadesse',
    });
    expect(bill.packageGuests[0]).toMatchObject({
      guestId: 'g1',
      netBalanceDue: 140,
      totalAddOns: 140,
    });
    expect(bill.totals).toMatchObject({
      stayCharges: 2400,
      packageCharges: 140,
      charges: 2540,
      roomCharges: 2400,
      balanceDue: 2540,
    });
    expect(bill.byService.map((s) => s.label)).toEqual([
      'Room',
      'Food & Beverage',
    ]);
  });
});

describe('HotelService atomic checkout', () => {
  const reservation = {
    id: 5,
    tenantId: 1,
    roomId: 9,
    guestName: 'John Doe',
    status: 'CHECKED_IN',
    checkIn: new Date('2026-01-04'),
    checkOut: new Date('2026-01-06'),
    totalAmount: 2400,
    notes: null,
    email: null,
    address: null,
    nationality: null,
    idTypeId: null,
    idType: null,
    idNumber: null,
    idExpiryDate: null,
    idDocumentUrl: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    checkedInBy: null,
    room: { number: '104', roomType: { name: 'Deluxe' } },
    folios: [],
  };
  const stayFolio = {
    id: 500,
    status: 'OPEN',
    entries: [
      { id: 1, type: 'CHARGE', amount: 2400 },
      { id: 2, type: 'CHARGE', amount: 140 },
    ],
  };
  const packageGuest = {
    id: 'g1',
    guestName: 'Abebe Bekele',
    roomNumber: '104',
    status: 'CHECKED_IN',
    package: { id: 'p1', name: 'All-Inclusive', price: 1500 },
    folio: {
      id: 'gf1',
      packageValuePaid: 1500,
      totalPayments: 0,
      entries: [{ id: 11, netCharge: 600 }],
    },
  };

  it('blocks checkout until the balance is collected', async () => {
    const { service, prisma } = makeHarness();
    prisma.hotelReservation.findFirst.mockResolvedValue({ ...reservation });
    prisma.folio.findFirst.mockResolvedValue({ ...stayFolio });
    prisma.packageGuest.findMany.mockResolvedValue([packageGuest]);

    await expect(
      service.checkout(5, { payments: [] }, 7),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'UNSETTLED_FOLIOS' }),
    });
    expect(prisma.folio.update).not.toHaveBeenCalled();
    expect(prisma.room.update).not.toHaveBeenCalled();
    expect(prisma.hotelReservation.update).not.toHaveBeenCalled();
  });

  it('settles the stay + every linked folio, checks the guests out and frees the room', async () => {
    const { service, prisma, finance } = makeHarness();
    prisma.hotelReservation.findFirst.mockResolvedValue({ ...reservation });
    prisma.folio.findFirst.mockResolvedValue({ ...stayFolio });
    prisma.packageGuest.findMany.mockResolvedValue([packageGuest]);

    const result = await service.checkout(
      5,
      { payments: [{ amount: 3140, paymentMethodId: 3 }] },
      7,
    );

    // The stay folio carries the collected payment and is settled by the user.
    expect(prisma.folioEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        folioId: 500,
        amount: 2540,
        type: 'PAYMENT',
        createdById: 7,
      }),
    });
    expect(prisma.folio.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 500 },
        data: expect.objectContaining({ status: 'SETTLED', settledById: 7 }),
      }),
    );

    // The package folio is settled and the guest checked out.
    expect(prisma.guestFolio.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'gf1' },
        data: expect.objectContaining({
          status: 'SETTLED',
          settledById: 7,
          totalPayments: 600,
        }),
      }),
    );
    expect(prisma.packageGuest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CHECKED_OUT' }),
      }),
    );

    // The stay closes and the room goes to housekeeping.
    expect(prisma.hotelReservation.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { status: 'CHECKED_OUT' },
    });
    expect(prisma.room.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { status: 'DIRTY' },
    });

    // GL: the stay folio (all its charges) + the package add-on balance.
    expect(finance.postFolioIncome).toHaveBeenCalledWith(500, 1);
    expect(finance.postPackageFolioIncome).toHaveBeenCalledWith(
      'g1',
      1,
      600,
      expect.stringContaining('All-Inclusive'),
    );

    expect(result).toMatchObject({
      status: 'CHECKED_OUT',
      roomStatus: 'DIRTY',
      forced: false,
      settledById: 7,
      totals: { totalDue: 3140, paid: 3140, outstanding: 0 },
    });
    expect(result.settledBy).toEqual({
      id: 7,
      name: 'Selam Tadesse',
      role: 'Receptionist',
    });
    expect(result.bill).toBeDefined();
  });

  it('rejects a payment that exceeds the outstanding balance', async () => {
    const { service, prisma } = makeHarness();
    prisma.hotelReservation.findFirst.mockResolvedValue({ ...reservation });
    prisma.folio.findFirst.mockResolvedValue({ ...stayFolio });

    await expect(
      service.checkout(5, { payments: [{ amount: 9000 }] }, 7),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'OVERPAYMENT' }),
    });
    expect(prisma.room.update).not.toHaveBeenCalled();
  });

  it('honours force: releases the room with the balance still outstanding', async () => {
    const { service, prisma, finance } = makeHarness();
    prisma.hotelReservation.findFirst.mockResolvedValue({ ...reservation });
    prisma.folio.findFirst.mockResolvedValue({ ...stayFolio });
    prisma.packageGuest.findMany.mockResolvedValue([packageGuest]);

    const result = await service.checkout(5, { force: true }, 7);

    expect(prisma.room.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { status: 'DIRTY' },
    });
    expect(result.forced).toBe(true);
    expect(result.totals.outstanding).toBe(3140);
    // Revenue is still booked when a stay is released unpaid.
    expect(finance.postFolioIncome).toHaveBeenCalledWith(500, 1);
  });

  it('refuses to check out twice', async () => {
    const { service, prisma } = makeHarness();
    prisma.hotelReservation.findFirst.mockResolvedValue({
      ...reservation,
      status: 'CHECKED_OUT',
    });

    await expect(
      service.checkout(5, { payments: [{ amount: 100 }] }, 7),
    ).rejects.toThrow(/already checked out/i);
  });
});

/**
 * Room cleanliness is a housekeeping privilege (`hotel.housekeeping.update`), so
 * the service must be strict about *which* room it flips: the bare id is not
 * authorization, and an unknown id has to be a clean 404 rather than a raw
 * Prisma P2025 (which surfaced as a 500 before this guard existed).
 */
describe('HotelService room status guard', () => {
  it('rejects a room that does not belong to the active tenant', async () => {
    const { service, prisma } = makeHarness();
    prisma.room.findFirst.mockResolvedValue(null);

    await expect(service.updateRoomStatus(999, 'DIRTY' as any)).rejects.toThrow(
      /not found/i,
    );
    expect(prisma.room.findFirst).toHaveBeenCalledWith({
      where: { id: 999, tenantId: 1 },
    });
    expect(prisma.room.update).not.toHaveBeenCalled();
  });

  it('updates the room once the tenant check passes', async () => {
    const { service, prisma } = makeHarness();
    prisma.room.findFirst.mockResolvedValue({ id: 9, tenantId: 1 });

    await expect(service.updateRoomStatus(9, 'DIRTY' as any)).resolves.toEqual({
      id: 9,
      status: 'DIRTY',
    });
    expect(prisma.room.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { status: 'DIRTY' },
    });
  });
});
