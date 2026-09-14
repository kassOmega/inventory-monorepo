// src/hotel/hotel.service.spec.ts
import { BadRequestException } from '@nestjs/common';
import { HotelService } from './hotel.service';

// checkOut / checkoutPreview resolve the request tenant.
jest.mock('../common/tenant/tenant.context', () => ({
  getCurrentTenantId: jest.fn(() => 1),
  requireTenantId: jest.fn(() => 1),
}));

/**
 * Front-desk checkout safety:
 *  - checkout is blocked while a linked package guest folio is open or the stay
 *    folio still carries a balance,
 *  - `force` releases the room anyway and reports what was left unsettled,
 *  - the preview endpoint exposes the same summary before acting.
 */
describe('HotelService checkout safety', () => {
  const reservation = { id: 5, roomId: 9, tenantId: 1, status: 'CHECKED_IN' };

  function makeService() {
    const prisma: any = {
      hotelReservation: {
        findFirst: jest.fn(() => Promise.resolve(reservation)),
        update: jest.fn(() => Promise.resolve(reservation)),
      },
      room: { update: jest.fn(() => Promise.resolve({ id: 9 })) },
      packageGuest: { findMany: jest.fn(() => Promise.resolve([])) },
      folio: { findFirst: jest.fn(() => Promise.resolve(null)) },
    };
    const service = new HotelService(prisma, {} as any);
    return { service, prisma };
  }

  const openGuest = {
    id: 'guest-1',
    guestName: 'Abebe',
    roomNumber: '12',
    status: 'CHECKED_IN',
    package: { name: 'Resort Package' },
    folio: {
      id: 'folio-1',
      status: 'OPEN',
      packageValuePaid: 1000,
      totalAddOns: 700,
      totalPayments: 200,
    },
  };

  it('blocks checkout while a linked package folio is open', async () => {
    const { service, prisma } = makeService();
    prisma.packageGuest.findMany.mockResolvedValue([openGuest]);

    await expect(service.checkOut(5)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.hotelReservation.update).not.toHaveBeenCalled();
    expect(prisma.room.update).not.toHaveBeenCalled();
  });

  it('surfaces the unsettled details on the blocked error', async () => {
    const { service, prisma } = makeService();
    prisma.packageGuest.findMany.mockResolvedValue([openGuest]);

    await expect(service.checkOut(5)).rejects.toMatchObject({
      response: {
        code: 'UNSETTLED_FOLIOS',
        unsettledCount: 1,
        canCheckOut: false,
        hasOpenItems: true,
      },
    });
  });

  it('releases the room with force=true and reports what was unsettled', async () => {
    const { service, prisma } = makeService();
    prisma.packageGuest.findMany.mockResolvedValue([openGuest]);

    const result = await service.checkOut(5, { force: true });

    expect(prisma.hotelReservation.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { status: 'CHECKED_OUT' },
    });
    expect(prisma.room.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { status: 'DIRTY' },
    });
    expect(result).toMatchObject({
      status: 'CHECKED_OUT',
      forced: true,
      unsettledCount: 1,
    });
    expect(result.unsettledPackageGuests[0]).toMatchObject({
      guestId: 'guest-1',
      balance: 500,
      isSettled: false,
    });
  });

  it('checks out cleanly when every folio is settled', async () => {
    const { service, prisma } = makeService();
    prisma.packageGuest.findMany.mockResolvedValue([
      {
        ...openGuest,
        folio: { ...openGuest.folio, status: 'SETTLED', totalPayments: 700 },
      },
    ]);

    const result = await service.checkOut(5);

    expect(result).toMatchObject({
      status: 'CHECKED_OUT',
      forced: false,
      hasOpenItems: false,
      canCheckOut: true,
    });
    expect(prisma.hotelReservation.update).toHaveBeenCalled();
  });

  it('blocks when the stay folio itself still has a balance', async () => {
    const { service, prisma } = makeService();
    prisma.folio.findFirst.mockResolvedValue({
      id: 'stay-folio',
      status: 'OPEN',
      entries: [
        { type: 'CHARGE', amount: 400 },
        { type: 'PAYMENT', amount: 100 },
      ],
    });

    await expect(service.checkOut(5)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('previews linked folios and open add-ons without mutating anything', async () => {
    const { service, prisma } = makeService();
    prisma.hotelReservation.findFirst.mockResolvedValue({
      ...reservation,
      guestName: 'Abebe',
      checkIn: new Date('2026-01-04'),
      checkOut: new Date('2026-01-06'),
      totalAmount: 2000,
      room: { number: '12', roomType: { name: 'Deluxe' } },
      folios: [],
    });
    prisma.packageGuest.findMany.mockResolvedValue([openGuest]);

    const preview = await service.checkoutPreview(5);

    expect(preview.reservation).toMatchObject({ id: 5, roomNumber: '12' });
    expect(preview.canCheckOut).toBe(false);
    expect(preview.unsettledCount).toBe(1);
    expect(preview.packageGuests[0]).toMatchObject({
      guestName: 'Abebe',
      balance: 500,
    });
    expect(prisma.hotelReservation.update).not.toHaveBeenCalled();
  });
});

/**
 * POS charge-to-room lookup: only active CHECKED_IN stays, with the room number,
 * guest name and the linked package guest (when present) so the POS can decide
 * between entitlement routing and a plain stay-folio charge.
 */
describe('HotelService chargeable rooms (POS)', () => {
  function makeService() {
    const prisma: any = {
      hotelReservation: { findMany: jest.fn(() => Promise.resolve([])) },
    };
    const service = new HotelService(prisma, {} as any);
    return { service, prisma };
  }

  it('returns room number, guest name and the linked package guest', async () => {
    const { service, prisma } = makeService();
    prisma.hotelReservation.findMany.mockResolvedValue([
      {
        id: 5,
        guestName: 'John Doe',
        checkIn: new Date('2026-01-04'),
        checkOut: new Date('2026-01-06'),
        room: { id: 3, number: '104' },
        packageGuests: [
          {
            id: 'pg-1',
            guestName: 'John Doe',
            package: { name: 'All-Inclusive' },
          },
        ],
      },
      {
        id: 6,
        guestName: 'Jane Roe',
        checkIn: new Date('2026-01-05'),
        checkOut: new Date('2026-01-07'),
        room: { id: 4, number: '105' },
        packageGuests: [],
      },
    ]);

    const rooms = await service.listChargeableRooms();

    // Only active checked-in stays are queried.
    expect(prisma.hotelReservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'CHECKED_IN' }),
      }),
    );
    expect(rooms[0]).toMatchObject({
      reservationId: 5,
      roomNumber: '104',
      guestName: 'John Doe',
      packageGuestId: 'pg-1',
      packageName: 'All-Inclusive',
    });
    // A standard stay has no package guest -> plain folio charge.
    expect(rooms[1]).toMatchObject({
      reservationId: 6,
      roomNumber: '105',
      packageGuestId: null,
    });
  });
});
