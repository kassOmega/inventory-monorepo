// src/cash/cash.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { getCurrentTenantId } from '../common/tenant/tenant.context';
import { FinanceService } from '../finance/finance.service';
import { PrismaService } from '../prisma/prisma.service';
import { RecordCollectionDto, RecordFloatDto, UpdateCashSettingsDto } from './dto/cash.dto';

@Injectable()
export class CashService {
  constructor(private prisma: PrismaService, private finance: FinanceService) {}

  private tenant(): number {
    const id = getCurrentTenantId();
    if (id == null) throw new BadRequestException('No active organization');
    return id;
  }

  async listPendingPayments(filters?: { waiterId?: number; dateFrom?: string; dateTo?: string }) {
    const tenantId = this.tenant();
    const where: Record<string, unknown> = { tenantId, status: 'PENDING_CONFIRMATION' };
    if (filters?.waiterId) where.collectedById = filters.waiterId;
    if (filters?.dateFrom || filters?.dateTo) {
      const createdAt: Record<string, Date> = {};
      if (filters.dateFrom) createdAt.gte = new Date(`${filters.dateFrom}T00:00:00`);
      if (filters.dateTo) createdAt.lte = new Date(`${filters.dateTo}T23:59:59`);
      where.createdAt = createdAt;
    }
    const payments = await this.prisma.orderPayment.findMany({
      where,
      include: {
        order: { include: { table: true, items: true, fiscalReceipt: true } },
        paymentMethod: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const userIds = [...new Set(payments.map((p) => p.collectedById).filter((v): v is number => v != null))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    });
    const nameMap = new Map(users.map((u) => [u.id, u.name]));

    return payments.map((p) => ({
      ...p,
      collectedByName: p.collectedById != null ? nameMap.get(p.collectedById) ?? null : null,
    }));
  }

  async confirmPayment(id: number, userId: number) {
    const tenantId = this.tenant();
    const payment = await this.prisma.orderPayment.findFirst({ where: { tenantId, id } });
    if (!payment) throw new NotFoundException('Payment not found');

    const updated = await this.prisma.orderPayment.update({
      where: { id },
      data: { status: 'CONFIRMED', confirmedById: userId, confirmedAt: new Date() },
    });

    // Post categorized income once the payment is confirmed.
    await this.finance.postOrderIncome(payment.orderId, tenantId);
    return updated;
  }

  async listFloats() {
    const tenantId = this.tenant();
    return this.prisma.cashFloat.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
  }

  async recordFloat(dto: RecordFloatDto, userId: number) {
    const tenantId = this.tenant();
    return this.prisma.cashFloat.create({
      data: {
        tenantId,
        recipientId: dto.recipientId,
        amount: dto.amount,
        notes: dto.notes,
        createdById: userId,
      },
    });
  }

  async listCollections() {
    const tenantId = this.tenant();
    return this.prisma.cashCollection.findMany({
      where: { tenantId },
      include: { paymentMethod: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listStaff() {
    const tenantId = this.tenant();
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId: tenantId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { id: 'asc' },
    });
    return memberships.map((m) => ({ id: m.user.id, name: m.user.name }));
  }

  async getSettings() {
    const tenantId = this.tenant();
    const org = await this.prisma.organization.findUnique({ where: { id: tenantId }, select: { settings: true } });
    const settings = (org?.settings as Record<string, unknown>) ?? {};
    return {
      requireCashierConfirmation: settings.requireCashierConfirmation !== false,
      enableFloatManagement: settings.enableFloatManagement !== false,
    };
  }

  async updateSettings(dto: UpdateCashSettingsDto) {
    const tenantId = this.tenant();
    const org = await this.prisma.organization.findUnique({ where: { id: tenantId }, select: { settings: true } });
    const current = (org?.settings as Record<string, unknown>) ?? {};
    const merged: Record<string, unknown> = { ...current };
    if (dto.requireCashierConfirmation !== undefined) {
      merged.requireCashierConfirmation = dto.requireCashierConfirmation;
    }
    if (dto.enableFloatManagement !== undefined) {
      merged.enableFloatManagement = dto.enableFloatManagement;
    }
    await this.prisma.organization.update({ where: { id: tenantId }, data: { settings: merged as any } });
    return merged;
  }

  async recordCollection(dto: RecordCollectionDto, userId: number) {
    const tenantId = this.tenant();
    return this.prisma.cashCollection.create({
      data: {
        tenantId,
        fromUserId: dto.fromUserId,
        amount: dto.amount,
        paymentMethodId: dto.paymentMethodId,
        notes: dto.notes,
        collectedById: userId,
      },
    });
  }

  async collectionSummary() {
    const tenantId = this.tenant();

    const [payments, floats, collections, memberships] = await Promise.all([
      this.prisma.orderPayment.findMany({
        where: { tenantId, status: { not: 'VOIDED' } },
        include: { order: { include: { items: true } }, paymentMethod: true },
      }),
      this.prisma.cashFloat.findMany({ where: { tenantId } }),
      this.prisma.cashCollection.findMany({ where: { tenantId }, include: { paymentMethod: true } }),
      this.prisma.membership.findMany({
        where: { organizationId: tenantId },
        include: { user: { select: { id: true, name: true } } },
      }),
    ]);

    const userMap = new Map(memberships.map((m) => [m.user.id, m.user.name]));

    // Per-collector reconciliation.
    const collectors = new Map<number, any>();
    const ensure = (userId: number) => {
      if (!collectors.has(userId)) {
        collectors.set(userId, {
          userId,
          name: userMap.get(userId) ?? 'Unknown',
          floatsReceived: 0,
          cashSales: 0,
          digitalSales: 0,
          salesCollected: 0,
          collectionsReturned: 0,
        });
      }
      return collectors.get(userId);
    };

    for (const f of floats) ensure(f.recipientId).floatsReceived += f.amount;

    for (const p of payments) {
      if (p.collectedById == null) continue;
      const c = ensure(p.collectedById);
      c.salesCollected += p.amount;
      if (p.paymentMethod?.isDigital) c.digitalSales += p.amount;
      else c.cashSales += p.amount;
    }

    for (const col of collections) ensure(col.fromUserId).collectionsReturned += col.amount;

    const collectorRows = [...collectors.values()].map((c) => ({
      ...c,
      expectedPhysicalCash: c.floatsReceived + c.cashSales - c.collectionsReturned,
      netSalesRevenue: c.salesCollected,
    }));

    // Per-station (category) totals — from order items.
    const stationMap = new Map<string, number>();
    for (const p of payments) {
      for (const item of p.order.items ?? []) {
        const key = item.stationName ?? 'Unassigned';
        stationMap.set(key, (stationMap.get(key) ?? 0) + item.unitPrice * item.quantity);
      }
    }
    const categories = [...stationMap.entries()].map(([station, total]) => ({ station, total }));

    // Per-payment-method totals.
    const methodMap = new Map<string, number>();
    for (const p of payments) {
      const key = p.paymentMethod?.name ?? 'Unknown';
      methodMap.set(key, (methodMap.get(key) ?? 0) + p.amount);
    }
    const methods = [...methodMap.entries()].map(([method, total]) => ({ method, total }));

    const totalSales = payments.reduce((s, p) => s + p.amount, 0);
    const totalCashSales = payments.reduce((s, p) => s + (p.paymentMethod?.isDigital ? 0 : p.amount), 0);
    const totalDigitalSales = totalSales - totalCashSales;
    const totalFloats = floats.reduce((s, f) => s + f.amount, 0);
    const totalCollections = collections.reduce((s, c) => s + c.amount, 0);

    return {
      collectors: collectorRows,
      categories,
      methods,
      totals: {
        sales: totalSales,
        cashSales: totalCashSales,
        digitalSales: totalDigitalSales,
        floats: totalFloats,
        collections: totalCollections,
        expectedPhysicalCash: totalFloats + totalCashSales - totalCollections,
      },
    };
  }
}

