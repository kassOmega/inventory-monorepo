import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Observable, Subject } from 'rxjs';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { getCurrentTenantId } from '../common/tenant/tenant.context';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';

/** Deep link used for low-stock alerts (kept in sync with the bell/toast map). */
const LOW_STOCK_LINK = '/dashboard/reports?tab=low-stock';

/** An inventory row plus the product/variant/location the alert text needs. */
type LowStockRow = Prisma.InventoryGetPayload<{
  include: { product: true; variant: true; location: true };
}>;

@Injectable()
export class NotificationsService {
  private readonly events = new Subject<{ data: string }>();
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  /** SSE stream of notification refresh events. */
  getStream(): Observable<{ data: string }> {
    return this.events.asObservable();
  }

  /**
   * Owner (system) role of a specific business. `tenantId` is always supplied by
   * the caller (taken from the location's tenant) so alerts raised from the
   * scheduled scan — which has no request tenant context — still resolve the
   * right business instead of the first system role in the database.
   */
  private async getOwnerRoleId(tenantId: number | null): Promise<number | null> {
    const role = await this.prisma.role.findFirst({
      where: {
        isSystem: true,
        ...(tenantId != null ? { organizationId: tenantId } : {}),
      },
      select: { id: true },
    });
    return role?.id ?? null;
  }

  /** The exact low-stock number for one stock row (variant's own, else product's). */
  private lowStockThreshold(
    product: { reorderLevel: number },
    variant: { reorderLevel: number } | null,
  ): number {
    const variantLevel = variant?.reorderLevel ?? 0;
    return variantLevel > 0 ? variantLevel : (product.reorderLevel ?? 0);
  }

  /** "Brand Base" — or "Brand Base (42 / Black)" so the alert names the variant. */
  private lowStockItemLabel(
    product: { brand: string; baseName: string },
    variant: { sku?: string | null; attributes?: unknown } | null,
  ): string {
    const base = `${product.brand ?? ''} ${product.baseName ?? ''}`.trim();
    if (!variant) return base;
    const label = this.variantLabel(variant);
    return label ? `${base} (${label})` : base;
  }

  /** Attribute label for a variant: slot1..slot4, else legacy keys, else its SKU. */
  private variantLabel(variant: {
    sku?: string | null;
    attributes?: unknown;
  }): string {
    const attrs = (variant.attributes ?? {}) as Record<string, unknown>;
    const pick = (key: string): string | null => {
      const value = attrs[key];
      if (value === undefined || value === null) return null;
      const text = String(value).trim();
      return text === '' ? null : text;
    };
    const slots = ['slot1', 'slot2', 'slot3', 'slot4']
      .map(pick)
      .filter((v): v is string => v !== null);
    const legacy = [
      'size',
      'color',
      'power',
      'capacity',
      'material',
      'voltage',
      'weight',
    ]
      .map(pick)
      .filter((v): v is string => v !== null);
    const label = slots.length ? slots : legacy;
    return label.length ? label.join(' / ') : (variant.sku ?? '').trim();
  }

  /**
   * Low-stock check for one product at one location.
   *
   * Alerts are per ITEM, never per product: a plain product alerts on its own
   * stock row, while a variant product alerts once per variant row (each with its
   * own number) and never produces a product-level alert.
   *
   * The number compared against is the item's own — the variant's when it has one
   * (`reorderLevel > 0`), otherwise the product's. `0` still means "never alert".
   * Every alert is stamped with that number (`threshold`) and the `variantId`, so
   * it can be coalesced and auto-resolved by it instead of duplicated.
   */
  async checkAndNotifyLowStock(
    productId: number,
    locationId: number,
  ): Promise<void> {
    // Every stock row of this product at this location: one row for a plain
    // product, one row per variant for a variant product.
    const rows = await this.prisma.inventory.findMany({
      where: { productId, locationId },
      include: { product: true, variant: true, location: true },
    });
    await this.processLowStockRows(rows);
  }

  /** Shared per-row low-stock work (used per product and for a whole location). */
  private async processLowStockRows(rows: LowStockRow[]): Promise<void> {
    for (const row of rows) {
      const locationId = row.locationId;
      // Derive the business from the location so this works even when called
      // from the scheduled low-stock scan (no request tenant context).
      const item = {
        tenantId: row.location.tenantId ?? getCurrentTenantId(),
        productId: row.productId,
        variantId: row.variantId ?? null,
        locationId,
      };
      const threshold = this.lowStockThreshold(row.product, row.variant);

      if (threshold > 0 && row.quantity < threshold) {
        await this.raiseLowStock({
          ...item,
          threshold,
          qty: row.quantity,
          label: this.lowStockItemLabel(row.product, row.variant),
          locationName: row.location.name,
        });
      } else {
        // Back at/above its number (or alerts switched off): close whatever is
        // still open for this item so the bell drops the stale alert. The next
        // drop below the number raises it again.
        await this.resolveLowStockAlerts(item);
      }
    }
  }

