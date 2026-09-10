// src/hotel/hotel.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { HotelReservationStatus, RoomStatus, TaxDirection } from '@prisma/client';
import { getCurrentTenantId } from '../common/tenant/tenant.context';
import { resolveTax, splitTax } from '../common/tax.util';
import { FinanceService } from '../finance/finance.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AddFolioEntryDto,
  CreateHotelReservationDto,
  CreateRoomDto,
  CreateRoomTypeDto,
  UpdateHotelReservationDto,
  UpdateRoomDto,
  UpdateRoomTypeDto,
} from './dto/hotel.dto';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class HotelService {
  constructor(private prisma: PrismaService, private finance: FinanceService) {}

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
      data: { tenantId, name: dto.name, description: dto.description, basePrice: dto.basePrice },
    });
  }

  async updateRoomType(id: number, dto: UpdateRoomTypeDto) {
    const tenantId = this.tenant();
    const existing = await this.prisma.roomType.findFirst({ where: { id, tenantId } });
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
    const existing = await this.prisma.roomType.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Room type not found');
    const roomCount = await this.prisma.room.count({ where: { roomTypeId: id } });
    if (roomCount > 0) {
      throw new BadRequestException('This room type still has rooms — move or remove them first.');
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
          where: { status: { in: [HotelReservationStatus.CONFIRMED, HotelReservationStatus.CHECKED_IN] } },
          select: { id: true, guestName: true, checkIn: true, checkOut: true },
        },
      },
      orderBy: { number: 'asc' },
    });
  }

  async createRoom(dto: CreateRoomDto) {
    const tenantId = this.tenant();
    return this.prisma.room.create({
      data: { tenantId, roomTypeId: dto.roomTypeId, number: dto.number, floor: dto.floor },
    });
  }

  async updateRoom(id: number, dto: UpdateRoomDto) {
    const tenantId = this.tenant();
    const existing = await this.prisma.room.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Room not found');
    if (dto.roomTypeId) {
      const rt = await this.prisma.roomType.findFirst({ where: { id: dto.roomTypeId, tenantId } });
      if (!rt) throw new BadRequestException('Room type not found');
    }
    return this.prisma.room.update({
      where: { id },
      data: { number: dto.number, floor: dto.floor, roomTypeId: dto.roomTypeId },
    });
  }

  async deleteRoom(id: number) {
    const tenantId = this.tenant();
    const existing = await this.prisma.room.findFirst({ where: { id, tenantId } });
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
      throw new BadRequestException('This room has active reservations — cancel or remove them first.');
    }
    await this.prisma.room.delete({ where: { id } });
    return { id };
  }

  async updateRoomStatus(id: number, status: RoomStatus) {
    await this.prisma.room.update({ where: { id }, data: { status } });
    return { id, status };
  }

  // --- Reservations ---
  async listReservations(status?: string) {
    const tenantId = this.tenant();
    return this.prisma.hotelReservation.findMany({
      where: { tenantId, ...(status ? { status: status as HotelReservationStatus } : {}) },
      include: { room: { include: { roomType: true } }, folios: true },
      orderBy: { checkIn: 'desc' },
    });
  }

  async createReservation(dto: CreateHotelReservationDto) {
    const tenantId = this.tenant();
    const room = await this.prisma.room.findUnique({
      where: { id: dto.roomId },
      include: { roomType: true },
    });
    if (!room) throw new NotFoundException('Room not found');

    const checkIn = new Date(dto.checkIn);
    const checkOut = new Date(dto.checkOut);
    const nights = Math.max(1, Math.round((checkOut.getTime() - checkIn.getTime()) / MS_PER_DAY));
    const totalAmount = room.roomType.basePrice * nights;

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
        },
      });

      await tx.folio.create({
        data: { tenantId, reservationId: reservation.id, guestName: dto.guestName },
      });

      await tx.room.update({ where: { id: dto.roomId }, data: { status: RoomStatus.OCCUPIED } });

      return reservation;
    });
  }

  async updateReservation(id: number, dto: UpdateHotelReservationDto) {
    const tenantId = this.tenant();
    const existing = await this.prisma.hotelReservation.findFirst({
      where: { id, tenantId },
      include: { room: true },
    });
    if (!existing) throw new NotFoundException('Reservation not found');

    const roomId = dto.roomId ?? existing.roomId;
    const checkIn = dto.checkIn ? new Date(dto.checkIn) : existing.checkIn;
    const checkOut = dto.checkOut ? new Date(dto.checkOut) : existing.checkOut;

    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: { roomType: true },
    });
    if (!room) throw new NotFoundException('Room not found');

    const nights = Math.max(1, Math.round((checkOut.getTime() - checkIn.getTime()) / MS_PER_DAY));
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
          [HotelReservationStatus.PENDING, HotelReservationStatus.CONFIRMED, HotelReservationStatus.CHECKED_IN] as HotelReservationStatus[]
        ).includes(existing.status);
        if (occupies) {
          await tx.room.update({
            where: { id: dto.roomId },
            data: { status: RoomStatus.OCCUPIED },
          });
        }
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

  async checkIn(id: number) {
    const reservation = await this.prisma.hotelReservation.findUnique({ where: { id } });
    if (!reservation) throw new NotFoundException('Reservation not found');

    await this.prisma.hotelReservation.update({
      where: { id },
      data: { status: HotelReservationStatus.CHECKED_IN },
    });
    await this.prisma.room.update({ where: { id: reservation.roomId }, data: { status: RoomStatus.OCCUPIED } });
    return { id, status: HotelReservationStatus.CHECKED_IN };
  }

  async checkOut(id: number) {
    const reservation = await this.prisma.hotelReservation.findUnique({ where: { id } });
    if (!reservation) throw new NotFoundException('Reservation not found');

    await this.prisma.hotelReservation.update({
      where: { id },
      data: { status: HotelReservationStatus.CHECKED_OUT },
    });
    await this.prisma.room.update({ where: { id: reservation.roomId }, data: { status: RoomStatus.DIRTY } });
    return { id, status: HotelReservationStatus.CHECKED_OUT };
  }

  // --- Folio ---
  async getFolio(reservationId: number) {
    const tenantId = this.tenant();
    const folio = await this.prisma.folio.findFirst({
      where: { tenantId, reservationId },
      include: { entries: { orderBy: { createdAt: 'asc' } }, reservation: { include: { room: true } } },
    });
    if (!folio) throw new NotFoundException('Folio not found');

    const charges = folio.entries.filter((e) => e.type === 'CHARGE').reduce((s, e) => s + e.amount, 0);
    const payments = folio.entries.filter((e) => e.type === 'PAYMENT').reduce((s, e) => s + e.amount, 0);

    return { ...folio, balance: charges - payments, totalCharges: charges, totalPayments: payments };
  }

  async addFolioEntry(reservationId: number, dto: AddFolioEntryDto, userId: number) {
    const tenantId = this.tenant();
    const folio = await this.prisma.folio.findFirst({ where: { tenantId, reservationId } });
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

  async settleFolio(reservationId: number) {
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
      },
    });

    // Universal finance: auto-post guest folio settlement income.
    await this.finance.postFolioIncome(folio.id, tenantId).catch(() => 0);
    return { id: folio.id, status: 'SETTLED' };
  }
}

