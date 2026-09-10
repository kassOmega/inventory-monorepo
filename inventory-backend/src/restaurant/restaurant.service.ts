// src/restaurant/restaurant.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MenuItemTrackingMode,
  OrderItemStatus,
  OrderStatus,
  Prisma,
  TableStatus,
  TaxDirection,
} from '@prisma/client';
import { getCurrentTenantId } from '../common/tenant/tenant.context';
import { tr } from '../i18n/i18n.service';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { DEFAULT_MENU_CATEGORIES } from '../common/verticals';
import { assertNotDuplicate } from '../common/duplicate.util';
import { resolveTax, splitTax } from '../common/tax.util';
import { FinanceService } from '../finance/finance.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { MenuRecipeService } from './menu-recipe.service';
import {
  CreateMenuCategoryDto,
  CreateMenuItemDto,
  CreateMenuItemOptionDto,
  CreateOrderDto,
  CreateReservationDto,
  CreateStationDto,
  CreateTableDto,
  SettleOrderDto,
  UpdateMenuCategoryDto,
  UpdateMenuItemDto,
  UpdateMenuItemOptionDto,
  UpdateOrderDto,
  UpdateStationDto,
} from './dto/restaurant.dto';

const OPEN_ORDER_STATUSES = [
  OrderStatus.OPEN,
  OrderStatus.DISPATCHED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.SERVED,
];

