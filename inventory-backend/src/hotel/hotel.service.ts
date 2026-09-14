// src/hotel/hotel.service.ts
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  HotelReservationStatus,
  Prisma,
  RoomStatus,
  TaxDirection,
} from '@prisma/client';
import {
  formatBusinessDate,
  formatBusinessWeekday,
} from '../common/business-date.util';
import { getCurrentTenantId } from '../common/tenant/tenant.context';
import { resolveTax, splitTax } from '../common/tax.util';
import { UPLOAD_ROOT } from '../common/upload.config';
import type { UploadedFileShape } from '../common/upload.config';
import { FinanceService } from '../finance/finance.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AddFolioEntryDto,
  CheckInGuestDto,
  CheckoutReservationDto,
  CreateGuestIdTypeDto,
  CreateHotelReservationDto,
  CreateRoomDto,
  CreateRoomTypeDto,
  RoomsAvailableQueryDto,
  UpdateGuestIdTypeDto,
  UpdateHotelReservationDto,
  UpdateRoomDto,
  UpdateRoomTypeDto,
} from './dto/hotel.dto';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Statuses that occupy a room for availability purposes. */
const BLOCKING_RESERVATION_STATUSES: HotelReservationStatus[] = [
  HotelReservationStatus.CONFIRMED,
  HotelReservationStatus.CHECKED_IN,
];

/** The room-rate line is identified by this sourceService value. */
const ROOM_SOURCE_SERVICE = 'ACCOMMODATION';

/** Display label per service so the consolidated bill groups sensibly. */
const SERVICE_LABELS: Record<string, string> = {
  ACCOMMODATION: 'Room',
  FOOD_AND_BEVERAGE: 'Food & Beverage',
  RESTAURANT: 'Restaurant',
  ROOM_SERVICE: 'Room Service',
  BAR: 'Bar',
  MINIBAR: 'Minibar',
  SPA: 'Spa',
  GYM: 'Gym',
  POOL: 'Pool',
  EVENTS: 'Events',
  LAUNDRY: 'Laundry',
  PACKAGE: 'Package',
};

const serviceLabel = (sourceService?: string | null): string =>
  (sourceService && SERVICE_LABELS[sourceService]) || sourceService || 'Other';

/**
 * Prisma select for a staff member attached to a ledger line. The role is read
 * from the person's membership in THIS tenant (that's what the JWT/permissions
 * are built from), falling back to the legacy global User.role.
 */
const staffSelect = (tenantId: number) => ({
  id: true,
  name: true,
  role: { select: { name: true } },
  memberships: {
    where: { organizationId: tenantId },
    select: { role: { select: { name: true } } },
    take: 1,
  },
});

/** Resolve the display role for a staff member selected with `staffSelect`. */
const staffRoleOf = (user: any): string | null =>
  user?.memberships?.[0]?.role?.name ?? user?.role?.name ?? null;