  /**
   * Raise (or refresh) the low-stock alert for one item+location and push it.
   *
   * One live alert per item+location per target: an existing unread alert is
   * updated in place when the quantity or the alert number changed, so a falling
   * quantity never stacks duplicates. The device push fires only when the alert is
   * *newly* raised — coalesced updates just refresh the in-app entry.
   */
  private async raiseLowStock(params: {
    tenantId: number | null;
    productId: number;
    variantId: number | null;
    locationId: number;
    threshold: number;
    qty: number;
    label: string;
    locationName: string;
  }): Promise<void> {
    const { tenantId, productId, variantId, locationId, qty, label, locationName } =
      params;
    const title = 'Low Stock Alert';
    const message =
      `${label} is running low (${qty} remaining, alert level ${params.threshold}) ` +
      `at ${locationName}.`;
    const pushPayload = {
      title,
      body: `${label}: ${qty} left (alert level ${params.threshold})`,
      url: LOW_STOCK_LINK,
    };

    const ownerRoleId = await this.getOwnerRoleId(tenantId);

    let raised = false;
    if (ownerRoleId) {
      const owner = await this.upsertLowStockAlert({
        tenantId,
        productId,
        variantId,
        locationId,
        threshold: params.threshold,
        title,
        message,
        target: { targetRoleId: ownerRoleId },
      });
      raised = raised || owner.created;
    }

    const locationAlert = await this.upsertLowStockAlert({
      tenantId,
      productId,
      variantId,
      locationId,
      threshold: params.threshold,
      title,
      message,
      target: { targetLocationId: locationId },
    });
    raised = raised || locationAlert.created;

    if (!raised) return;

    this.push.sendToLocation(pushPayload, locationId).catch(() => {});

    // A location with nobody assigned to it (owner-run shop, a branch whose staff
    // were removed, ...) can never receive the fan-out above, so the alert would
    // only ever sit in the bell. Fall back to the business owner(s), who already
    // have the in-app row. The count is a single indexed query; the sends stay
    // fire-and-forget so stock/sales latency is unchanged.
    const assignedUsers = await this.prisma.user.count({
      where: { locationId },
    });
    if (assignedUsers === 0 && ownerRoleId) {
      this.push
        .sendToRoleId(pushPayload, ownerRoleId, tenantId)
        .catch(() => {});
    }
  }

  /** Create the alert, or refresh the still-open one for the same item+target. */
  private async upsertLowStockAlert(params: {
    tenantId: number | null;
    productId: number;
    variantId: number | null;
    locationId: number;
    threshold: number;
    title: string;
    message: string;
    target: { targetRoleId?: number | null; targetLocationId?: number | null };
  }): Promise<{ created: boolean }> {
    const key = {
      type: 'LOW_STOCK',
      tenantId: params.tenantId,
      productId: params.productId,
      variantId: params.variantId,
      locationId: params.locationId,
      targetRoleId: params.target.targetRoleId ?? null,
      targetLocationId: params.target.targetLocationId ?? null,
    };

    const open = await this.prisma.notification.findFirst({
      where: { ...key, isRead: false },
    });

    if (open) {
      // Managed by the number: a changed quantity or a re-edited alert level
      // rewrites this one row instead of adding another.
      if (
        open.threshold !== params.threshold ||
        open.message !== params.message
      ) {
        await this.prisma.notification.update({
          where: { id: open.id },
          data: {
            threshold: params.threshold,
            message: params.message,
            link: LOW_STOCK_LINK,
          },
        });
        this.events.next({ data: 'refresh' });
      }
      return { created: false };
    }

    await this.prisma.notification.create({
      data: {
        ...key,
        title: params.title,
        message: params.message,
        link: LOW_STOCK_LINK,
        threshold: params.threshold,
      },
    });
    this.events.next({ data: 'refresh' });
    return { created: true };
  }

  /** Close every open alert for an item that is no longer below its number. */
  private async resolveLowStockAlerts(params: {
    tenantId: number | null;
    productId: number;
    variantId: number | null;
    locationId: number;
  }): Promise<void> {
    const open = await this.prisma.notification.findMany({
      where: {
        type: 'LOW_STOCK',
        tenantId: params.tenantId,
        productId: params.productId,
        variantId: params.variantId,
        locationId: params.locationId,
        isRead: false,
      },
      select: { id: true },
    });
    if (open.length === 0) return;

    await this.prisma.notification.updateMany({
      where: { id: { in: open.map((n) => n.id) } },
      data: { isRead: true },
    });
    this.events.next({ data: 'refresh' });
  }

