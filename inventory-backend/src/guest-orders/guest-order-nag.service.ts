// src/guest-orders/guest-order-nag.service.ts
// Nags privileged users while a guest order is still unhandled (SUBMITTED or
// ROUTED). Runs every few minutes outside any tenant context, so it scopes each
// notification to the order's own tenant explicitly.
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { tenantContext } from '../common/tenant/tenant.context';

/** Statuses that still need a privileged decision. */
const OPEN: Array<'SUBMITTED' | 'ROUTED'> = ['SUBMITTED', 'ROUTED'];

@Injectable()
export class GuestOrderNagService {
  private readonly logger = new Logger(GuestOrderNagService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('*/5 * * * *')
  async nag() {
    const open = await this.prisma.guestOrder.findMany({
      where: { status: { in: OPEN } },
      select: {
        id: true,
        tenantId: true,
        status: true,
        createdAt: true,
        entry: { select: { label: true } },
      },
      take: 500,
    });
    for (const order of open) {
      try {
        // Explicit tenant scope so notifyOwner targets the order's business.
        await tenantContext.run(order.tenantId, () =>
          this.notifications.notifyOwner(
            'Guest order awaiting action',
            `${order.entry?.label ?? 'Guest order'} #${order.id} is still ${order.status.toLowerCase()} — review it.`,
            {
              type: 'GUEST_ORDER',
              link: '/dashboard/guest-orders',
              // Per-order + per-5-minute bucket would spam; key per order only so
              // read-once suppresses it, and a fresh nag comes from the reminder
              // cycle only when the status/period changes.
              dedupeKey: `GUEST_ORDER_NAG:${order.id}`,
            },
          ),
        );
      } catch (err) {
        this.logger.warn(`Guest-order nag failed for #${order.id}: ${(err as Error).message}`);
      }
    }
  }
}
