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
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GuestOrdersService } from '../guest-orders/guest-orders.service';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { variantAttributeLabel } from '../common/variant-label.util';

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
      select: { name: true, businessType: true, enabledHospitalityServices: true },
    });

    const state = this.effectiveState(entry);
    if (state !== 'LIVE') {
      // Still return the shell (so the page can render "temporarily unavailable"),
      // but no catalog.
      return {
        kind: entry.kind,
        label: entry.label,
        businessName: business?.name ?? '',
        state,
        tableName: null,
        requiresProfile: false,
        items: [],
        services: [],
      };
    }

    const businessType = business?.businessType ?? 'RETAIL';
    const enabled = business?.enabledHospitalityServices ?? [];
    // With a single QR per tenant, whether the guest must fill their profile
    // depends on F&B-at-table handling done client-side (phone autofill / name
    // prompt); the server always allows a profile to be supplied.
    const requiresProfile = true;
    // Multi-service hospitality shows tabs; everyone else a flat catalog.
    const services =
      businessType === 'HOSPITALITY' && enabled.length > 1
        ? await this.hospitalityServices(entry, enabled)
        : [];
    const items =
      businessType === 'HOSPITALITY'
        ? await this.hotelCatalog(entry)
        : await this.publishedCatalog(entry);

    return {
      kind: entry.kind,
      label: entry.label,
      businessName: business?.name ?? '',
      state,
      tableName: null,
      requiresProfile,
      items,
      services,
    };
  }

  /**
   * Hospitality: the enabled service lines as tabs (F&B menu, available rooms,
   * and each other service's published items). Only lines with content appear.
   */
  private async hospitalityServices(
    entry: PublicEntry,
    enabled: string[],
  ): Promise<Array<{ key: string; label: string; items: PublicItem[] }>> {
    const groups: Array<{ key: string; label: string; items: PublicItem[] }> = [];
    const published = await this.publishedCatalog(entry);

    if (enabled.includes('FOOD_AND_BEVERAGE')) {
      const fb = published.filter((i) => i.kind === 'MENU_ITEM');
      if (fb.length) groups.push({ key: 'FOOD_AND_BEVERAGE', label: 'Food & Beverage', items: fb });
    }
    if (enabled.includes('ACCOMMODATION')) {
      const rooms = await this.hotelCatalog(entry);
      if (rooms.length) groups.push({ key: 'ACCOMMODATION', label: 'Rooms', items: rooms });
    }
    const svc = published.filter((i) => i.kind === 'SERVICE_ITEM');
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

  /** The entry's published catalog (each item flattened to a public DTO). */
  private async publishedCatalog(entry: PublicEntry): Promise<PublicItem[]> {
    const rows = await this.prisma.publicEntryItem.findMany({
      where: { entryId: entry.id, active: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    const out: PublicItem[] = [];
    for (const row of rows) {
      const item = await this.resolveItem(entry.tenantId, row.itemKind, row.itemId, row.priceOverride);
      if (item) out.push(item);
    }
    return out;
  }

  /**
   * Hotel: a room-TYPE catalog grouped from rooms that are FREE for the requested
   * dates (taken room types are omitted), plus any published F&B / service items.
   */
  private async hotelCatalog(entry: PublicEntry): Promise<PublicItem[]> {
    const tenantId = entry.tenantId;
    const now = new Date();
    const checkIn = entry.liveFrom ?? now;
    const checkOut = entry.liveUntil ?? new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // Rooms busy for the window (overlapping active reservations).
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

    // Any explicitly published items on the same entry (e.g. hotel services).
    const published = await this.prisma.publicEntryItem.findMany({
      where: { entryId: entry.id, active: true },
    });
    for (const row of published) {
      if (row.itemKind === 'ROOM_TYPE') continue; // rooms come from availability
      const item = await this.resolveItem(tenantId, row.itemKind, row.itemId, row.priceOverride);
      if (item) out.push(item);
    }
    return out;
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
    const groups =
      businessType === 'HOSPITALITY' && (org?.enabledHospitalityServices ?? []).length > 1
        ? await this.hospitalityServices(entry, org?.enabledHospitalityServices ?? [])
        : [];
    const flat =
      businessType === 'HOSPITALITY'
        ? await this.hotelCatalog(entry)
        : await this.publishedCatalog(entry);
    const all = [...flat, ...groups.flatMap((g) => g.items)];
    const map = new Map<string, PublicItem>();
    for (const item of all) {
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
}