@Injectable()
export class RestaurantService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private finance: FinanceService,
    private recipes: MenuRecipeService,
  ) {}

  /** Active organization id for the current request (throws when absent). */
  tenant(): number {
    const id = getCurrentTenantId();
    if (id == null) throw new BadRequestException(tr('errors.noActiveOrganization'));
    return id;
  }

  // --- Stations (owner-managed, dynamic) ---

  // Built-in stations keep their hardcoded permission keys so existing
  // roles/data are unaffected. Custom stations get dynamic keys:
  //   station.<key>.view / station.<key>.update  (group "Stations")
  private static readonly STATION_PERMISSIONS: Record<
    string,
    { view: string; update: string }
  > = {
    kitchen: { view: 'kitchen.view', update: 'kitchen.update' },
    bar: { view: 'bar.view', update: 'bar.update' },
    barista: { view: 'barista.view', update: 'barista.update' },
  };

  private stationViewPermission(key: string): string {
    return (
      RestaurantService.STATION_PERMISSIONS[key]?.view ??
      `station.${key}.view`
    );
  }

  private stationUpdatePermission(key: string): string {
    return (
      RestaurantService.STATION_PERMISSIONS[key]?.update ??
      `station.${key}.update`
    );
  }

  private stationWithAccess(st: any) {
    return {
      ...st,
      permissionView: this.stationViewPermission(st.key),
      permissionUpdate: this.stationUpdatePermission(st.key),
    };
  }

  /**
   * Ensure the station's board permissions + role exist and are linked.
   * Built-in stations reuse their existing permission keys and roles
   * (Chef/Barman/Barista); custom stations get `station.<key>.view/update`
   * permissions and a role named after the station (or the owner's chosen
   * "notify role"). Idempotent — safe to call on every read.
   */
  private async ensureStationAccess(station: {
    id: number;
    name: string;
    key: string;
    roleName?: string | null;
    roleId?: number | null;
  }): Promise<{ roleId: number | null; roleName: string | null }> {
    const tenantId = this.tenant();
    const builtIn = RestaurantService.STATION_PERMISSIONS[station.key];
    const viewKey = this.stationViewPermission(station.key);
    const updateKey = this.stationUpdatePermission(station.key);
    const roleName = station.roleName?.trim() || station.name;

    const permView = await this.prisma.permission.upsert({
      where: { key: viewKey },
      update: builtIn ? {} : { label: `View ${station.name} Board`, group: 'Stations' },
      create: {
        key: viewKey,
        label: `View ${station.name} Board`,
        group: builtIn ? 'Restaurant' : 'Stations',
      },
    });
    const permUpdate = await this.prisma.permission.upsert({
      where: { key: updateKey },
      update: builtIn ? {} : { label: `Update ${station.name} Items`, group: 'Stations' },
      create: {
        key: updateKey,
        label: `Update ${station.name} Items`,
        group: builtIn ? 'Restaurant' : 'Stations',
      },
    });

    // Resolve the linked role by name first (so pointing a station at an
    // existing role like "Chef" just grants it the board permissions), then
    // fall back to the previously linked role so renames stay in sync.
    let role = await this.prisma.role.findFirst({
      where: { name: roleName, organizationId: tenantId },
    });
    if (!role && station.roleId) {
      role = await this.prisma.role.findFirst({
        where: { id: station.roleId, organizationId: tenantId },
      });
    }
    if (!role) {
      role = await this.prisma.role.create({
        data: {
          name: roleName,
          description: `Prepares items at the ${station.name} station.`,
          organizationId: tenantId,
          permissions: {
            create: [
              { permissionId: permView.id },
              { permissionId: permUpdate.id },
            ],
          },
        },
      });
    } else {
      await this.prisma.rolePermission.createMany({
        data: [
          { roleId: role.id, permissionId: permView.id },
          { roleId: role.id, permissionId: permUpdate.id },
        ],
        skipDuplicates: true,
      });
      if (role.name !== roleName) {
        role = await this.prisma.role.update({
          where: { id: role.id },
          data: { name: roleName },
        });
      }
    }

    // Station staff need base keys so they can sign in and read restaurant data.
    const base = await this.prisma.permission.findMany({
      where: { key: { in: ['dashboard.view', 'restaurant.view'] } },
    });
    if (base.length) {
      await this.prisma.rolePermission.createMany({
        data: base.map((p) => ({ roleId: role!.id, permissionId: p.id })),
        skipDuplicates: true,
      });
    }

    return { roleId: role.id, roleName: role.name };
  }

  async ensureDefaultStations(tenantId: number) {
    const defaults = [
      { name: 'Kitchen', key: 'kitchen', roleName: 'Chef' },
      { name: 'Bar', key: 'bar', roleName: 'Barman' },
      { name: 'Barista', key: 'barista', roleName: 'Barista' },
    ];
    for (const d of defaults) {
      await this.prisma.restaurantStation.upsert({
        where: { tenantId_key: { tenantId, key: d.key } },
        update: {},
        create: {
          tenantId,
          name: d.name,
          key: d.key,
          roleName: d.roleName,
          sortOrder: defaults.indexOf(d),
        },
      });
    }
    return this.listStationsFor(tenantId);
  }

  async listStations() {
    const tenantId = this.tenant();
    const stations = await this.prisma.restaurantStation.findMany({
      where: { tenantId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    // Lazy backfill: ensure every station (incl. pre-existing ones) has its
    // board permissions + role linked before returning.
    const results: any[] = [];
    for (const s of stations) {
      let st = s;
      if (!s.roleId) {
        const access = await this.ensureStationAccess(s);
        if (access.roleId) {
          st = await this.prisma.restaurantStation.update({
            where: { id: s.id },
            data: { roleId: access.roleId, roleName: access.roleName },
          });
        }
      }
      results.push(this.stationWithAccess(st));
    }
    return results;
  }

  private async listStationsFor(tenantId: number) {
    return this.prisma.restaurantStation.findMany({
      where: { tenantId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createStation(dto: CreateStationDto) {
    const tenantId = this.tenant();
    const key = this.slugify(dto.key ?? dto.name);
    const existing = await this.prisma.restaurantStation.findUnique({
      where: { tenantId_key: { tenantId, key } },
    });
    if (existing) {
      throw new BadRequestException(tr('errors.stationKeyExists'));
    }
    const station = await this.prisma.restaurantStation.create({
      data: {
        tenantId,
        name: dto.name,
        key,
        roleName: dto.roleName ?? null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    // Create the station's board permissions + role and link them.
    const access = await this.ensureStationAccess(station);
    if (access.roleId) {
      await this.prisma.restaurantStation.update({
        where: { id: station.id },
        data: { roleId: access.roleId, roleName: access.roleName },
      });
    }
    const linked = await this.prisma.restaurantStation.findUnique({
      where: { id: station.id },
    });
    return this.stationWithAccess(linked!);
  }

  async updateStation(id: number, dto: UpdateStationDto) {
    const tenantId = this.tenant();
    const existing = await this.prisma.restaurantStation.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException(tr('errors.stationNotFound'));

    let key = existing.key;
    if (dto.key) {
      key = this.slugify(dto.key);
      const dup = await this.prisma.restaurantStation.findUnique({
        where: { tenantId_key: { tenantId, key } },
      });
      if (dup && dup.id !== id) {
        throw new BadRequestException(tr('errors.stationKeyExists'));
      }
    }

    const updated = await this.prisma.restaurantStation.update({
      where: { id },
      data: {
        name: dto.name,
        key,
        roleName: dto.roleName,
        sortOrder: dto.sortOrder,
        isActive: dto.isActive,
      },
    });

    // Keep the role name + permission labels in sync with the station.
    const access = await this.ensureStationAccess(updated);
    if (access.roleId) {
      await this.prisma.restaurantStation.update({
        where: { id },
        data: { roleId: access.roleId, roleName: access.roleName },
      });
    }
    const linked = await this.prisma.restaurantStation.findUnique({
      where: { id },
    });
    return this.stationWithAccess(linked!);
  }

  /** Staff members of the active org, flagged by whether they hold this station's role. */
  async listStationUsers(stationId: number) {
    const tenantId = this.tenant();
    const station = await this.prisma.restaurantStation.findFirst({
      where: { id: stationId, tenantId },
    });
    if (!station) throw new NotFoundException(tr('errors.stationNotFound'));

    const memberships = await this.prisma.membership.findMany({
      where: { organizationId: tenantId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        role: { select: { isSystem: true } },
      },
      orderBy: { id: 'asc' },
    });

    return memberships.map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      isSystem: m.role?.isSystem ?? false,
      assigned: m.roleId === station.roleId,
    }));
  }

  /** Quick-assign helper: give/revoke a staff member's station role (same as the Users page). */
  async assignStationUser(
    stationId: number,
    body: { userId: number; assign: boolean },
  ) {
    const tenantId = this.tenant();
    const station = await this.prisma.restaurantStation.findFirst({
      where: { id: stationId, tenantId },
    });
    if (!station) throw new NotFoundException(tr('errors.stationNotFound'));
    if (!station.roleId) {
      throw new BadRequestException(
        tr('errors.resStationNoRole'),
      );
    }

    const membership = await this.prisma.membership.findFirst({
      where: { userId: body.userId, organizationId: tenantId },
      include: { role: { select: { isSystem: true } } },
    });
    if (!membership) {
      throw new NotFoundException(tr('errors.userNotPartOfBusiness'));
    }
    if (membership.role?.isSystem) {
      throw new BadRequestException(
        tr('errors.resCannotChangeOwnerRole'),
      );
    }

    const roleId = body.assign ? station.roleId : null;
    await this.prisma.membership.update({
      where: { id: membership.id },
      data: { roleId },
    });
    // Keep the legacy single-role field in sync with the membership.
    await this.prisma.user.update({
      where: { id: body.userId },
      data: { roleId },
    });

    return { userId: body.userId, stationId, assigned: body.assign };
  }

  async deleteStation(id: number) {
    const tenantId = this.tenant();
    const station = await this.prisma.restaurantStation.findFirst({
      where: { id, tenantId },
    });
    if (!station) throw new NotFoundException(tr('errors.stationNotFound'));

    const inUse = await this.prisma.menuCategory.count({
      where: { stationId: id },
    });
    if (inUse > 0) {
      // Soft-delete so existing routes/history keep their labels.
      return this.prisma.restaurantStation.update({
        where: { id },
        data: { isActive: false },
      });
    }
    await this.prisma.restaurantStation.delete({ where: { id } });
    return { id };
  }

  private slugify(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);
  }

  private async resolveRoute(
    tenantId: number,
    stationIds: number[],
  ): Promise<Array<{ id: number; name: string; key: string }>> {
    if (!stationIds.length) return [];
    const stations = await this.prisma.restaurantStation.findMany({
      where: { tenantId, id: { in: stationIds } },
    });
    const byId = new Map(stations.map((s) => [s.id, s]));
    return stationIds.map((sid) => {
      const s = byId.get(sid);
      if (!s) throw new BadRequestException(tr('errors.resStationIdNotFound', { id: sid }));
      return { id: s.id, name: s.name, key: s.key };
    });
  }

  // --- Menu ---
  /**
   * Attach recipe info to a menu item: `hasRecipe`, `recipeCost` (live, from
   * current ingredient buy prices) and `effectiveCost` (recipe cost when a
   * recipe exists, otherwise the manual `cost` — the fallback).
   */
  private withEffectiveCost(item: any) {
    const recipeCost = (item.ingredients ?? []).reduce(
      (s: number, r: any) =>
        s + r.quantityPerUnit * (r.product?.currentBuyPrice ?? 0),
      0,
    );
    const hasRecipe = (item.ingredients?.length ?? 0) > 0;
    const rounded = Math.round(recipeCost * 100) / 100;
    return {
      ...item,
      hasRecipe,
      recipeCost: rounded,
      effectiveCost: hasRecipe ? rounded : item.cost ?? 0,
    };
  }

  async listMenu() {
    const tenantId = this.tenant();
    const categories = await this.prisma.menuCategory.findMany({
      where: { tenantId },
      include: {
        items: {
          include: {
            options: true,
            ingredients: { include: { product: { include: { unit: true } } } },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });
    return categories.map((cat) => ({
      ...cat,
      items: cat.items.map((item) => this.withEffectiveCost(item)),
    }));
  }

  async createMenuCategory(dto: CreateMenuCategoryDto) {
    const tenantId = this.tenant();
    const routeIds = dto.route?.length
      ? dto.route
      : dto.stationId != null
        ? [dto.stationId]
        : [];
    const route = routeIds.length ? await this.resolveRoute(tenantId, routeIds) : [];
    return this.prisma.menuCategory.create({
      data: {
        tenantId,
        name: dto.name,
        sortOrder: dto.sortOrder ?? 0,
        stationId: route[0]?.id ?? null,
        stationRoute: route as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async seedDefaultMenuCategories() {
    const tenantId = this.tenant();
    await this.ensureDefaultStations(tenantId);
    const stations = await this.listStationsFor(tenantId);
    const byKey = new Map(stations.map((s) => [s.key, s]));
    const existing = await this.prisma.menuCategory.findMany({
      where: { tenantId },
      select: { name: true },
    });
    const existingNames = new Set(existing.map((c) => c.name));
    const toCreate = DEFAULT_MENU_CATEGORIES.filter((c) => !existingNames.has(c.name));
    for (const c of toCreate) {
      const st = byKey.get(c.stationKey);
      if (!st) continue;
      const route = [{ id: st.id, name: st.name, key: st.key }];
      await this.prisma.menuCategory.create({
        data: {
          tenantId,
          name: c.name,
          stationId: st.id,
          stationRoute: route as unknown as Prisma.InputJsonValue,
          sortOrder: toCreate.indexOf(c),
        },
      });
    }
    return this.listMenu();
  }

  async createMenuItem(dto: CreateMenuItemDto) {
    const tenantId = this.tenant();
    const trackingMode = dto.trackingMode ?? MenuItemTrackingMode.SIMPLE;
    if (trackingMode === MenuItemTrackingMode.BENCHMARK) {
      if (!(dto.estimatedCogs != null && dto.estimatedCogs > 0)) {
        throw new BadRequestException(
          tr('errors.resEstCostRequired'),
        );
      }
    }
    const data: Prisma.MenuItemUncheckedCreateInput = {
      tenantId,
      menuCategoryId: dto.menuCategoryId,
      name: dto.name,
      description: dto.description,
      price: dto.price,
      // Cost sync per tracking mode: BENCHMARK -> estimatedCogs, SIMPLE -> 0,
      // PERPETUAL -> manual fallback (recipe auto-cost takes over when set).
      cost:
        trackingMode === MenuItemTrackingMode.BENCHMARK
          ? (dto.estimatedCogs ?? 0)
          : trackingMode === MenuItemTrackingMode.SIMPLE
            ? 0
            : (dto.cost ?? 0),
      trackingMode,
      estimatedCogs:
        trackingMode === MenuItemTrackingMode.BENCHMARK
          ? dto.estimatedCogs
          : null,
      isAvailable: dto.isAvailable ?? true,
      options: dto.options?.length
        ? { create: dto.options.map((o) => ({ tenantId, name: o.name, extraPrice: o.extraPrice ?? 0 })) }
        : undefined,
    };
    if (dto.stationRoute?.length) {
      data.stationRoute = (await this.resolveRoute(
        tenantId,
        dto.stationRoute,
      )) as unknown as Prisma.InputJsonValue;
    }
    return this.prisma.menuItem.create({ data, include: { options: true } });
  }

  async updateMenuItemAvailability(id: number, isAvailable: boolean) {
    await this.prisma.menuItem.update({ where: { id }, data: { isAvailable } });
    return { id, isAvailable };
  }

  async updateMenuCategory(id: number, dto: UpdateMenuCategoryDto) {
    const tenantId = this.tenant();
    const existing = await this.prisma.menuCategory.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException(tr('errors.menuCategoryNotFound'));

    const data: Prisma.MenuCategoryUncheckedUpdateInput = {};
    if (dto.name != null) data.name = dto.name;
    if (dto.sortOrder != null) data.sortOrder = dto.sortOrder;
    if (dto.route?.length) {
      const route = await this.resolveRoute(tenantId, dto.route);
      data.stationId = route[0]?.id ?? null;
      data.stationRoute = route as unknown as Prisma.InputJsonValue;
    } else if (dto.stationId != null) {
      const route = await this.resolveRoute(tenantId, [dto.stationId]);
      data.stationId = dto.stationId;
      data.stationRoute = route as unknown as Prisma.InputJsonValue;
    }

    await this.prisma.menuCategory.update({ where: { id }, data });
    return this.prisma.menuCategory.findFirst({ where: { id, tenantId } });
  }

  async deleteMenuCategory(id: number) {
    const tenantId = this.tenant();
    await this.prisma.menuCategory.deleteMany({ where: { id, tenantId } });
    return { id };
  }

  async updateMenuItem(id: number, dto: UpdateMenuItemDto) {
    const tenantId = this.tenant();
    const existing = await this.prisma.menuItem.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException(tr('errors.menuItemNotFound'));

    const trackingMode = dto.trackingMode ?? existing.trackingMode;
    const data: Prisma.MenuItemUncheckedUpdateInput = {};
    if (dto.name != null) data.name = dto.name;
    if (dto.description != null) data.description = dto.description;
    if (dto.price != null) data.price = dto.price;
    if (dto.isAvailable != null) data.isAvailable = dto.isAvailable;
    if (dto.sortOrder != null) data.sortOrder = dto.sortOrder;
    if (dto.menuCategoryId != null) data.menuCategoryId = dto.menuCategoryId;
    if (dto.trackingMode != null) data.trackingMode = dto.trackingMode;
    if (dto.stationRoute) {
      data.stationRoute = (await this.resolveRoute(
        tenantId,
        dto.stationRoute,
      )) as unknown as Prisma.InputJsonValue;
    } else if (dto.stationRoute !== undefined) {
      // Empty array clears the override -> inherit the category route.
      data.stationRoute = Prisma.DbNull;
    }

    // Cost sync per tracking mode:
    //  BENCHMARK -> cost = estimatedCogs (required, > 0).
    //  SIMPLE    -> cost = 0 (no COGS posted at settlement).
    //  PERPETUAL -> recipe auto-cost governs; keep a manual fallback cost.
    if (trackingMode === MenuItemTrackingMode.BENCHMARK) {
      const est = dto.estimatedCogs ?? existing.estimatedCogs;
      if (!(est != null && est > 0)) {
        throw new BadRequestException(
          tr('errors.resEstCostRequired'),
        );
      }
      data.estimatedCogs = est;
      data.cost = est;
    } else if (trackingMode === MenuItemTrackingMode.SIMPLE) {
      data.cost = 0;
      data.estimatedCogs = null;
    } else {
      // PERPETUAL — the recipe (when defined) auto-computes the live cost.
      data.estimatedCogs = null;
      if (dto.cost != null) data.cost = dto.cost;
    }

    await this.prisma.menuItem.updateMany({ where: { id, tenantId }, data });

    // When a recipe exists its live cost wins over the manual value, so the
    // menu always reflects the current ingredient prices.
    await this.recipes.recalcMenuItemCost(id, tenantId);

    const item = await this.prisma.menuItem.findFirst({
      where: { id, tenantId },
      include: {
        options: true,
        ingredients: { include: { product: { include: { unit: true } } } },
      },
    });
    return item ? this.withEffectiveCost(item) : item;
  }

  async deleteMenuItem(id: number) {
    const tenantId = this.tenant();
    await this.prisma.menuItem.deleteMany({ where: { id, tenantId } });
    return { id };
  }

  async addMenuItemOption(menuItemId: number, dto: CreateMenuItemOptionDto) {
    const tenantId = this.tenant();
    await this.prisma.menuItem.findFirstOrThrow({ where: { id: menuItemId, tenantId } });
    return this.prisma.menuItemOption.create({
      data: { tenantId, menuItemId, name: dto.name, extraPrice: dto.extraPrice ?? 0 },
    });
  }

  async updateMenuItemOption(id: number, dto: UpdateMenuItemOptionDto) {
    const tenantId = this.tenant();
    await this.prisma.menuItemOption.updateMany({ where: { id, tenantId }, data: { ...dto } });
    return this.prisma.menuItemOption.findFirst({ where: { id, tenantId } });
  }

  async deleteMenuItemOption(id: number) {
    const tenantId = this.tenant();
    await this.prisma.menuItemOption.deleteMany({ where: { id, tenantId } });
    return { id };
  }

  // --- Tables ---
  async listTables() {
    const tenantId = this.tenant();
    return this.prisma.diningTable.findMany({
      where: { tenantId },
      include: { orders: { where: { status: { in: OPEN_ORDER_STATUSES } }, select: { id: true, orderNumber: true, totalAmount: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async createTable(dto: CreateTableDto) {
    const tenantId = this.tenant();
    return this.prisma.diningTable.create({
      data: { tenantId, name: dto.name, zone: dto.zone, capacity: dto.capacity ?? 4 },
    });
  }

  async updateTableStatus(id: number, status: TableStatus) {
    await this.prisma.diningTable.update({ where: { id }, data: { status } });
    return { id, status };
  }

  // --- Orders ---
  async listOrders(
    user: JwtPayload,
    status?: string,
    filters?: { waiterId?: number; tableId?: number; dateFrom?: string; dateTo?: string },
  ) {
    const tenantId = this.tenant();
    const where: Record<string, unknown> = { tenantId };
    // Waiters only see the orders they took; owners and managers (who hold
    // restaurant.manage) can list everyone's orders and may optionally filter
    // by a specific waiter. This is enforced server-side so the scope cannot
    // be widened by query params.
    const canSeeAllOrders =
      user.isSuperuser || (user.permissions ?? []).includes('restaurant.manage');
    if (canSeeAllOrders) {
      if (status) where.status = status as OrderStatus;
      if (filters?.waiterId) where.createdById = filters.waiterId;
    } else {
      where.createdById = user.sub;
    }
    if (filters?.tableId) where.tableId = filters.tableId;
    if (filters?.dateFrom || filters?.dateTo) {
      const createdAt: Record<string, Date> = {};
      if (filters.dateFrom) createdAt.gte = new Date(`${filters.dateFrom}T00:00:00`);
      if (filters.dateTo) createdAt.lte = new Date(`${filters.dateTo}T23:59:59`);
      where.createdAt = createdAt;
    }
    return this.prisma.order.findMany({
      where,
      include: {
        items: true,
        table: true,
        paymentMethod: true,
        history: { orderBy: { createdAt: 'asc' } },
        fiscalReceipt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Whether the user may view a station's board (owner bypass, manager bypass). */
  private canViewStation(stationKey: string, user: JwtPayload): boolean {
    if (user.isSuperuser) return true;
    const perms = user.permissions ?? [];
    if (perms.includes('restaurant.manage')) return true;
    return perms.includes(this.stationViewPermission(stationKey));
  }

  /**
   * Whether the user may update items sitting at a station. Only the station
   * currently holding the item may advance its status — via the station's own
   * update permission (kitchen.update / bar.update / barista.update, or
   * station.<key>.update for custom stations). Owners and managers
   * (restaurant.manage) keep a universal override. Waiters/servers
   * (restaurant.serve) must NOT update item statuses: they place, dispatch
   * and settle orders, but the corresponding station owns the item while it
   * is there.
   */
  private canUpdateStationItem(
    item: { stationKey: string | null },
    user: JwtPayload,
  ): boolean {
    if (user.isSuperuser) return true;
    const perms = user.permissions ?? [];
    if (perms.includes('restaurant.manage')) return true;
    if (!item.stationKey) return false;
    return perms.includes(this.stationUpdatePermission(item.stationKey));
  }

  async getKitchenBoard(stationKey: string | undefined, user: JwtPayload) {
    if (stationKey && !this.canViewStation(stationKey, user)) {
      throw new ForbiddenException(tr('errors.stationAccessDenied'));
    }
    const tenantId = this.tenant();
    return this.prisma.order.findMany({
      where: { tenantId, status: { in: OPEN_ORDER_STATUSES } },
      include: {
        table: true,
        items: {
          where: {
            status: { not: OrderItemStatus.SERVED },
            ...(stationKey ? { stationKey } : {}),
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createOrder(dto: CreateOrderDto, user: JwtPayload) {
    const tenantId = this.tenant();
    const created = await this.prisma.$transaction(async (tx) => {
        let totalAmount = 0;
        const itemsData: any[] = [];

        for (const it of dto.items) {
          const mi = await tx.menuItem.findUnique({
            where: { id: it.menuItemId },
            include: { menuCategory: true },
          });
          if (!mi) throw new BadRequestException(tr('errors.resMenuItemIdNotFound', { id: it.menuItemId }));
          totalAmount += mi.price * it.quantity;

          // Dynamic recipe costing: when the menu item has a recipe, the cost
          // snapshot is recomputed live from current ingredient buy prices
          // (and persisted so the menu stays fresh); otherwise the manual
          // `cost` field is used as the fallback.
          const liveCost = await this.recipes.liveMenuItemCost(
            mi.id,
            tenantId,
            tx,
          );
          if (liveCost != null) {
            await tx.menuItem.update({
              where: { id: mi.id },
              data: { cost: liveCost },
            });
          }
          const itemCost = liveCost ?? mi.cost ?? 0;

          // Resolve the station route: item override > category route > none.
          const catRoute = (mi.menuCategory?.stationRoute as Array<{ id: number; name: string; key: string }>) ?? [];
          const itemRoute = (mi.stationRoute as Array<{ id: number; name: string; key: string }> | null) ?? null;
          const route =
            itemRoute && itemRoute.length
              ? itemRoute
              : catRoute && catRoute.length
                ? catRoute
                : [];
          const first = route[0] ?? null;

          itemsData.push({
            tenantId,
            menuItemId: mi.id,
            name: mi.name,
            quantity: it.quantity,
            unitPrice: mi.price,
            cost: itemCost,
            stationRoute: route,
            stationIndex: 0,
            stationKey: first?.key ?? null,
            stationName: first?.name ?? null,
            notes: it.notes,
          });
        }

        const order = await tx.order.create({
          data: {
            tenantId,
            orderNumber: `ORD-${Date.now()}`,
            tableId: dto.tableId,
            customerName: dto.customerName,
            // Auto-dispatched: the order goes straight to its stations when it
            // is placed, so waiters have no separate "send to station" step.
            status: OrderStatus.DISPATCHED,
            totalAmount,
            clientRef: dto.clientRef ?? null,
            createdById: user.sub,
            items: { create: itemsData },
          },
          include: { items: true },
        });

        if (dto.tableId) {
          await tx.diningTable.update({ where: { id: dto.tableId }, data: { status: TableStatus.OCCUPIED } });
        }

        return order;
      })
      .catch((err: unknown) =>
        assertNotDuplicate(err, 'This order was already submitted. Please refresh and try again.'),
      );

    // Dispatch = placing the order. Notify the stations that receive work and
    // start the order's audit timeline.
    await this.notifyFirstHopStations(created);
    await this.recordOrderStatusHistory(created.id, OrderStatus.DISPATCHED, user);
    return created;
  }

  async updateOrder(orderId: number, dto: UpdateOrderDto) {
    const tenantId = this.tenant();
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException(tr('errors.orderNotFound'));
    // Orders are auto-dispatched on creation, so editing stays possible while
    // the order is OPEN or DISPATCHED and no station has started any item yet.
    const editable = order.status === OrderStatus.OPEN || order.status === OrderStatus.DISPATCHED;
    const started = (order.items ?? []).some((it) => it.status !== OrderItemStatus.QUEUED);
    if (!editable || started) {
      throw new BadRequestException(tr('errors.paidOrderCannotBeEdited'));
    }

    return this.prisma.$transaction(async (tx) => {
      let totalAmount = order.totalAmount;
      const itemsData: any[] = [];

      if (dto.items) {
        totalAmount = 0;
        for (const it of dto.items) {
          const mi = await tx.menuItem.findUnique({
            where: { id: it.menuItemId },
            include: { menuCategory: true },
          });
          if (!mi) throw new BadRequestException(tr('errors.resMenuItemIdNotFound', { id: it.menuItemId }));
          totalAmount += mi.price * it.quantity;
          // Resolve the station route: item override > category route > none.
          const catRoute = (mi.menuCategory?.stationRoute as Array<{ id: number; name: string; key: string }>) ?? [];
          const itemRoute = (mi.stationRoute as Array<{ id: number; name: string; key: string }> | null) ?? null;
          const route =
            itemRoute && itemRoute.length
              ? itemRoute
              : catRoute && catRoute.length
                ? catRoute
                : [];
          const first = route[0] ?? null;
          // Snapshot the effective cost per tracking mode so OrderItem.cost
          // (used by reports/reversals) matches what settlement posts:
          // BENCHMARK -> estimatedCogs, SIMPLE -> 0, PERPETUAL -> recipe/manual.
          const cost =
            mi.trackingMode === MenuItemTrackingMode.BENCHMARK
              ? (mi.estimatedCogs ?? 0)
              : mi.trackingMode === MenuItemTrackingMode.SIMPLE
                ? 0
                : (mi.cost ?? 0);
          itemsData.push({
            menuItemId: mi.id,
            name: mi.name,
            quantity: it.quantity,
            unitPrice: mi.price,
            cost,
            stationRoute: route,
            stationIndex: 0,
            stationKey: first?.key ?? null,
            stationName: first?.name ?? null,
            notes: it.notes,
          });
        }
      }

      await tx.order.update({
        where: { id: orderId },
        data: {
          tableId: dto.tableId,
          customerName: dto.customerName,
          totalAmount,
          ...(dto.items ? { items: { deleteMany: {}, create: itemsData } } : {}),
        },
      });

      return tx.order.findFirst({ where: { id: orderId }, include: { items: true, table: true } });
    });
  }

  async cancelOrder(orderId: number, user: JwtPayload) {
    const tenantId = this.tenant();
    const order = await this.prisma.order.findFirst({ where: { id: orderId, tenantId } });
    if (!order) throw new NotFoundException(tr('errors.orderNotFound'));
    if (order.status === OrderStatus.PAID) throw new BadRequestException(tr('errors.paidOrdersCannotBeCancelled'));
    await this.prisma.order.update({ where: { id: orderId }, data: { status: OrderStatus.CANCELLED } });
    await this.recordOrderStatusHistory(orderId, OrderStatus.CANCELLED, user);
    return { id: orderId, status: OrderStatus.CANCELLED };
  }

  async deleteOrder(orderId: number) {
    const tenantId = this.tenant();
    const order = await this.prisma.order.findFirst({ where: { id: orderId, tenantId } });
    if (!order) throw new NotFoundException(tr('errors.orderNotFound'));
    if (order.status === OrderStatus.PAID) throw new BadRequestException(tr('errors.paidOrdersCannotBeDeleted'));
    await this.prisma.order.deleteMany({ where: { id: orderId, tenantId } });
    return { id: orderId };
  }

  /**
   * Notify the roles of every station that receives the first hop of an item.
   * Called automatically when an order is placed (orders are auto-dispatched).
   */
  private async notifyFirstHopStations(order: {
    orderNumber: string;
    items: Array<{ stationRoute: Prisma.JsonValue }>;
  }) {
    const firstHopKeys = new Set<string>();
    for (const item of order.items ?? []) {
      const route = (item.stationRoute as Array<{ id: number; name: string; key: string }>) ?? [];
      if (route.length) firstHopKeys.add(route[0].key);
    }

    const tenantId = this.tenant();
    const stationRows = await this.prisma.restaurantStation.findMany({
      where: { tenantId, key: { in: [...firstHopKeys].filter(Boolean) } },
    });
    for (const st of stationRows) {
      if (st.roleName) {
        await this.notifications.notifyRole(
          st.roleName,
          `New ${st.name} Order`,
          `Order ${order.orderNumber} has items to prepare at ${st.name}.`,
        );
      }
    }
  }

  /**
   * Hand an item off to the next station in its route (multi-hop flow, e.g.
   * Butcher -> Kitchen). The first station must make the item ready first; the
   * next station then takes over. The next station's role is notified and the
   * item returns to QUEUED at the new station.
   */
  async advanceItem(orderId: number, itemId: number, user: JwtPayload) {
    const item = await this.prisma.orderItem.findUnique({
      where: { id: itemId },
    });
    if (!item) throw new NotFoundException(tr('errors.orderItemNotFound'));
    if (!this.canUpdateStationItem(item, user)) {
      throw new ForbiddenException(tr('errors.stationItemUpdateDenied'));
    }
    if (item.status !== OrderItemStatus.READY) {
      throw new BadRequestException(
        tr('errors.resMakeItemReady'),
      );
    }

    const route = (item.stationRoute as Array<{ id: number; name: string; key: string }>) ?? [];
    const nextIndex = item.stationIndex + 1;
    if (nextIndex >= route.length) {
      throw new BadRequestException(
        tr('errors.resNoNextStation'),
      );
    }
    const next = route[nextIndex];

    await this.prisma.orderItem.update({
      where: { id: itemId },
      data: {
        stationIndex: nextIndex,
        stationKey: next.key,
        stationName: next.name,
        status: OrderItemStatus.QUEUED,
      },
    });

    if (next.key) {
      const tenantId = this.tenant();
      const st = await this.prisma.restaurantStation.findFirst({
        where: { tenantId, key: next.key },
      });
      if (st?.roleName) {
        const order = await this.prisma.order.findUnique({
          where: { id: orderId },
          select: { orderNumber: true },
        });
        await this.notifications.notifyRole(
          st.roleName,
          `New ${st.name} Order`,
          `Order ${order?.orderNumber ?? ''} has an item handed off to ${st.name}.`,
        );
      }
    }

    // Keep the order-level status consistent with the item's new position.
    await this.syncOrderStatus(orderId, user);

    return {
      orderId,
      itemId,
      stationIndex: nextIndex,
      stationKey: next.key,
      stationName: next.name,
    };
  }

  async updateOrderStatus(orderId: number, status: OrderStatus, user: JwtPayload) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { table: true } });
    if (!order) throw new NotFoundException(tr('errors.orderNotFound'));

    await this.prisma.order.update({ where: { id: orderId }, data: { status } });
    await this.recordOrderStatusHistory(orderId, status, user);

    // Free the table when the order is paid or cancelled.
    if ((status === OrderStatus.PAID || status === OrderStatus.CANCELLED) && order.tableId) {
      await this.prisma.diningTable.update({ where: { id: order.tableId }, data: { status: TableStatus.FREE } });
    }

    return { id: orderId, status };
  }

  async updateItemStatus(
    orderId: number,
    itemId: number,
    status: OrderItemStatus,
    user: JwtPayload,
  ) {
    const item = await this.prisma.orderItem.findUnique({
      where: { id: itemId },
    });
    if (!item) throw new NotFoundException(tr('errors.orderItemNotFound'));
    if (!this.allowedItemStatusChange(item, status, user)) {
      throw new ForbiddenException(tr('errors.cannotChangeItemToThatStatus'));
    }
    await this.prisma.orderItem.update({ where: { id: itemId }, data: { status } });

    if (status === OrderItemStatus.READY) {
      // Only notify the waiter when the item is ready at its FINAL station
      // (multi-hop items are handed to the next station instead).
      const route = (item.stationRoute as Array<{ id: number; name: string; key: string }>) ?? [];
      const isFinalHop = item.stationIndex + 1 >= route.length;
      if (isFinalHop) {
        const order = await this.prisma.order.findUnique({
          where: { id: orderId },
          select: { createdById: true, orderNumber: true },
        });
        if (order?.createdById) {
          await this.notifications.notifyUser(
            order.createdById,
            'Item Ready',
            `An item on order ${order.orderNumber} is ready to serve.`,
          );
        }
      }
    }

    // Keep the order-level status consistent with its items.
    await this.syncOrderStatus(orderId, user);

    return { orderId, itemId, status };
  }

  /**
   * Whether the user may set an item to `status`. Stations may only prepare
   * and make ready (they never serve); waiters may only serve items the
   * station has made ready; managers/owners (and superusers) may do anything.
   */
  private allowedItemStatusChange(
    item: { stationKey: string | null; status: OrderItemStatus },
    status: OrderItemStatus,
    user: JwtPayload,
  ): boolean {
    if (user.isSuperuser) return true;
    const perms = user.permissions ?? [];
    if (perms.includes('restaurant.manage')) return true;

    if (item.stationKey && perms.includes(this.stationUpdatePermission(item.stationKey))) {
      // The station prepares and makes ready — it does not serve.
      return status === OrderItemStatus.PREPARING || status === OrderItemStatus.READY;
    }

    if (perms.includes('restaurant.serve')) {
      // The waiter serves the order once the station has made it ready.
      return status === OrderItemStatus.SERVED && item.status === OrderItemStatus.READY;
    }

    return false;
  }

  /** Display name of the acting user, falling back to email when unknown. */
  private async userDisplayName(user: JwtPayload): Promise<string> {
    try {
      const u = await this.prisma.user.findUnique({
        where: { id: user.sub },
        select: { name: true },
      });
      return u?.name ?? user.email;
    } catch {
      return user.email;
    }
  }

  /** Append a row to the order's status timeline (audit trail). */
  private async recordOrderStatusHistory(
    orderId: number,
    status: OrderStatus,
    user?: JwtPayload | null,
  ) {
    const actorName = user ? await this.userDisplayName(user) : null;
    await this.prisma.orderStatusHistory.create({
      data: {
        tenantId: this.tenant(),
        orderId,
        status,
        actorId: user?.sub ?? null,
        actorName,
        actorRole: user?.roleName ?? null,
      },
    });
  }

  /**
   * Keep the order-level status consistent with its items so every user sees
   * the same status: all SERVED → SERVED; all READY/SERVED → READY; any
   * PREPARING/READY → PREPARING; otherwise DISPATCHED. Terminal states
   * (PAID/CANCELLED) are never overridden. Forward milestones are logged to
   * the audit trail and trigger workflow notifications.
   */
  private async syncOrderStatus(orderId: number, user?: JwtPayload) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) return;
    if (order.status === OrderStatus.PAID || order.status === OrderStatus.CANCELLED) return;
    const items = order.items ?? [];
    if (!items.length) return;

    const counts: Record<OrderItemStatus, number> = {
      QUEUED: 0,
      PREPARING: 0,
      READY: 0,
      SERVED: 0,
    };
    for (const it of items) counts[it.status]++;

    let next: OrderStatus;
    if (counts.SERVED === items.length) {
      next = OrderStatus.SERVED;
    } else if (counts.QUEUED === 0 && counts.PREPARING === 0) {
      // Everything is READY (or already served) but not all served yet.
      next = OrderStatus.READY;
    } else if (counts.PREPARING > 0 || counts.READY > 0) {
      next = OrderStatus.PREPARING;
    } else {
      next = OrderStatus.DISPATCHED;
    }

    if (next === order.status) return;

    await this.prisma.order.update({ where: { id: orderId }, data: { status: next } });

    // READY is only a real "ready to serve" milestone when every item is at
    // its FINAL station (multi-hop items are handed to the next station and
    // reset to QUEUED instead of being served).
    const allAtFinalHop = items.every((it) => {
      const route = (it.stationRoute as Array<{ id: number; name: string; key: string }>) ?? [];
      return it.stationIndex + 1 >= route.length;
    });

    // Audit: log forward milestones. DISPATCHED is logged at order creation;
    // the transient DISPATCHED during a multi-hop handoff is not logged.
    if (
      next === OrderStatus.PREPARING ||
      (next === OrderStatus.READY && allAtFinalHop) ||
      next === OrderStatus.SERVED
    ) {
      await this.recordOrderStatusHistory(orderId, next, user);
    }

    // Workflow notifications.
    if (next === OrderStatus.PREPARING && order.createdById) {
      await this.notifications.notifyUser(
        order.createdById,
        'Order Preparing',
        `Order ${order.orderNumber} is being prepared at the station.`,
      );
    }

    if (next === OrderStatus.READY && allAtFinalHop && order.createdById) {
      await this.notifications.notifyUser(
        order.createdById,
        'Order Ready',
        `Order ${order.orderNumber} is ready to serve.`,
      );
    }

    if (next === OrderStatus.SERVED) {
      await this.notifications.notifyRole(
        'Cashier',
        'Order Served',
        `Order ${order.orderNumber} has been served to the customer.`,
      );
      await this.notifications.notifyRole(
        'Receptionist',
        'Order Served',
        `Order ${order.orderNumber} has been served to the customer.`,
      );
    }
  }

  /**
   * Waiter action: the station has made the items ready and the waiter takes
   * them to the customer. Every READY item is marked SERVED and the order
   * status is re-derived. Managers/owners can trigger it too.
   */
  async markOrderServed(orderId: number, user: JwtPayload) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException(tr('errors.orderNotFound'));
    if (order.status === OrderStatus.PAID || order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException(tr('errors.orderAlreadyClosed'));
    }

    const perms = user.permissions ?? [];
    const isServer =
      user.isSuperuser ||
      perms.includes('restaurant.manage') ||
      perms.includes('restaurant.serve');
    if (!isServer) {
      throw new ForbiddenException(tr('errors.noPermissionToServe'));
    }

    const readyItems = (order.items ?? []).filter((it) => it.status === OrderItemStatus.READY);
    if (!readyItems.length) {
      throw new BadRequestException(tr('errors.noItemsReadyToServe'));
    }

    await this.prisma.orderItem.updateMany({
      where: { id: { in: readyItems.map((it) => it.id) } },
      data: { status: OrderItemStatus.SERVED },
    });

    await this.syncOrderStatus(orderId, user);
    return { id: orderId, status: OrderStatus.SERVED };
  }

  /**
   * Shared per-order settlement writes, run inside the caller's transaction.
   * Sets the order PAID, creates the payment rows, frees the table and logs the
   * PAID milestone to the audit trail.
   */
  private async settleOrderInTransaction(
    tx: Prisma.TransactionClient,
    order: { id: number; orderNumber: string; totalAmount: number; tableId: number | null },
    dto: SettleOrderDto,
    tenantId: number,
    initialStatus: string,
    user: JwtPayload,
    actorName: string,
  ) {
    const discount = dto.discount ?? 0;
    const serviceCharge = dto.serviceCharge ?? 0;
    // Tax: when the company has tax enabled + a default OUTPUT rate, compute it
    // from the discounted item total (inclusive → embedded in the item totals,
    // exclusive → added on top). Otherwise fall back to the manual POS value.
    let tax = dto.tax ?? 0;
    let taxRateId: number | null = null;
    const base = Math.max(0, order.totalAmount - discount);
    const taxCtx = await resolveTax(tx, tenantId, TaxDirection.OUTPUT);
    const configuredTax = taxCtx.enabled && taxCtx.rate > 0;
    if (configuredTax) {
      tax = splitTax(base, taxCtx.rate, taxCtx.inclusive).tax;
      taxRateId = taxCtx.rateId;
    }
    const finalTotal = configuredTax && taxCtx.inclusive
      ? base + serviceCharge // tax already inside the item totals
      : base + serviceCharge + tax;

    const payments = dto.payments?.length
      ? dto.payments
      : [{ amount: finalTotal, paymentMethodId: dto.paymentMethodId }];
    const totalPaid = payments.reduce((s, p) => s + (p.amount ?? 0), 0);

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.PAID,
        discount,
        serviceCharge,
        tax,
        taxRateId,
        taxInclusive: configuredTax ? taxCtx.inclusive : true,
        paidAmount: totalPaid,
      },
    });

    for (const p of payments) {
      await tx.orderPayment.create({
        data: {
          tenantId,
          orderId: order.id,
          amount: p.amount ?? 0,
          paymentMethodId: p.paymentMethodId,
          transactionReference: p.transactionReference,
          collectedById: user.sub,
          status: initialStatus,
        },
      });
    }

    if (order.tableId) {
      await tx.diningTable.update({ where: { id: order.tableId }, data: { status: TableStatus.FREE } });
    }

    await tx.orderStatusHistory.create({
      data: {
        tenantId,
        orderId: order.id,
        status: OrderStatus.PAID,
        actorId: user.sub,
        actorName,
        actorRole: user.roleName ?? null,
      },
    });

    return { orderId: order.id, orderNumber: order.orderNumber, finalTotal, totalPaid };
  }

  async settleOrder(orderId: number, dto: SettleOrderDto, user: JwtPayload) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: { table: true } });
    if (!order) throw new NotFoundException(tr('errors.orderNotFound'));

    const tenantId = this.tenant();
    const org = await this.prisma.organization.findUnique({ where: { id: tenantId }, select: { settings: true } });
    const settings = (org?.settings as Record<string, unknown>) ?? {};
    const requireCashierConfirmation = settings.requireCashierConfirmation !== false;
    const initialStatus = requireCashierConfirmation ? 'PENDING_CONFIRMATION' : 'CONFIRMED';
    const actorName = await this.userDisplayName(user);

    const result = await this.prisma.$transaction((tx) =>
      this.settleOrderInTransaction(tx, order, dto, tenantId, initialStatus, user, actorName),
    );

    if (requireCashierConfirmation) {
      await this.notifications.notifyRole(
        'Cashier',
        'Payment Pending Confirmation',
        `Order ${order.orderNumber} has a payment awaiting confirmation.`,
      );
    } else {
      // Post categorized income immediately (no cashier confirmation required).
      await this.finance.postOrderIncome(orderId, tenantId);
    }

    return {
      id: orderId,
      status: OrderStatus.PAID,
      finalTotal: result.finalTotal,
      paidAmount: result.totalPaid,
    };
  }

  /**
   * Batch-settle several open orders (e.g. every open order on the same table)
   * in a single transaction so the whole bill is closed atomically.
   */
  async batchSettleOrders(orderIds: number[], dto: SettleOrderDto, user: JwtPayload) {
    const tenantId = this.tenant();
    const orders = await this.prisma.order.findMany({
      where: {
        id: { in: orderIds },
        tenantId,
        status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] },
      },
    });
    if (!orders.length) throw new NotFoundException(tr('errors.noOpenOrdersToSettle'));

    const org = await this.prisma.organization.findUnique({ where: { id: tenantId }, select: { settings: true } });
    const settings = (org?.settings as Record<string, unknown>) ?? {};
    const requireCashierConfirmation = settings.requireCashierConfirmation !== false;
    const initialStatus = requireCashierConfirmation ? 'PENDING_CONFIRMATION' : 'CONFIRMED';
    const actorName = await this.userDisplayName(user);

    const results = await this.prisma.$transaction(async (tx) => {
      const out: any[] = [];
      for (const order of orders) {
        out.push(
          await this.settleOrderInTransaction(tx, order, dto, tenantId, initialStatus, user, actorName),
        );
      }
      return out;
    });

    if (requireCashierConfirmation) {
      await this.notifications.notifyRole(
        'Cashier',
        'Payment Pending Confirmation',
        `${orders.length} order(s) have payments awaiting confirmation.`,
      );
    } else {
      for (const order of orders) {
        await this.finance.postOrderIncome(order.id, tenantId).catch(() => {});
      }
    }

    return { ids: orders.map((o) => o.id), status: OrderStatus.PAID, settled: results };
  }

  // --- Reservations ---
  async listReservations(date?: string) {
    const tenantId = this.tenant();
    return this.prisma.reservation.findMany({
      where: {
        tenantId,
        ...(date
          ? {
              reservedAt: {
                gte: new Date(`${date}T00:00:00`),
                lte: new Date(`${date}T23:59:59`),
              },
            }
          : {}),
      },
      include: { table: true },
      orderBy: { reservedAt: 'asc' },
    });
  }

  async createReservation(dto: CreateReservationDto) {
    const tenantId = this.tenant();
    return this.prisma.reservation.create({
      data: {
        tenantId,
        tableId: dto.tableId,
        customerName: dto.customerName,
        phone: dto.phone,
        partySize: dto.partySize ?? 1,
        reservedAt: new Date(dto.reservedAt),
        notes: dto.notes,
      },
    });
  }

  async updateReservationStatus(id: number, status: string) {
    await this.prisma.reservation.update({ where: { id }, data: { status } });
    return { id, status };
  }
}

