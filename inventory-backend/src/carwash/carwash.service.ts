// src/carwash/carwash.service.ts
// CAR WASH vertical: washers (commission), prices (vehicle type), customer
// vehicles, bookings (time-slot + walk-in queue), wash jobs (revenue), equipment
// issuance (atomic stock decrement) and daily money collection. Commission is
// computed by the canonical `computeWashCommissions` helper so owner share and
// net profit agree across the dashboard, reports and collection surfaces.
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountType,
  CarWashBookingStatus,
  CarWashStatus,
  LocationType,
  UserStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { getCurrentTenantId } from '../common/tenant/tenant.context';
import { tr } from '../i18n/i18n.service';
import { FinanceService } from '../finance/finance.service';
import { PrismaService } from '../prisma/prisma.service';
import { computeWashCommissions, CommissionedWasher } from './commission';
import {
  CreateBookingDto,
  CreateCarWashExpenseDto,
  CreateCollectionDto,
  CreateStoreItemDto,
  CreateVehicleDto,
  CreateWashDto,
  CreateWasherDto,
  CreateWashTypeDto,
  CreateVehicleTypeDto,
  IssueEquipmentDto,
  UpdateCarWashExpenseDto,
  UpdateStoreItemDto,
  UpdateVehicleDto,
  UpdateWasherDto,
  UpdateWashTypeDto,
  UpdateVehicleTypeDto,
  UpsertPriceDto,
} from './dto/carwash.dto';

type WashForSummary = {
  amount: number;
  washerId: number | null;
  washer: { id: number; commissionRate: number } | null;
  participantWashers: Array<{ id: number; commissionRate: number }>;
};