  async notifyOwner(
    title: string,
    message: string,
    opts: { productId?: number; locationId?: number; link?: string } = {},
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
          link: opts.link ?? null,
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
        .sendToUser(userId, {
          title,
          body: message,
          ...(opts.link ? { url: opts.link } : {}),
        })
        .catch(() => {});
    }
  }

  async notifyLocation(
    title: string,
    message: string,
    locationId: number,
    opts: { productId?: number; link?: string } = {},
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
        link: opts.link ?? null,
        targetRoleId: null,
        targetLocationId: locationId,
        productId: opts.productId ?? null,
        locationId: locationId,
      },
    });

    this.events.next({ data: 'refresh' });

    this.push
      .sendToLocation(
        { title, body: message, ...(opts.link ? { url: opts.link } : {}) },
        locationId,
      )
      .catch(() => {});
  }

  /** Notify a specific user (e.g. the waiter who created an order). */
  async notifyUser(
    userId: number,
    title: string,
    message: string,
    type = 'ORDER_STATUS',
    tenantId?: number | null,
    link?: string | null,
  ): Promise<void> {
    const resolvedTenantId = tenantId ?? getCurrentTenantId();
    await this.prisma.notification.create({
      data: {
        type,
        title,
        message,
        ...(link ? { link } : {}),
        targetUserId: userId,
        ...(resolvedTenantId != null ? { tenantId: resolvedTenantId } : {}),
      },
    });
    this.events.next({ data: 'refresh' });

    this.push
      .sendToUser(userId, {
        title,
        body: message,
        ...(link ? { url: link } : {}),
      })
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
  /**
   * Notify every member of a role.
   *
   * `roleKey` is normally the role's immutable `systemKey` (CASHIER,
   * RECEPTIONIST, CHEF, BARMAN, BARISTA, STATION_<KEY>, ...). The
   * user-editable role name is still accepted as a fallback so roles created
   * before the systemKey column keep working.
   */
  async notifyRole(
    roleKey: string,
    title: string,
    message: string,
    type = 'ORDER_STATUS',
    link?: string | null,
  ): Promise<void> {
    const tenantId = getCurrentTenantId();
    const role =
      (await this.prisma.role.findFirst({
        where: { systemKey: roleKey, organizationId: tenantId },
      })) ??
      (await this.prisma.role.findFirst({
        where: { name: roleKey, organizationId: tenantId },
      }));
    if (!role) {
      // This used to return silently, so a mistyped/renamed role made alerts
      // disappear without a trace.
      this.logger.warn(
        `notifyRole("${roleKey}") skipped: no role with that systemKey or name in organization ${tenantId ?? 'n/a'}.`,
      );
      return;
    }
    await this.dispatchToRole(role.id, role.organizationId, title, message, type, link);
  }

  /**
   * Notify every member of a role by id. Preferred by callers that already hold
   * an immutable role reference (e.g. RestaurantStation.roleId), so a station
   * rename can never misroute its alerts.
   */
  async notifyRoleId(
    roleId: number,
    title: string,
    message: string,
    type = 'ORDER_STATUS',
    link?: string | null,
  ): Promise<void> {
    const tenantId = getCurrentTenantId();
    const role = await this.prisma.role.findFirst({
      where: {
        id: roleId,
        ...(tenantId != null ? { organizationId: tenantId } : {}),
      },
    });
    if (!role) return;
    await this.dispatchToRole(role.id, role.organizationId, title, message, type, link);
  }

  /** Persist a role-targeted notification and fan it out to web push. */
  private async dispatchToRole(
    roleId: number,
    organizationId: number | null,
    title: string,
    message: string,
    type: string,
    link?: string | null,
  ): Promise<void> {
    await this.prisma.notification.create({
      data: {
        tenantId: organizationId,
        type,
        title,
        message,
        ...(link ? { link } : {}),
        targetRoleId: roleId,
      },
    });
    this.events.next({ data: 'refresh' });

    this.push
      .sendToRoleId(
        { title, body: message, ...(link ? { url: link } : {}) },
        roleId,
        organizationId,
      )
      .catch(() => {});
  }

  async checkAllLowStockForLocation(locationId: number): Promise<void> {
    // One query for the whole location (plain rows + variant rows) and one pass
    // over them: going product-by-product would re-scan every variant group.
    const rows = await this.prisma.inventory.findMany({
      where: { locationId },
      include: { product: true, variant: true, location: true },
    });
    await this.processLowStockRows(rows);
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
