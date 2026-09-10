import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { tenantContext } from '../common/tenant/tenant.context';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // Periodically re-scan every location for low stock so alerts are raised
  // even when no inventory change occurs in between (e.g. slow-moving items).
  @Cron(CronExpression.EVERY_HOUR)
  async scanLowStock() {
    const locations = await this.prisma.location.findMany({
      select: { id: true, tenantId: true },
    });

    for (const location of locations) {
      // Run each location's scan under its own tenant context so alerts are
      // linked to the correct business and Owner role.
      await tenantContext.run(location.tenantId ?? null, () =>
        this.notifications.checkAllLowStockForLocation(location.id),
      );
    }

    this.logger.log(
      `Low-stock scan completed for ${locations.length} location(s)`,
    );
  }
}