@Injectable()
export class CarWashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: FinanceService,
  ) {}

  private tenantId(): number {
    const id = getCurrentTenantId();
    if (id == null) {
      throw new BadRequestException('No active organization selected');
    }
    return id;
  }

  // A washer only sees their own results. Detection is LINK-BASED (a CarWashWasher
  // row points at this user) rather than permission-based, because the Washer
  // baseline grants no wash permissions — the owner adds them if wanted. A
  // manager/owner who also happens to have a washer row keeps full scope
  // (they hold `carwash.collections.view`).
  private async washerScope(user?: {
    sub: number;
    permissions: string[];
  }): Promise<number | null> {
    if (!user) return null;
    const isManager =
      user.permissions.includes('carwash.collections.view') ||
      user.permissions.includes('carwash.reports.full');
    if (isManager) return null;
    const washer = await this.prisma.carWashWasher.findFirst({
      where: { userId: user.sub },
    });
    return washer?.id ?? null;
  }

  private rethrowDuplicate(err: unknown, message: string): never {
    if (
      err &&
      typeof err === 'object' &&
      (err as { code?: string }).code === 'P2002'
    ) {
      throw new BadRequestException(message);
    }
    throw err;
  }

  private summarizeWashes(washes: WashForSummary[]) {
    let totalRevenue = 0;
    let totalCommission = 0;
    const perWasher: Record<number, number> = {};

    for (const wash of washes) {
      totalRevenue += wash.amount;
      const washersById = new Map<number, CommissionedWasher>();
      if (wash.washer) washersById.set(wash.washer.id, wash.washer);
      for (const p of wash.participantWashers) washersById.set(p.id, p);

      const result = computeWashCommissions({
        amount: wash.amount,
        primaryWasherId: wash.washerId,
        participantWasherIds: wash.participantWashers.map((p) => p.id),
        washersById,
      });
      totalCommission += result.totalCommission;
      for (const [id, amt] of Object.entries(result.commissions)) {
        perWasher[Number(id)] = (perWasher[Number(id)] ?? 0) + amt;
      }
    }

    return {
      totalRevenue,
      totalCommission,
      ownerShare: totalRevenue - totalCommission,
      perWasher,
    };
  }

  // -------------------------------------------------------------------------
  // Dashboard
  // -------------------------------------------------------------------------
  /**
   * Resolve a [start, end] range from optional ISO date strings. Defaults to
   * today when neither is supplied, preserving the original no-param behavior.
   */
  /** Format a Date as `YYYY-MM-DD` in the server's local timezone. */
  private toLocalDay(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private resolveRange(startDate?: string, endDate?: string) {
    const now = new Date();
    // Parse `YYYY-MM-DD` as a LOCAL calendar day (not UTC midnight) so the
    // resolved range and the echoed start/end match the dates the user picked,
    // regardless of the server timezone.
    const parseDay = (value: string) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
      if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      const d = new Date(value);
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    };
    const start = startDate
      ? parseDay(startDate)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startDay = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate(),
    );
    const end = endDate ? parseDay(endDate) : start;
    const endDay = new Date(
      end.getFullYear(),
      end.getMonth(),
      end.getDate(),
    );
    // Inclusive end-of-day.
    const endExclusive = new Date(endDay.getTime() + 24 * 60 * 60 * 1000);
    return { start: startDay, endExclusive };
  }

  async dashboard(
    user?: { sub: number; permissions: string[] },
    filters?: {
      startDate?: string;
      endDate?: string;
      washerId?: number;
      washTypeId?: number;
      vehicleType?: string;
    },
  ) {
    const { start, endExclusive } = this.resolveRange(
      filters?.startDate,
      filters?.endDate,
    );

    // A washer only ever sees their own washes; the scope is forced and any
    // supplied `washerId` filter is ignored for them (cannot widen scope).
    const scopeWasherId = await this.washerScope(user);
    const washerId = scopeWasherId ?? filters?.washerId ?? null;
    const washerWhere = washerId
      ? {
          OR: [
            { washerId },
            { participantWashers: { some: { id: washerId } } },
          ],
        }
      : {};
    const typeWhere = {
      ...(filters?.washTypeId != null ? { washTypeId: filters.washTypeId } : {}),
      ...(filters?.vehicleType ? { vehicleType: filters.vehicleType } : {}),
    };
    const rangeWhere = { date: { gte: start, lt: endExclusive } };
    const where = { ...rangeWhere, ...washerWhere, ...typeWhere };

    const [washes, activeWashers, openBookings, washer] = await Promise.all([
      this.prisma.carWash.findMany({
        where,
        include: { washer: true, participantWashers: true },
      }),
      this.prisma.carWashWasher.count({ where: { isActive: true } }),
      this.prisma.carWashBooking.count({
        where: {
          status: {
            in: [CarWashBookingStatus.PENDING, CarWashBookingStatus.SERVING],
          },
        },
      }),
      washerId
        ? this.prisma.carWashWasher.findUnique({ where: { id: washerId } })
        : Promise.resolve(null),
    ]);

    const summary = this.summarizeWashes(washes);

    // Per-day series across the requested range (capped to 62 days for the
    // chart) so the filter visibly changes the bars.
    const daily: Array<{ date: string; commission: number; revenue: number }> =
      [];
    const spanDays = Math.min(
      Math.round((endExclusive.getTime() - start.getTime()) / 86400000),
      62,
    );
    for (let i = spanDays - 1; i >= 0; i--) {
      const dStart = new Date(start.getTime() + i * 86400000);
      const dEnd = new Date(dStart.getTime() + 86400000);
      const dayWashes = washes.filter(
        (w) => w.date >= dStart && w.date < dEnd,
      );
      const s = this.summarizeWashes(dayWashes);
      daily.push({
        date: this.toLocalDay(dStart),
        commission: washerId
          ? (s.perWasher[washerId] ?? 0)
          : s.totalCommission,
        revenue: s.totalRevenue,
      });
    }

    return {
      role: scopeWasherId ? 'washer' : 'staff',
      washerId: scopeWasherId,
      washerName: washer?.name ?? null,
      commissionRate: washer?.commissionRate ?? null,
      startDate: this.toLocalDay(start),
      endDate: this.toLocalDay(new Date(endExclusive.getTime() - 86400000)),
      todayWashes: washes.length,
      todayRevenue: summary.totalRevenue,
      todayCommission: washerId
        ? (summary.perWasher[washerId] ?? 0)
        : summary.totalCommission,
      weekCommission: washerId
        ? (summary.perWasher[washerId] ?? 0)
        : summary.totalCommission,
      ownerShare: summary.ownerShare,
      daily,
      activeWashers,
      openBookings,
    };
  }

  // -------------------------------------------------------------------------
  // Washers
  // -------------------------------------------------------------------------
  listWashers() {
    return this.prisma.carWashWasher.findMany({
      orderBy: { name: 'asc' },
      include: { user: true },
    });
  }

  async createWasher(dto: CreateWasherDto) {
    const tenantId = this.tenantId();
    const hashed = await bcrypt.hash(dto.password ?? '123456', 10);
    const washerRole = await this.prisma.role.findFirst({
      where: { organizationId: tenantId, systemKey: 'WASHER' },
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
        let user = await tx.user.findUnique({ where: { email: dto.email } });
        if (!user) {
          user = await tx.user.create({
            data: {
              email: dto.email,
              password: hashed,
              name: dto.name,
              phone: dto.phone,
            },
          });
        }
        if (washerRole) {
          const existing = await tx.membership.findFirst({
            where: { userId: user.id, organizationId: tenantId },
          });
          if (!existing) {
            await tx.membership.create({
              data: {
                userId: user.id,
                organizationId: tenantId,
                roleId: washerRole.id,
                status: UserStatus.ACTIVE,
              },
            });
          }
        }
        return tx.carWashWasher.create({
          data: {
            tenantId,
            userId: user.id,
            name: dto.name,
            phone: dto.phone,
            commissionRate: dto.commissionRate ?? 50,
            isActive: dto.isActive ?? true,
          },
        });
      });
    } catch (err) {
      return this.rethrowDuplicate(
        err,
        'A washer with this name or email already exists',
      );
    }
  }

  async updateWasher(id: number, dto: UpdateWasherDto) {
    const existing = await this.prisma.carWashWasher.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Washer not found');

    const washer = await this.prisma.carWashWasher.update({
      where: { id },
      data: {
        name: dto.name,
        phone: dto.phone,
        commissionRate: dto.commissionRate,
        isActive: dto.isActive,
      },
    });

    // Keep the linked login account in sync (name/phone/email).
    if (existing.userId) {
      await this.prisma.user.update({
        where: { id: existing.userId },
        data: {
          ...(dto.name ? { name: dto.name } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          ...(dto.email ? { email: dto.email } : {}),
        },
      });
    }
    return washer;
  }

  async deleteWasher(id: number) {
    const existing = await this.prisma.carWashWasher.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Washer not found');

    await this.prisma.carWashWasher.delete({ where: { id } });
    // Deactivate (not delete) the linked account so history is preserved and the
    // washer can no longer log in.
    if (existing.userId) {
      await this.prisma.user.update({
        where: { id: existing.userId },
        data: { status: UserStatus.INACTIVE },
      });
    }
    return { id };
  }

  // -------------------------------------------------------------------------
  // Prices (vehicle type -> amount)
  // -------------------------------------------------------------------------
  listPrices() {
    return this.prisma.carWashPrice.findMany({
      include: { washType: true },
      orderBy: { vehicleType: 'asc' },
    });
  }

  async upsertPrice(dto: UpsertPriceDto) {
    const tenantId = this.tenantId();
    const washTypeId = dto.washTypeId ?? null;
    const existing = await this.prisma.carWashPrice.findFirst({
      where: { tenantId, vehicleType: dto.vehicleType, washTypeId },
    });
    if (existing) {
      return this.prisma.carWashPrice.update({
        where: { id: existing.id },
        data: { amount: dto.amount },
      });
    }
    return this.prisma.carWashPrice.create({
      data: {
        tenantId,
        vehicleType: dto.vehicleType,
        washTypeId,
        amount: dto.amount,
      },
    });
  }

  async deletePrice(id: number) {
    await this.prisma.carWashPrice.delete({ where: { id } });
    return { id };
  }

  // -------------------------------------------------------------------------
  // Wash types (business-defined wash service types)
  // -------------------------------------------------------------------------
  listWashTypes() {
    return this.prisma.carWashWashType.findMany({ orderBy: { name: 'asc' } });
  }

  async createWashType(dto: CreateWashTypeDto) {
    const tenantId = this.tenantId();
    try {
      return await this.prisma.carWashWashType.create({
        data: { tenantId, name: dto.name.trim() },
      });
    } catch (err) {
      return this.rethrowDuplicate(
        err,
        'A wash type with this name already exists',
      );
    }
  }

  async updateWashType(id: number, dto: UpdateWashTypeDto) {
    await this.assertWashType(id);
    return this.prisma.carWashWashType.update({
      where: { id },
      data: { name: dto.name.trim() },
    });
  }

  async deleteWashType(id: number) {
    await this.assertWashType(id);
    await this.prisma.carWashWashType.delete({ where: { id } });
    return { id };
  }

  // -------------------------------------------------------------------------
  // Vehicle types (business-defined vehicle categories)
  // -------------------------------------------------------------------------
  listVehicleTypes() {
    return this.prisma.carWashVehicleType.findMany({ orderBy: { name: 'asc' } });
  }

  async createVehicleType(dto: CreateVehicleTypeDto) {
    const tenantId = this.tenantId();
    try {
      return await this.prisma.carWashVehicleType.create({
        data: { tenantId, name: dto.name.trim() },
      });
    } catch (err) {
      return this.rethrowDuplicate(
        err,
        'A vehicle type with this name already exists',
      );
    }
  }

  async updateVehicleType(id: number, dto: UpdateVehicleTypeDto) {
    await this.assertVehicleType(id);
    return this.prisma.carWashVehicleType.update({
      where: { id },
      data: { name: dto.name.trim() },
    });
  }

  async deleteVehicleType(id: number) {
    await this.assertVehicleType(id);
    await this.prisma.carWashVehicleType.delete({ where: { id } });
    return { id };
  }

  // -------------------------------------------------------------------------
  // Vehicles (customer cars / plate numbers)
  // -------------------------------------------------------------------------
  listVehicles(search?: string, customerId?: number) {
    return this.prisma.carWashVehicle.findMany({
      where: {
        ...(customerId != null ? { customerId } : {}),
        ...(search
          ? {
              OR: [
                {
                  plateNumber: { contains: search, mode: 'insensitive' as const },
                },
                {
                  vehicleType: { contains: search, mode: 'insensitive' as const },
                },
              ],
            }
          : {}),
      },
      include: { customer: true },
      orderBy: { plateNumber: 'asc' },
      take: 100,
    });
  }

  async createVehicle(dto: CreateVehicleDto) {
    try {
      return await this.prisma.carWashVehicle.create({
        data: {
          tenantId: this.tenantId(),
          customerId: dto.customerId ?? null,
          plateNumber: dto.plateNumber,
          vehicleType: dto.vehicleType ?? 'Car',
        },
      });
    } catch (err) {
      return this.rethrowDuplicate(
        err,
        'This plate number is already registered',
      );
    }
  }

  async updateVehicle(id: number, dto: UpdateVehicleDto) {
    await this.assertVehicle(id);
    return this.prisma.carWashVehicle.update({
      where: { id },
      data: {
        customerId: dto.customerId,
        plateNumber: dto.plateNumber,
        vehicleType: dto.vehicleType,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Bookings (time-slot + walk-in queue)
  // -------------------------------------------------------------------------
  listBookings(
    date?: string,
    filters?: { startDate?: string; endDate?: string; washerId?: number; status?: string },
  ) {
    let where: any;
    if (filters?.startDate || filters?.endDate) {
      const { start, endExclusive } = this.resolveRange(
        filters.startDate,
        filters.endDate,
      );
      where = { bookingDate: { gte: start, lt: endExclusive } };
    } else {
      const day = date ? new Date(date) : new Date();
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      where = { bookingDate: { gte: start, lt: end } };
    }
    if (filters?.washerId != null) where.washerId = filters.washerId;
    if (filters?.status) where.status = filters.status as CarWashBookingStatus;
    return this.prisma.carWashBooking.findMany({
      where,
      include: {
        customer: true,
        vehicle: true,
        washer: true,
        items: { include: { vehicle: true, washType: true } },
      },
      orderBy: [{ isTimeSlotBooking: 'asc' }, { startsAt: 'asc' }],
    });
  }

  async createBooking(dto: CreateBookingDto) {
    const tenantId = this.tenantId();
    const startsAt = new Date(dto.startsAt);

    // Items: multi-vehicle payload, or the single-vehicle fields wrapped into
    // one item for backward compatibility.
    const items =
      dto.items && dto.items.length > 0
        ? dto.items
        : [
            {
              vehicleId: dto.vehicleId ?? null,
              vehicleType: dto.vehicleType ?? 'Car',
              amount: dto.amount ?? 0,
            },
          ];
    const totalAmount = items.reduce((s, i) => s + (i.amount ?? 0), 0);

    // Auto queue position: next in that day's queue when not supplied.
    const dayStart = new Date(startsAt.getFullYear(), startsAt.getMonth(), startsAt.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    let positionInQueue = dto.positionInQueue;
    if (positionInQueue == null) {
      const last = await this.prisma.carWashBooking.findFirst({
        where: { bookingDate: { gte: dayStart, lt: dayEnd } },
        orderBy: { positionInQueue: 'desc' },
        select: { positionInQueue: true },
      });
      positionInQueue = (last?.positionInQueue ?? 0) + 1;
    }

    return this.prisma.carWashBooking.create({
      data: {
        tenantId,
        customerId: dto.customerId ?? null,
        vehicleId: items[0]?.vehicleId ?? null,
        washerId: dto.washerId ?? null,
        vehicleType: items[0]?.vehicleType ?? dto.vehicleType ?? 'Car',
        amount: totalAmount,
        isTimeSlotBooking: dto.isTimeSlotBooking ?? true,
        bookingDate: startsAt,
        startsAt,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        positionInQueue,
        notes: dto.notes,
        items: {
          create: items.map((i) => ({
            tenantId,
            vehicleId: i.vehicleId ?? null,
            vehicleType: i.vehicleType ?? 'Car',
            washTypeId: i.washTypeId ?? null,
            amount: i.amount ?? 0,
            date: i.date ? new Date(i.date) : startsAt,
            startsAt: i.startsAt ? new Date(i.startsAt) : startsAt,
          })),
        },
      },
      include: {
        customer: true,
        vehicle: true,
        washer: true,
        items: { include: { vehicle: true, washType: true } },
      },
    });
  }

  async updateBookingStatus(id: number, status: CarWashBookingStatus) {
    await this.assertBooking(id);
    return this.prisma.carWashBooking.update({
      where: { id },
      data: { status },
    });
  }

  // -------------------------------------------------------------------------
  // Wash jobs (revenue)
  // -------------------------------------------------------------------------
  async listWashes(
    startDate?: string,
    endDate?: string,
    user?: { sub: number; permissions: string[] },
    filters?: { washerId?: number; washTypeId?: number },
  ) {
    const { start, endExclusive } =
      startDate || endDate
        ? this.resolveRange(startDate, endDate)
        : (() => {
            const s = new Date(new Date().setHours(0, 0, 0, 0));
            const e = new Date(new Date().setHours(23, 59, 59, 999) + 1);
            return { start: s, endExclusive: e };
          })();
    // A washer is always scoped to their own washes (forced); an owner/manager
    // may narrow to a specific washer via the filter.
    const scopeWasherId = await this.washerScope(user);
    const washerId = scopeWasherId ?? filters?.washerId ?? null;
    const washerWhere = washerId
      ? {
          OR: [
            { washerId },
            { participantWashers: { some: { id: washerId } } },
          ],
        }
      : {};
    const typeWhere = filters?.washTypeId != null ? { washTypeId: filters.washTypeId } : {};
    return this.prisma.carWash.findMany({
      where: { date: { gte: start, lt: endExclusive }, ...washerWhere, ...typeWhere },
      include: {
        washer: true,
        participantWashers: true,
        vehicle: true,
        customer: true,
        washType: true,
      },
      orderBy: { date: 'desc' },
    });
  }

  async createWash(dto: CreateWashDto, userId: number) {
    const participantIds = dto.participantWasherIds ?? [];
    const wash = await this.prisma.carWash.create({
      data: {
        tenantId: this.tenantId(),
        customerId: dto.customerId ?? null,
        vehicleId: dto.vehicleId ?? null,
        washerId: dto.washerId ?? null,
        participantWashers: { connect: participantIds.map((id) => ({ id })) },
        vehicleType: dto.vehicleType ?? 'Car',
        washTypeId: dto.washTypeId ?? null,
        amount: dto.amount,
        date: dto.date ? new Date(dto.date) : new Date(),
        notes: dto.notes,
        plateNumber: dto.plateNumber,
        makeModel: dto.makeModel,
        recordedById: userId,
      },
      include: {
        washer: true,
        participantWashers: true,
        vehicle: true,
        customer: true,
      },
    });

    const washersById = new Map<number, CommissionedWasher>();
    if (wash.washer) washersById.set(wash.washer.id, wash.washer);
    for (const p of wash.participantWashers) washersById.set(p.id, p);

    const { commissions, ownerShare } = computeWashCommissions({
      amount: wash.amount,
      primaryWasherId: wash.washerId,
      participantWasherIds: participantIds,
      washersById,
    });

    return { ...wash, commissions, ownerShare };
  }

  async completeWash(id: number) {
    const wash = await this.prisma.carWash.findUnique({
      where: { id },
      include: { washer: true, participantWashers: true },
    });
    if (!wash) throw new NotFoundException('Wash not found');

    const washersById = new Map<number, CommissionedWasher>();
    if (wash.washer) washersById.set(wash.washer.id, wash.washer);
    for (const p of wash.participantWashers) washersById.set(p.id, p);
    const { totalCommission } = computeWashCommissions({
      amount: wash.amount,
      primaryWasherId: wash.washerId,
      participantWasherIds: wash.participantWashers.map((p) => p.id),
      washersById,
    });

    const tenantId = this.tenantId();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.carWash.update({
        where: { id },
        data: { status: CarWashStatus.COMPLETED, completedAt: new Date() },
      });

      // Only a COMPLETED wash is recognised in the ledger (a wash terminated
      // before completion posts nothing). Idempotent by wash id.
      const accounts = await tx.account.findMany({ where: { tenantId } });
      const revenueAccount =
        accounts.find((a) => a.name === 'Car Wash Revenue') ??
        accounts.find((a) => a.name === 'Equipment Revenue') ??
        accounts.find((a) => a.type === AccountType.INCOME);
      const commissionAccount = accounts.find(
        (a) => a.name === 'Washer Commission Expense',
      );
      if (revenueAccount && wash.amount > 0) {
        await this.finance.postCarWashIncome({
          tx,
          tenantId,
          washId: id,
          revenueAccountId: revenueAccount.id,
          commissionAccountId: commissionAccount?.id ?? null,
          description: `Car wash #${id}`,
          revenue: wash.amount,
          commission: totalCommission,
          incomeDate: wash.date,
          createdById: wash.recordedById ?? null,
        });
      }
      return updated;
    });
  }

  async commissions(
    startDate?: string,
    endDate?: string,
    user?: { sub: number; permissions: string[] },
  ) {
    const start = startDate
      ? new Date(startDate)
      : new Date(new Date().setHours(0, 0, 0, 0));
    const end = endDate
      ? new Date(endDate)
      : new Date(new Date().setHours(23, 59, 59, 999));
    const washerId = await this.washerScope(user);
    const washerWhere = washerId
      ? {
          OR: [
            { washerId },
            { participantWashers: { some: { id: washerId } } },
          ],
        }
      : {};
    const washes = await this.prisma.carWash.findMany({
      where: { date: { gte: start, lte: end }, ...washerWhere },
      include: { washer: true, participantWashers: true },
    });
    return { start, end, ...this.summarizeWashes(washes) };
  }

  // -------------------------------------------------------------------------
  // Equipment issuance (atomic stock decrement)
  // -------------------------------------------------------------------------
  listEquipmentIssues() {
    return this.prisma.carWashEquipmentIssue.findMany({
      include: { washer: true, product: true },
      orderBy: { issuedAt: 'desc' },
    });
  }

  async issueEquipment(dto: IssueEquipmentDto) {
    const tenantId = this.tenantId();
    const totalAmount = (dto.unitPrice ?? 0) * dto.quantity;

    return this.prisma.$transaction(async (tx) => {
      const issue = await tx.carWashEquipmentIssue.create({
        data: {
          tenantId,
          washerId: dto.washerId ?? null,
          productId: dto.productId ?? null,
          quantity: dto.quantity,
          unitPrice: dto.unitPrice ?? 0,
          totalAmount,
        },
      });

      if (dto.productId != null) {
        const inv = await tx.inventory.findFirst({
          where: { productId: dto.productId, tenantId },
          orderBy: { id: 'asc' },
        });
        if (inv) {
          await tx.inventory.update({
            where: { id: inv.id },
            data: { quantity: { decrement: dto.quantity } },
          });
        }
      }

      return issue;
    });
  }

  async markEquipmentIssuePaid(id: number, isPaid?: boolean) {
    await this.assertEquipmentIssue(id);
    return this.prisma.carWashEquipmentIssue.update({
      where: { id },
      data: {
        isPaid: isPaid ?? true,
        paidAt: isPaid === false ? null : new Date(),
      },
    });
  }

  // -------------------------------------------------------------------------
  // Money collection + daily summary
  // -------------------------------------------------------------------------
  async dailySummary(dateStr?: string, endDateStr?: string) {
    // Single-day (legacy) when only `dateStr` is given; a range when both are.
    const { start, endExclusive } = this.resolveRange(dateStr, endDateStr);

    const [washes, equipment, expenses, collections] = await Promise.all([
      this.prisma.carWash.findMany({
        where: { date: { gte: start, lt: endExclusive } },
        include: { washer: true, participantWashers: true },
      }),
      this.prisma.carWashEquipmentIssue.findMany({
        where: { issuedAt: { gte: start, lt: endExclusive } },
      }),
      this.prisma.expense.findMany({
        where: { expenseDate: { gte: start, lt: endExclusive } },
      }),
      this.prisma.carWashCollection.findMany({
        where: { collectionDate: { gte: start, lt: endExclusive } },
        select: { totalAmount: true },
      }),
    ]);

    const summary = this.summarizeWashes(washes);
    const equipmentRevenue = equipment.reduce((s, e) => s + e.totalAmount, 0);
    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
    const netProfit = summary.ownerShare - totalExpenses;
    // Money on the air: the owner share not yet collected. The gap is what is
    // still outstanding for the range, so the collection button only enables
    // while a gap remains.
    const collectedAmount = collections.reduce((s, c) => s + c.totalAmount, 0);
    const gap = Math.max(0, summary.ownerShare - collectedAmount);

    return {
      date: start,
      startDate: this.toLocalDay(start),
      endDate: this.toLocalDay(new Date(endExclusive.getTime() - 86400000)),
      totalRevenue: summary.totalRevenue,
      totalCommission: summary.totalCommission,
      ownerShare: summary.ownerShare,
      equipmentRevenue,
      totalExpenses,
      netProfit,
      collectedAmount,
      gap,
    };
  }

  listCollections(startDate?: string, endDate?: string) {
    const where =
      startDate || endDate
        ? (() => {
            const { start, endExclusive } = this.resolveRange(
              startDate,
              endDate,
            );
            return { collectionDate: { gte: start, lt: endExclusive } };
          })()
        : {};
    return this.prisma.carWashCollection.findMany({
      where,
      include: { collectedBy: true },
      orderBy: { collectionDate: 'desc' },
    });
  }

  async createCollection(dto: CreateCollectionDto, userId: number) {
    const tenantId = this.tenantId();
    const summary = await this.dailySummary(dto.collectionDate);
    const day = dto.collectionDate ? new Date(dto.collectionDate) : new Date();
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

    const prior = await this.prisma.carWashCollection.findMany({
      where: { collectionDate: { gte: start, lt: end } },
      select: { totalAmount: true, remainingBalance: true },
    });
    const priorTotal = prior.reduce((s, c) => s + c.totalAmount, 0);

    // A day whose owner share has already been handed over in full is settled:
    // refuse a second full collection so double-taps can't create duplicates.
    const alreadySettled = prior.some(
      (c) => (c.remainingBalance ?? 0) <= 0.0001,
    );
    if (alreadySettled && dto.totalAmount == null) {
      throw new BadRequestException(tr('errors.collectionAlreadySettled'));
    }

    const totalAmount = dto.totalAmount ?? summary.ownerShare;
    const remainingBalance = summary.ownerShare - priorTotal - totalAmount;

    return this.prisma.carWashCollection.create({
      data: {
        tenantId,
        collectedById: userId,
        totalAmount,
        dailyOwnerShare: summary.ownerShare,
        equipmentRevenue: summary.equipmentRevenue,
        totalExpenses: summary.totalExpenses,
        netAmountDue: summary.ownerShare,
        netProfit: summary.netProfit,
        remainingBalance,
        collectionDate: day,
        notes: dto.notes,
      },
    });
  }

  // Products usable as equipment/store items for the equipment-issue form.
  listProducts() {
    return this.prisma.product.findMany({
      orderBy: { baseName: 'asc' },
      take: 200,
    });
  }

  async deleteVehicle(id: number) {
    await this.assertVehicle(id);
    await this.prisma.carWashVehicle.delete({ where: { id } });
    return { id };
  }

  async deleteBooking(id: number) {
    await this.assertBooking(id);
    await this.prisma.carWashBooking.delete({ where: { id } });
    return { id };
  }

  async deleteWash(id: number) {
    await this.assertWash(id);
    await this.prisma.carWash.delete({ where: { id } });
    return { id };
  }

  async deleteEquipmentIssue(id: number) {
    await this.assertEquipmentIssue(id);
    await this.prisma.carWashEquipmentIssue.delete({ where: { id } });
    return { id };
  }

  // -------------------------------------------------------------------------
  // Expenses (simple category -> mapped to the right account under the hood)
  // -------------------------------------------------------------------------
  listExpenses(
    startDate?: string,
    endDate?: string,
    category?: string,
    search?: string,
  ) {
    const { start, endExclusive } =
      startDate || endDate ? this.resolveRange(startDate, endDate) : {};
    return this.prisma.expense.findMany({
      where: {
        ...(start ? { expenseDate: { gte: start, lt: endExclusive } } : {}),
        ...(category ? { account: { name: category } } : {}),
        ...(search
          ? {
              OR: [
                { account: { name: { contains: search, mode: 'insensitive' } } },
                { notes: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: { account: true },
      orderBy: { expenseDate: 'desc' },
      take: 200,
    });
  }

  async createExpense(dto: CreateCarWashExpenseDto, userId: number) {
    const accountId = await this.resolveExpenseAccountId(dto.category);
    return this.finance.createExpense(
      {
        accountId,
        amount: dto.amount,
        notes: dto.notes,
        expenseDate: dto.expenseDate,
      },
      userId,
    );
  }

  async updateExpense(id: number, dto: UpdateCarWashExpenseDto) {
    const accountId = dto.category
      ? await this.resolveExpenseAccountId(dto.category)
      : undefined;
    return this.finance.updateExpense(id, {
      ...(accountId ? { accountId } : {}),
      ...(dto.amount != null ? { amount: dto.amount } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      ...(dto.expenseDate ? { expenseDate: dto.expenseDate } : {}),
    });
  }

  async deleteExpense(id: number) {
    return this.finance.deleteExpense(id);
  }

  private async resolveExpenseAccountId(category: string): Promise<number> {
    const tenantId = this.tenantId();
    const nameMap: Record<string, string> = {
      Rent: 'Rent',
      Salaries: 'Salaries & Wages',
      Utilities: 'Utilities',
      Supplies: 'Supplies',
      Marketing: 'Marketing',
      Maintenance: 'Maintenance',
      Equipment: 'Equipment & Tools',
      Other: 'Supplies',
    };
    const target = nameMap[category] ?? 'Supplies';
    const account = await this.prisma.account.findFirst({
      where: { tenantId, name: target, type: AccountType.EXPENSE },
    });
    if (account) return account.id;

    // No silent fallback: the category must map to a real COA account so the
    // posted GL entry lands in the right expense bucket. If the exact account is
    // missing, try the generic expense accounts before failing loudly.
    const generic = await this.prisma.account.findFirst({
      where: { tenantId, name: 'Other Expenses', type: AccountType.EXPENSE },
    });
    if (generic) return generic.id;

    throw new BadRequestException(
      tr('errors.carWashExpenseAccountMissing', { category: target }),
    );
  }

  // -------------------------------------------------------------------------
  // Washer self-service report (scoped to the logged-in washer)
  // -------------------------------------------------------------------------
  async myReport(userId: number) {
    const washer = await this.prisma.carWashWasher.findFirst({
      where: { userId },
    });
    if (!washer) {
      throw new NotFoundException('No washer profile linked to this account');
    }

    const washes = await this.prisma.carWash.findMany({
      where: {
        OR: [
          { washerId: washer.id },
          { participantWashers: { some: { id: washer.id } } },
        ],
      },
      include: {
        washer: true,
        participantWashers: true,
        vehicle: true,
        customer: true,
      },
      orderBy: { date: 'desc' },
    });

    let totalRevenue = 0;
    let totalCommission = 0;
    for (const wash of washes) {
      totalRevenue += wash.amount;
      const involved = new Set<number>();
      if (wash.washerId != null) involved.add(wash.washerId);
      for (const p of wash.participantWashers) involved.add(p.id);
      const n = involved.size;
      if (n === 0) continue;
      const rate =
        wash.washer?.id === washer.id
          ? wash.washer.commissionRate
          : wash.participantWashers.find((p) => p.id === washer.id)
              ?.commissionRate;
      if (rate == null) continue;
      totalCommission += (wash.amount * (rate / 100)) / n;
    }

    return {
      washer: {
        id: washer.id,
        name: washer.name,
        commissionRate: washer.commissionRate,
      },
      washCount: washes.length,
      totalRevenue,
      totalCommission,
      washes,
    };
  }

  // -------------------------------------------------------------------------
  // Settings (CarWashProfile)
  // -------------------------------------------------------------------------
  async getSettings() {
    const tenantId = this.tenantId();
    return this.prisma.carWashProfile.upsert({
      where: { organizationId: tenantId },
      update: {},
      create: { organizationId: tenantId },
    });
  }

  async updateSettings(slotMinutes: number) {
    const tenantId = this.tenantId();
    await this.prisma.carWashProfile.upsert({
      where: { organizationId: tenantId },
      update: { slotMinutes },
      create: { organizationId: tenantId, slotMinutes },
    });
    return this.prisma.carWashProfile.findUnique({
      where: { organizationId: tenantId },
    });
  }

  // -------------------------------------------------------------------------
  // Availability check (time-slot conflict for a washer)
  // -------------------------------------------------------------------------
  async checkAvailability(
    washerId: number,
    startsAt: string,
    slotMinutes?: number,
  ) {
    const tenantId = this.tenantId();
    const start = new Date(startsAt);
    const mins = slotMinutes ?? 30;
    const end = new Date(start.getTime() + mins * 60 * 1000);
    const overlapping = await this.prisma.carWashBooking.findMany({
      where: {
        tenantId,
        washerId,
        status: {
          in: [CarWashBookingStatus.PENDING, CarWashBookingStatus.SERVING],
        },
        startsAt: { lt: end },
        OR: [{ endsAt: { gt: start } }, { endsAt: null }],
      },
      select: { id: true },
    });
    return { available: overlapping.length === 0, slotMinutes: mins };
  }

  // -------------------------------------------------------------------------
  // Store items (equipment) — thin wrapper over Product + Inventory
  // -------------------------------------------------------------------------
  listStoreItems() {
    return this.prisma.product.findMany({
      include: { inventory: true },
      orderBy: { baseName: 'asc' },
      take: 200,
    });
  }

  private async defaultCategoryId(): Promise<number> {
    const tenantId = this.tenantId();
    let cat = await this.prisma.category.findFirst({
      where: { tenantId, name: 'General' },
    });
    if (!cat) {
      cat = await this.prisma.category.create({
        data: { tenantId, name: 'General' },
      });
    }
    return cat.id;
  }

  private async defaultLocationId(): Promise<number> {
    const tenantId = this.tenantId();
    let loc = await this.prisma.location.findFirst({ where: { tenantId } });
    if (!loc) {
      loc = await this.prisma.location.create({
        data: { tenantId, name: 'Main', type: LocationType.SHOP },
      });
    }
    return loc.id;
  }

  async createStoreItem(dto: CreateStoreItemDto) {
    const tenantId = this.tenantId();
    const categoryId = await this.defaultCategoryId();
    const locationId = await this.defaultLocationId();
    const price = dto.sellingPrice ?? 0;
    const sku = `CW-${Date.now()}`;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            tenantId,
            sku,
            brand: 'General',
            baseName: dto.name,
            currentBuyPrice: price,
            currentSellPrice: price,
            categoryId,
            reorderLevel: dto.minimumStock ?? 0,
          },
        });
        await tx.inventory.create({
          data: {
            tenantId,
            productId: product.id,
            locationId,
            quantity: dto.stock ?? 0,
          },
        });
        return product;
      });
    } catch (err) {
      return this.rethrowDuplicate(
        err,
        'An item with this name already exists',
      );
    }
  }

  async updateStoreItem(id: number, dto: UpdateStoreItemDto) {
    const data: Record<string, unknown> = {};
    if (dto.name) data.baseName = dto.name;
    if (dto.sellingPrice != null) {
      data.currentSellPrice = dto.sellingPrice;
      data.currentBuyPrice = dto.sellingPrice;
    }
    if (dto.minimumStock != null) data.reorderLevel = dto.minimumStock;
    await this.prisma.product.update({ where: { id }, data });

    if (dto.stock != null) {
      const tenantId = this.tenantId();
      const locationId = await this.defaultLocationId();
      const inv = await this.prisma.inventory.findFirst({
        where: { productId: id, locationId },
      });
      if (inv) {
        await this.prisma.inventory.update({
          where: { id: inv.id },
          data: { quantity: dto.stock },
        });
      } else {
        await this.prisma.inventory.create({
          data: { tenantId, productId: id, locationId, quantity: dto.stock },
        });
      }
    }
    return this.prisma.product.findUnique({
      where: { id },
      include: { inventory: true },
    });
  }

  async deleteStoreItem(id: number) {
    await this.prisma.product.delete({ where: { id } });
    return { id };
  }

  // -------------------------------------------------------------------------
  // Washer reports (per-washer commission over a date range)
  // -------------------------------------------------------------------------
  async washerReports(
    startDate?: string,
    endDate?: string,
    user?: { sub: number; permissions: string[] },
  ) {
    // Local-day range so a report for "today" includes today's local washes.
    const { start, endExclusive } = this.resolveRange(startDate, endDate);
    const end = new Date(endExclusive.getTime() - 1);

    // A washer only sees their own row; owner/manager see every washer.
    const scopeWasherId = await this.washerScope(user);

    const [washers, washes] = await Promise.all([
      this.prisma.carWashWasher.findMany({
        where: scopeWasherId != null ? { id: scopeWasherId } : undefined,
        orderBy: { name: 'asc' },
      }),
      this.prisma.carWash.findMany({
        where: { date: { gte: start, lt: endExclusive } },
        include: { washer: true, participantWashers: true },
      }),
    ]);

    const report = washers.map((washer) => {
      const own = washes.filter(
        (w) =>
          w.washerId === washer.id ||
          w.participantWashers.some((p) => p.id === washer.id),
      );
      let totalRevenue = 0;
      let commission = 0;
      for (const wash of own) {
        totalRevenue += wash.amount;
        const involved = new Set<number>();
        if (wash.washerId != null) involved.add(wash.washerId);
        for (const p of wash.participantWashers) involved.add(p.id);
        const n = involved.size;
        if (n === 0) continue;
        const rate =
          wash.washer?.id === washer.id
            ? wash.washer.commissionRate
            : wash.participantWashers.find((p) => p.id === washer.id)
                ?.commissionRate;
        if (rate == null) continue;
        commission += (wash.amount * (rate / 100)) / n;
      }
      return {
        washerId: washer.id,
        name: washer.name,
        commissionRate: washer.commissionRate,
        washCount: own.length,
        totalRevenue,
        commission,
      };
    });

    return { start, end, washers: report };
  }

  /**
   * The washes a single washer completed in a date range, each with that
   * washer's commission share — the drill-down behind the washer report row.
   * A washer caller is always scoped to their own record.
   */
  async washerWashes(
    washerId: number,
    startDate?: string,
    endDate?: string,
    user?: { sub: number; permissions: string[] },
  ) {
    const scopeWasherId = await this.washerScope(user);
    const effectiveId = scopeWasherId ?? washerId;
    const { start, endExclusive } = this.resolveRange(startDate, endDate);

    const washes = await this.prisma.carWash.findMany({
      where: {
        date: { gte: start, lt: endExclusive },
        OR: [
          { washerId: effectiveId },
          { participantWashers: { some: { id: effectiveId } } },
        ],
      },
      include: {
        washer: true,
        participantWashers: true,
        vehicle: true,
        customer: true,
        washType: true,
      },
      orderBy: { date: 'desc' },
    });

    return washes.map((wash) => {
      const washersById = new Map<number, CommissionedWasher>();
      if (wash.washer) washersById.set(wash.washer.id, wash.washer);
      for (const p of wash.participantWashers) washersById.set(p.id, p);
      const { commissions } = computeWashCommissions({
        amount: wash.amount,
        primaryWasherId: wash.washerId,
        participantWasherIds: wash.participantWashers.map((p) => p.id),
        washersById,
      });
      return {
        id: wash.id,
        date: wash.date,
        status: wash.status,
        vehicleType: wash.vehicleType,
        plateNumber: wash.plateNumber,
        washType: wash.washType?.name ?? null,
        amount: wash.amount,
        commission: commissions[effectiveId] ?? 0,
        customer: wash.customer?.name ?? null,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Breakdown report (mirrors the Flutter reports screen): revenue/commission,
  // expenses, equipment revenue (paid vs unpaid), washer earnings, popular
  // items and low-stock items over a date range.
  // -------------------------------------------------------------------------
  async reportsBreakdown(
    startDate?: string,
    endDate?: string,
    user?: { sub: number; permissions: string[] },
  ) {
    const { start, endExclusive } = this.resolveRange(startDate, endDate);
    const end = new Date(endExclusive.getTime() - 1);
    const washerId = await this.washerScope(user);
    const washerWhere = washerId
      ? {
          OR: [
            { washerId },
            { participantWashers: { some: { id: washerId } } },
          ],
        }
      : {};

    const [washes, equipment, expenses, products, washers] = await Promise.all([
      this.prisma.carWash.findMany({
        where: { date: { gte: start, lte: end }, ...washerWhere },
        include: { washer: true, participantWashers: true },
      }),
      this.prisma.carWashEquipmentIssue.findMany({
        // A washer only sees equipment issued to THEM (own scope); owner/manager
        // sees everyone's.
        where: {
          issuedAt: { gte: start, lte: end },
          ...(washerId != null ? { washerId } : {}),
        },
        include: { washer: true, product: true },
      }),
      this.prisma.expense.findMany({
        where: { expenseDate: { gte: start, lte: end } },
      }),
      this.prisma.product.findMany({
        include: { inventory: true },
        take: 200,
      }),
      this.prisma.carWashWasher.findMany({
        // A washer sees only their own row (so "Washer earnings" can never show
        // other washers); owner/manager sees all.
        where: washerId != null ? { id: washerId } : undefined,
        orderBy: { name: 'asc' },
      }),
    ]);

    const summary = this.summarizeWashes(washes);
    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

    const paid = equipment.filter((e) => e.isPaid);
    const unpaid = equipment.filter((e) => !e.isPaid);
    const paidEquipmentRevenue = paid.reduce((s, e) => s + e.totalAmount, 0);
    const unpaidEquipmentRevenue = unpaid.reduce((s, e) => s + e.totalAmount, 0);
    const totalEquipmentRevenue = paidEquipmentRevenue + unpaidEquipmentRevenue;

    const washerEarnings = washers
      .map((w) => ({
        washerId: w.id,
        name: w.name,
        commission: summary.perWasher[w.id] ?? 0,
      }))
      .filter((w) => w.commission > 0)
      .sort((a, b) => b.commission - a.commission);

    const equipmentByWasher = (list: typeof equipment) => {
      const map = new Map<number, number>();
      for (const e of list) {
        if (e.washerId == null) continue;
        map.set(e.washerId, (map.get(e.washerId) ?? 0) + e.totalAmount);
      }
      return washers
        .map((w) => ({
          washerId: w.id,
          name: w.name,
          total: map.get(w.id) ?? 0,
        }))
        .filter((x) => x.total > 0)
        .sort((a, b) => b.total - a.total);
    };

    const qtyByProduct = new Map<number, number>();
    for (const e of equipment) {
      if (e.productId == null) continue;
      qtyByProduct.set(
        e.productId,
        (qtyByProduct.get(e.productId) ?? 0) + e.quantity,
      );
    }
    const popularItems = [...qtyByProduct.entries()]
      .map(([id, qty]) => ({
        id,
        name:
          equipment.find((e) => e.productId === id)?.product?.baseName ??
          `#${id}`,
        quantity: qty,
      }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);

    const lowStockItems = products
      .map((p) => {
        const stock = (p.inventory ?? []).reduce((s, i) => s + i.quantity, 0);
        return {
          id: p.id,
          name: p.baseName,
          stock,
          minimumStock: p.reorderLevel ?? 0,
        };
      })
      .filter((x) => x.stock <= x.minimumStock);

    // --- Per-detail visibility (server-side redaction) ---
    // A caller sees a section when they hold its detail key. A washer (who only
    // has `carwash.reports.commission`) additionally always sees their OWN row,
    // because `washCount` and `washerEarnings` are already scoped by
    // `washerScope` to their own washes. Company financials/inventory/equipment
    // are nulled/emptied so the data never leaves the API for unpermitted users.
    const perms = user?.permissions ?? [];
    const canFinancials =
      perms.includes('carwash.reports.financials') ||
      perms.includes('carwash.collections.view');
    const canCommission = perms.includes('carwash.reports.commission');
    const canInventory = perms.includes('carwash.reports.inventory');
    const canEquipment = perms.includes('carwash.reports.equipment');
    // A washer viewing their own scoped data keeps their own commission row even
    // without the company-wide `carwash.reports.commission` key.
    const isOwnScope = washerId != null;
    const showCommission = canCommission || isOwnScope;

    const redacted = {
      start,
      end,
      // Financials (owner money)
      totalRevenue: canFinancials ? summary.totalRevenue : null,
      ownerShare: canFinancials ? summary.ownerShare : null,
      totalExpenses: canFinancials ? totalExpenses : null,
      netProfit: canFinancials ? summary.ownerShare - totalExpenses : null,
      totalIncome: canFinancials
        ? summary.totalRevenue + totalEquipmentRevenue
        : null,
      // Commission
      totalCommission: showCommission ? summary.totalCommission : null,
      washCount: isOwnScope || canCommission || canFinancials ? washes.length : null,
      washerEarnings: showCommission ? washerEarnings : [],
      // Equipment
      paidEquipmentRevenue: canEquipment ? paidEquipmentRevenue : null,
      unpaidEquipmentRevenue: canEquipment ? unpaidEquipmentRevenue : null,
      totalEquipmentRevenue: canEquipment ? totalEquipmentRevenue : null,
      equipmentIssueCount: canEquipment ? equipment.length : null,
      paidEquipmentCount: canEquipment ? paid.length : null,
      unpaidEquipmentCount: canEquipment ? unpaid.length : null,
      paidEquipmentByWasher: canEquipment ? equipmentByWasher(paid) : [],
      unpaidEquipmentByWasher: canEquipment ? equipmentByWasher(unpaid) : [],
      // Inventory
      popularItems: canInventory ? popularItems : [],
      lowStockItems: canInventory ? lowStockItems : [],
      // Which sections the client may render (drives the card visibility).
      sections: {
        financials: canFinancials,
        commission: showCommission,
        inventory: canInventory,
        equipment: canEquipment,
      },
    };
    return redacted;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  private async assertWashType(id: number) {
    const found = await this.prisma.carWashWashType.findUnique({
      where: { id },
    });
    if (!found) throw new NotFoundException('Wash type not found');
  }

  private async assertVehicleType(id: number) {
    const found = await this.prisma.carWashVehicleType.findUnique({
      where: { id },
    });
    if (!found) throw new NotFoundException('Vehicle type not found');
  }

  private async assertWasher(id: number) {
    const found = await this.prisma.carWashWasher.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Washer not found');
  }

  private async assertVehicle(id: number) {
    const found = await this.prisma.carWashVehicle.findUnique({
      where: { id },
    });
    if (!found) throw new NotFoundException('Vehicle not found');
  }

  private async assertBooking(id: number) {
    const found = await this.prisma.carWashBooking.findUnique({
      where: { id },
    });
    if (!found) throw new NotFoundException('Booking not found');
  }

  private async assertWash(id: number) {
    const found = await this.prisma.carWash.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Wash not found');
  }

  private async assertEquipmentIssue(id: number) {
    const found = await this.prisma.carWashEquipmentIssue.findUnique({
      where: { id },
    });
    if (!found) throw new NotFoundException('Equipment issue not found');
  }
}
