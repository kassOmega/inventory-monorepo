import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { inventoryFind } from '../common/inventory.util';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { getCurrentTenantId } from '../common/tenant/tenant.context';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';

@Injectable()
export class NotificationsService {
  private readonly events = new Subject<{ data: string }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  /** SSE stream of notification refresh events. */
  getStream(): Observable<{ data: string }> {
    return this.events.asObservable();
  }

  private async getOwnerRoleId(): Promise<number | null> {
    const tenantId = getCurrentTenantId();
    const role = await this.prisma.role.findFirst({
      where: { isSystem: true, ...(tenantId != null ? { organizationId: tenantId } : {}) },
    });
    return role?.id ?? null;
  }

  async checkAndNotifyLowStock(
    productId: number,
    locationId: number,
  ): Promise<void> {
    const inventory = await inventoryFind(
      this.prisma,
      { productId, locationId },
      { product: true, location: true },
    );

    if (!inventory) return;

    const qty = inventory.quantity;
    // Only alert when a per-item low-stock threshold is set (> 0); items with
    // no threshold configured are never flagged.
    const threshold = inventory.product.reorderLevel;

    if (threshold > 0 && qty < threshold) {
      const productName = `${inventory.product.brand} ${inventory.product.baseName}`;
      // Derive the business from the location so this works even when called
      // from the scheduled low-stock scan (no request tenant context).
      const tenantId = inventory.location.tenantId ?? getCurrentTenantId();

      const ownerRoleId = await this.getOwnerRoleId();
      if (ownerRoleId) {
        const existingOwner = await this.prisma.notification.findFirst({
          where: {
            type: 'LOW_STOCK',
            tenantId,
            productId,
            locationId,
            targetRoleId: ownerRoleId,
            isRead: false,
          },
        });

        if (!existingOwner) {
          await this.prisma.notification.create({
            data: {
              type: 'LOW_STOCK',
              title: 'Low Stock Alert',
              message: `${productName} is running low (${qty} remaining) at ${inventory.location.name}.`,
              tenantId,
              productId,
              locationId,
              targetRoleId: ownerRoleId,
            },
          });
        }
      }

      const existingLocation = await this.prisma.notification.findFirst({
        where: {
          type: 'LOW_STOCK',
          tenantId,
          productId,
          locationId,
          targetRoleId: null,
          targetLocationId: locationId,
          isRead: false,
        },
      });

      if (!existingLocation) {
        await this.prisma.notification.create({
          data: {
            type: 'LOW_STOCK',
            title: 'Low Stock Alert',
            message: `${productName} is running low (${qty} remaining) at ${inventory.location.name}.`,
            tenantId,
            productId,
            locationId,
            targetRoleId: null,
            targetLocationId: locationId,
          },
        });
      }

      this.push
        .sendToLocation({
          title: 'Low Stock Alert',
          body: `${productName} is running low (${qty} remaining)`,
        }, locationId)
        .catch(() => {});
    }
  }

  async notifyOwner(
    title: string,
    message: string,
    opts: { productId?: number; locationId?: number } = {},
  ): Promise<void> {
    const tenantId = getCurrentTenantId();
    const ownerRole = await this.prisma.role.findFirst({
      where: { isSystem: true, ...(tenantId != null ? { organizationId: tenantId } : {}) },
      select: { id: true },
    });
    const ownerUsers = await this.prisma.membership.findMany({
      where: { roleId: ownerRole?.id, ...(tenantId != null ? { organizationId: tenantId } : {}) },
      select: { userId: true },
    });
    const ownerUserIds = ownerUsers.map((m) => m.userId);

    // Link each notification to a specific user (targetUserId) and to the
    // business (tenantId) so it can be attributed and filtered by both.
    const targets: Array<{ targetUserId: number | null }> =
      ownerUserIds.length > 0
        ? ownerUserIds.map((userId) => ({ targetUserId: userId }))
        : [{ targetUserId: null }];

    for (const t of targets) {
      await this.prisma.notification.create({
        data: {
          tenantId,
          type: 'REQUEST_STATUS',
          title,
          message,
          targetRoleId: ownerRole?.id ?? null,
          targetLocationId: null,
          targetUserId: t.targetUserId,
          productId: opts.productId ?? null,
          locationId: opts.locationId ?? null,
        },
      });
    }

    this.events.next({ data: 'refresh' });

    for (const userId of ownerUserIds) {
      this.push
        .sendToUser(userId, { title, body: message })
        .catch(() => {});
    }
  }

