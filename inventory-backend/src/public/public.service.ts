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
import { tenantContext } from '../common/tenant/tenant.context';
import { variantAttributeLabel } from '../common/variant-label.util';
import { catalogsForKind } from './public.constants';

/** Public-safe catalog item. */
interface PublicItem {
  ref: string; // opaque per-entry item reference (itemKind:itemId)
  kind: string;
  name: string;
  description: string | null;
  price: number;
  /** Public image URL (served from the catalog-images directory), if any. */
  image: string | null;
  /** PRODUCT only: the selectable variants (expandable in the catalog). */
  variants?: Array<{ ref: string; name: string; price: number; image: string | null }>;
  meta?: Record<string, unknown>;
}

export interface PublicEntryView {
  kind: PublicEntryKind;
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
    // Multi-service hospitality shows tabs; everyone else a flat catalog.
    const services =
      businessType === 'HOSPITALITY' && enabled.length > 1
        ? this.groupByService(all, enabled)
        : [];

    return {
      kind: entry.kind,
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
    const groups: Array<{ key: string; label: string; items: PublicItem[] }> = [];
    if (enabled.includes('FOOD_AND_BEVERAGE')) {
      const fb = items.filter((i) => i.kind === 'MENU_ITEM');
      if (fb.length) groups.push({ key: 'FOOD_AND_BEVERAGE', label: 'Food & Beverage', items: fb });
    }
    if (enabled.includes('ACCOMMODATION')) {
      const rooms = items.filter((i) => i.kind === 'ROOM_TYPE');
      if (rooms.length) groups.push({ key: 'ACCOMMODATION', label: 'Rooms', items: rooms });
    }
    const svc = items.filter((i) => i.kind === 'SERVICE_ITEM');
    if (svc.length) groups.push({ key: 'SERVICES', label: 'Services', items: svc });
    return groups;
  }

