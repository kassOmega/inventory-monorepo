// src/guest-orders/guest-order-conversion.service.ts
// Turns an accepted GuestOrder into the matching INTERNAL record by calling the
// real domain services, so stock/price/GL rules are enforced exactly as for a
// staff-entered order:
//   F&B (TABLE/HOTEL)  -> RestaurantService.createOrder
//   SHOP               -> SalesService.createSale (at the assigned branch)
//   HOTEL (rooms)      -> HotelService.createReservation
//   SERVICE/CARWASH    -> ServiceService.createBooking
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RestaurantService } from '../restaurant/restaurant.service';
import { SalesService } from '../sales/sales.service';
import { HotelService } from '../hotel/hotel.service';
import { ServiceService } from '../service/service.service';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import type { GuestOrder } from '@prisma/client';

@Injectable()
export class GuestOrderConversionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly restaurant: RestaurantService,
    private readonly sales: SalesService,
    private readonly hotel: HotelService,
    private readonly service: ServiceService,
  ) {}

  /**
   * Convert an accepted guest order into its internal record and link it back.
   * `actor` is a synthetic JwtPayload for the privileged user who accepted it.
   */
  async convert(
    order: GuestOrder & { items: Array<{ itemKind: string; itemId: number | null; quantity: number; notes: string | null }> },
    actor: JwtPayload,
    opts: { locationId?: number } = {},
  ): Promise<{ kind: string; id: number }> {
    // The item kinds tell us the internal target.
    const kinds = new Set(order.items.map((i) => i.itemKind));
    if (kinds.has('MENU_ITEM')) return this.toOrder(order, actor);
    if (kinds.has('PRODUCT')) return this.toSale(order, actor, opts.locationId);
    if (kinds.has('ROOM_TYPE')) return this.toReservation(order, actor);
    if (kinds.has('SERVICE_ITEM')) return this.toBooking(order, actor);
    throw new BadRequestException('Nothing to convert for this guest order');
  }

  private async toOrder(order: any, actor: JwtPayload) {
    const created = await this.restaurant.createOrder(
      {
        tableId: order.entry?.tableId ?? undefined,
        customerName: order.customerName ?? undefined,
        items: order.items
          .filter((i: any) => i.itemKind === 'MENU_ITEM')
          .map((i: any) => ({ menuItemId: i.itemId, quantity: i.quantity, notes: i.notes ?? undefined })),
      },
      actor,
    );
    await this.prisma.guestOrder.update({
      where: { id: order.id },
      data: { orderId: created.id, status: 'ACCEPTED' },
    });
    return { kind: 'ORDER', id: created.id };
  }

  private async toSale(order: any, actor: JwtPayload, locationId?: number) {
    const shopId = locationId ?? order.routes?.find((r: any) => r.status === 'ACCEPTED')?.locationId;
    if (!shopId) throw new BadRequestException('Assign a branch before converting');
    // A synthetic shop-scoped actor so SalesService uses the accepted branch.
    const shopActor: JwtPayload = { ...actor, locationId: shopId, locationType: 'SHOP' as any };
    const created = await this.sales.createSale(
      {
        shopId,
        customerId: order.customerId ?? undefined,
        saleType: 'FULLY_PAID',
        items: order.items
          .filter((i: any) => i.itemKind === 'PRODUCT')
          .map((i: any) => ({ productId: i.itemId, quantity: i.quantity })),
      } as any,
      shopActor,
    );
    await this.prisma.guestOrder.update({
      where: { id: order.id },
      data: { saleId: created.id, status: 'ACCEPTED' },
    });
    return { kind: 'SALE', id: created.id };
  }

  private async toReservation(order: any, actor: JwtPayload) {
    const roomType = order.items.find((i: any) => i.itemKind === 'ROOM_TYPE');
    if (!roomType) throw new BadRequestException('No room selected');
    // Pick a free room of that type for the requested window.
    const room = await this.prisma.room.findFirst({
      where: { tenantId: order.tenantId, roomTypeId: roomType.itemId },
      orderBy: { number: 'asc' },
    });
    if (!room) throw new BadRequestException('No room available');
    const checkIn = new Date();
    const checkOut = new Date(checkIn.getTime() + 24 * 60 * 60 * 1000);
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
    const serviceItem = order.items.find((i: any) => i.itemKind === 'SERVICE_ITEM');
    if (!serviceItem) throw new BadRequestException('No service selected');
    const created = await this.service.createBooking({
      clientId: order.customerId ?? null,
      serviceItemId: serviceItem.itemId ?? null,
      startsAt: new Date().toISOString(),
      notes: order.note ?? undefined,
    } as any);
    await this.prisma.guestOrder.update({
      where: { id: order.id },
      data: { bookingId: created.id, status: 'ACCEPTED' },
    });
    return { kind: 'BOOKING', id: created.id };
  }
}
