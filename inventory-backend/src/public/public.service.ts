// src/public/public.service.ts
// The PUBLIC guest-ordering surface. Every method here is reachable WITHOUT auth
// and is scoped ONLY by an opaque entry token (never an internal id, never
// X-Tenant-Id). Responses are whitelisted DTOs: no internal ids, no cost/stock
// internals, no other-tenant data.
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PublicEntry, PublicEntryKind } from '@prisma/client';
import { CarWashBookingStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GuestOrdersService } from '../guest-orders/guest-orders.service';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { variantAttributeLabel } from '../common/variant-label.util';
import { hospitalityServiceLabel, itemKindsForEntry } from './public.constants';

/** The shape of a ProductUnit row used to build public unit options. */
interface PublicUnitRow {
  unitId: number;
  perBase: number;
  isBase?: boolean | null;
  isDefaultSale?: boolean | null;
  sellPrice?: number | null;
  unit?: { name?: string | null; symbol?: string | null } | null;
}

/** Public-safe per-unit price option (PRODUCT ladders only). */
export interface PublicUnitOption {
  unitId: number;
  name: string;
  symbol: string | null;
  perBase: number;
  isBase: boolean;
  isDefaultSale: boolean;
  /** Effective price for one of this unit (override or base ÷ perBase). */
  price: number;
}

/** Public-safe catalog item. */
export interface PublicItem {
  ref: string; // opaque per-entry item reference (itemKind:itemId)
  kind: string;
  name: string;
  description: string | null;
  price: number;
  /** Display category (product category, menu category, service category). */
  category?: string | null;
  /** Public image URL (served from the catalog-images directory), if any. */
  image: string | null;
  /** PRODUCT only: selectable units with their effective prices. */
  units?: PublicUnitOption[];
  /** PRODUCT only: the selectable variants (expandable in the catalog). */
  variants?: Array<{
    ref: string;
    name: string;
    price: number;
    image: string | null;
    units?: PublicUnitOption[];
  }>;
  meta?: Record<string, unknown>;
}