  private async resolveEntry(token: string): Promise<
    PublicEntry & { table: { name: string } | null }
  > {
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
        const item = await this.resolveItem(entry.tenantId, row.itemKind, row.itemId, row.priceOverride);
        if (item) out.push(item);
      }
      return out;
    }
    return this.autoCatalog(entry);
  }

  /** Auto-publish the tenant's catalog for the entry's kind. */
  private async autoCatalog(entry: PublicEntry): Promise<PublicItem[]> {
    const kinds = catalogsForKind(entry.kind);
    const out: PublicItem[] = [];
    if (kinds.includes('ROOM_TYPE')) out.push(...(await this.availableRooms(entry)));
    if (kinds.includes('MENU_ITEM')) out.push(...(await this.autoMenuItems(entry.tenantId)));
    if (kinds.includes('SERVICE_ITEM')) out.push(...(await this.autoServiceItems(entry.tenantId)));
    if (kinds.includes('PRODUCT')) out.push(...(await this.autoProducts(entry.tenantId)));
    return out;
  }

  /** Room-TYPE catalog from rooms that are FREE for the requested window. */
  private async availableRooms(entry: PublicEntry): Promise<PublicItem[]> {
    const tenantId = entry.tenantId;
    const now = new Date();
    const checkIn = entry.liveFrom ?? now;
    const checkOut = entry.liveUntil ?? new Date(now.getTime() + 24 * 60 * 60 * 1000);

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
      Math.round((checkOut.getTime() - checkIn.getTime()) / (24 * 60 * 60 * 1000)),
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
        meta: { nights, totalForStay: rt.basePrice * nights, availableCount: free.length },
      });
    }
    return out;
  }

  /** All available menu items for a tenant, as public items. */
  private async autoMenuItems(tenantId: number): Promise<PublicItem[]> {
    const rows = await this.prisma.menuItem.findMany({
      where: { tenantId, isAvailable: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, description: true, price: true, imageUrl: true },
    });
    return rows.map((it) => ({
      ref: `MENU_ITEM:${it.id}`,
      kind: 'MENU_ITEM',
      name: it.name,
      description: it.description ?? null,
      price: it.price,
      image: this.imageUrl(it.imageUrl),
    }));
  }

  /** All active service items for a tenant, as public items. */
  private async autoServiceItems(tenantId: number): Promise<PublicItem[]> {
    const rows = await this.prisma.serviceItem.findMany({
      where: { tenantId, active: true },
      orderBy: [{ id: 'asc' }],
      select: { id: true, name: true, description: true, price: true, imageUrl: true },
    });
    return rows.map((it) => ({
      ref: `SERVICE_ITEM:${it.id}`,
      kind: 'SERVICE_ITEM',
      name: it.name,
      description: it.description ?? null,
      price: it.price,
      image: this.imageUrl(it.imageUrl),
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
        variants: { select: { id: true, attributes: true, sellPrice: true, imageUrl: true } },
      },
    });
    return rows.map((it) => {
      const productImage = this.imageUrl(it.imageUrl);
      const variants = (it.variants ?? []).map((v) => ({
        ref: `PRODUCT:${it.id}:VARIANT:${v.id}`,
        name: variantAttributeLabel(v) || `#${v.id}`,
        price: v.sellPrice ?? it.currentSellPrice ?? 0,
        image: this.imageUrl(v.imageUrl) ?? productImage,
      }));
      const basePrice = variants.length
        ? Math.min(...variants.map((v) => v.price))
        : it.currentSellPrice ?? 0;
      return {
        ref: `PRODUCT:${it.id}`,
        kind: 'PRODUCT',
        name: `${it.brand} ${it.baseName}`.trim(),
        description: null,
        price: basePrice,
        image: productImage,
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
          select: { id: true, name: true, description: true, price: true, isAvailable: true, imageUrl: true },
        });
        if (!it || it.isAvailable === false) return null;
        return {
          ref: `MENU_ITEM:${it.id}`,
          kind,
          name: it.name,
          description: it.description ?? null,
          price: price(it.price),
          image: this.imageUrl(it.imageUrl),
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
            variants: {
              select: { id: true, attributes: true, sellPrice: true, imageUrl: true },
            },
          },
        });
        if (!it) return null;
        const productImage = this.imageUrl(it.imageUrl);
        const variants = (it.variants ?? []).map((v) => ({
          ref: `PRODUCT:${it.id}:VARIANT:${v.id}`,
          name: variantAttributeLabel(v) || `#${v.id}`,
          price: price(v.sellPrice ?? it.currentSellPrice ?? 0),
          image: this.imageUrl(v.imageUrl) ?? productImage,
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
          ...(variants.length ? { variants } : {}),
        };
      }
      case 'SERVICE_ITEM': {
        const it = await this.prisma.serviceItem.findFirst({
          where: { id: itemId, tenantId },
          select: { id: true, name: true, description: true, price: true, active: true, imageUrl: true },
        });
        if (!it || it.active === false) return null;
        return {
          ref: `SERVICE_ITEM:${it.id}`,
          kind,
          name: it.name,
          description: it.description ?? null,
          price: price(it.price),
          image: this.imageUrl(it.imageUrl),
        };
      }
      case 'ROOM_TYPE': {
        const rt = await this.prisma.roomType.findFirst({
          where: { id: itemId, tenantId },
          select: { id: true, name: true, description: true, basePrice: true, imageUrl: true },
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
  async lookupCustomer(token: string, phone: string): Promise<{ name: string | null }> {
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
      items: Array<{ ref: string; quantity: number; notes?: string }>;
      customerName?: string;
      customerPhone?: string;
      note?: string;
    },
  ) {
    const entry = await this.resolveEntry(token);
    if (this.effectiveState(entry) !== 'LIVE') {
      throw new ForbiddenException('This link is not accepting orders right now');
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
      if (blocked) throw new ForbiddenException('Ordering is unavailable for this number');
    }

    // Non-table entries identify the guest by name/phone; require at least one.
    if (entry.kind !== 'TABLE') {
      const name = body.customerName?.trim();
      const phone = body.customerPhone?.trim();
      if (!name && !phone) {
        throw new BadRequestException('Please provide your name or phone number');
      }
    }

    // Resolve each ref (kind:id) against the entry's own catalog/published items
    // so a guest can only order what that entry exposes.
    const catalog = await this.catalogMap(entry);
    const items = body.items.map((line) => {
      const item = catalog.get(line.ref);
      if (!item) throw new BadRequestException(`Unknown item ${line.ref}`);
      return {
        itemKind: item.kind,
        itemId: Number(item.ref.split(':')[1]),
        nameSnapshot: item.name,
        quantity: Math.max(1, Math.floor(Number(line.quantity) || 1)),
        unitPrice: item.price,
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
        customerName: entry.kind === 'TABLE' ? null : body.customerName?.trim() || null,
        customerPhone: entry.kind === 'TABLE' ? null : body.customerPhone?.trim() || null,
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
    await this.guestOrders.maybeAutoApprove(created.id, entry.tenantId).catch(() => {});

    return { token: created.token, status: created.status, totalAmount };
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
  private async catalogMap(entry: PublicEntry): Promise<Map<string, PublicItem>> {
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
  ): Promise<boolean> {
    const start = new Date(startsAt);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('Invalid booking time');
    }
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
    return overlapping.length === 0;
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
        select: { vehicleType: true, washTypeId: true, amount: true },
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
      slotMinutes: profile?.slotMinutes ?? 30,
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
    );
    return { available, slotMinutes: slotMinutes ?? 30 };
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
        amount?: number;
      }>;
    },
  ) {
    const entry = await this.carwashEntry(token);
    if (this.effectiveState(entry) !== 'LIVE') {
      throw new ForbiddenException('This link is not accepting bookings right now');
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

    const profile = await this.prisma.carWashProfile.findUnique({
      where: { organizationId: entry.tenantId },
    });
    const slotMinutes = profile?.slotMinutes ?? 30;
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
      select: { vehicleType: true, washTypeId: true, amount: true },
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

    let washerId: number | null = null;
    if (body.washerId) {
      washerId = Number(body.washerId);
      const washer = await this.prisma.carWashWasher.findFirst({
        where: { id: washerId, tenantId: entry.tenantId, isActive: true },
        select: { id: true },
      });
      if (!washer) throw new BadRequestException('Washer not available');
      const available = await this.carwashAvailabilityForTenant(
        entry.tenantId,
        washerId,
        startsAt.toISOString(),
        slotMinutes,
      );
      if (!available) {
        throw new BadRequestException('This washer is not available at that time');
      }
    }

    const resolved: Array<{
      vehicleId: number | null;
      vehicleType: string;
      washTypeId: number | null;
      amount: number;
      startsAt: Date;
      date: Date;
    }> = [];
    let totalAmount = 0;
    for (const line of lines) {
      const vehicleType = line.vehicleType?.trim() || 'Car';
      const washTypeId = line.washTypeId ? Number(line.washTypeId) : null;
      const plate = line.plateNumber?.trim();
      let vehicleId: number | null = null;
      if (plate) {
        let vehicle = await this.prisma.carWashVehicle.findFirst({
          where: { tenantId: entry.tenantId, plateNumber: plate },
          select: { id: true },
        });
        if (!vehicle) {
          vehicle = await this.prisma.carWashVehicle.create({
            data: {
              tenantId: entry.tenantId,
              plateNumber: plate,
              vehicleType,
            },
            select: { id: true },
          });
        }
        vehicleId = vehicle.id;
      }
      const amount = Number(line.amount) || priceFor(vehicleType, washTypeId);
      totalAmount += amount;
      resolved.push({
        vehicleId,
        vehicleType,
        washTypeId,
        amount,
        startsAt,
        date: startsAt,
      });
    }

    const booking = await this.prisma.carWashBooking.create({
      data: {
        tenantId: entry.tenantId,
        customerId: null,
        vehicleId: resolved[0].vehicleId,
        washerId,
        vehicleType: resolved[0].vehicleType,
        amount: totalAmount,
        isTimeSlotBooking: true,
        bookingDate: startsAt,
        startsAt,
        endsAt: new Date(startsAt.getTime() + slotMinutes * 60 * 1000),
        notes: body.notes?.trim() || null,
        items: {
          create: resolved.map((r) => ({
            tenantId: entry.tenantId,
            vehicleId: r.vehicleId,
            vehicleType: r.vehicleType,
            washTypeId: r.washTypeId,
            amount: r.amount,
            date: r.date,
            startsAt: r.startsAt,
          })),
        },
      },
      include: { items: true },
    });

    await tenantContext
      .run(entry.tenantId, () =>
        this.notifications.notifyOwner(
          'New car wash booking',
          `${entry.label}: ${resolved.length} vehicle(s), ${totalAmount} total.`,
          {
            type: 'CARWASH_BOOKING',
            link: '/dashboard/carwash/bookings',
            dedupeKey: `CARWASH_BOOKING:${booking.id}`,
          },
        ),
      )
      .catch(() => {});

    return { id: booking.id, status: booking.status, startsAt: booking.startsAt };
  }
}