/** "Kebele ID" → "KEBELE_ID" (used when the owner doesn't supply a code). */
function idTypeCodeFromName(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

@Injectable()
export class HotelService {
  constructor(
    private prisma: PrismaService,
    private finance: FinanceService,
  ) {}

  private tenant(): number {
    const id = getCurrentTenantId();
    if (id == null) throw new BadRequestException('No active organization');
    return id;
  }

  // --- Room types ---
  async listRoomTypes() {
    const tenantId = this.tenant();
    return this.prisma.roomType.findMany({
      where: { tenantId },
      include: { rooms: true },
      orderBy: { name: 'asc' },
    });
  }

  async createRoomType(dto: CreateRoomTypeDto) {
    const tenantId = this.tenant();
    return this.prisma.roomType.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        basePrice: dto.basePrice,
      },
    });
  }

  async updateRoomType(id: number, dto: UpdateRoomTypeDto) {
    const tenantId = this.tenant();
    const existing = await this.prisma.roomType.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Room type not found');
    return this.prisma.roomType.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        basePrice: dto.basePrice,
      },
    });
  }

  async deleteRoomType(id: number) {
    const tenantId = this.tenant();
    const existing = await this.prisma.roomType.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Room type not found');
    const roomCount = await this.prisma.room.count({
      where: { roomTypeId: id },
    });
    if (roomCount > 0) {
      throw new BadRequestException(
        'This room type still has rooms — move or remove them first.',
      );
    }
    await this.prisma.roomType.delete({ where: { id } });
    return { id };
  }

  // --- Rooms ---
  async listRooms() {
    const tenantId = this.tenant();
    return this.prisma.room.findMany({
      where: { tenantId },
      include: {
        roomType: true,
        reservations: {
          where: {
            status: {
              in: [
                HotelReservationStatus.CONFIRMED,
                HotelReservationStatus.CHECKED_IN,
              ],
            },
          },
          select: { id: true, guestName: true, checkIn: true, checkOut: true },
        },
      },
      orderBy: { number: 'asc' },
    });
  }

  async createRoom(dto: CreateRoomDto) {
    const tenantId = this.tenant();
    return this.prisma.room.create({
      data: {
        tenantId,
        roomTypeId: dto.roomTypeId,
        number: dto.number,
        floor: dto.floor,
      },
    });
  }

  async updateRoom(id: number, dto: UpdateRoomDto) {
    const tenantId = this.tenant();
    const existing = await this.prisma.room.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Room not found');
    if (dto.roomTypeId) {
      const rt = await this.prisma.roomType.findFirst({
        where: { id: dto.roomTypeId, tenantId },
      });
      if (!rt) throw new BadRequestException('Room type not found');
    }
    return this.prisma.room.update({
      where: { id },
      data: {
        number: dto.number,
        floor: dto.floor,
        roomTypeId: dto.roomTypeId,
      },
    });
  }

  async deleteRoom(id: number) {
    const tenantId = this.tenant();
    const existing = await this.prisma.room.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Room not found');
    const active = await this.prisma.hotelReservation.count({
      where: {
        roomId: id,
        status: {
          in: [
            HotelReservationStatus.PENDING,
            HotelReservationStatus.CONFIRMED,
            HotelReservationStatus.CHECKED_IN,
          ],
        },
      },
    });
    if (active > 0) {
      throw new BadRequestException(
        'This room has active reservations — cancel or remove them first.',
      );
    }
    await this.prisma.room.delete({ where: { id } });
    return { id };
  }

  async updateRoomStatus(id: number, status: RoomStatus) {
    const tenantId = this.tenant();
    // Tenant-scoped existence check: the bare id is not authorization, and a
    // stale id must be a 404 rather than a raw Prisma P2025 (→ 500).
    const room = await this.prisma.room.findFirst({ where: { id, tenantId } });
    if (!room) throw new NotFoundException('Room not found');
    await this.prisma.room.update({ where: { id }, data: { status } });
    return { id, status };
  }

  // --- Reservations ---
  async listReservations(status?: string) {
    const tenantId = this.tenant();
    return this.prisma.hotelReservation.findMany({
      where: {
        tenantId,
        ...(status ? { status: status as HotelReservationStatus } : {}),
      },
      include: {
        room: { include: { roomType: true } },
        // Entries are included so the folios surface can show each in-house
        // stay's net balance due without a per-row request.
        folios: {
          include: { entries: { select: { type: true, amount: true } } },
        },
        // Package guests billed against this stay (ROOM_CHARGE / folio bridge).
        packageGuests: {
          select: {
            id: true,
            guestName: true,
            roomNumber: true,
            status: true,
            folio: {
              select: {
                id: true,
                status: true,
                totalAddOns: true,
                totalPayments: true,
              },
            },
          },
        },
      },
      orderBy: { checkIn: 'desc' },
    });
  }

  /**
   * POS charge-to-room lookup: the rooms that can receive charges right now —
   * active CHECKED_IN stays with the guest name, room number and (when present)
   * the linked package guest used for entitlement routing. Deliberately narrow
   * so POS staff can bill a room without the full hotel administrative surface.
   */
  async listChargeableRooms() {
    const tenantId = this.tenant();
    const reservations = await this.prisma.hotelReservation.findMany({
      where: { tenantId, status: HotelReservationStatus.CHECKED_IN },
      select: {
        id: true,
        guestName: true,
        checkIn: true,
        checkOut: true,
        room: { select: { id: true, number: true } },
        packageGuests: {
          where: { status: 'CHECKED_IN' },
          select: {
            id: true,
            guestName: true,
            package: { select: { name: true } },
          },
          orderBy: { checkInAt: 'asc' },
        },
      },
      orderBy: { checkIn: 'asc' },
    });

    return reservations.map((r) => ({
      reservationId: r.id,
      roomId: r.room?.id ?? null,
      roomNumber: r.room?.number ?? null,
      guestName: r.guestName,
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      // When set, the order routes through the guest's package entitlements.
      packageGuestId: r.packageGuests[0]?.id ?? null,
      packageName: r.packageGuests[0]?.package?.name ?? null,
    }));
  }

  async createReservation(dto: CreateHotelReservationDto, userId?: number) {
    const tenantId = this.tenant();
    const room = await this.prisma.room.findUnique({
      where: { id: dto.roomId },
      include: { roomType: true },
    });
    if (!room) throw new NotFoundException('Room not found');

    const checkIn = new Date(dto.checkIn);
    const checkOut = new Date(dto.checkOut);
    if (!(checkOut > checkIn)) {
      throw new BadRequestException('Check-out must be after check-in.');
    }
    const nights = Math.max(
      1,
      Math.round((checkOut.getTime() - checkIn.getTime()) / MS_PER_DAY),
    );
    const totalAmount = room.roomType.basePrice * nights;

    // A room can never be double-booked for overlapping dates.
    await this.assertRoomAvailable(tenantId, dto.roomId, checkIn, checkOut);

    return this.prisma.$transaction(async (tx) => {
      const reservation = await tx.hotelReservation.create({
        data: {
          tenantId,
          roomId: dto.roomId,
          guestName: dto.guestName,
          phone: dto.phone,
          checkIn,
          checkOut,
          totalAmount,
          notes: dto.notes,
          ...this.guestRegistrationData(dto),
        },
      });

      await tx.folio.create({
        data: {
          tenantId,
          reservationId: reservation.id,
          guestName: dto.guestName,
          createdById: userId ?? null,
        },
      });

      await tx.room.update({
        where: { id: dto.roomId },
        data: { status: RoomStatus.OCCUPIED },
      });

      return reservation;
    });
  }

  async updateReservation(
    id: number,
    dto: UpdateHotelReservationDto,
    userId?: number,
  ) {
    const tenantId = this.tenant();
    const existing = await this.prisma.hotelReservation.findFirst({
      where: { id, tenantId },
      include: { room: true },
    });
    if (!existing) throw new NotFoundException('Reservation not found');

    const roomId = dto.roomId ?? existing.roomId;
    const checkIn = dto.checkIn ? new Date(dto.checkIn) : existing.checkIn;
    const checkOut = dto.checkOut ? new Date(dto.checkOut) : existing.checkOut;
    if (!(checkOut > checkIn)) {
      throw new BadRequestException('Check-out must be after check-in.');
    }

    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: { roomType: true },
    });
    if (!room) throw new NotFoundException('Room not found');

    // Re-validate availability whenever the room or the dates change.
    if (dto.roomId != null || dto.checkIn || dto.checkOut) {
      await this.assertRoomAvailable(tenantId, roomId, checkIn, checkOut, id);
    }

    const nights = Math.max(
      1,
      Math.round((checkOut.getTime() - checkIn.getTime()) / MS_PER_DAY),
    );
    const totalAmount = room.roomType.basePrice * nights;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.hotelReservation.update({
        where: { id },
        data: {
          roomId,
          guestName: dto.guestName,
          phone: dto.phone,
          checkIn,
          checkOut,
          notes: dto.notes,
          totalAmount,
          ...this.guestRegistrationData(dto),
        },
      });

      // If the room changed, free the old one and occupy the new one (only
      // while the reservation is actually occupying a room).
      if (dto.roomId && dto.roomId !== existing.roomId) {
        await tx.room.update({
          where: { id: existing.roomId },
          data: { status: RoomStatus.AVAILABLE },
        });
        const occupies = (
          [
            HotelReservationStatus.PENDING,
            HotelReservationStatus.CONFIRMED,
            HotelReservationStatus.CHECKED_IN,
          ] as HotelReservationStatus[]
        ).includes(existing.status);
        if (occupies) {
          await tx.room.update({
            where: { id: dto.roomId },
            data: { status: RoomStatus.OCCUPIED },
          });
        }
      }

      // Keep the folio's room line in sync while the guest is in-house.
      if (updated.status === HotelReservationStatus.CHECKED_IN) {
        await this.syncRoomChargeLine(tx, {
          tenantId,
          reservationId: id,
          guestName: updated.guestName,
          roomNumber: room.number,
          totalAmount,
          nights,
          createdById: userId ?? null,
        });
      }

      return updated;
    });
  }

  async deleteReservation(id: number) {
    const tenantId = this.tenant();
    const existing = await this.prisma.hotelReservation.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Reservation not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.hotelReservation.delete({ where: { id } }); // folios cascade
      const stillActive = await tx.hotelReservation.count({
        where: {
          roomId: existing.roomId,
          status: {
            in: [
              HotelReservationStatus.PENDING,
              HotelReservationStatus.CONFIRMED,
              HotelReservationStatus.CHECKED_IN,
            ],
          },
        },
      });
      if (stillActive === 0) {
        await tx.room.update({
          where: { id: existing.roomId },
          data: { status: RoomStatus.AVAILABLE },
        });
      }
    });
    return { id };
  }

  /**
   * Interactive check-in. The body is optional (the one-click path still works);
   * when present it records the guest's registration/ID details, may reassign
   * the room, and always posts the idempotent ACCOMMODATION room line to the
   * stay folio so the ledger shows the room charge for the whole stay.
   */
  async checkIn(id: number, dto?: CheckInGuestDto, userId?: number) {
    const tenantId = this.tenant();
    const reservation = await this.prisma.hotelReservation.findFirst({
      where: { id, tenantId },
      include: { room: { include: { roomType: true } } },
    });
    if (!reservation) throw new NotFoundException('Reservation not found');
    if (reservation.status === HotelReservationStatus.CHECKED_OUT) {
      throw new BadRequestException('This stay is already checked out.');
    }

    const roomId = dto?.roomId ?? reservation.roomId;
    let roomNumber = reservation.room?.number ?? null;
    if (roomId !== reservation.roomId) {
      const target = await this.prisma.room.findFirst({
        where: { id: roomId, tenantId },
        select: { id: true, number: true },
      });
      if (!target) throw new NotFoundException('Room not found');
      // The replacement room must be free for this stay's window.
      await this.assertRoomAvailable(
        tenantId,
        roomId,
        reservation.checkIn,
        reservation.checkOut,
        id,
      );
      roomNumber = target.number;
    }

    const nights = Math.max(
      1,
      Math.round(
        (reservation.checkOut.getTime() - reservation.checkIn.getTime()) /
          MS_PER_DAY,
      ),
    );

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.hotelReservation.update({
        where: { id },
        data: {
          status: HotelReservationStatus.CHECKED_IN,
          roomId,
          checkedInById: userId ?? null,
          ...(dto?.guestName ? { guestName: dto.guestName } : {}),
          ...(dto?.phone ? { phone: dto.phone } : {}),
          ...(dto?.notes ? { notes: dto.notes } : {}),
          ...(dto ? this.guestRegistrationData(dto) : {}),
        },
      });

      if (roomId !== reservation.roomId) {
        await tx.room.update({
          where: { id: reservation.roomId },
          data: { status: RoomStatus.AVAILABLE },
        });
      }
      await tx.room.update({
        where: { id: roomId },
        data: { status: RoomStatus.OCCUPIED },
      });

      // Continuous room posting — the folio always carries the room charge.
      await this.syncRoomChargeLine(tx, {
        tenantId,
        reservationId: id,
        guestName: updated.guestName,
        roomNumber,
        totalAmount: reservation.totalAmount,
        nights,
        createdById: userId ?? null,
      });

      return updated;
    });
  }

  /**
   * Everything reception needs before releasing a room: the linked package
   * guest folios and their open add-ons, plus the stay's own folio balance.
   */
  private async buildCheckoutPreview(id: number) {
    const tenantId = this.tenant();
    const linkedGuests = await this.prisma.packageGuest.findMany({
      where: { hotelReservationId: id, status: 'CHECKED_IN' },
      select: {
        id: true,
        guestName: true,
        roomNumber: true,
        status: true,
        package: { select: { name: true } },
        folio: {
          select: {
            id: true,
            status: true,
            packageValuePaid: true,
            totalAddOns: true,
            totalPayments: true,
          },
        },
      },
      orderBy: { checkInAt: 'asc' },
    });

    const packageGuests = linkedGuests.map((g) => {
      const totalAddOns = g.folio?.totalAddOns ?? 0;
      const totalPayments = g.folio?.totalPayments ?? 0;
      const balance = Math.max(0, totalAddOns - totalPayments);
      return {
        guestId: g.id,
        guestName: g.guestName,
        roomNumber: g.roomNumber,
        packageName: g.package?.name ?? null,
        folioId: g.folio?.id ?? null,
        folioStatus: g.folio?.status ?? null,
        packageValuePaid: g.folio?.packageValuePaid ?? 0,
        totalAddOns,
        totalPayments,
        balance,
        // An open folio, or any outstanding add-on balance, blocks checkout.
        isSettled: g.folio?.status === 'SETTLED' && balance <= 0,
      };
    });

    const folio = await this.prisma.folio.findFirst({
      where: { tenantId, reservationId: id },
      select: {
        id: true,
        status: true,
        entries: { select: { type: true, amount: true } },
      },
    });
    const charges = (folio?.entries ?? [])
      .filter((e) => e.type === 'CHARGE')
      .reduce((s, e) => s + e.amount, 0);
    const payments = (folio?.entries ?? [])
      .filter((e) => e.type === 'PAYMENT')
      .reduce((s, e) => s + e.amount, 0);
    const reservationFolio = folio
      ? {
          id: folio.id,
          status: folio.status,
          totalCharges: charges,
          totalPayments: payments,
          balance: Math.max(0, charges - payments),
        }
      : null;

    const unsettledPackageGuests = packageGuests.filter((g) => !g.isSettled);
    const reservationBalanceDue =
      reservationFolio && reservationFolio.status !== 'SETTLED'
        ? reservationFolio.balance
        : 0;

    return {
      packageGuests,
      unsettledPackageGuests,
      reservationFolio,
      unsettledCount: unsettledPackageGuests.length,
      reservationBalanceDue,
      hasOpenItems:
        unsettledPackageGuests.length > 0 || reservationBalanceDue > 0,
      canCheckOut:
        unsettledPackageGuests.length === 0 && reservationBalanceDue === 0,
    };
  }

  /** Front-desk preview: linked guest folios + open add-ons before checkout. */
  async checkoutPreview(id: number) {
    const tenantId = this.tenant();
    const reservation = await this.prisma.hotelReservation.findFirst({
      where: { id, tenantId },
      include: { room: { include: { roomType: true } }, folios: true },
    });
    if (!reservation) throw new NotFoundException('Reservation not found');

    const preview = await this.buildCheckoutPreview(id);
    return {
      reservation: {
        id: reservation.id,
        guestName: reservation.guestName,
        status: reservation.status,
        roomNumber: reservation.room?.number ?? null,
        roomId: reservation.roomId,
        checkIn: reservation.checkIn,
        checkOut: reservation.checkOut,
        totalAmount: reservation.totalAmount,
      },
      ...preview,
      // The consolidated, per-line bill the checkout modal renders in step 1.
      bill: await this.getReservationItemizedBill(id),
    };
  }

  /**
   * Check out a stay. By default this is BLOCKED while any linked package folio
   * is open or the stay's own folio still carries a balance; pass `force: true`
   * to release the room anyway (used from the front-desk safety modal). The
   * response always carries the unsettled summary so the desk can chase it.
   */
  async checkOut(id: number, opts?: { force?: boolean }) {
    const tenantId = this.tenant();
    const reservation = await this.prisma.hotelReservation.findFirst({
      where: { id, tenantId },
    });
    if (!reservation) throw new NotFoundException('Reservation not found');

    const preview = await this.buildCheckoutPreview(id);

    if (preview.hasOpenItems && !opts?.force) {
      throw new BadRequestException({
        message: `Cannot check out: ${preview.unsettledCount} package guest(s) still have an open folio${
          preview.reservationBalanceDue > 0
            ? ' and the room folio has a balance'
            : ''
        }. Settle them first, or release the room with force.`,
        code: 'UNSETTLED_FOLIOS',
        ...preview,
      });
    }

    await this.prisma.hotelReservation.update({
      where: { id },
      data: { status: HotelReservationStatus.CHECKED_OUT },
    });
    await this.prisma.room.update({
      where: { id: reservation.roomId },
      data: { status: RoomStatus.DIRTY },
    });

    return {
      id,
      status: HotelReservationStatus.CHECKED_OUT,
      forced: Boolean(opts?.force && preview.hasOpenItems),
      ...preview,
      warning: preview.hasOpenItems
        ? `Checked out with ${preview.unsettledCount} unsettled package guest(s) — their balances remain on the guest folios.`
        : null,
    };
  }

  // --- Folio ---
  async getFolio(reservationId: number) {
    const tenantId = this.tenant();
    const folio = await this.prisma.folio.findFirst({
      where: { tenantId, reservationId },
      include: {
        entries: { orderBy: { createdAt: 'asc' } },
        reservation: { include: { room: true } },
      },
    });
    if (!folio) throw new NotFoundException('Folio not found');

    const charges = folio.entries
      .filter((e) => e.type === 'CHARGE')
      .reduce((s, e) => s + e.amount, 0);
    const payments = folio.entries
      .filter((e) => e.type === 'PAYMENT')
      .reduce((s, e) => s + e.amount, 0);

    return {
      ...folio,
      balance: charges - payments,
      totalCharges: charges,
      totalPayments: payments,
    };
  }

  async addFolioEntry(
    reservationId: number,
    dto: AddFolioEntryDto,
    userId: number,
  ) {
    const tenantId = this.tenant();
    const folio = await this.prisma.folio.findFirst({
      where: { tenantId, reservationId },
    });
    if (!folio) throw new NotFoundException('Folio not found');

    return this.prisma.folioEntry.create({
      data: {
        tenantId,
        folioId: folio.id,
        accountId: dto.accountId,
        description: dto.description,
        amount: dto.amount,
        type: dto.type ?? 'CHARGE',
        createdById: userId,
      },
    });
  }

  async settleFolio(reservationId: number, userId?: number) {
    const tenantId = this.tenant();
    const folio = await this.prisma.folio.findFirst({
      where: { tenantId, reservationId },
      include: { entries: true },
    });
    if (!folio) throw new NotFoundException('Folio not found');

    // Output VAT snapshot from the configured default OUTPUT rate, computed on
    // the total charges at settlement time.
    let taxAmount = 0;
    let taxRateId: number | null = null;
    const totalCharges = folio.entries
      .filter((e) => e.type === 'CHARGE')
      .reduce((s, e) => s + e.amount, 0);
    const taxCtx = await resolveTax(this.prisma, tenantId, TaxDirection.OUTPUT);
    if (taxCtx.enabled && taxCtx.rate > 0 && totalCharges > 0) {
      taxAmount = splitTax(totalCharges, taxCtx.rate, taxCtx.inclusive).tax;
      taxRateId = taxCtx.rateId;
    }

    await this.prisma.folio.update({
      where: { id: folio.id },
      data: {
        status: 'SETTLED',
        taxAmount,
        taxRateId,
        taxInclusive: taxCtx.enabled ? taxCtx.inclusive : true,
        settledById: userId ?? null,
      },
    });

    // Universal finance: auto-post guest folio settlement income.
    await this.finance.postFolioIncome(folio.id, tenantId).catch(() => 0);
    return { id: folio.id, status: 'SETTLED' };
  }

  // --- Room availability ---

  /**
   * Reject a stay that would overlap an active (CONFIRMED/CHECKED_IN) booking of
   * the same room. The comparison is the standard half-open interval overlap
   * test, so a stay ending on the requested check-in date is a same-day turnover
   * and stays allowed.
   */
  private async assertRoomAvailable(
    tenantId: number,
    roomId: number,
    checkIn: Date,
    checkOut: Date,
    excludeReservationId?: number,
  ) {
    const clash = await this.prisma.hotelReservation.findFirst({
      where: {
        tenantId,
        roomId,
        status: { in: BLOCKING_RESERVATION_STATUSES },
        ...(excludeReservationId ? { id: { not: excludeReservationId } } : {}),
        checkIn: { lt: checkOut },
        checkOut: { gt: checkIn },
      },
      select: { id: true, guestName: true, checkIn: true, checkOut: true },
    });
    if (clash) {
      throw new BadRequestException(
        `Room is already booked for those dates (${clash.guestName}) — pick another room or different dates.`,
      );
    }
  }

  /**
   * Rooms with no booking overlapping the requested window, grouped by room type
   * (each group carries its price for the stay) so the front desk can pick a
   * category and then a specific room.
   */
  async listAvailableRooms(query: RoomsAvailableQueryDto) {
    const tenantId = this.tenant();
    const checkIn = new Date(query.checkInDate);
    const checkOut = new Date(query.checkOutDate);
    if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) {
      throw new BadRequestException(
        'Valid check-in and check-out dates are required.',
      );
    }
    if (!(checkOut > checkIn)) {
      throw new BadRequestException('Check-out must be after check-in.');
    }

    const busy = await this.prisma.hotelReservation.findMany({
      where: {
        tenantId,
        status: { in: BLOCKING_RESERVATION_STATUSES },
        ...(query.excludeReservationId
          ? { id: { not: query.excludeReservationId } }
          : {}),
        checkIn: { lt: checkOut },
        checkOut: { gt: checkIn },
      },
      select: { roomId: true },
    });
    const busyRoomIds = Array.from(new Set(busy.map((b) => b.roomId)));

    const rooms = await this.prisma.room.findMany({
      where: {
        tenantId,
        ...(query.roomTypeId ? { roomTypeId: query.roomTypeId } : {}),
        ...(busyRoomIds.length ? { id: { notIn: busyRoomIds } } : {}),
      },
      include: { roomType: true },
      orderBy: [{ roomTypeId: 'asc' }, { number: 'asc' }],
    });

    const nights = Math.max(
      1,
      Math.round((checkOut.getTime() - checkIn.getTime()) / MS_PER_DAY),
    );

    type AvailableRoom = {
      id: number;
      number: string;
      floor: string | null;
      roomTypeId: number;
      basePrice: number;
      totalForStay: number;
    };
    const groups = new Map<
      number,
      {
        roomTypeId: number;
        roomTypeName: string;
        basePrice: number;
        totalForStay: number;
        availableCount: number;
        rooms: AvailableRoom[];
      }
    >();
    for (const room of rooms) {
      const basePrice = room.roomType?.basePrice ?? 0;
      const group = groups.get(room.roomTypeId) ?? {
        roomTypeId: room.roomTypeId,
        roomTypeName: room.roomType?.name ?? 'Unassigned',
        basePrice,
        totalForStay: round2(basePrice * nights),
        availableCount: 0,
        rooms: [],
      };
      group.rooms.push({
        id: room.id,
        number: room.number,
        floor: room.floor,
        roomTypeId: room.roomTypeId,
        basePrice,
        totalForStay: round2(basePrice * nights),
      });
      group.availableCount = group.rooms.length;
      groups.set(room.roomTypeId, group);
    }

    return {
      checkIn,
      checkOut,
      nights,
      totalAvailable: rooms.length,
      roomTypes: Array.from(groups.values()),
      rooms: rooms.map((room) => ({
        id: room.id,
        number: room.number,
        floor: room.floor,
        roomTypeId: room.roomTypeId,
        roomTypeName: room.roomType?.name ?? null,
        basePrice: room.roomType?.basePrice ?? 0,
        totalForStay: round2((room.roomType?.basePrice ?? 0) * nights),
      })),
    };
  }

  /** Map the shared guest-registration DTO fields onto reservation columns. */
  private guestRegistrationData(dto: {
    email?: string;
    address?: string;
    nationality?: string;
    idTypeId?: number;
    idNumber?: string;
    idExpiryDate?: string;
    emergencyContactName?: string;
    emergencyContactPhone?: string;
  }): {
    email?: string | null;
    address?: string | null;
    nationality?: string | null;
    idTypeId?: number | null;
    idNumber?: string | null;
    idExpiryDate?: Date | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
  } {
    const data: {
      email?: string | null;
      address?: string | null;
      nationality?: string | null;
      idTypeId?: number | null;
      idNumber?: string | null;
      idExpiryDate?: Date | null;
      emergencyContactName?: string | null;
      emergencyContactPhone?: string | null;
    } = {};
    if (dto.email !== undefined) data.email = dto.email || null;
    if (dto.address !== undefined) data.address = dto.address || null;
    if (dto.nationality !== undefined) {
      data.nationality = dto.nationality || null;
    }
    if (dto.idTypeId !== undefined) data.idTypeId = dto.idTypeId ?? null;
    if (dto.idNumber !== undefined) data.idNumber = dto.idNumber || null;
    if (dto.idExpiryDate !== undefined) {
      data.idExpiryDate = dto.idExpiryDate ? new Date(dto.idExpiryDate) : null;
    }
    if (dto.emergencyContactName !== undefined) {
      data.emergencyContactName = dto.emergencyContactName || null;
    }
    if (dto.emergencyContactPhone !== undefined) {
      data.emergencyContactPhone = dto.emergencyContactPhone || null;
    }
    return data;
  }

  /** Find (or create) the folio a reservation bills its room charge to. */
  private async ensureStayFolio(
    tx: Prisma.TransactionClient,
    tenantId: number,
    reservationId: number,
    guestName: string,
  ) {
    const existing = await tx.folio.findFirst({
      where: { tenantId, reservationId },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return existing;
    return tx.folio.create({ data: { tenantId, reservationId, guestName } });
  }

  /**
   * Upsert the ACCOMMODATION line so a stay always carries exactly one room
   * charge (room rate × nights). Re-run whenever the stay's dates or room change
   * while the guest is in-house, so the ledger never drifts.
   */
  private async syncRoomChargeLine(
    tx: Prisma.TransactionClient,
    args: {
      tenantId: number;
      reservationId: number;
      guestName: string;
      roomNumber: string | null;
      totalAmount: number;
      nights: number;
      createdById?: number | null;
    },
  ) {
    const folio = await this.ensureStayFolio(
      tx,
      args.tenantId,
      args.reservationId,
      args.guestName,
    );
    const unitPrice = round2(args.totalAmount / Math.max(1, args.nights));
    const description = `Room ${args.roomNumber ?? '—'} — ${args.nights} night${
      args.nights === 1 ? '' : 's'
    } × ${unitPrice.toLocaleString()}`;

    const existing = await tx.folioEntry.findFirst({
      where: {
        tenantId: args.tenantId,
        folioId: folio.id,
        sourceService: ROOM_SOURCE_SERVICE,
        type: 'CHARGE',
      },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) {
      return tx.folioEntry.update({
        where: { id: existing.id },
        data: { description, amount: args.totalAmount, unitPrice },
      });
    }
    return tx.folioEntry.create({
      data: {
        tenantId: args.tenantId,
        folioId: folio.id,
        description,
        amount: args.totalAmount,
        unitPrice,
        type: 'CHARGE',
        sourceService: ROOM_SOURCE_SERVICE,
        createdById: args.createdById ?? null,
      },
    });
  }

  // --- Guest ID types (tenant-configurable registry) ---

  async listIdTypes(activeOnly = false) {
    return this.prisma.guestIdType.findMany({
      where: {
        tenantId: this.tenant(),
        ...(activeOnly ? { isActive: true } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createIdType(dto: CreateGuestIdTypeDto) {
    const tenantId = this.tenant();
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('An ID type name is required.');
    const code = (dto.code?.trim() || idTypeCodeFromName(name)).toUpperCase();
    if (!code) {
      throw new BadRequestException(
        'Provide an ID type name or an explicit code.',
      );
    }

    const existing = await this.prisma.guestIdType.findFirst({
      where: { tenantId, code },
    });
    if (existing) {
      throw new BadRequestException(
        `An ID type with the code "${code}" already exists.`,
      );
    }

    return this.prisma.guestIdType.create({
      data: {
        tenantId,
        name,
        code,
        requiresExpiry: dto.requiresExpiry ?? false,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  /** Update an ID type. Types are deactivated, never deleted, so history holds. */
  async updateIdType(id: number, dto: UpdateGuestIdTypeDto) {
    const tenantId = this.tenant();
    const existing = await this.prisma.guestIdType.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Guest ID type not found');

    return this.prisma.guestIdType.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        requiresExpiry: dto.requiresExpiry,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
      },
    });
  }

  // --- Guest ID document ---

  /** Attach an uploaded ID scan to a stay (stored path, served via the API). */
  async setIdDocument(reservationId: number, file: UploadedFileShape) {
    const tenantId = this.tenant();
    const reservation = await this.prisma.hotelReservation.findFirst({
      where: { id: reservationId, tenantId },
      select: { id: true },
    });
    if (!reservation) throw new NotFoundException('Reservation not found');

    return this.prisma.hotelReservation.update({
      where: { id: reservationId },
      data: { idDocumentUrl: `guests/${file.filename}` },
    });
  }

  /**
   * Resolve a stored ID scan to an absolute path for a permissioned stream.
   * `uploads/` is never served statically, so every read goes through the
   * controller's permission check.
   */
  async getIdDocument(reservationId: number) {
    const tenantId = this.tenant();
    const reservation = await this.prisma.hotelReservation.findFirst({
      where: { id: reservationId, tenantId },
      select: { idDocumentUrl: true },
    });
    if (!reservation) throw new NotFoundException('Reservation not found');
    if (!reservation.idDocumentUrl) {
      throw new NotFoundException('No ID document on file for this stay.');
    }

    const absolute = path.resolve(UPLOAD_ROOT, reservation.idDocumentUrl);
    // Defend against path traversal — only serve files under the uploads root.
    if (
      !absolute.startsWith(`${UPLOAD_ROOT}${path.sep}`) ||
      !existsSync(absolute)
    ) {
      throw new NotFoundException('ID document file is not available.');
    }
    return { path: absolute, filename: path.basename(absolute) };
  }

  // --- Consolidated itemized bill (stay + linked package guests) ---

  /**
   * One consolidated bill for a stay: the room/folio lines PLUS every linked
   * package guest's itemized lines, each tagged with the service it came from
   * and the staff member who posted it. This is what the unified folio surface
   * and the checkout modal render, and what the printed receipt reproduces.
   */
  async getReservationItemizedBill(id: number) {
    const tenantId = this.tenant();
    const reservation = await this.prisma.hotelReservation.findFirst({
      where: { id, tenantId },
      include: {
        room: { include: { roomType: true } },
        idType: true,
        checkedInBy: { select: staffSelect(tenantId) },
        folios: {
          orderBy: { createdAt: 'asc' },
          include: {
            settledBy: { select: { id: true, name: true } },
            entries: {
              orderBy: { createdAt: 'asc' },
              include: {
                createdBy: { select: staffSelect(tenantId) },
              },
            },
          },
        },
      },
    });
    if (!reservation) throw new NotFoundException('Reservation not found');

    const guests = await this.prisma.packageGuest.findMany({
      where: { hotelReservationId: id },
      include: {
        package: { select: { id: true, name: true, price: true } },
        folio: {
          include: {
            settledBy: { select: { id: true, name: true } },
            entries: {
              orderBy: { createdAt: 'asc' },
              include: {
                createdBy: { select: staffSelect(tenantId) },
              },
            },
          },
        },
      },
      orderBy: { checkInAt: 'asc' },
    });

    const nights = Math.max(
      1,
      Math.round(
        (reservation.checkOut.getTime() - reservation.checkIn.getTime()) /
          MS_PER_DAY,
      ),
    );

    // Stay-folio lines (room rate, POS charge-to-room, manual add-ons, payments).
    const stayLines = reservation.folios.flatMap((folio) =>
      folio.entries.map((e) => ({
        id: `folio-${e.id}`,
        source: 'STAY' as const,
        guestId: null as string | null,
        guestName: folio.guestName,
        folioId: folio.id,
        date: e.createdAt,
        description: e.description,
        service: e.sourceService ?? null,
        serviceLabel: serviceLabel(e.sourceService),
        quantity: null as number | null,
        unitPrice: e.unitPrice ?? 0,
        amount: e.amount,
        type: e.type,
        stationName: null as string | null,
        orderId: e.orderId ?? null,
        packageDiscount: 0,
        staffName: e.createdBy?.name ?? null,
        staffRole: staffRoleOf(e.createdBy),
      })),
    );

    const packageGuests = guests.map((guest) => {
      const entries = guest.folio?.entries ?? [];
      const totalAddOns = round2(
        entries.reduce((s, e) => s + (e.netCharge ?? 0), 0),
      );
      const totalPackageDiscount = round2(
        entries.reduce((s, e) => s + (e.packageDiscount ?? 0), 0),
      );
      const totalPayments = round2(guest.folio?.totalPayments ?? 0);
      const lines = entries.map((e) => {
        const quantity = e.quantity ?? 1;
        return {
          id: `guest-${e.id}`,
          source: 'PACKAGE' as const,
          guestId: guest.id,
          guestName: guest.guestName,
          folioId: guest.folio?.id ?? null,
          date: e.createdAt,
          description: e.itemName,
          service: e.sourceService ?? null,
          serviceLabel: serviceLabel(e.sourceService),
          quantity,
          unitPrice:
            e.unitPrice ||
            (quantity > 0 ? e.grossPrice / quantity : e.grossPrice),
          amount: e.netCharge,
          type: 'CHARGE' as const,
          stationName: e.stationName ?? null,
          orderId: e.orderId ?? null,
          packageDiscount: e.packageDiscount ?? 0,
          // Prefer the user who posted the line, else the POS name snapshot.
          staffName: e.createdBy?.name ?? e.servedByName ?? null,
          staffRole: staffRoleOf(e.createdBy),
        };
      });
      return {
        guestId: guest.id,
        guestName: guest.guestName,
        roomNumber: guest.roomNumber ?? reservation.room?.number ?? null,
        packageName: guest.package?.name ?? null,
        packageValuePaid: round2(guest.package?.price ?? 0),
        status: guest.status,
        folioId: guest.folio?.id ?? null,
        folioStatus: guest.folio?.status ?? null,
        settledByName: guest.folio?.settledBy?.name ?? null,
        totalAddOns,
        totalPackageDiscount,
        totalPayments,
        netBalanceDue: Math.max(0, round2(totalAddOns - totalPayments)),
        lines,
      };
    });

    const packageLines = packageGuests.flatMap((guest) => guest.lines);
    const lines = [...stayLines, ...packageLines].sort(
      (a, b) => a.date.getTime() - b.date.getTime(),
    );

    const charges = round2(
      lines
        .filter((l) => l.type === 'CHARGE')
        .reduce((s, l) => s + l.amount, 0),
    );
    const payments = round2(
      stayLines
        .filter((l) => l.type === 'PAYMENT')
        .reduce((s, l) => s + l.amount, 0),
    );
    const guestPayments = round2(
      packageGuests.reduce((s, g) => s + g.totalPayments, 0),
    );
    const advanceDeposits = round2(
      packageGuests.reduce((s, g) => s + g.packageValuePaid, 0),
    );
    const roomCharges = round2(
      stayLines
        .filter((l) => l.type === 'CHARGE' && l.service === ROOM_SOURCE_SERVICE)
        .reduce((s, l) => s + l.amount, 0),
    );

    // Service breakdown for the bill header ("Room … 12,000", "Bar … 800", …).
    const byServiceMap = new Map<
      string,
      { service: string | null; label: string; amount: number; lines: number }
    >();
    for (const line of lines.filter((l) => l.type === 'CHARGE')) {
      const key = line.service ?? 'OTHER';
      const entry = byServiceMap.get(key) ?? {
        service: line.service,
        label: line.serviceLabel,
        amount: 0,
        lines: 0,
      };
      entry.amount = round2(entry.amount + line.amount);
      entry.lines += 1;
      byServiceMap.set(key, entry);
    }

    const stayCharges = round2(
      stayLines
        .filter((l) => l.type === 'CHARGE')
        .reduce((s, l) => s + l.amount, 0),
    );
    const packageCharges = round2(charges - stayCharges);
    return {
      reservation: {
        id: reservation.id,
        guestName: reservation.guestName,
        status: reservation.status,
        roomId: reservation.roomId,
        roomNumber: reservation.room?.number ?? null,
        roomTypeName: reservation.room?.roomType?.name ?? null,
        checkIn: reservation.checkIn,
        checkOut: reservation.checkOut,
        nights,
        totalAmount: reservation.totalAmount,
        notes: reservation.notes,
      },
      guest: {
        name: reservation.guestName,
        phone: reservation.phone,
        email: reservation.email,
        address: reservation.address,
        nationality: reservation.nationality,
        idTypeId: reservation.idTypeId,
        idTypeName: reservation.idType?.name ?? null,
        idNumber: reservation.idNumber,
        idExpiryDate: reservation.idExpiryDate,
        hasIdDocument: Boolean(reservation.idDocumentUrl),
        emergencyContactName: reservation.emergencyContactName,
        emergencyContactPhone: reservation.emergencyContactPhone,
        checkedInBy: reservation.checkedInBy?.name ?? null,
        checkedInByRole: staffRoleOf(reservation.checkedInBy),
      },
      stay: {
        folioId: reservation.folios[0]?.id ?? null,
        status: reservation.folios[0]?.status ?? null,
        settledByName: reservation.folios[0]?.settledBy?.name ?? null,
        charges: stayCharges,
        payments,
        balance: Math.max(0, round2(stayCharges - payments)),
        lines: stayLines,
      },
      packageGuests,
      lines,
      byService: Array.from(byServiceMap.values()),
      totals: {
        roomCharges,
        stayCharges,
        packageCharges,
        charges,
        payments: round2(payments + guestPayments),
        advanceDeposits,
        // Actionable amount still to collect: the stay folio balance plus every
        // linked package guest's add-on balance (advance deposits excluded).
        balanceDue: round2(
          Math.max(0, round2(stayCharges - payments)) +
            packageGuests.reduce((s, g) => s + g.netBalanceDue, 0),
        ),
      },
    };
  }

  // --- Single-modal atomic checkout ---

  /**
   * One-shot checkout: collect the payment(s), settle the stay folio AND every
   * linked package folio, check the guests out, release the room as DIRTY and
   * post the GL income — all inside a single transaction, so a failure leaves
   * nothing half-settled. Pass `force` to release the room with a balance still
   * outstanding (recorded as an unpaid balance on the settled folios).
   */
  async checkout(id: number, dto: CheckoutReservationDto, userId?: number) {
    const tenantId = this.tenant();
    const reservation = await this.prisma.hotelReservation.findFirst({
      where: { id, tenantId },
      include: { room: true },
    });
    if (!reservation) throw new NotFoundException('Reservation not found');
    if (reservation.status === HotelReservationStatus.CHECKED_OUT) {
      throw new BadRequestException('This stay is already checked out.');
    }

    const payments = (dto.payments ?? [])
      .map((p) => ({
        amount: round2(Number(p.amount) || 0),
        paymentMethodId: p.paymentMethodId ?? null,
        transactionReference: p.transactionReference?.trim() || null,
      }))
      .filter((p) => p.amount > 0);
    const paidTotal = round2(payments.reduce((s, p) => s + p.amount, 0));

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Snapshot the balances inside the transaction (DB is the source of truth).
      const stayFolio = await tx.folio.findFirst({
        where: { tenantId, reservationId: id },
        include: { entries: true },
        orderBy: { createdAt: 'asc' },
      });
      const guests = await tx.packageGuest.findMany({
        where: { hotelReservationId: id },
        include: { package: true, folio: { include: { entries: true } } },
      });

      const stayCharges = round2(
        (stayFolio?.entries ?? [])
          .filter((e) => e.type === 'CHARGE')
          .reduce((s, e) => s + e.amount, 0),
      );
      const stayPayments = round2(
        (stayFolio?.entries ?? [])
          .filter((e) => e.type === 'PAYMENT')
          .reduce((s, e) => s + e.amount, 0),
      );
      const stayBalance = Math.max(0, round2(stayCharges - stayPayments));

      const guestBalances = guests
        .filter((g) => g.status === 'CHECKED_IN' && g.folio)
        .map((g) => {
          const totalAddOns = round2(
            (g.folio?.entries ?? []).reduce((s, e) => s + e.netCharge, 0),
          );
          const totalPayments = round2(g.folio?.totalPayments ?? 0);
          return {
            guest: g,
            totalAddOns,
            totalPayments,
            balance: Math.max(0, round2(totalAddOns - totalPayments)),
          };
        });

      const totalDue = round2(
        stayBalance + guestBalances.reduce((s, g) => s + g.balance, 0),
      );

      if (paidTotal - 0.01 > totalDue) {
        throw new BadRequestException({
          message: `Collected ${paidTotal} but only ${totalDue} is outstanding — adjust the payment split.`,
          code: 'OVERPAYMENT',
          totalDue,
          paidTotal,
        });
      }
      if (totalDue > 0 && !dto.force && paidTotal + 0.01 < totalDue) {
        throw new BadRequestException({
          message: `Collected ${paidTotal} of ${totalDue} due — collect the balance or check out with force.`,
          code: 'UNSETTLED_FOLIOS',
          totalDue,
          paidTotal,
        });
      }

      // 2. Allocate the payments: the stay folio first, then each package guest.
      const targets: Array<{
        kind: 'STAY' | 'PACKAGE';
        guestId: string | null;
        due: number;
        applied: number;
      }> = [
        ...(stayBalance > 0
          ? [
              {
                kind: 'STAY' as const,
                guestId: null,
                due: stayBalance,
                applied: 0,
              },
            ]
          : []),
        ...guestBalances
          .filter((g) => g.balance > 0)
          .map((g) => ({
            kind: 'PACKAGE' as const,
            guestId: g.guest.id,
            due: g.balance,
            applied: 0,
          })),
      ];
      const stayPaymentRows: Array<{
        amount: number;
        paymentMethodId: number | null;
        transactionReference: string | null;
      }> = [];
      const guestPaymentRows: Array<{
        guestId: string;
        amount: number;
        paymentMethodId: number | null;
        transactionReference: string | null;
      }> = [];
      for (const p of payments) {
        let amount = p.amount;
        for (const t of targets) {
          if (amount <= 0.004) break;
          const due = round2(t.due - t.applied);
          if (due <= 0) continue;
          const take = round2(Math.min(amount, due));
          if (take <= 0) continue;
          t.applied = round2(t.applied + take);
          amount = round2(amount - take);
          if (t.kind === 'STAY') {
            stayPaymentRows.push({ ...p, amount: take });
          } else {
            guestPaymentRows.push({ guestId: t.guestId!, ...p, amount: take });
          }
        }
      }
      const appliedTotal = round2(
        stayPaymentRows.reduce((s, p) => s + p.amount, 0) +
          guestPaymentRows.reduce((s, p) => s + p.amount, 0),
      );

      // 3. Stay folio: record the PAYMENT rows, then settle with the VAT snapshot.
      let taxAmount = 0;
      let taxRateId: number | null = null;
      let taxInclusive = true;
      if (stayFolio) {
        for (const p of stayPaymentRows) {
          await tx.folioEntry.create({
            data: {
              tenantId,
              folioId: stayFolio.id,
              description: p.transactionReference
                ? `Checkout payment (ref ${p.transactionReference})`
                : 'Checkout payment',
              amount: p.amount,
              type: 'PAYMENT',
              createdById: userId ?? null,
            },
          });
        }

        const taxCtx = await resolveTax(
          this.prisma,
          tenantId,
          TaxDirection.OUTPUT,
        );
        if (taxCtx.enabled && taxCtx.rate > 0 && stayCharges > 0) {
          taxAmount = splitTax(stayCharges, taxCtx.rate, taxCtx.inclusive).tax;
          taxRateId = taxCtx.rateId;
          taxInclusive = taxCtx.inclusive;
        }
        await tx.folio.update({
          where: { id: stayFolio.id },
          data: {
            status: 'SETTLED',
            settledById: userId ?? null,
            taxAmount,
            taxRateId,
            taxInclusive,
          },
        });
      }

      // 4. Package folios: apply their share, settle, check the guests out.
      const settledGuests = guestBalances.map((g) => {
        const amountPaid = round2(
          guestPaymentRows
            .filter((p) => p.guestId === g.guest.id)
            .reduce((s, p) => s + p.amount, 0),
        );
        return {
          guestId: g.guest.id,
          guestName: g.guest.guestName,
          roomNumber: g.guest.roomNumber ?? reservation.room?.number ?? null,
          packageName: g.guest.package?.name ?? null,
          totalAddOns: g.totalAddOns,
          totalPayments: round2(g.totalPayments + amountPaid),
          amountPaid,
          balance: Math.max(0, round2(g.balance - amountPaid)),
          // The outstanding add-on balance is the amount posted to the GL, so a
          // forced checkout still books the revenue it released.
          postableAmount: g.balance,
        };
      });

      for (const g of guestBalances) {
        if (!g.guest.folio) continue;
        const settled = settledGuests.find((s) => s.guestId === g.guest.id)!;
        await tx.guestFolio.update({
          where: { id: g.guest.folio.id },
          data: {
            status: 'SETTLED',
            settledAt: new Date(),
            settledById: userId ?? null,
            packageValuePaid:
              g.guest.package?.price ?? g.guest.folio.packageValuePaid,
            totalAddOns: g.totalAddOns,
            totalPayments: settled.totalPayments,
          },
        });
        await tx.packageGuest.update({
          where: { id: g.guest.id },
          data: { status: 'CHECKED_OUT', checkOutAt: new Date() },
        });
      }

      // 5. Close the stay and release the room for housekeeping.
      await tx.hotelReservation.update({
        where: { id },
        data: { status: HotelReservationStatus.CHECKED_OUT },
      });
      await tx.room.update({
        where: { id: reservation.roomId },
        data: { status: RoomStatus.DIRTY },
      });

      const stayPaid = round2(
        stayPaymentRows.reduce((s, p) => s + p.amount, 0),
      );
      const outstanding = round2(totalDue - appliedTotal);
      return {
        reservationId: id,
        guestName: reservation.guestName,
        roomNumber: reservation.room?.number ?? null,
        status: HotelReservationStatus.CHECKED_OUT,
        roomStatus: RoomStatus.DIRTY,
        stayFolioId: stayFolio?.id ?? null,
        stay: {
          charges: stayCharges,
          previousPayments: stayPayments,
          amountPaid: stayPaid,
          balance: Math.max(0, round2(stayBalance - stayPaid)),
          taxAmount,
        },
        packageGuests: settledGuests,
        payments,
        totals: {
          totalDue,
          paid: appliedTotal,
          outstanding,
        },
        forced: Boolean(dto.force && outstanding > 0.01),
        settledById: userId ?? null,
      };
    });

    // 6. GL posting — each poster is idempotent and runs in its own transaction,
    //    so a posting failure never rolls back a checkout the guest completed.
    if (result.stayFolioId) {
      await this.finance
        .postFolioIncome(result.stayFolioId, tenantId)
        .catch(() => 0);
    }
    for (const g of result.packageGuests) {
      if (g.postableAmount > 0) {
        await this.finance
          .postPackageFolioIncome(
            g.guestId,
            tenantId,
            g.postableAmount,
            `Guest folio settlement — ${g.guestName}${
              g.roomNumber ? ` (Room ${g.roomNumber})` : ''
            }${g.packageName ? ` [${g.packageName}]` : ''}`,
          )
          .catch(() => 0);
      }
    }

    // Who settled — printed on the receipt.
    const settledBy = userId
      ? await this.prisma.user
          .findUnique({
            where: { id: userId },
            select: staffSelect(tenantId),
          })
          .then((u) =>
            u ? { id: u.id, name: u.name, role: staffRoleOf(u) } : null,
          )
          .catch(() => null)
      : null;

    return {
      ...result,
      settledBy,
      // The printable receipt: the settled, per-line consolidated bill.
      bill: await this.getReservationItemizedBill(id),
    };
  }
}