  async notifyLocation(
    title: string,
    message: string,
    locationId: number,
    opts: { productId?: number } = {},
  ): Promise<void> {
    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
      select: { tenantId: true },
    });

    await this.prisma.notification.create({
      data: {
        tenantId: location?.tenantId ?? getCurrentTenantId(),
        type: 'REQUEST_STATUS',
        title,
        message,
        targetRoleId: null,
        targetLocationId: locationId,
        productId: opts.productId ?? null,
        locationId: locationId,
      },
    });

    this.events.next({ data: 'refresh' });

    this.push
      .sendToLocation({ title, body: message }, locationId)
      .catch(() => {});
  }

  /** Notify a specific user (e.g. the waiter who created an order). */
  async notifyUser(
    userId: number,
    title: string,
    message: string,
    type = 'ORDER_STATUS',
    tenantId?: number | null,
  ): Promise<void> {
    const resolvedTenantId = tenantId ?? getCurrentTenantId();
    await this.prisma.notification.create({
      data: {
        type,
        title,
        message,
        targetUserId: userId,
        ...(resolvedTenantId != null ? { tenantId: resolvedTenantId } : {}),
      },
    });
    this.events.next({ data: 'refresh' });

    this.push
      .sendToUser(userId, { title, body: message })
      .catch(() => {});
  }

  /** Notify every platform admin (used for account-verification events). */
  async notifyAdmins(title: string, message: string, type = 'ACCOUNT_VERIFICATION'): Promise<void> {
    const admins = await this.prisma.user.findMany({
      where: { isPlatformAdmin: true },
      select: { id: true },
    });
    if (admins.length === 0) return;

    for (const admin of admins) {
      await this.prisma.notification.create({
        data: { type, title, message, targetUserId: admin.id },
      });
      this.push
        .sendToUser(admin.id, { title, body: message })
        .catch(() => {});
    }
    this.events.next({ data: 'refresh' });
  }

  /** Notify everyone holding a given role name in the active organization. */
  async notifyRole(roleName: string, title: string, message: string, type = 'ORDER_STATUS'): Promise<void> {
    const tenantId = getCurrentTenantId();
    const role = await this.prisma.role.findFirst({ where: { name: roleName, organizationId: tenantId } });
    if (!role) return;

    await this.prisma.notification.create({
      data: { tenantId: role.organizationId, type, title, message, targetRoleId: role.id },
    });
    this.events.next({ data: 'refresh' });

    this.push
      .sendToRoleId({ title, body: message }, role.id)
      .catch(() => {});
  }

  async checkAllLowStockForLocation(locationId: number): Promise<void> {
    const inventories = await this.prisma.inventory.findMany({
      where: { locationId },
    });

    for (const inv of inventories) {
      await this.checkAndNotifyLowStock(inv.productId, locationId);
    }
  }

  async findAll(user: JwtPayload) {
    const where = this.buildVisibleWhere(user);

    return this.prisma.notification.findMany({
      where,
      include: {
        product: true,
        location: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getUnreadCount(user: JwtPayload): Promise<{ count: number }> {
    const where = this.buildVisibleWhere(user);
    where.isRead = false;

    const count = await this.prisma.notification.count({ where });
    return { count };
  }

  async markAsRead(id: number, user: JwtPayload): Promise<void> {
    const tenantId = getCurrentTenantId();
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }
    if (!user.isSuperuser && !this.isVisibleTo(notification, user)) {
      throw new ForbiddenException('You cannot read this notification');
    }
    // Tenant-scoped update (multi-tenant): only update notifications that
    // belong to the active organization.
    await this.prisma.notification.updateMany({
      where: { id, ...(tenantId != null ? { tenantId } : {}) },
      data: { isRead: true },
    });
  }

  async markAllAsRead(user: JwtPayload): Promise<void> {
    const where = this.buildVisibleWhere(user);
    where.isRead = false;

    await this.prisma.notification.updateMany({
      where,
      data: { isRead: true },
    });
  }

  /**
   * Notifications are company- AND location-specific. Every user — including
   * business owners / superusers — only sees:
   *  - notifications addressed directly to them (targetUserId), or
   *  - notifications broadcast within their active company (tenantId) that
   *    their role/location qualifies for.
   * Owners are no longer shown every location-scoped notification (e.g. "Stock
   * Ready for Receipt" at a store they aren't assigned to — that goes to the
   * location's shopkeepers); they still receive user/role-targeted notices
   * (approvals, confirmations, shortages) via notifyOwner.
   */
  private buildVisibleWhere(user: JwtPayload): any {
    const tenantId = getCurrentTenantId();

    // Company scoping: the active business's notifications, plus anything
    // addressed directly to this user (e.g. while no business is active yet).
    const companyScope: any[] = [{ targetUserId: user.sub }];
    if (tenantId != null) companyScope.push({ tenantId });

    return {
      AND: [
        { OR: companyScope },
        {
          OR: [
            { targetUserId: user.sub },
            {
              targetUserId: null,
              targetRoleId: user.roleId,
              targetLocationId: user.locationId ?? null,
            },
            {
              targetUserId: null,
              targetRoleId: user.roleId,
              targetLocationId: null,
            },
            {
              targetUserId: null,
              targetRoleId: null,
              targetLocationId: user.locationId ?? null,
            },
            {
              targetUserId: null,
              targetRoleId: null,
              targetLocationId: null,
            },
          ],
        },
      ],
    };
  }

  private isVisibleTo(
    n: {
      targetUserId: number | null;
      targetRoleId: number | null;
      targetLocationId: number | null;
    },
    user: JwtPayload,
  ): boolean {
    // A notification addressed to a specific user is only visible to that user.
    if (n.targetUserId != null) return n.targetUserId === user.sub;

    const matchesRole =
      n.targetRoleId === null || n.targetRoleId === user.roleId;
    const matchesLocation =
      n.targetLocationId === null || n.targetLocationId === user.locationId;
    return matchesRole && matchesLocation;
  }
}
