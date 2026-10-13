// src/guest-orders/guest-orders.service.ts
// Privileged side of public guest ordering: the inbox, review, routing to
// branches (central desk), branch replies, and release (free / reject). All
// methods are tenant-scoped and permission-gated at the controller.
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GuestOrderConversionService } from './guest-order-conversion.service';
import { getCurrentTenantId } from '../common/tenant/tenant.context';
import { auditBestEffort } from '../common/audit.util';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import {
  entryKindsFor,
  hospitalityServiceLabel,
  kindForHospitalityService,
  publicKindFor,
} from '../public/public.constants';
import type { HospitalityServiceType } from '@prisma/client';

@Injectable()
export class GuestOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly conversion: GuestOrderConversionService,
  ) {}

  private tenantId(): number {
    const id = getCurrentTenantId();
    if (id == null) throw new BadRequestException('No active organization');
    return id;
  }

  /**
   * The branch the user is scoped to, but only when that location actually
   * belongs to the active tenant. A stale `locationId` (e.g. pointing at a
   * location from a previous business) must never turn the inbox into an empty
   * list — it falls back to central (null) instead.
   */
  private async effectiveBranchId(
    user: JwtPayload | undefined,
    tenantId: number,
  ): Promise<number | null> {
    const locationId = user?.locationId ?? null;
    if (locationId == null) return null;
    const loc = await this.prisma.location.findFirst({
      where: { id: locationId, tenantId },
      select: { id: true },
    });
    return loc ? locationId : null;
  }

  /** The privileged inbox: guest orders for the active business. */
  async list(status?: string, user?: JwtPayload, sort?: string) {
    const tenantId = this.tenantId();
    const branchId = await this.effectiveBranchId(user, tenantId);
    return this.prisma.guestOrder.findMany({
      where: {
        tenantId,
        ...(status ? { status: status as any } : {}),
        // Branch-scoped inbox: a branch sees orders placed through its own entry
        // or routed to it by the central desk. Central sees everything.
        ...(branchId
          ? {
              OR: [
                { entry: { locationId: branchId } },
                { routes: { some: { locationId: branchId } } },
              ],
            }
          : {}),
      },
      include: {
        entry: {
          select: {
            label: true,
            kind: true,
            locationId: true,
            table: { select: { name: true } },
          },
        },
        items: true,
        routes: { include: { location: { select: { id: true, name: true } } } },
      },
      // Default: oldest first (inbox order). The UI can switch to newest first.
      orderBy: { createdAt: sort === 'newest' ? 'desc' : 'asc' },
      take: 200,
    });
  }

  async get(id: number, user?: JwtPayload) {
    const tenantId = this.tenantId();
    const branchId = await this.effectiveBranchId(user, tenantId);
    const order = await this.prisma.guestOrder.findFirst({
      where: {
        id,
        tenantId,
        ...(branchId
          ? {
              OR: [
                { entry: { locationId: branchId } },
                { routes: { some: { locationId: branchId } } },
              ],
            }
          : {}),
      },
      include: {
        entry: true,
        items: true,
        routes: { include: { location: true } },
        activities: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) throw new NotFoundException('Guest order not found');

    // Surface the washer chosen for each car-wash line (stored as JSON in the
    // item notes) so the detail view can show it next to each vehicle.
    const washerIdByItem = new Map<
      number,
      { washerId: number | null; washerName: string | null }
    >();
    const washerIds = new Set<number>();
    for (const item of order.items) {
      if (item.itemKind !== 'CARWASH_ITEM' || !item.notes) continue;
      let washerId: number | null = null;
      try {
        washerId = JSON.parse(item.notes).washerId ?? null;
      } catch {
        washerId = null;
      }
      if (typeof washerId === 'number') washerIds.add(washerId);
      washerIdByItem.set(item.id, { washerId, washerName: null });
    }
    if (washerIds.size > 0) {
      const washers = await this.prisma.carWashWasher.findMany({
        where: { tenantId, id: { in: [...washerIds] } },
        select: { id: true, name: true },
      });
      const nameById = new Map(washers.map((w) => [w.id, w.name]));
      for (const entry of washerIdByItem.values()) {
        if (entry.washerId != null) {
          entry.washerName = nameById.get(entry.washerId) ?? null;
        }
      }
    }
    const items = order.items.map((item) => {
      const washer = washerIdByItem.get(item.id);
      return washer ? { ...item, ...washer } : item;
    });

    // Registered customers have known vehicle types; surface them so the edit
    // form can show the customer's vehicle type when present.
    const customerVehicles = await this.customerVehiclesFor(
      tenantId,
      order.customerId,
      order.customerPhone,
    );

    // GuestOrder.saleId is a plain Int? (no relation in Prisma), so fetch the
    // linked sale summary explicitly for the detail modal.
    let sale: { id: number; invoiceNumber: string; shop: { id: number; name: string } | null } | null = null;
    if (order.saleId) {
      sale = await this.prisma.sale.findUnique({
        where: { id: order.saleId },
        select: {
          id: true,
          invoiceNumber: true,
          shop: { select: { id: true, name: true } },
        },
      });
    }
    return { ...order, items, sale, customerVehicles };
  }

  /** The registered customer's car-wash vehicles (plate + type), if any. */
  private async customerVehiclesFor(
    tenantId: number,
    customerId: number | null,
    customerPhone: string | null,
  ) {
    let resolvedId = customerId;
    if (resolvedId == null && customerPhone) {
      const customer = await this.prisma.customer.findFirst({
        where: { organizationId: tenantId, phone: customerPhone },
        select: { id: true },
      });
      resolvedId = customer?.id ?? null;
    }
    if (resolvedId == null) return [];
    return this.prisma.carWashVehicle.findMany({
      where: { tenantId, customerId: resolvedId },
      select: { id: true, plateNumber: true, vehicleType: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Options the guest-order edit form needs (car-wash lines only). */
  async editOptions() {
    const tenantId = this.tenantId();
    const [washers, washTypes, vehicleTypes] = await Promise.all([
      this.prisma.carWashWasher.findMany({
        where: { tenantId, isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      this.prisma.carWashWashType.findMany({
        where: { tenantId },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      this.prisma.carWashVehicleType.findMany({
        where: { tenantId },
        orderBy: { name: 'asc' },
        select: { name: true },
      }),
    ]);
    return {
      washers,
      washTypes,
      vehicleTypes: vehicleTypes.map((v) => v.name),
    };
  }

  /** Delete a guest order before it is linked to an internal record. */
  async remove(id: number, user?: JwtPayload) {
    const tenantId = this.tenantId();
    const branchId = await this.effectiveBranchId(user, tenantId);
    const order = await this.prisma.guestOrder.findFirst({
      where: {
        id,
        tenantId,
        ...(branchId
          ? {
              OR: [
                { entry: { locationId: branchId } },
                { routes: { some: { locationId: branchId } } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        saleId: true,
        bookingId: true,
        orderId: true,
        reservationId: true,
      },
    });
    if (!order) throw new NotFoundException('Guest order not found');
    if (
      order.saleId != null ||
      order.bookingId != null ||
      order.orderId != null ||
      order.reservationId != null
    ) {
      throw new BadRequestException(
        'This order is already linked to an internal record and can no longer be deleted',
      );
    }
    await this.prisma.guestOrder.delete({ where: { id } });
    return { ok: true };
  }

  /** Edit car-wash guest order lines: washer, date/time, wash type, vehicle type. */
  async update(
    id: number,
    dto:
      | {
          items?: Array<{
            id: number;
            vehicleType?: string;
            washTypeId?: number | null;
            washerId?: number | null;
            startsAt?: string;
          }>;
          note?: string;
        }
      | undefined,
    user?: JwtPayload,
  ) {
    const tenantId = this.tenantId();
    const branchId = await this.effectiveBranchId(user, tenantId);
    const order = await this.prisma.guestOrder.findFirst({
      where: {
        id,
        tenantId,
        ...(branchId
          ? {
              OR: [
                { entry: { locationId: branchId } },
                { routes: { some: { locationId: branchId } } },
              ],
            }
          : {}),
      },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Guest order not found');

    const carWashItems = (order.items ?? []).filter(
      (item) => item.itemKind === 'CARWASH_ITEM',
    );
    if (carWashItems.length === 0) {
      throw new BadRequestException('Only car wash orders can be edited here');
    }

    const updateById = new Map((dto?.items ?? []).map((u) => [u.id, u]));
    const [prices, washTypes, washers] = await Promise.all([
      this.prisma.carWashPrice.findMany({
        where: { tenantId },
        select: { vehicleType: true, washTypeId: true, amount: true },
      }),
      this.prisma.carWashWashType.findMany({
        where: { tenantId },
        select: { id: true, name: true },
      }),
      this.prisma.carWashWasher.findMany({
        where: { tenantId, isActive: true },
        select: { id: true },
      }),
    ]);
    const activeWasherIds = new Set(washers.map((w) => w.id));
    const washTypeName = (washTypeId: number | null) =>
      washTypeId == null
        ? null
        : (washTypes.find((w) => w.id === washTypeId)?.name ?? null);
    const priceFor = (vehicleType: string, washTypeId: number | null) =>
      prices.find(
        (p) =>
          p.vehicleType.toLowerCase() === vehicleType.toLowerCase() &&
          String(p.washTypeId ?? '') === String(washTypeId ?? ''),
      );

    const updatedCarWashItems: Array<{
      id: number;
      vehicleType: string;
      washTypeId: number | null;
      washerId: number | null;
      amount: number;
      startsAt: Date;
      nameSnapshot: string;
    }> = [];
    let totalAmount = 0;

    for (const item of order.items) {
      if (item.itemKind !== 'CARWASH_ITEM') {
        totalAmount += item.unitPrice * item.quantity;
        continue;
      }
      let meta: any = {};
      try {
        meta = item.notes ? JSON.parse(item.notes) : {};
      } catch {
        meta = {};
      }
      const upd = updateById.get(item.id);
      const vehicleType =
        (upd?.vehicleType ?? meta.vehicleType ?? 'Car').trim() || 'Car';
      const washTypeId =
        upd?.washTypeId !== undefined
          ? upd.washTypeId
          : (meta.washTypeId ?? null);
      const washerId =
        upd?.washerId !== undefined ? upd.washerId : (meta.washerId ?? null);
      const startsAt = upd?.startsAt
        ? new Date(upd.startsAt)
        : meta.startsAt
          ? new Date(meta.startsAt)
          : order.startsAt
            ? new Date(order.startsAt)
            : new Date();

      if (Number.isNaN(startsAt.getTime())) {
        throw new BadRequestException('Invalid booking time');
      }
      if (washerId != null && !activeWasherIds.has(washerId)) {
        throw new BadRequestException('The selected washer is not available');
      }

      const priceAmount = priceFor(vehicleType, washTypeId)?.amount;
      const amount =
        typeof priceAmount === 'number'
          ? priceAmount
          : typeof meta.amount === 'number'
            ? meta.amount
            : Number(item.unitPrice) || 0;

      const nextNotes = JSON.stringify({
        vehicleType,
        plateNumber: meta.plateNumber ?? null,
        washTypeId,
        washerId,
        amount,
        startsAt: startsAt.toISOString(),
      });
      const nameSnapshot =
        [vehicleType, washTypeName(washTypeId)].filter(Boolean).join(' — ') ||
        'Car wash';

      totalAmount += amount * item.quantity;
      updatedCarWashItems.push({
        id: item.id,
        vehicleType,
        washTypeId,
        washerId,
        amount,
        startsAt,
        nameSnapshot,
      });

      await this.prisma.guestOrderItem.update({
        where: { id: item.id },
        data: {
          notes: nextNotes,
          unitPrice: amount,
          nameSnapshot,
        },
      });
    }

    const headerStartsAt = updatedCarWashItems.length
      ? new Date(
          Math.min(...updatedCarWashItems.map((i) => i.startsAt.getTime())),
        )
      : order.startsAt;

    await this.prisma.guestOrder.update({
      where: { id },
      data: {
        totalAmount,
        ...(headerStartsAt ? { startsAt: headerStartsAt } : {}),
        ...(dto && dto.note !== undefined ? { note: dto.note } : {}),
      },
    });

    // Keep the converted car-wash booking in sync. Conversion registers one
    // booking item per CARWASH_ITEM line in order, so match by index.
    if (order.bookingId) {
      const booking = await this.prisma.carWashBooking.findUnique({
        where: { id: order.bookingId },
        include: { items: { orderBy: { id: 'asc' } } },
      });
      if (booking) {
        await this.prisma.carWashBooking.update({
          where: { id: booking.id },
          data: {
            startsAt: headerStartsAt ?? booking.startsAt,
            vehicleType:
              updatedCarWashItems[0]?.vehicleType ?? booking.vehicleType,
            amount: totalAmount,
          },
        });
        for (let i = 0; i < booking.items.length; i++) {
          const line = updatedCarWashItems[i];
          if (!line) break;
          await this.prisma.carWashBookingItem.update({
            where: { id: booking.items[i].id },
            data: {
              vehicleType: line.vehicleType,
              washTypeId: line.washTypeId,
              washerId: line.washerId,
              startsAt: line.startsAt,
              amount: line.amount,
            },
          });
        }
      }
    }

    return this.get(id, user);
  }

  private async log(orderId: number, action: string, note?: string | null, actorId?: number) {
    await this.prisma.guestOrderActivity.create({
      data: { guestOrderId: orderId, action, note: note ?? null, actorId: actorId ?? null },
    });
  }

  /** Ensure the order is editing-able (not closed). */
  private assertOpen(status: string) {
    if (['COMPLETED', 'REJECTED', 'CANCELLED', 'DROPPED'].includes(status)) {
      throw new BadRequestException('This order is already closed');
    }
  }

  /**
   * Privileged review: accept the order into the business. For F&B/service the
   * review immediately creates the internal record (order/booking); retail is
   * then registered as a Sale via `convert` (or `assign`).
   */
  async review(id: number, actor: JwtPayload, note?: string) {
    const order = await this.get(id, actor);
    this.assertOpen(order.status);
    const updated = await this.prisma.guestOrder.update({
      where: { id },
      data: { status: 'REVIEWED' },
    });
    await this.log(id, 'REVIEWED', note, actor.sub);

    // F&B / service / room / car-wash bookings convert right away; retail/mfg
    // use `convert`.
    const kinds = new Set((order.items ?? []).map((i) => i.itemKind));
    if (
      kinds.has('MENU_ITEM') ||
      kinds.has('SERVICE_ITEM') ||
      kinds.has('ROOM_TYPE') ||
      kinds.has('CARWASH_ITEM')
    ) {
      await this.conversion.convert(order as any, actor).catch(() => {});
    }
    return this.get(id, actor);
  }

  /**
   * Route to one or more branches (retail/manufacturing). Creates a REQUESTED row
   * per branch; branches reply ACCEPTED/DECLINED.
   */
  async route(
    id: number,
    locationIds: number[],
    actor: JwtPayload,
    note?: string,
  ) {
    // Routing is a central-desk action (a branch forwards nothing to itself).
    if (actor.locationId) {
      throw new BadRequestException('Only the central desk can route to branches');
    }
    const order = await this.get(id, actor);
    this.assertOpen(order.status);
    if (locationIds.length === 0) throw new BadRequestException('Pick at least one branch');

    for (const locationId of locationIds) {
      const loc = await this.prisma.location.findFirst({
        where: { id: locationId, tenantId: order.tenantId },
        select: { id: true },
      });
      if (!loc) throw new BadRequestException(`Branch ${locationId} not found`);
      await this.prisma.guestOrderRoute.upsert({
        where: { guestOrderId_locationId: { guestOrderId: id, locationId } },
        update: {},
        create: { guestOrderId: id, locationId, status: 'REQUESTED' },
      });
    }
    const updated = await this.prisma.guestOrder.update({
      where: { id },
      data: { status: 'ROUTED' },
    });
    await this.log(id, 'ROUTED', note ?? `Sent to ${locationIds.length} branch(es)`, actor.sub);

    // Notify each asked branch so it appears in their inbox/bell immediately.
    for (const locationId of locationIds) {
      await this.notifications
        .notifyLocation(
          'New guest order',
          `Order #${id} was routed to your branch`,
          locationId,
          {
            link: '/dashboard/guest-orders',
            dedupeKey: `GUEST_ORDER_ROUTED:${id}:${locationId}`,
            type: 'GUEST_ORDER',
          },
        )
        .catch(() => {});
    }
    return updated;
  }

  /** A branch replies to a routed order (accept / decline). */
  async respond(
    orderId: number,
    locationId: number,
    actor: JwtPayload,
    reply: 'ACCEPTED' | 'DECLINED',
    note?: string,
  ) {
    // A branch may only answer for itself.
    if (actor.locationId && actor.locationId !== locationId) {
      throw new BadRequestException('You can only respond for your own branch');
    }
    const order = await this.get(orderId, actor);
    this.assertOpen(order.status);
    const route = await this.prisma.guestOrderRoute.findUnique({
      where: { guestOrderId_locationId: { guestOrderId: orderId, locationId } },
    });
    if (!route) throw new NotFoundException('This branch was not asked');
    if (route.status !== 'REQUESTED') {
      throw new BadRequestException('This branch already responded');
    }

    // Single acceptance: once any branch accepted, freeze the whole routed
    // conversation (accept AND decline) until the central desk assigns/drops.
    const acceptedElsewhere = await this.prisma.guestOrderRoute.findFirst({
      where: { guestOrderId: orderId, status: 'ACCEPTED' },
      select: { id: true },
    });
    if (acceptedElsewhere) {
      throw new BadRequestException('This order is already accepted by another branch');
    }

    await this.prisma.guestOrderRoute.update({
      where: { id: route.id },
      data: { status: reply, note: note ?? null, respondedById: actor.sub, respondedAt: new Date() },
    });
    await this.log(orderId, `BRANCH_${reply}`, note ?? `Branch #${locationId}`, actor.sub);
    if (reply === 'ACCEPTED') {
      // The central desk assigns (or the branch registers the sale itself); an
      // accept just records willingness.
      await this.log(orderId, 'BRANCH_ACCEPTED_PENDING_ASSIGN', null, actor.sub);
    }

    // Notify the central desk of the branch's reply.
    const branchName =
      (await this.prisma.location.findUnique({
        where: { id: locationId },
        select: { name: true },
      }))?.name ?? `#${locationId}`;
    await this.notifications
      .notifyOwner(
        'Guest order update',
        `Branch ${branchName} ${reply === 'ACCEPTED' ? 'accepted' : 'declined'} order #${orderId}`,
        {
          link: '/dashboard/guest-orders',
          dedupeKey: `GUEST_ORDER_BRANCH_REPLY:${orderId}:${locationId}`,
          type: 'GUEST_ORDER',
        },
      )
      .catch(() => {});

    return this.get(orderId, actor);
  }

  /**
   * Central desk assigns the order to a branch and registers the sale there.
   * `input` carries the sale/payment choices (same as `convert`).
   */
  async assign(
    id: number,
    locationId: number,
    actor: JwtPayload,
    input: {
      paymentMethodId?: number;
      saleType?: string;
      paidAmount?: number;
    } = {},
  ) {
    if (actor.locationId) {
      throw new BadRequestException('Only the central desk can assign to a branch');
    }
    const order = await this.get(id, actor);
    this.assertOpen(order.status);
    const route = order.routes.find((r) => r.locationId === locationId);
    if (!route) throw new NotFoundException('This branch was not asked');

    const saleType = input.saleType ?? 'FULLY_PAID';
    this.assertSaleInput(saleType, input.paymentMethodId, input.paidAmount);

    // Credit/partial sales: resolve the customer and check the credit gate up
    // front so the operator gets a clear error before any sale is attempted.
    let customerId: number | undefined;
    if (saleType === 'PARTIALLY_PAID' || saleType === 'CREDITED') {
      const customer = await this.conversion.ensureCreditCustomer(order as any);
      if (!customer) {
        throw new BadRequestException('Customer is required for credit/partial sales');
      }
      customerId = customer.id;
    }

    await this.prisma.guestOrder.update({ where: { id }, data: { status: 'ACCEPTED' } });
    await this.log(id, 'ASSIGNED', `Assigned to branch #${locationId}`, actor.sub);
    try {
      await this.conversion.convert(order as any, actor, {
        locationId,
        paymentMethodId: input.paymentMethodId,
        saleType,
        paidAmount: input.paidAmount,
        customerId,
      });
    } catch (err) {
      await this.log(id, 'CONVERT_FAILED', (err as Error).message, actor.sub);
      throw err;
    }

    await this.notifications
      .notifyLocation(
        'Guest order accepted',
        `Order #${id} was assigned to your branch`,
        locationId,
        {
          link: '/dashboard/guest-orders',
          dedupeKey: `GUEST_ORDER_ASSIGNED:${id}:${locationId}`,
          type: 'GUEST_ORDER',
        },
      )
      .catch(() => {});

    return this.get(id, actor);
  }

  /**
   * Register an accepted retail/manufacturing guest order as an internal Sale.
   * Branch users always register at their own branch; central must pick one.
   */
  async convert(
    id: number,
    actor: JwtPayload,
    input: {
      locationId?: number;
      paymentMethodId?: number;
      saleType?: string;
      paidAmount?: number;
    },
  ) {
    const order = await this.get(id, actor);
    this.assertOpen(order.status);
    const kinds = new Set((order.items ?? []).map((i) => i.itemKind));
    if (!kinds.has('PRODUCT')) {
      throw new BadRequestException('Only product orders can be added as a sale');
    }

    const branchId = actor.locationId ?? input.locationId;
    if (!branchId) {
      throw new BadRequestException('Select a branch where the sale will be registered');
    }
    const loc = await this.prisma.location.findFirst({
      where: { id: branchId, tenantId: order.tenantId },
      select: { id: true, name: true },
    });
    if (!loc) throw new BadRequestException('Branch not found');

    const saleType = input.saleType ?? 'FULLY_PAID';
    this.assertSaleInput(saleType, input.paymentMethodId, input.paidAmount);

    // Credit/partial sales: resolve the customer and check the credit gate up
    // front so the operator gets a clear error before any sale is attempted.
    let customerId: number | undefined;
    if (saleType === 'PARTIALLY_PAID' || saleType === 'CREDITED') {
      const customer = await this.conversion.ensureCreditCustomer(order as any);
      if (!customer) {
        throw new BadRequestException('Customer is required for credit/partial sales');
      }
      customerId = customer.id;
    }

    await this.conversion.convert(order as any, actor, {
      locationId: branchId,
      paymentMethodId: input.paymentMethodId,
      saleType,
      paidAmount: input.paidAmount,
      customerId,
    });
    await this.log(id, 'SALE_CREATED', `Sale registered at ${loc.name}`, actor.sub);

    await this.notifications
      .notifyLocation(
        'Guest order accepted',
        `Order #${id} was registered as a sale at your branch`,
        branchId,
        {
          link: '/dashboard/guest-orders',
          dedupeKey: `GUEST_ORDER_SALE:${id}:${branchId}`,
          type: 'GUEST_ORDER',
        },
      )
      .catch(() => {});

    return this.get(id, actor);
  }

  /** Shared sale/payment validation for `assign` and `convert`. */
  private assertSaleInput(
    saleType: string,
    paymentMethodId?: number,
    paidAmount?: number,
  ) {
    if (saleType !== 'CREDITED' && !paymentMethodId) {
      throw new BadRequestException('Payment method is required');
    }
    if (saleType === 'PARTIALLY_PAID' && (paidAmount ?? 0) <= 0) {
      throw new BadRequestException('Paid amount is required for partially paid');
    }
  }

  /** Reject (decline) a guest order before anything goes live. */
  async reject(id: number, actor: JwtPayload, note?: string) {
    await this.get(id, actor);
    const updated = await this.prisma.guestOrder.update({
      where: { id },
      data: { status: 'REJECTED' },
    });
    await this.log(id, 'REJECTED', note, actor.sub);
    return updated;
  }

  /** Bulk approve (review) many orders at once. */
  async bulkReview(ids: number[], actor: JwtPayload, note?: string) {
    const results: Array<{ id: number; ok: boolean }> = [];
    for (const id of ids) {
      try {
        await this.review(id, actor, note);
        results.push({ id, ok: true });
      } catch {
        results.push({ id, ok: false });
      }
    }
    return { results };
  }

  /** Bulk decline (reject) many orders at once. */
  async bulkReject(ids: number[], actor: JwtPayload, note?: string) {
    const results: Array<{ id: number; ok: boolean }> = [];
    for (const id of ids) {
      try {
        await this.reject(id, actor, note);
        results.push({ id, ok: true });
      } catch {
        results.push({ id, ok: false });
      }
    }
    return { results };
  }

  /**
   * Auto-approve handling: when an entry has autoApprove on, a submitted guest
   * order is approved immediately (skips the manual gate). Uses a system actor
   * (there is no privileged user in the request path).
   */
  async maybeAutoApprove(orderId: number, tenantId: number) {
    const order = await this.prisma.guestOrder.findUnique({
      where: { id: orderId },
      include: { entry: { select: { autoApprove: true } } },
    });
    if (order?.entry?.autoApprove && order.status === 'SUBMITTED') {
      const system: JwtPayload = {
        sub: 0,
        email: 'system@guest-orders',
        roleId: null,
        roleName: null,
        isSuperuser: true,
        isPlatformAdmin: false,
        isOwnerAccount: false,
        permissions: [],
        locationId: null,
        locationType: null,
        organizationId: tenantId,
        businessType: null,
        memberships: [],
        verificationStatus: 'APPROVED',
        verificationNote: null,
        verificationAttempts: 0,
      };
      await this.review(orderId, system, 'Auto-approved').catch(() => {});
    }
    return order;
  }

  /** Count of orders still needing a privileged decision (for the nav badge). */
  /** Count of orders still needing a privileged decision (for the nav badge). */
  async pendingCount(user?: JwtPayload): Promise<{ count: number }> {
    const branchId = await this.effectiveBranchId(user, this.tenantId());
    const count = await this.prisma.guestOrder.count({
      where: {
        tenantId: this.tenantId(),
        status: { in: ['SUBMITTED', 'ROUTED'] },
        ...(branchId
          ? {
              OR: [
                { entry: { locationId: branchId } },
                { routes: { some: { locationId: branchId } } },
              ],
            }
          : {}),
      },
    });
    return { count };
  }

  // --- QR / public entries (admin management) -------------------------------

  async listEntries() {
    return this.prisma.publicEntry.findMany({
      where: { tenantId: this.tenantId() },
      include: {
        items: true,
        table: { select: { name: true } },
        location: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createEntry(input: {
    kind: 'TABLE' | 'HOTEL' | 'SHOP' | 'CARWASH_BAY' | 'SERVICE';
    label: string;
    tableId?: number | null;
    locationId?: number | null;
    serviceType?: HospitalityServiceType | null;
  }) {
    const tenantId = this.tenantId();
    return this.prisma.publicEntry.create({
      data: {
        // Opaque capability token — never the row id.
        token: crypto.randomUUID().replace(/-/g, ''),
        tenantId,
        kind: input.kind,
        label: input.label,
        tableId: input.tableId ?? null,
        locationId: input.locationId ?? null,
        serviceType: input.serviceType ?? null,
      },
    });
  }

  /** The entry kinds allowed for the active business (for the QR page). */
  async allowedEntryKinds(): Promise<string[]> {
    const org = await this.prisma.organization.findUnique({
      where: { id: this.tenantId() },
      select: { businessType: true, enabledHospitalityServices: true },
    });
    return entryKindsFor(
      org?.businessType ?? 'RETAIL',
      org?.enabledHospitalityServices ?? [],
    );
  }

  /**
   * Auto-prepare (idempotently) the business's public QRs.
   *
   * Hospitality businesses get **one central entry per enabled service line**,
   * each labeled and scoped to the right catalog (F&B → TABLE/menu, Rooms →
   * HOTEL/room types, Spa/Gym/Pool/Events/Custom → SERVICE/service items).
   * Non-hospitality businesses keep a single SHOP / CARWASH_BAY / SERVICE
   * entry; retail/manufacturing also gets one entry per branch.
   */
  async ensurePublicEntries() {
    const tenantId = this.tenantId();
    const org = await this.prisma.organization.findUnique({
      where: { id: tenantId },
      select: { businessType: true, enabledHospitalityServices: true },
    });
    const businessType = org?.businessType ?? 'RETAIL';
    const enabled = org?.enabledHospitalityServices ?? [];

    const existing = await this.prisma.publicEntry.findMany({
      where: { tenantId },
      select: { locationId: true, serviceType: true },
    });
    const has = (locationId: number | null, serviceType: string | null) =>
      existing.some(
        (e) =>
          e.locationId === locationId &&
          (e.serviceType ?? null) === serviceType,
      );
    const make = (
      kind: 'TABLE' | 'HOTEL' | 'SHOP' | 'CARWASH_BAY' | 'SERVICE',
      label: string,
      locationId: number | null,
      serviceType: string | null,
    ) =>
      this.prisma.publicEntry.create({
        data: {
          token: crypto.randomUUID().replace(/-/g, ''),
          tenantId,
          kind,
          label,
          locationId,
          serviceType: (serviceType as HospitalityServiceType) ?? null,
        },
      });

    if (businessType === 'HOSPITALITY' && enabled.length > 0) {
      // One central QR per enabled service line (no branch duplication).
      for (const service of enabled) {
        if (has(null, service)) continue;
        await make(
          kindForHospitalityService(service),
          hospitalityServiceLabel(service),
          null,
          service,
        );
      }
    } else {
      const kind = publicKindFor(businessType);
      // Central entry (always).
      if (!has(null, null)) await make(kind, 'Order here', null, null);

      // One per branch — only retail/manufacturing route branch-specific QRs.
      if (kind === 'SHOP') {
        const branches = await this.prisma.location.findMany({
          where: { tenantId },
          select: { id: true, name: true },
        });
        for (const b of branches) {
          if (!has(b.id, null)) await make(kind, b.name, b.id, null);
        }
      }
    }

    return this.listEntries();
  }

  async updateEntry(
    id: number,
    input: {
      label?: string;
      state?: 'LIVE' | 'HELD' | 'DROPPED';
      liveFrom?: string | null;
      liveUntil?: string | null;
      active?: boolean;
      autoApprove?: boolean;
    },
  ) {
    await this.assertEntry(id);
    return this.prisma.publicEntry.update({
      where: { id },
      data: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.state !== undefined ? { state: input.state } : {}),
        ...(input.liveFrom !== undefined
          ? { liveFrom: input.liveFrom ? new Date(input.liveFrom) : null }
          : {}),
        ...(input.liveUntil !== undefined
          ? { liveUntil: input.liveUntil ? new Date(input.liveUntil) : null }
          : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.autoApprove !== undefined ? { autoApprove: input.autoApprove } : {}),
      },
    });
  }

  async deleteEntry(id: number) {
    await this.assertEntry(id);
    await this.prisma.publicEntry.delete({ where: { id } });
    return { ok: true };
  }

  /** Replace the published catalog for an entry. */
  async setEntryItems(
    id: number,
    items: Array<{ itemKind: string; itemId: number; priceOverride?: number | null; sortOrder?: number }>,
  ) {
    await this.assertEntry(id);
    await this.prisma.$transaction([
      this.prisma.publicEntryItem.deleteMany({ where: { entryId: id } }),
      this.prisma.publicEntryItem.createMany({
        data: items.map((i, idx) => ({
          entryId: id,
          itemKind: i.itemKind,
          itemId: i.itemId,
          priceOverride: i.priceOverride ?? null,
          sortOrder: i.sortOrder ?? idx,
        })),
        skipDuplicates: true,
      }),
    ]);
    return this.listEntries().then((rows) => rows.find((r) => r.id === id));
  }

  private async assertEntry(id: number) {
    const e = await this.prisma.publicEntry.findFirst({
      where: { id, tenantId: this.tenantId() },
      select: { id: true },
    });
    if (!e) throw new NotFoundException('Public entry not found');
  }

  // --- Blocklist ------------------------------------------------------------

  async listBlocklist() {
    return this.prisma.guestBlocklist.findMany({
      where: { tenantId: this.tenantId() },
      orderBy: { createdAt: 'desc' },
    });
  }

  async blockPhone(phone: string, reason?: string) {
    return this.prisma.guestBlocklist.upsert({
      where: { tenantId_phone: { tenantId: this.tenantId(), phone } },
      update: { reason: reason ?? null },
      create: { tenantId: this.tenantId(), phone, reason: reason ?? null },
    });
  }

  async unblockPhone(id: number) {
    await this.prisma.guestBlocklist.deleteMany({
      where: { id, tenantId: this.tenantId() },
    });
    return { ok: true };
  }
}
