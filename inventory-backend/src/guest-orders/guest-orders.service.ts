// src/guest-orders/guest-orders.service.ts
// Privileged side of public guest ordering: the inbox, review, routing to
// branches (central desk), branch replies, and release (free / reject). All
// methods are tenant-scoped and permission-gated at the controller.
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GuestOrderConversionService } from './guest-order-conversion.service';
import { getCurrentTenantId } from '../common/tenant/tenant.context';
import { auditBestEffort } from '../common/audit.util';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { entryKindsFor, publicKindFor } from '../public/public.constants';

@Injectable()
export class GuestOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly conversion: GuestOrderConversionService,
  ) {}

  private tenantId(): number {
    const id = getCurrentTenantId();
    if (id == null) throw new BadRequestException('No active organization');
    return id;
  }

  /** The privileged inbox: guest orders for the active business. */
  async list(status?: string) {
    return this.prisma.guestOrder.findMany({
      where: {
        tenantId: this.tenantId(),
        ...(status ? { status: status as any } : {}),
      },
      include: {
        entry: { select: { label: true, kind: true, table: { select: { name: true } } } },
        items: true,
        routes: { include: { location: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async get(id: number) {
    const order = await this.prisma.guestOrder.findFirst({
      where: { id, tenantId: this.tenantId() },
      include: {
        entry: true,
        items: true,
        routes: { include: { location: true } },
        activities: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) throw new NotFoundException('Guest order not found');
    return order;
  }

  private async log(orderId: number, action: string, note?: string | null, actorId?: number) {
    await this.prisma.guestOrderActivity.create({
      data: { guestOrderId: orderId, action, note: note ?? null, actorId: actorId ?? null },
    });
  }

  /** Ensure the order is editing-able (not closed). */
  private assertOpen(status: string) {
    if (['COMPLETED', 'REJECTED', 'CANCELLED', 'DROPPED'].includes(status)) {
      throw new BadRequestException('This order is already closed');
    }
  }

  /**
   * Privileged review: accept the order into the business. For F&B/service the
   * review immediately creates the internal record (order/booking); retail waits
   * for a branch to accept (see `assign`).
   */
  async review(id: number, actor: JwtPayload, note?: string) {
    const order = await this.get(id);
    this.assertOpen(order.status);
    const updated = await this.prisma.guestOrder.update({
      where: { id },
      data: { status: 'REVIEWED' },
    });
    await this.log(id, 'REVIEWED', note, actor.sub);

    // F&B / service bookings convert right away; retail/mfg wait for assign.
    const kinds = new Set((order.items ?? []).map((i) => i.itemKind));
    if (kinds.has('MENU_ITEM') || kinds.has('SERVICE_ITEM') || kinds.has('ROOM_TYPE')) {
      await this.conversion.convert(order as any, actor).catch(() => {});
    }
    return this.get(id);
  }

  /**
   * Route to one or more branches (retail/manufacturing). Creates a REQUESTED row
   * per branch; branches reply ACCEPTED/DECLINED.
   */
  async route(id: number, locationIds: number[], actorId: number, note?: string) {
    const order = await this.get(id);
    this.assertOpen(order.status);
    if (locationIds.length === 0) throw new BadRequestException('Pick at least one branch');

    for (const locationId of locationIds) {
      const loc = await this.prisma.location.findFirst({
        where: { id: locationId, tenantId: order.tenantId },
        select: { id: true },
      });
      if (!loc) throw new BadRequestException(`Branch ${locationId} not found`);
      await this.prisma.guestOrderRoute.upsert({
        where: { guestOrderId_locationId: { guestOrderId: id, locationId } },
        update: {},
        create: { guestOrderId: id, locationId, status: 'REQUESTED' },
      });
    }
    const updated = await this.prisma.guestOrder.update({
      where: { id },
      data: { status: 'ROUTED' },
    });
    await this.log(id, 'ROUTED', note ?? `Sent to ${locationIds.length} branch(es)`, actorId);
    return updated;
  }

  /** A branch replies to a routed order (accept / decline). */
  async respond(
    orderId: number,
    locationId: number,
    actorId: number,
    reply: 'ACCEPTED' | 'DECLINED',
    note?: string,
  ) {
    const order = await this.get(orderId);
    this.assertOpen(order.status);
    const route = await this.prisma.guestOrderRoute.findUnique({
      where: { guestOrderId_locationId: { guestOrderId: orderId, locationId } },
    });
    if (!route) throw new NotFoundException('This branch was not asked');
    await this.prisma.guestOrderRoute.update({
      where: { id: route.id },
      data: { status: reply, note: note ?? null, respondedById: actorId, respondedAt: new Date() },
    });
    await this.log(orderId, `BRANCH_${reply}`, note ?? `Branch #${locationId}`, actorId);
    if (reply === 'ACCEPTED') {
      // The central desk assigns; an accept just records willingness.
      await this.log(orderId, 'BRANCH_ACCEPTED_PENDING_ASSIGN', null, actorId);
    }
    return this.get(orderId);
  }

  /**
   * Central desk assigns the order to a branch that accepted it; the branch's
   * sale is then created through the real sales flow (stock/price/GL enforced).
   */
  async assign(id: number, locationId: number, actor: JwtPayload) {
    const order = await this.get(id);
    this.assertOpen(order.status);
    const route = order.routes.find((r) => r.locationId === locationId);
    if (!route) throw new NotFoundException('This branch was not asked');
    await this.prisma.guestOrder.update({ where: { id }, data: { status: 'ACCEPTED' } });
    await this.log(id, 'ASSIGNED', `Assigned to branch #${locationId}`, actor.sub);
    // Create the internal Sale at the assigned branch.
    await this.conversion
      .convert(order as any, actor, { locationId })
      .catch(async (err) => {
        await this.log(id, 'CONVERT_FAILED', (err as Error).message, actor.sub);
      });
    return this.get(id);
  }

  /** Reject (frees the table/entry immediately). */
  async reject(id: number, actorId: number, note?: string) {
    await this.get(id);
    const updated = await this.prisma.guestOrder.update({
      where: { id },
      data: { status: 'REJECTED' },
    });
    await this.log(id, 'REJECTED', note, actorId);
    return updated;
  }

  /** Manually free an order (guest left / table reset). */
  async free(id: number, actorId: number, note?: string) {
    await this.get(id);
    const updated = await this.prisma.guestOrder.update({
      where: { id },
      data: { status: 'DROPPED' },
    });
    await this.log(id, 'DROPPED', note, actorId);
    return updated;
  }

  /** Bulk approve (review) many orders at once. */
  async bulkReview(ids: number[], actor: JwtPayload, note?: string) {
    const results: Array<{ id: number; ok: boolean }> = [];
    for (const id of ids) {
      try {
        await this.review(id, actor, note);
        results.push({ id, ok: true });
      } catch {
        results.push({ id, ok: false });
      }
    }
    return { results };
  }

  /** Bulk decline (reject) many orders at once. */
  async bulkReject(ids: number[], actor: JwtPayload, note?: string) {
    const results: Array<{ id: number; ok: boolean }> = [];
    for (const id of ids) {
      try {
        await this.reject(id, actor.sub, note);
        results.push({ id, ok: true });
      } catch {
        results.push({ id, ok: false });
      }
    }
    return { results };
  }

  /**
   * Auto-approve handling: when an entry has autoApprove on, a submitted guest
   * order is approved immediately (skips the manual gate). Uses a system actor
   * (there is no privileged user in the request path).
   */
  async maybeAutoApprove(orderId: number, tenantId: number) {
    const order = await this.prisma.guestOrder.findUnique({
      where: { id: orderId },
      include: { entry: { select: { autoApprove: true } } },
    });
    if (order?.entry?.autoApprove && order.status === 'SUBMITTED') {
      const system: JwtPayload = {
        sub: 0,
        email: 'system@guest-orders',
        roleId: null,
        roleName: null,
        isSuperuser: true,
        isPlatformAdmin: false,
        isOwnerAccount: false,
        permissions: [],
        locationId: null,
        locationType: null,
        organizationId: tenantId,
        businessType: null,
        memberships: [],
        verificationStatus: 'APPROVED',
        verificationNote: null,
        verificationAttempts: 0,
      };
      await this.review(orderId, system, 'Auto-approved').catch(() => {});
    }
    return order;
  }

  /** Count of orders still needing a privileged decision (for the nav badge). */
  async pendingCount(): Promise<{ count: number }> {
    const count = await this.prisma.guestOrder.count({
      where: { tenantId: this.tenantId(), status: { in: ['SUBMITTED', 'ROUTED'] } },
    });
    return { count };
  }

  // --- QR / public entries (admin management) -------------------------------

  async listEntries() {
    return this.prisma.publicEntry.findMany({
      where: { tenantId: this.tenantId() },
      include: {
        items: true,
        table: { select: { name: true } },
        location: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createEntry(input: {
    kind: 'TABLE' | 'HOTEL' | 'SHOP' | 'CARWASH_BAY' | 'SERVICE';
    label: string;
    tableId?: number | null;
    locationId?: number | null;
  }) {
    const tenantId = this.tenantId();
    return this.prisma.publicEntry.create({
      data: {
        // Opaque capability token — never the row id.
        token: crypto.randomUUID().replace(/-/g, ''),
        tenantId,
        kind: input.kind,
        label: input.label,
        tableId: input.tableId ?? null,
        locationId: input.locationId ?? null,
      },
    });
  }

  /** The entry kinds allowed for the active business (for the QR page). */
  async allowedEntryKinds(): Promise<string[]> {
    const org = await this.prisma.organization.findUnique({
      where: { id: this.tenantId() },
      select: { businessType: true, enabledHospitalityServices: true },
    });
    return entryKindsFor(
      org?.businessType ?? 'RETAIL',
      org?.enabledHospitalityServices ?? [],
    );
  }

  /**
   * Auto-prepare (idempotently) the business's public QRs — **one central entry
   * per tenant**, plus **one per branch when the business has branches**. Every
   * entry shows the SAME tenant-wide catalog; the only difference is where the
   * order routes (central → the central desk routes; branch → straight to that
   * branch). No table/service/hotel-per-item entries.
   */
  async ensurePublicEntries() {
    const tenantId = this.tenantId();
    const org = await this.prisma.organization.findUnique({
      where: { id: tenantId },
      select: { businessType: true },
    });
    const kind = publicKindFor(org?.businessType ?? 'RETAIL');
    const existing = await this.prisma.publicEntry.findMany({
      where: { tenantId },
      select: { locationId: true },
    });
    const hasLocation = (locationId: number | null) =>
      existing.some((e) => e.locationId === locationId);
    const make = (label: string, locationId: number | null) =>
      this.prisma.publicEntry.create({
        data: {
          token: crypto.randomUUID().replace(/-/g, ''),
          tenantId,
          kind,
          label,
          locationId,
        },
      });

    // Central entry (always).
    if (!hasLocation(null)) await make('Order here', null);

    // One per branch (only when branches exist).
    const branches = await this.prisma.location.findMany({
      where: { tenantId },
      select: { id: true, name: true },
    });
    for (const b of branches) {
      if (!hasLocation(b.id)) await make(b.name, b.id);
    }

    return this.listEntries();
  }

  async updateEntry(
    id: number,
    input: {
      label?: string;
      state?: 'LIVE' | 'HELD' | 'DROPPED';
      liveFrom?: string | null;
      liveUntil?: string | null;
      active?: boolean;
      autoApprove?: boolean;
    },
  ) {
    await this.assertEntry(id);
    return this.prisma.publicEntry.update({
      where: { id },
      data: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.state !== undefined ? { state: input.state } : {}),
        ...(input.liveFrom !== undefined
          ? { liveFrom: input.liveFrom ? new Date(input.liveFrom) : null }
          : {}),
        ...(input.liveUntil !== undefined
          ? { liveUntil: input.liveUntil ? new Date(input.liveUntil) : null }
          : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.autoApprove !== undefined ? { autoApprove: input.autoApprove } : {}),
      },
    });
  }

  async deleteEntry(id: number) {
    await this.assertEntry(id);
    await this.prisma.publicEntry.delete({ where: { id } });
    return { ok: true };
  }

  /** Replace the published catalog for an entry. */
  async setEntryItems(
    id: number,
    items: Array<{ itemKind: string; itemId: number; priceOverride?: number | null; sortOrder?: number }>,
  ) {
    await this.assertEntry(id);
    await this.prisma.$transaction([
      this.prisma.publicEntryItem.deleteMany({ where: { entryId: id } }),
      this.prisma.publicEntryItem.createMany({
        data: items.map((i, idx) => ({
          entryId: id,
          itemKind: i.itemKind,
          itemId: i.itemId,
          priceOverride: i.priceOverride ?? null,
          sortOrder: i.sortOrder ?? idx,
        })),
        skipDuplicates: true,
      }),
    ]);
    return this.listEntries().then((rows) => rows.find((r) => r.id === id));
  }

  private async assertEntry(id: number) {
    const e = await this.prisma.publicEntry.findFirst({
      where: { id, tenantId: this.tenantId() },
      select: { id: true },
    });
    if (!e) throw new NotFoundException('Public entry not found');
  }

  // --- Blocklist ------------------------------------------------------------

  async listBlocklist() {
    return this.prisma.guestBlocklist.findMany({
      where: { tenantId: this.tenantId() },
      orderBy: { createdAt: 'desc' },
    });
  }

  async blockPhone(phone: string, reason?: string) {
    return this.prisma.guestBlocklist.upsert({
      where: { tenantId_phone: { tenantId: this.tenantId(), phone } },
      update: { reason: reason ?? null },
      create: { tenantId: this.tenantId(), phone, reason: reason ?? null },
    });
  }

  async unblockPhone(id: number) {
    await this.prisma.guestBlocklist.deleteMany({
      where: { id, tenantId: this.tenantId() },
    });
    return { ok: true };
  }
}
