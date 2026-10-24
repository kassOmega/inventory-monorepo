// src/guest-orders/guest-order-conversion.service.ts
// Turns an accepted GuestOrder into the matching INTERNAL record by calling the
// real domain services, so stock/price/GL rules are enforced exactly as for a
// staff-entered order:
//   F&B (TABLE/HOTEL)  -> RestaurantService.createOrder
//   SHOP               -> SalesService.createSale (at the assigned branch)
//   HOTEL (rooms)      -> HotelService.createReservation
//   SERVICE            -> ServiceService.createBooking
//   CARWASH            -> CarWashService.createBooking
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RestaurantService } from '../restaurant/restaurant.service';
import { SalesService } from '../sales/sales.service';
import { HotelService } from '../hotel/hotel.service';
import { ServiceService } from '../service/service.service';
import { CarWashService } from '../carwash/carwash.service';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { tr } from '../i18n/i18n.service';
import type { GuestOrder } from '@prisma/client';

@Injectable()
export class GuestOrderConversionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly restaurant: RestaurantService,
    private readonly sales: SalesService,
    private readonly hotel: HotelService,
    private readonly service: ServiceService,
    private readonly carwash: CarWashService,
  ) {}

  /**
   * Convert an accepted guest order into its internal record and link it back.
   * `actor` is a synthetic JwtPayload for the privileged user who accepted it.
   */
  async convert(
    order: GuestOrder & {
      items: Array<{
        itemKind: string;
        itemId: number | null;
        variantId?: number | null;
        quantity: number;
        unitId?: number | null;
        notes: string | null;
      }>;
    },
    actor: JwtPayload,
    opts: {
      locationId?: number;
      paymentMethodId?: number;
      saleType?: string;
      paidAmount?: number;
      customerId?: number;
    } = {},
  ): Promise<{ kind: string; id: number }> {
    // The item kinds tell us the internal target.
    const kinds = new Set(order.items.map((i) => i.itemKind));
    if (kinds.has('MENU_ITEM')) return this.toOrder(order, actor);
    if (kinds.has('PRODUCT')) return this.toSale(order, actor, opts);
    if (kinds.has('ROOM_TYPE')) return this.toReservation(order, actor);
    if (kinds.has('SERVICE_ITEM')) return this.toBooking(order, actor);
    if (kinds.has('CARWASH_ITEM')) return this.toCarWashBooking(order, actor);
    throw new BadRequestException('Nothing to convert for this guest order');
  }

  private async toOrder(order: any, actor: JwtPayload) {
    const created = await this.restaurant.createOrder(
      {
        tableId: order.entry?.tableId ?? undefined,
        customerName: order.customerName ?? undefined,
        items: order.items
          .filter((i: any) => i.itemKind === 'MENU_ITEM')
          .map((i: any) => ({
            menuItemId: i.itemId,
            quantity: i.quantity,
            notes: i.notes ?? undefined,
          })),
      },
      actor,
    );
    await this.prisma.guestOrder.update({
      where: { id: order.id },
      data: { orderId: created.id, status: 'ACCEPTED' },
    });
    return { kind: 'ORDER', id: created.id };
  }

  private async toSale(
    order: any,
    actor: JwtPayload,
    opts: {
      locationId?: number;
      paymentMethodId?: number;
      saleType?: string;
      paidAmount?: number;
      customerId?: number;
    } = {},
  ) {
    const shopId =
      opts.locationId ??
      order.routes?.find((r: any) => r.status === 'ACCEPTED')?.locationId;
    if (!shopId)
      throw new BadRequestException('Assign a branch before converting');
    const saleType = (opts.saleType ?? 'FULLY_PAID') as any;

    // Credit/partial sales need a customer who may take credit. The caller may
    // pass an already-validated id; otherwise resolve/create it here.
    let customerId: number | null = opts.customerId ?? order.customerId ?? null;
    if (saleType === 'PARTIALLY_PAID' || saleType === 'CREDITED') {
      if (!customerId) {
        const customer = await this.ensureCreditCustomer(order);
        if (!customer) {
          throw new BadRequestException(
            'Customer is required for credit/partial sales',
          );
        }
        customerId = customer.id;
      } else {
        // Re-check the credit gate even when the id came from the order.
        const customer = await this.prisma.customer.findFirst({
          where: { id: customerId },
          select: { id: true, name: true, canTakeCredit: true },
        });
        if (!customer)
          throw new BadRequestException(tr('errors.customerNotFound'));
        if (!customer.canTakeCredit) {
          throw new BadRequestException(
            tr('errors.customerCreditBlocked', { name: customer.name }),
          );
        }
      }
    }

    // A synthetic shop-scoped actor so SalesService uses the chosen branch.
    const shopActor: JwtPayload = {
      ...actor,
      locationId: shopId,
      locationType: 'SHOP' as any,
    };
    const created = await this.sales.createSale(
      {
        shopId,
        customerId: customerId ?? undefined,
        saleType,
        paymentMethodId: opts.paymentMethodId,
        paidAmount: opts.paidAmount,
        items: order.items
          .filter((i: any) => i.itemKind === 'PRODUCT')
          .map((i: any) => ({
            productId: i.itemId,
            variantId: i.variantId ?? undefined,
            quantity: i.quantity,
            unitId: i.unitId ?? undefined,
          })),
      } as any,
      shopActor,
    );
    await this.prisma.guestOrder.update({
      where: { id: order.id },
      data: {
        saleId: created.id,
        status: 'ACCEPTED',
        ...(customerId && !order.customerId ? { customerId } : {}),
      },
    });
    return { kind: 'SALE', id: created.id };
  }

  /**
   * Resolve (or create) the customer for a credit/partial guest sale and verify
   * they are allowed to take credit. Returns null only when the order has no
   * customer info at all (caller then rejects credit/partial).
   */
  async ensureCreditCustomer(
    order: any,
  ): Promise<{
    id: number;
    name: string;
    phone: string | null;
    canTakeCredit: boolean;
  } | null> {
    const name = (order.customerName ?? '').trim();
    const phone = (order.customerPhone ?? '').trim();

    let customer: {
      id: number;
      name: string;
      phone: string | null;
      canTakeCredit: boolean;
    } | null = null;
    if (order.customerId) {
      customer = await this.prisma.customer.findFirst({
        where: { id: order.customerId },
        select: { id: true, name: true, phone: true, canTakeCredit: true },
      });
    } else if (phone) {
      customer = await this.prisma.customer.findFirst({
        where: { organizationId: order.tenantId, phone },
        select: { id: true, name: true, phone: true, canTakeCredit: true },
      });
    }

    if (!customer) {
      if (!name && !phone) return null;
      const created = await this.prisma.customer.create({
        data: {
          organizationId: order.tenantId,
          name: name || 'Walk-in guest',
          phone: phone || null,
        },
      });
      customer = {
        id: created.id,
        name: created.name,
        phone: created.phone,
        canTakeCredit: created.canTakeCredit,
      };
    }

    if (!customer.canTakeCredit) {
      throw new BadRequestException(
        tr('errors.customerCreditBlocked', { name: customer.name }),
      );
    }
    return customer;
  }

  private async toReservation(order: any, actor: JwtPayload) {
    const roomType = order.items.find((i: any) => i.itemKind === 'ROOM_TYPE');
    if (!roomType) throw new BadRequestException('No room selected');

    // Guest-chosen stay window; legacy rows fall back to now/+1 day.
    const checkIn = order.checkIn ? new Date(order.checkIn) : new Date();
    const checkOut = order.checkOut
      ? new Date(order.checkOut)
      : new Date(checkIn.getTime() + 24 * 60 * 60 * 1000);
    if (
      Number.isNaN(checkIn.getTime()) ||
      Number.isNaN(checkOut.getTime()) ||
      !(checkOut > checkIn)
    ) {
      throw new BadRequestException('Invalid stay dates');
    }

    // Pick a free room of that type for the requested window.
    const busy = await this.prisma.hotelReservation.findMany({
      where: {
        tenantId: order.tenantId,
        status: { in: ['CONFIRMED', 'CHECKED_IN'] },
        checkIn: { lt: checkOut },
        checkOut: { gt: checkIn },
      },
      select: { roomId: true },
    });
    const busyIds = new Set(busy.map((b) => b.roomId));
    const room = await this.prisma.room.findFirst({
      where: {
        tenantId: order.tenantId,
        roomTypeId: roomType.itemId,
        id: { notIn: [...busyIds] },
      },
      orderBy: { number: 'asc' },
    });
    if (!room) throw new BadRequestException('No room available');

    const created = await this.hotel.createReservation(
      {
        roomId: room.id,
        guestName: order.customerName ?? 'Guest',
        phone: order.customerPhone ?? undefined,
        checkIn: checkIn.toISOString(),
        checkOut: checkOut.toISOString(),
        notes: order.note ?? undefined,
      },
      actor.sub,
    );
    await this.prisma.guestOrder.update({
      where: { id: order.id },
      data: { reservationId: created.id, status: 'ACCEPTED' },
    });
    return { kind: 'RESERVATION', id: created.id };
  }

  private async toBooking(order: any, actor: JwtPayload) {
    const serviceItem = order.items.find(
      (i: any) => i.itemKind === 'SERVICE_ITEM',
    );
    if (!serviceItem) throw new BadRequestException('No service selected');
    // Guest-chosen start time; legacy rows fall back to now.
    const startsAt = order.startsAt ? new Date(order.startsAt) : new Date();
    if (Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException('Invalid booking time');
    }
    const created = await this.service.createBooking({
      clientId: order.customerId ?? null,
      serviceItemId: serviceItem.itemId ?? null,
      startsAt: startsAt.toISOString(),
      notes: order.note ?? undefined,
    } as any);
    await this.prisma.guestOrder.update({
      where: { id: order.id },
      data: { bookingId: created.id, status: 'ACCEPTED' },
    });
    return { kind: 'BOOKING', id: created.id };
  }

  /**
   * Reconstruct a public car-wash booking from the guest order's line payload
   * (stored as JSON in each item's `notes`) and register it in the wash queue.
   */
  private async toCarWashBooking(order: any, actor: JwtPayload) {
    const lines = (order.items ?? [])
      .filter((i: any) => i.itemKind === 'CARWASH_ITEM')
      .map((i: any) => {
        let meta: any = {};
        try {
          meta = i.notes ? JSON.parse(i.notes) : {};
        } catch {
          meta = {};
        }
        return {
          vehicleType: meta.vehicleType ?? 'Car',
          plateNumber: meta.plateNumber ?? null,
          washTypeId: meta.washTypeId ?? i.itemId ?? null,
          washerId: meta.washerId ?? null,
          amount: Number(i.unitPrice) || Number(meta.amount) || 0,
          startsAt: meta.startsAt ?? order.startsAt,
        };
      });
    if (lines.length === 0) {
      throw new BadRequestException(
        'Nothing to convert for this guest booking',
      );
    }

    // Resolve or create the customer so the booking shows their name + phone.
    let customerId: number | null = order.customerId ?? null;
    const phone = (order.customerPhone ?? '').trim() || null;
    if (!customerId && phone) {
      const existing = await this.prisma.customer.findFirst({
        where: { organizationId: order.tenantId, phone },
        select: { id: true },
      });
      if (existing) {
        customerId = existing.id;
      } else {
        const created = await this.prisma.customer.create({
          data: {
            organizationId: order.tenantId,
            name: (order.customerName ?? '').trim() || 'Guest',
            phone,
          },
          select: { id: true },
        });
        customerId = created.id;
      }
    }

    // Resolve (or create) each vehicle by plate and build the booking items.
    const items: Array<{
      vehicleId: number | null;
      vehicleType: string;
      washTypeId: number | null;
      washerId: number | null;
      amount: number;
      startsAt: string;
    }> = [];
    for (const line of lines) {
      let vehicleId: number | null = null;
      if (line.plateNumber) {
        let vehicle = await this.prisma.carWashVehicle.findFirst({
          where: { tenantId: order.tenantId, plateNumber: line.plateNumber },
          select: { id: true },
        });
        if (!vehicle) {
          vehicle = await this.prisma.carWashVehicle.create({
            data: {
              tenantId: order.tenantId,
              plateNumber: line.plateNumber,
              vehicleType: line.vehicleType,
              customerId,
            },
            select: { id: true },
          });
        }
        vehicleId = vehicle.id;
      }
      items.push({
        vehicleId,
        vehicleType: line.vehicleType,
        washTypeId: line.washTypeId,
        washerId: line.washerId,
        amount: line.amount,
        startsAt: line.startsAt,
      });
    }

    const headerStartsAt = items
      .map((i) => new Date(i.startsAt).getTime())
      .reduce((a, b) => Math.min(a, b));

    const created = await this.carwash.createBooking(
      {
        customerId,
        customerName: order.customerName ?? undefined,
        customerPhone: order.customerPhone ?? undefined,
        washerId: items[0]?.washerId ?? null,
        isTimeSlotBooking: true,
        startsAt: new Date(headerStartsAt).toISOString(),
        notes: order.note ?? undefined,
        items,
      } as any,
      actor.sub,
    );

    await this.prisma.guestOrder.update({
      where: { id: order.id },
      data: {
        bookingId: created.id,
        status: 'ACCEPTED',
        ...(customerId && !order.customerId ? { customerId } : {}),
      },
    });
    return { kind: 'CARWASH_BOOKING', id: created.id };
  }
}