export interface PublicEntryView {
  kind: PublicEntryKind;
  /** Hospitality service line this QR is scoped to (null for others). */
  serviceType: string | null;
  label: string;
  businessName: string;
  state: 'LIVE' | 'HELD' | 'DROPPED';
  /** TABLE entries identify the table by name only (the guest's identity). */
  tableName: string | null;
  /** True when the guest must fill name/phone (false for F&B on a table). */
  requiresProfile: boolean;
  /** Business-configurable: show prices on the public page. */
  showPrices: boolean;
  /** Business-configurable: show business name/address/phone on the public page. */
  showBusinessInfo: boolean;
  /** Business contact lines for the public header (whitelisted, best effort). */
  businessAddress: string | null;
  businessPhone: string | null;
  items: PublicItem[];
  /**
   * Multi-service hospitality: the catalog grouped per enabled service so the
   * guest page can render tabs (F&B / Rooms / Spa / …). Empty for single-service
   * businesses (the flat `items` above is used).
   */
  services: Array<{ key: string; label: string; items: PublicItem[] }>;
}

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly guestOrders: GuestOrdersService,
  ) {}

  // --- Token resolution -----------------------------------------------------

  /** A public image URL for a stored file name (null when none). */
  private imageUrl(fileName: string | null | undefined): string | null {
    return fileName ? `/api/public/image/${fileName}` : null;
  }

  private roundPublicPrice(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  /**
   * Build the public unit options for a product (or one variant).
   *
   * The effective price mirrors SalesService.deductSaleItem exactly:
   *   variant unit override -> product unit override -> base price ÷ perBase.
   * Per-unit prices are optional; when absent the converted default is shown.
   */
  private publicUnits(
    product: { units?: PublicUnitRow[] | null } | null | undefined,
    basePrice: number,
    variantUnitPrices?: Record<
      string,
      { sellPrice?: number | null } | undefined
    > | null,
    priceOverride?: number | null,
  ): PublicUnitOption[] {
    const rows = product?.units ?? [];
    if (rows.length === 0) return [];
    const base = priceOverride ?? (Number(basePrice) || 0);
    return rows.map((row) => {
      const perBase = Number(row.perBase) || 1;
      const variantOverride =
        variantUnitPrices?.[String(row.unitId)]?.sellPrice;
      const productOverride =
        row.sellPrice === null || row.sellPrice === undefined
          ? null
          : Number(row.sellPrice);
      const price =
        variantOverride !== null && variantOverride !== undefined
          ? Number(variantOverride)
          : productOverride !== null
            ? productOverride
            : base / perBase;
      return {
        unitId: Number(row.unitId),
        name: row.unit?.name ?? '',
        symbol: row.unit?.symbol ?? null,
        perBase,
        isBase: !!row.isBase,
        isDefaultSale: !!row.isDefaultSale,
        price: this.roundPublicPrice(price),
      };
    });
  }

  /** The public-safe view for a token, or a state error when not live. */
  async view(token: string): Promise<PublicEntryView> {
    const entry = await this.resolveEntry(token);
    const business = await this.prisma.organization.findUnique({
      where: { id: entry.tenantId },
      select: {
        name: true,
        businessType: true,
        enabledHospitalityServices: true,
        settings: true,
      },
    });
    const fiscal = await this.prisma.tenantFiscalConfig.findUnique({
      where: { tenantId: entry.tenantId },
      select: { address: true, phone: true },
    });

    const businessType = business?.businessType ?? 'RETAIL';
    const settings = (business?.settings ?? {}) as Record<string, unknown>;
    const showPrices =
      (settings.showPublicPrices as boolean | undefined) ??
      businessType !== 'RETAIL';
    const showBusinessInfo =
      (settings.showPublicBusinessInfo as boolean | undefined) ?? true;

    const state = this.effectiveState(entry);
    // F&B on a table identifies the guest by the table number (typed on the
    // page); every other entry needs a name/phone profile.
    const requiresProfile = entry.kind !== 'TABLE';
    if (state !== 'LIVE') {
      // Still return the shell (so the page can render "temporarily unavailable"),
      // but no catalog.
      return {
        kind: entry.kind,
        serviceType: entry.serviceType ?? null,
        label: entry.label,
        businessName: business?.name ?? '',
        state,
        tableName: entry.table?.name ?? null,
        requiresProfile,
        showPrices,
        showBusinessInfo,
        businessAddress: fiscal?.address ?? null,
        businessPhone: fiscal?.phone ?? null,
        items: [],
        services: [],
      };
    }

    const enabled = business?.enabledHospitalityServices ?? [];
    const all = await this.catalog(entry);
    // Multi-service hospitality shows tabs only for legacy hotel-wide entries
    // (no serviceType). Service-scoped QRs always render their flat catalog.
    const serviceScoped = entry.serviceType != null;
    const services =
      !serviceScoped && businessType === 'HOSPITALITY' && enabled.length > 1
        ? this.groupByService(all, enabled)
        : [];

    return {
      kind: entry.kind,
      serviceType: entry.serviceType ?? null,
      label: entry.label,
      businessName: business?.name ?? '',
      state,
      tableName: entry.table?.name ?? null,
      requiresProfile,
      showPrices,
      showBusinessInfo,
      businessAddress: fiscal?.address ?? null,
      businessPhone: fiscal?.phone ?? null,
      items: services.length ? [] : all,
      services,
    };
  }

  /**
   * Hospitality: group a resolved catalog into the enabled service lines as tabs
   * (F&B menu, rooms, other services). Only lines with content appear.
   */
  private groupByService(
    items: PublicItem[],
    enabled: string[],
  ): Array<{ key: string; label: string; items: PublicItem[] }> {
    const groups: Array<{ key: string; label: string; items: PublicItem[] }> =
      [];
    if (enabled.includes('FOOD_AND_BEVERAGE')) {
      const fb = items.filter((i) => i.kind === 'MENU_ITEM');
      if (fb.length)
        groups.push({
          key: 'FOOD_AND_BEVERAGE',
          label: hospitalityServiceLabel('FOOD_AND_BEVERAGE'),
          items: fb,
        });
    }
    if (enabled.includes('ACCOMMODATION')) {
      const rooms = items.filter((i) => i.kind === 'ROOM_TYPE');
      if (rooms.length)
        groups.push({
          key: 'ACCOMMODATION',
          label: hospitalityServiceLabel('ACCOMMODATION'),
          items: rooms,
        });
    }
    const svc = items.filter((i) => i.kind === 'SERVICE_ITEM');
    if (svc.length)
      groups.push({ key: 'SERVICES', label: 'Services', items: svc });
    return groups;
  }

  private async resolveEntry(
    token: string,
  ): Promise<PublicEntry & { table: { name: string } | null }> {
    const entry = await this.prisma.publicEntry.findUnique({
      where: { token },
      include: { table: { select: { name: true } } },
    });
    if (!entry || !entry.active) throw new NotFoundException('Unknown link');
    return entry;
  }

  private effectiveState(entry: PublicEntry): 'LIVE' | 'HELD' | 'DROPPED' {
    if (entry.state === 'DROPPED') return 'DROPPED';
    const now = Date.now();
    if (entry.liveFrom && now < entry.liveFrom.getTime()) return 'HELD';
    if (entry.liveUntil && now > entry.liveUntil.getTime()) return 'HELD';
    return entry.state === 'HELD' ? 'HELD' : 'LIVE';
  }

  // --- Catalog --------------------------------------------------------------

  /**
   * The full catalog for an entry. When the entry has explicitly published items
   * (curated), those are used; otherwise the catalog is auto-published from the
   * tenant's own data (all active menu items / products / services, and available
   * rooms) so a freshly created QR never shows an empty page.
   */
  private async catalog(entry: PublicEntry): Promise<PublicItem[]> {
    const rows = await this.prisma.publicEntryItem.findMany({
      where: { entryId: entry.id, active: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    if (rows.length > 0) {
      const out: PublicItem[] = [];
      for (const row of rows) {
        const item = await this.resolveItem(
          entry.tenantId,
          row.itemKind,
          row.itemId,
          row.priceOverride,
        );
        if (item) out.push(item);
      }
      return out;
    }
    return this.autoCatalog(entry);
  }

  /** Auto-publish the tenant's catalog for the entry's kind/service scope. */
  private async autoCatalog(entry: PublicEntry): Promise<PublicItem[]> {
    const kinds = itemKindsForEntry(entry.kind, entry.serviceType);
    const out: PublicItem[] = [];
    if (kinds.includes('ROOM_TYPE'))
      out.push(...(await this.availableRooms(entry)));
    if (kinds.includes('MENU_ITEM'))
      out.push(...(await this.autoMenuItems(entry.tenantId)));
    if (kinds.includes('SERVICE_ITEM'))
      out.push(...(await this.autoServiceItems(entry.tenantId)));
    if (kinds.includes('PRODUCT'))
      out.push(...(await this.autoProducts(entry.tenantId)));
    return out;
  }

  /** Room-TYPE catalog from rooms that are FREE for the entry's window. */
  private async availableRooms(entry: PublicEntry): Promise<PublicItem[]> {
    const now = new Date();
    const checkIn = entry.liveFrom ?? now;
    const checkOut =
      entry.liveUntil ?? new Date(now.getTime() + 24 * 60 * 60 * 1000);
    return this.availableRoomTypes(entry.tenantId, checkIn, checkOut);
  }

  /** Room types with at least one free room for the given stay window. */
  private async availableRoomTypes(
    tenantId: number,
    checkIn: Date,
    checkOut: Date,
  ): Promise<PublicItem[]> {
    const busy = await this.prisma.hotelReservation.findMany({
      where: {
        tenantId,
        status: { in: ['CONFIRMED', 'CHECKED_IN'] },
        checkIn: { lt: checkOut },
        checkOut: { gt: checkIn },
      },
      select: { roomId: true },
    });
    const busyIds = new Set(busy.map((b) => b.roomId));

    const roomTypes = await this.prisma.roomType.findMany({
      where: { tenantId },
      include: { rooms: true },
      orderBy: { basePrice: 'asc' },
    });
    const nights = Math.max(
      1,
      Math.round(
        (checkOut.getTime() - checkIn.getTime()) / (24 * 60 * 60 * 1000),
      ),
    );

    const out: PublicItem[] = [];
    for (const rt of roomTypes) {
      const free = rt.rooms.filter((r) => !busyIds.has(r.id));
      if (free.length === 0) continue; // hide taken types
      out.push({
        ref: `ROOM_TYPE:${rt.id}`,
        kind: 'ROOM_TYPE',
        name: rt.name,
        description: rt.description ?? null,
        price: rt.basePrice,
        image: this.imageUrl((rt as { imageUrl?: string | null }).imageUrl),
        meta: {
          nights,
          totalForStay: rt.basePrice * nights,
          availableCount: free.length,
        },
      });
    }
    return out;
  }

  /** Public room availability for the guest-chosen stay window. */
  async roomAvailability(
    token: string,
    checkInStr?: string,
    checkOutStr?: string,
  ) {
    const entry = await this.resolveEntry(token);
    if (entry.kind !== 'HOTEL' && entry.serviceType !== 'ACCOMMODATION') {
      throw new BadRequestException('This link is not a room booking link');
    }
    const checkIn = this.parseDay(checkInStr);
    const checkOut = this.parseDay(checkOutStr);
    if (!checkIn || !checkOut) {
      throw new BadRequestException(
        'Please choose a check-in and check-out date',
      );
    }
    if (checkOut <= checkIn) {
      throw new BadRequestException('Check-out must be after check-in');
    }
    const roomTypes = await this.availableRoomTypes(
      entry.tenantId,
      checkIn,
      checkOut,
    );
    return {
      checkIn,
      checkOut,
      totalAvailable: roomTypes.reduce(
        (s, r) => s + ((r.meta?.availableCount as number) ?? 0),
        0,
      ),
      roomTypes,
    };
  }

  /** All available menu items for a tenant, as public items. */
  private async autoMenuItems(tenantId: number): Promise<PublicItem[]> {
    const rows = await this.prisma.menuItem.findMany({
      where: { tenantId, isAvailable: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        imageUrl: true,
        menuCategory: { select: { name: true } },
      },
    });
    return rows.map((it) => ({
      ref: `MENU_ITEM:${it.id}`,
      kind: 'MENU_ITEM',
      name: it.name,
      description: it.description ?? null,
      price: it.price,
      image: this.imageUrl(it.imageUrl),
      ...(it.menuCategory?.name ? { category: it.menuCategory.name } : {}),
    }));
  }

  /** All active service items for a tenant, as public items. */
  private async autoServiceItems(tenantId: number): Promise<PublicItem[]> {
    const rows = await this.prisma.serviceItem.findMany({
      where: { tenantId, active: true },
      orderBy: [{ id: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        imageUrl: true,
        category: { select: { name: true } },
      },
    });
    return rows.map((it) => ({
      ref: `SERVICE_ITEM:${it.id}`,
      kind: 'SERVICE_ITEM',
      name: it.name,
      description: it.description ?? null,
      price: it.price,
      image: this.imageUrl(it.imageUrl),
      ...(it.category?.name ? { category: it.category.name } : {}),
    }));
  }

  /** All products (with variants) for a tenant, as public items. */
  private async autoProducts(tenantId: number): Promise<PublicItem[]> {
    const rows = await this.prisma.product.findMany({
      where: { tenantId },
      orderBy: [{ id: 'asc' }],
      select: {
        id: true,
        brand: true,
        baseName: true,
        currentSellPrice: true,
        imageUrl: true,
        category: { select: { name: true } },
        units: {
          include: { unit: true },
          orderBy: { sortOrder: 'asc' },
        },
        variants: {
          select: {
            id: true,
            attributes: true,
            sellPrice: true,
            imageUrl: true,
            unitPrices: true,
          },
        },
      },
    });
    return rows.map((it) => {
      const productImage = this.imageUrl(it.imageUrl);
      const productUnits = this.publicUnits(it, it.currentSellPrice ?? 0);
      const variants = (it.variants ?? []).map((v) => ({
        ref: `PRODUCT:${it.id}:VARIANT:${v.id}`,
        name: variantAttributeLabel(v) || `#${v.id}`,
        price: v.sellPrice ?? it.currentSellPrice ?? 0,
        image: this.imageUrl(v.imageUrl) ?? productImage,
        ...(productUnits.length
          ? {
              units: this.publicUnits(
                it,
                v.sellPrice ?? it.currentSellPrice ?? 0,
                (v.unitPrices as Record<string, { sellPrice?: number }>) ??
                  null,
              ),
            }
          : {}),
      }));
      const basePrice = variants.length
        ? Math.min(...variants.map((v) => v.price))
        : (it.currentSellPrice ?? 0);
      return {
        ref: `PRODUCT:${it.id}`,
        kind: 'PRODUCT',
        name: `${it.brand} ${it.baseName}`.trim(),
        description: null,
        price: basePrice,
        image: productImage,
        ...(it.category?.name ? { category: it.category.name } : {}),
        ...(productUnits.length ? { units: productUnits } : {}),
        ...(variants.length ? { variants } : {}),
      };
    });
  }

  /** Flatten a catalog row into a public DTO (display fields only). */
  private async resolveItem(
    tenantId: number,
    kind: string,
    itemId: number,
    priceOverride: number | null,
  ): Promise<PublicItem | null> {
    const price = (fallback: number) => priceOverride ?? fallback;
    switch (kind) {
      case 'MENU_ITEM': {
        const it = await this.prisma.menuItem.findFirst({
          where: { id: itemId, tenantId },
          select: {
            id: true,
            name: true,
            description: true,
            price: true,
            isAvailable: true,
            imageUrl: true,
            menuCategory: { select: { name: true } },
          },
        });
        if (!it || it.isAvailable === false) return null;
        return {
          ref: `MENU_ITEM:${it.id}`,
          kind,
          name: it.name,
          description: it.description ?? null,
          price: price(it.price),
          image: this.imageUrl(it.imageUrl),
          ...(it.menuCategory?.name ? { category: it.menuCategory.name } : {}),
        };
      }
      case 'PRODUCT': {
        const it = await this.prisma.product.findFirst({
          where: { id: itemId, tenantId },
          select: {
            id: true,
            brand: true,
            baseName: true,
            currentSellPrice: true,
            imageUrl: true,
            category: { select: { name: true } },
            units: {
              include: { unit: true },
              orderBy: { sortOrder: 'asc' },
            },
            variants: {
              select: {
                id: true,
                attributes: true,
                sellPrice: true,
                imageUrl: true,
                unitPrices: true,
              },
            },
          },
        });
        if (!it) return null;
        const productImage = this.imageUrl(it.imageUrl);
        const productUnits = this.publicUnits(
          it,
          it.currentSellPrice ?? 0,
          null,
          priceOverride,
        );
        const variants = (it.variants ?? []).map((v) => ({
          ref: `PRODUCT:${it.id}:VARIANT:${v.id}`,
          name: variantAttributeLabel(v) || `#${v.id}`,
          price: price(v.sellPrice ?? it.currentSellPrice ?? 0),
          image: this.imageUrl(v.imageUrl) ?? productImage,
          ...(productUnits.length
            ? {
                units: this.publicUnits(
                  it,
                  v.sellPrice ?? it.currentSellPrice ?? 0,
                  (v.unitPrices as Record<string, { sellPrice?: number }>) ??
                    null,
                  priceOverride,
                ),
              }
            : {}),
        }));
        const basePrice = variants.length
          ? Math.min(...variants.map((v) => v.price))
          : price(it.currentSellPrice ?? 0);
        return {
          ref: `PRODUCT:${it.id}`,
          kind,
          name: `${it.brand} ${it.baseName}`.trim(),
          description: null,
          price: basePrice,
          image: productImage,
          ...(it.category?.name ? { category: it.category.name } : {}),
          ...(productUnits.length ? { units: productUnits } : {}),
          ...(variants.length ? { variants } : {}),
        };
      }
      case 'SERVICE_ITEM': {
        const it = await this.prisma.serviceItem.findFirst({
          where: { id: itemId, tenantId },
          select: {
            id: true,
            name: true,
            description: true,
            price: true,
            active: true,
            imageUrl: true,
            category: { select: { name: true } },
          },
        });
        if (!it || it.active === false) return null;
        return {
          ref: `SERVICE_ITEM:${it.id}`,
          kind,
          name: it.name,
          description: it.description ?? null,
          price: price(it.price),
          image: this.imageUrl(it.imageUrl),
          ...(it.category?.name ? { category: it.category.name } : {}),
        };
      }
      case 'ROOM_TYPE': {
        const rt = await this.prisma.roomType.findFirst({
          where: { id: itemId, tenantId },
          select: {
            id: true,
            name: true,
            description: true,
            basePrice: true,
            imageUrl: true,
          },
        });
        if (!rt) return null;
        return {
          ref: `ROOM_TYPE:${rt.id}`,
          kind,
          name: rt.name,
          description: rt.description ?? null,
          price: price(rt.basePrice),
          image: this.imageUrl(rt.imageUrl),
        };
      }
      default:
        return null;
    }
  }

  // --- Customer autofill ----------------------------------------------------

  /**
   * Autofill by phone: returns only the minimal name for THIS tenant when a
   * customer with that phone exists. Never reveals anything else.
   */
  async lookupCustomer(
    token: string,
    phone: string,
  ): Promise<{ name: string | null }> {
    const entry = await this.resolveEntry(token);
    if (!phone) return { name: null };
    const customer = await this.prisma.customer.findFirst({
      where: { organizationId: entry.tenantId, phone },
      select: { name: true },
    });
    return { name: customer?.name ?? null };
  }

  // --- Order submission -----------------------------------------------------

  /**
   * Submit a guest order/booking. Blocklisted phones are refused. F&B on a table
   * needs no profile; other entries capture name/phone. Persists a GuestOrder
   * (SUBMITTED) with snapshot items and notifies the business's privileged users.
   */
  async submit(
    token: string,
    body: {
      items: Array<{
        ref: string;
        quantity: number;
        unitId?: number;
        notes?: string;
      }>;
      customerName?: string;
      customerPhone?: string;
      tableNumber?: string;
      identityMode?: 'TABLE' | 'PHONE';
      note?: string;
    },
  ) {
    const entry = await this.resolveEntry(token);
    if (this.effectiveState(entry) !== 'LIVE') {
      throw new ForbiddenException(
        'This link is not accepting orders right now',
      );
    }
    if (!body.items || body.items.length === 0) {
      throw new BadRequestException('No items');
    }

    // Blocklist check (by phone).
    if (body.customerPhone) {
      const blocked = await this.prisma.guestBlocklist.findFirst({
        where: { tenantId: entry.tenantId, phone: body.customerPhone },
        select: { id: true },
      });
      if (blocked)
        throw new ForbiddenException('Ordering is unavailable for this number');
    }

    const isFoodAndBeverage =
      entry.serviceType === 'FOOD_AND_BEVERAGE' || entry.kind === 'TABLE';
    const name = body.customerName?.trim();
    const phone = body.customerPhone?.trim();
    const tableNumber = body.tableNumber?.trim();

    if (isFoodAndBeverage) {
      // F&B guests identify themselves by table (dine-in) OR phone (take-away).
      if (!tableNumber && !phone) {
        throw new BadRequestException(
          'Please provide a table number or your phone number',
        );
      }
    } else {
      // Other entries identify the guest by name/phone; require at least one.
      if (!name && !phone) {
        throw new BadRequestException(
          'Please provide your name or phone number',
        );
      }
    }

    // Resolve each ref (kind:id) against the entry's own catalog/published items
    // so a guest can only order what that entry exposes.
    const catalog = await this.catalogMap(entry);
    const items = body.items.map((line) => {
      const item = catalog.get(line.ref);
      if (!item) throw new BadRequestException(`Unknown item ${line.ref}`);

      // PRODUCT lines may offer a unit ladder. Resolve the guest's choice
      // against that product's own ladder; fall back to the default-sale unit
      // for older clients that do not send one.
      const units = item.units ?? [];
      let selectedUnit = units.find(
        (unit) => unit.unitId === Number(line.unitId),
      );
      if (line.unitId != null && !selectedUnit) {
        throw new BadRequestException(
          `The selected unit is not available for this product.`,
        );
      }
      if (!selectedUnit && units.length > 0) {
        selectedUnit =
          units.find((unit) => unit.isDefaultSale) ??
          units.find((unit) => unit.isBase) ??
          units[0];
      }

      // Variant refs look like PRODUCT:<id>:VARIANT:<variantId>.
      const parts = item.ref.split(':');
      const variantId =
        parts[2] === 'VARIANT' && Number.isInteger(Number(parts[3]))
          ? Number(parts[3])
          : null;

      return {
        itemKind: item.kind,
        itemId: Number(parts[1]),
        variantId,
        nameSnapshot: item.name,
        quantity: Math.max(1, Math.floor(Number(line.quantity) || 1)),
        // The unit's own price (explicit override or base ÷ perBase).
        unitPrice: selectedUnit ? selectedUnit.price : item.price,
        unitId: selectedUnit?.unitId ?? null,
        unitNameSnapshot: selectedUnit?.name ?? null,
        notes: line.notes ?? null,
      };
    });
    const totalAmount = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

    // Link a known customer by phone (F&B-on-table has none).
    let customerId: number | null = null;
    if (body.customerPhone) {
      const cust = await this.prisma.customer.findFirst({
        where: { organizationId: entry.tenantId, phone: body.customerPhone },
        select: { id: true },
      });
      customerId = cust?.id ?? null;
    }

    const created = await this.prisma.guestOrder.create({
      data: {
        token: crypto.randomUUID(),
        entryId: entry.id,
        tenantId: entry.tenantId,
        status: 'SUBMITTED',
        customerId,
        customerName: name || null,
        customerPhone: phone || null,
        tableNumber: isFoodAndBeverage ? tableNumber || null : null,
        note: body.note?.trim() || null,
        totalAmount,
        items: { create: items },
        activities: {
          create: { action: 'SUBMITTED', note: null },
        },
      },
      include: { items: true },
    });

    // Notify the business's privileged users (owners/managers) that a new guest
    // order arrived.
    await this.notifications
      .notifyOwner(
        'New guest order',
        `${entry.label}: ${items.length} item(s), ${totalAmount} total.`,
        {
          type: 'GUEST_ORDER',
          link: '/dashboard/guest-orders',
          dedupeKey: `GUEST_ORDER:${created.id}`,
        },
      )
      .catch(() => {});

    // Owner may have enabled auto-approve for this entry (skip the manual gate).
    await this.guestOrders
      .maybeAutoApprove(created.id, entry.tenantId)
      .catch(() => {});

    return { token: created.token, status: created.status, totalAmount };
  }

  /** Reject blocklisted phone numbers for a tenant. */
  private async assertPhoneAllowed(tenantId: number, phone?: string) {
    if (!phone) return;
    const blocked = await this.prisma.guestBlocklist.findFirst({
      where: { tenantId, phone },
      select: { id: true },
    });
    if (blocked) {
      throw new ForbiddenException('Booking is unavailable for this number');
    }
  }

  /** Shared post-submit notification + auto-approve pass. */
  private async afterGuestOrder(
    orderId: number,
    tenantId: number,
    title: string,
    message: string,
    type: string,
    link: string,
  ) {
    await this.notifications
      .notifyOwner(title, message, {
        type,
        link,
        dedupeKey: `${type}:${orderId}`,
      })
      .catch(() => {});
    await this.guestOrders.maybeAutoApprove(orderId, tenantId).catch(() => {});
  }

  /**
   * Parse a calendar date from either a date-only string (YYYY-MM-DD) or a full
   * ISO string, normalizing to UTC midnight so a time-of-day / timezone offset
   * can never make check-out compare as before check-in.
   */
  private parseDay(value?: string): Date | null {
    if (!value) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
    if (m) {
      return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    }
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    );
  }

  /**
   * Submit a public room reservation. Validates the room-type ref against the
   * entry's own catalog and stores the guest-chosen check-in/check-out window.
   */
  async reserve(
    token: string,
    body: {
      roomTypeRef?: string;
      checkIn?: string;
      checkOut?: string;
      guestName?: string;
      phone?: string;
      notes?: string;
    },
  ) {
    const entry = await this.resolveEntry(token);
    if (this.effectiveState(entry) !== 'LIVE') {
      throw new ForbiddenException(
        'This link is not accepting bookings right now',
      );
    }
    const name = body.guestName?.trim() ?? '';
    const phone = body.phone?.trim() ?? '';
    if (!name && !phone) {
      throw new BadRequestException('Please provide your name or phone number');
    }
    await this.assertPhoneAllowed(entry.tenantId, phone || undefined);

    if (!body.roomTypeRef) {
      throw new BadRequestException('Please choose a room type');
    }
    const checkIn = this.parseDay(body.checkIn);
    const checkOut = this.parseDay(body.checkOut);
    if (!checkIn || !checkOut) {
      throw new BadRequestException(
        'Please choose a check-in and check-out date',
      );
    }
    if (checkOut <= checkIn) {
      throw new BadRequestException('Check-out must be after check-in');
    }

    const catalog = await this.catalogMap(entry);
    const item = catalog.get(body.roomTypeRef);
    if (!item || item.kind !== 'ROOM_TYPE') {
      throw new BadRequestException('Unknown room type');
    }

    let customerId: number | null = null;
    if (phone) {
      const cust = await this.prisma.customer.findFirst({
        where: { organizationId: entry.tenantId, phone },
        select: { id: true },
      });
      customerId = cust?.id ?? null;
    }

    const nights = Math.max(
      1,
      Math.round(
        (checkOut.getTime() - checkIn.getTime()) / (24 * 60 * 60 * 1000),
      ),
    );
    const totalAmount = item.price * nights;

    const created = await this.prisma.guestOrder.create({
      data: {
        token: crypto.randomUUID(),
        entryId: entry.id,
        tenantId: entry.tenantId,
        status: 'SUBMITTED',
        customerId,
        customerName: name || null,
        customerPhone: phone || null,
        checkIn,
        checkOut,
        note: body.notes?.trim() || null,
        totalAmount,
        items: {
          create: [
            {
              itemKind: 'ROOM_TYPE',
              itemId: Number(item.ref.split(':')[1]),
              nameSnapshot: item.name,
              quantity: 1,
              unitPrice: item.price,
              notes: null,
            },
          ],
        },
        activities: { create: { action: 'SUBMITTED', note: null } },
      },
      include: { items: true },
    });

    await this.afterGuestOrder(
      created.id,
      entry.tenantId,
      'New room reservation',
      `${entry.label}: ${item.name}, ${nights} night(s).`,
      'GUEST_ORDER',
      '/dashboard/guest-orders',
    );

    return { token: created.token, status: created.status, totalAmount };
  }

  /**
   * Submit a public service booking (spa/gym/pool/events/custom and the SERVICE
   * vertical). Validates the service-item ref against the entry catalog and
   * stores the guest-chosen start time.
   */
  async serviceBooking(
    token: string,
    body: {
      serviceItemRef?: string;
      startsAt?: string;
      guestName?: string;
      phone?: string;
      notes?: string;
    },
  ) {
    const entry = await this.resolveEntry(token);
    if (this.effectiveState(entry) !== 'LIVE') {
      throw new ForbiddenException(
        'This link is not accepting bookings right now',
      );
    }
    const name = body.guestName?.trim() ?? '';
    const phone = body.phone?.trim() ?? '';
    if (!name && !phone) {
      throw new BadRequestException('Please provide your name or phone number');
    }
    await this.assertPhoneAllowed(entry.tenantId, phone || undefined);

    if (!body.serviceItemRef) {
      throw new BadRequestException('Please choose a service');
    }
    const startsAt = new Date(body.startsAt ?? '');
    if (Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException('Please choose a booking time');
    }

    const catalog = await this.catalogMap(entry);
    const item = catalog.get(body.serviceItemRef);
    if (!item || item.kind !== 'SERVICE_ITEM') {
      throw new BadRequestException('Unknown service');
    }

    let customerId: number | null = null;
    if (phone) {
      const cust = await this.prisma.customer.findFirst({
        where: { organizationId: entry.tenantId, phone },
        select: { id: true },
      });
      customerId = cust?.id ?? null;
    }

    const created = await this.prisma.guestOrder.create({
      data: {
        token: crypto.randomUUID(),
        entryId: entry.id,
        tenantId: entry.tenantId,
        status: 'SUBMITTED',
        customerId,
        customerName: name || null,
        customerPhone: phone || null,
        startsAt,
        note: body.notes?.trim() || null,
        totalAmount: item.price,
        items: {
          create: [
            {
              itemKind: 'SERVICE_ITEM',
              itemId: Number(item.ref.split(':')[1]),
              nameSnapshot: item.name,
              quantity: 1,
              unitPrice: item.price,
              notes: null,
            },
          ],
        },
        activities: { create: { action: 'SUBMITTED', note: null } },
      },
      include: { items: true },
    });

    await this.afterGuestOrder(
      created.id,
      entry.tenantId,
      'New service booking',
      `${entry.label}: ${item.name}, ${startsAt.toLocaleString()}.`,
      'GUEST_ORDER',
      '/dashboard/guest-orders',
    );

    return {
      token: created.token,
      status: created.status,
      totalAmount: item.price,
    };
  }

  /** The guest's own order status (by its opaque token). */
  async orderStatus(token: string) {
    const order = await this.prisma.guestOrder.findUnique({
      where: { token },
      include: { entry: { select: { label: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    return {
      status: order.status,
      label: order.entry.label,
      totalAmount: order.totalAmount,
      createdAt: order.createdAt,
    };
  }

  /** Build a ref->publicItem map for the entry (the allowed order set). */
  private async catalogMap(
    entry: PublicEntry,
  ): Promise<Map<string, PublicItem>> {
    // Resolve the catalog the same way `view()` does, then index every
    // selectable ref — including variant refs — so a guest can only order what
    // this entry actually offers.
    const org = await this.prisma.organization.findUnique({
      where: { id: entry.tenantId },
      select: { businessType: true, enabledHospitalityServices: true },
    });
    const businessType = org?.businessType ?? 'RETAIL';
    const enabled = org?.enabledHospitalityServices ?? [];
    const all = await this.catalog(entry);
    const groups =
      businessType === 'HOSPITALITY' && enabled.length > 1
        ? this.groupByService(all, enabled)
        : [];
    const map = new Map<string, PublicItem>();
    for (const item of [...all, ...groups.flatMap((g) => g.items)]) {
      map.set(item.ref, item);
      // Index variants as their own orderable refs (name/price from the variant).
      for (const v of item.variants ?? []) {
        map.set(v.ref, {
          ...item,
          ref: v.ref,
          name: `${item.name} — ${v.name}`,
          price: v.price,
          image: v.image,
          units: v.units ?? item.units,
          variants: undefined,
        });
      }
    }
    return map;
  }

  // --- Car-wash public booking ---------------------------------------------

  /** The entry must be a car-wash bay link. */
  private async carwashEntry(token: string) {
    const entry = await this.resolveEntry(token);
    if (entry.kind !== 'CARWASH_BAY') {
      throw new BadRequestException('This link is not a car wash booking link');
    }
    return entry;
  }

  /** Overlap check for a washer in a time slot (mirrors CarWashService). */
  private async carwashAvailabilityForTenant(
    tenantId: number,
    washerId: number,
    startsAt: string,
    slotMinutes?: number,
    vehicleType?: string,
    washTypeId?: number,
  ): Promise<boolean> {
    const start = new Date(startsAt);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('Invalid booking time');
    }
    const mins =
      slotMinutes ??
      (await this.carwashDurationFor(tenantId, vehicleType, washTypeId));
    const end = new Date(start.getTime() + mins * 60 * 1000);
    return !(await this.carwashWasherBusy(tenantId, washerId, start, end));
  }

  /**
   * True when the washer already has an active booking job overlapping
   * [start, end) — checking the booking header and each vehicle line's own
   * washer/helpers with the line's start time + wash duration.
   */
  private async carwashWasherBusy(
    tenantId: number,
    washerId: number,
    start: Date,
    end: Date,
  ): Promise<boolean> {
    const active = [
      CarWashBookingStatus.PENDING,
      CarWashBookingStatus.BOOKED,
      CarWashBookingStatus.SERVED,
    ];
    const candidates = await this.prisma.carWashBooking.findMany({
      where: {
        tenantId,
        status: { in: active },
        OR: [{ washerId }, { items: { some: { washerId } } }],
      },
      include: {
        items: {
          select: {
            washerId: true,
            startsAt: true,
            vehicleType: true,
            washTypeId: true,
          },
        },
      },
    });
    if (candidates.length === 0) return false;

    const prices = await this.prisma.carWashPrice.findMany({
      where: { tenantId },
      select: { vehicleType: true, washTypeId: true, durationMinutes: true },
    });
    const dur = (vt: string | null, wt: number | null) => {
      const p = prices.find(
        (x) =>
          x.vehicleType.toLowerCase() === (vt ?? '').toLowerCase() &&
          String(x.washTypeId ?? '') === String(wt ?? ''),
      );
      return p?.durationMinutes ?? 45;
    };

    for (const b of candidates) {
      if (b.washerId === washerId) {
        const bEnd =
          b.endsAt ??
          new Date(b.startsAt.getTime() + dur(b.vehicleType, null) * 60000);
        if (b.startsAt < end && bEnd > start) return true;
      }
      for (const it of b.items) {
        if (it.washerId !== washerId) continue;
        const itStart = it.startsAt ?? b.startsAt;
        const itEnd = new Date(
          itStart.getTime() + dur(it.vehicleType, it.washTypeId) * 60000,
        );
        if (itStart < end && itEnd > start) return true;
      }
    }
    return false;
  }

  /**
   * The slot length for a vehicle/wash combination: the price's
   * `durationMinutes` when set, otherwise the default 45 minutes.
   */
  private async carwashDurationFor(
    tenantId: number,
    vehicleType?: string,
    washTypeId?: number | null,
  ): Promise<number> {
    const DEFAULT_SLOT = 45;
    if (!vehicleType) return DEFAULT_SLOT;
    const price = await this.prisma.carWashPrice.findFirst({
      where: { tenantId, vehicleType, washTypeId: washTypeId ?? null },
      select: { durationMinutes: true },
    });
    return price?.durationMinutes ?? DEFAULT_SLOT;
  }

  /** Public-safe booking options for a car-wash QR link. */
  async carwashOptions(token: string) {
    const entry = await this.carwashEntry(token);
    const org = await this.prisma.organization.findUnique({
      where: { id: entry.tenantId },
      select: { name: true, businessType: true, settings: true },
    });
    if (org?.businessType !== 'CAR_WASH') {
      throw new BadRequestException('This link is not a car wash link');
    }
    const fiscal = await this.prisma.tenantFiscalConfig.findUnique({
      where: { tenantId: entry.tenantId },
      select: { address: true, phone: true },
    });
    const settings = (org?.settings ?? {}) as Record<string, unknown>;
    const profile = await this.prisma.carWashProfile.findUnique({
      where: { organizationId: entry.tenantId },
    });
    const [vehicleTypes, washTypes, prices, washers] = await Promise.all([
      this.prisma.carWashVehicleType.findMany({
        where: { tenantId: entry.tenantId },
        orderBy: { name: 'asc' },
        select: { name: true },
      }),
      this.prisma.carWashWashType.findMany({
        where: { tenantId: entry.tenantId },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      this.prisma.carWashPrice.findMany({
        where: { tenantId: entry.tenantId },
        select: {
          vehicleType: true,
          washTypeId: true,
          amount: true,
          durationMinutes: true,
        },
      }),
      this.prisma.carWashWasher.findMany({
        where: { tenantId: entry.tenantId, isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
    ]);

    return {
      kind: entry.kind,
      label: entry.label,
      businessName: org?.name ?? '',
      state: this.effectiveState(entry),
      showPrices: (settings.showPublicPrices as boolean | undefined) ?? true,
      showBusinessInfo:
        (settings.showPublicBusinessInfo as boolean | undefined) ?? true,
      businessAddress: fiscal?.address ?? null,
      businessPhone: fiscal?.phone ?? null,
      slotMinutes: profile?.slotMinutes ?? 45,
      vehicleTypes: vehicleTypes.map((v) => v.name),
      washTypes,
      prices,
      washers,
    };
  }

  /** Check a washer's availability for a slot (public, token-scoped). */
  async carwashAvailability(
    token: string,
    washerId: number,
    startsAt: string,
    slotMinutes?: number,
    vehicleType?: string,
    washTypeId?: number,
  ) {
    const entry = await this.carwashEntry(token);
    if (!washerId || Number.isNaN(washerId)) {
      throw new BadRequestException('Washer is required');
    }
    const washer = await this.prisma.carWashWasher.findFirst({
      where: { id: washerId, tenantId: entry.tenantId, isActive: true },
      select: { id: true },
    });
    if (!washer) throw new BadRequestException('Washer not available');
    const available = await this.carwashAvailabilityForTenant(
      entry.tenantId,
      washerId,
      startsAt,
      slotMinutes,
      vehicleType,
      washTypeId,
    );
    const mins =
      slotMinutes ??
      (await this.carwashDurationFor(entry.tenantId, vehicleType, washTypeId));
    return { available, slotMinutes: mins };
  }

  /** Submit a public car-wash booking. */
  async carwashBooking(
    token: string,
    body: {
      name?: string;
      phone?: string;
      plateNumber?: string;
      vehicleType?: string;
      washTypeId?: number;
      washerId?: number;
      startsAt?: string;
      notes?: string;
      items?: Array<{
        vehicleType?: string;
        washTypeId?: number;
        plateNumber?: string;
        washerId?: number;
        amount?: number;
        startsAt?: string;
      }>;
    },
  ) {
    const entry = await this.carwashEntry(token);
    if (this.effectiveState(entry) !== 'LIVE') {
      throw new ForbiddenException(
        'This link is not accepting bookings right now',
      );
    }
    const name = body.name?.trim() ?? '';
    const phone = body.phone?.trim() ?? '';
    if (!name && !phone) {
      throw new BadRequestException('Please provide your name or phone number');
    }
    if (phone) {
      const blocked = await this.prisma.guestBlocklist.findFirst({
        where: { tenantId: entry.tenantId, phone },
        select: { id: true },
      });
      if (blocked) {
        throw new ForbiddenException('Booking is unavailable for this number');
      }
    }

    const startsAt = new Date(body.startsAt ?? '');
    if (Number.isNaN(startsAt.getTime())) {
      throw new BadRequestException('Please choose a booking time');
    }

    const lines =
      body.items && body.items.length > 0
        ? body.items
        : [
            {
              vehicleType: body.vehicleType,
              washTypeId: body.washTypeId,
              plateNumber: body.plateNumber,
              amount: undefined as number | undefined,
            },
          ];

    const prices = await this.prisma.carWashPrice.findMany({
      where: { tenantId: entry.tenantId },
      select: {
        vehicleType: true,
        washTypeId: true,
        amount: true,
        durationMinutes: true,
      },
    });
    const priceFor = (vehicleType: string, washTypeId: number | null) => {
      const p = prices.find(
        (x) =>
          String(x.vehicleType ?? '').toLowerCase() ===
            vehicleType.toLowerCase() &&
          String(x.washTypeId ?? '') === String(washTypeId ?? ''),
      );
      return p ? p.amount : 0;
    };
    const durationFor = (vehicleType: string, washTypeId: number | null) => {
      const p = prices.find(
        (x) =>
          String(x.vehicleType ?? '').toLowerCase() ===
            vehicleType.toLowerCase() &&
          String(x.washTypeId ?? '') === String(washTypeId ?? ''),
      );
      return p?.durationMinutes ?? 45;
    };
    const washTypes = await this.prisma.carWashWashType.findMany({
      where: { tenantId: entry.tenantId },
      select: { id: true, name: true },
    });
    const washTypeName = (id: number | null) =>
      id == null ? null : (washTypes.find((w) => w.id === id)?.name ?? null);

    const defaultWasherId = body.washerId ? Number(body.washerId) : null;

    // Resolve each vehicle line into a guest-order item. The full booking
    // payload is stored as JSON in each item's notes so the conversion step can
    // register the actual CarWashBooking when the owner accepts the order.
    const orderItems: Array<{
      itemKind: string;
      itemId: number | null;
      nameSnapshot: string;
      quantity: number;
      unitPrice: number;
      notes: string;
    }> = [];
    let totalAmount = 0;
    let headerStartsAt = startsAt;
    for (const line of lines) {
      const vehicleType = line.vehicleType?.trim() || 'Car';
      const washTypeId = line.washTypeId ? Number(line.washTypeId) : null;
      const plate = line.plateNumber?.trim() || null;
      const lineStartsAt = line.startsAt ? new Date(line.startsAt) : startsAt;
      if (Number.isNaN(lineStartsAt.getTime())) {
        throw new BadRequestException('Please choose a booking time');
      }
      if (lineStartsAt.getTime() < headerStartsAt.getTime()) {
        headerStartsAt = lineStartsAt;
      }

      // Resolve this line's washer and verify availability over the wash's
      // actual duration (price-based, default 45 min).
      const washerId = line.washerId ? Number(line.washerId) : defaultWasherId;
      if (washerId) {
        const washer = await this.prisma.carWashWasher.findFirst({
          where: { id: washerId, tenantId: entry.tenantId, isActive: true },
          select: { id: true },
        });
        if (!washer) throw new BadRequestException('Washer not available');
        const available = await this.carwashAvailabilityForTenant(
          entry.tenantId,
          washerId,
          lineStartsAt.toISOString(),
          durationFor(vehicleType, washTypeId),
        );
        if (!available) {
          throw new BadRequestException(
            'This washer is not available at that time',
          );
        }
      }

      const amount = Number(line.amount) || priceFor(vehicleType, washTypeId);
      totalAmount += amount;
      const nameSnapshot =
        [vehicleType, washTypeName(washTypeId)].filter(Boolean).join(' — ') ||
        'Car wash';
      orderItems.push({
        itemKind: 'CARWASH_ITEM',
        itemId: washTypeId,
        nameSnapshot,
        quantity: 1,
        unitPrice: amount,
        notes: JSON.stringify({
          vehicleType,
          plateNumber: plate,
          washTypeId,
          washerId,
          amount,
          startsAt: lineStartsAt.toISOString(),
        }),
      });
    }

    // Link a known customer by phone so the guest order shows their details.
    let customerId: number | null = null;
    if (phone) {
      const cust = await this.prisma.customer.findFirst({
        where: { organizationId: entry.tenantId, phone },
        select: { id: true },
      });
      customerId = cust?.id ?? null;
    }

    // The public booking becomes a SUBMITTED guest order; the owner accepts it
    // in the guest-orders inbox, which registers the CarWashBooking row.
    const created = await this.prisma.guestOrder.create({
      data: {
        token: crypto.randomUUID(),
        entryId: entry.id,
        tenantId: entry.tenantId,
        status: 'SUBMITTED',
        customerId,
        customerName: name || null,
        customerPhone: phone || null,
        startsAt: headerStartsAt,
        note: body.notes?.trim() || null,
        totalAmount,
        items: { create: orderItems },
        activities: { create: { action: 'SUBMITTED', note: null } },
      },
      include: { items: true },
    });

    await this.afterGuestOrder(
      created.id,
      entry.tenantId,
      'New car wash booking',
      `${entry.label}: ${orderItems.length} vehicle(s), ${totalAmount} total.`,
      'GUEST_ORDER',
      '/dashboard/guest-orders',
    );

    return { token: created.token, status: created.status, totalAmount };
  }
}
