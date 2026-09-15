// src/agent/agent-tools.service.ts
// The Autonomous Owner Agent's "hands". Each tool is tenant-scoped and writes a
// durable AgentActionLog entry. Financial actions are gated by the org's
// maxAutoSpend — anything over budget is staged as PENDING_APPROVAL instead of
// being executed automatically.
import { Injectable, Logger } from '@nestjs/common';
import {
  ActionStatus,
  AgentMode,
  Prisma,
  RequestStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';

const round2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class AgentToolsService {
  private readonly logger = new Logger(AgentToolsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  // =========================================================================
  // Tools exposed to Gemini
  // =========================================================================

  /** Read-only: a compact digest of the business state the agent reasons about. */
  async getBusinessContext(orgId: number): Promise<Record<string, unknown>> {
    const [pendingRequests, lowStockCount, recentSales, floats, config, orderItems] =
      await Promise.all([
        this.prisma.stockRequest.findMany({
          where: { tenantId: orgId, status: 'PENDING' },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { items: { include: { product: true } } },
        }),
        this.prisma.inventory.count({
          where: { tenantId: orgId, quantity: { lte: 10 } },
        }),
        this.prisma.sale.findMany({
          where: { tenantId: orgId },
          orderBy: { saleDate: 'desc' },
          take: 5,
          select: {
            invoiceNumber: true,
            totalAmount: true,
            saleDate: true,
          },
        }),
        this.prisma.cashFloat.findMany({
          where: { tenantId: orgId },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { amount: true, recipientId: true, createdAt: true },
        }),
        this.getOrCreateConfig(orgId),
        this.prisma.orderItem.findMany({
          where: { tenantId: orgId, order: { status: 'PAID' } },
          select: {
            unitPrice: true,
            cost: true,
            quantity: true,
            menuItem: {
              select: { menuCategoryId: true, menuCategory: { select: { name: true } } },
            },
          },
        }),
      ]);

    // Per-category economics snapshot (revenue / cost / profit / margin).
    const catMap = new Map<number, { category: string; revenue: number; cost: number }>();
    for (const i of orderItems) {
      const key = i.menuItem?.menuCategoryId ?? 0;
      const row = catMap.get(key) ?? {
        category: i.menuItem?.menuCategory?.name ?? 'Uncategorized',
        revenue: 0,
        cost: 0,
      };
      row.revenue += (i.unitPrice ?? 0) * i.quantity;
      row.cost += (i.cost ?? 0) * i.quantity;
      catMap.set(key, row);
    }
    const categoryEconomics = [...catMap.values()].map((c) => ({
      category: c.category,
      revenue: round2(c.revenue),
      cost: round2(c.cost),
      profit: round2(c.revenue - c.cost),
      margin: c.revenue > 0 ? round2(((c.revenue - c.cost) / c.revenue) * 100) : 0,
    }));

    return {
      mode: config.mode,
      maxAutoSpend: config.maxAutoSpend,
      currency: 'ETB',
      categoryEconomics,
      pendingRestockRequests: pendingRequests.map((r) => ({
        id: r.id,
        status: r.status,
        items: r.items.map((i) => ({
          productId: i.productId,
          product: `${i.product.brand} ${i.product.baseName}`,
          quantityRequested: i.quantityRequested ?? 0,
          unitBuyPrice: i.product.currentBuyPrice,
        })),
        estimatedCost: round2(
          r.items.reduce(
            (sum, i) =>
              sum + (i.quantityRequested ?? 0) * i.product.currentBuyPrice,
            0,
          ),
        ),
      })),
      lowStockItems: lowStockCount,
      recentSales: recentSales.map((s) => ({
        invoice: s.invoiceNumber,
        amount: s.totalAmount,
        date: s.saleDate.toISOString().slice(0, 10),
      })),
      recentCashFloats: floats.map((f) => ({
        amount: f.amount,
        recipientId: f.recipientId,
        date: f.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Approve a pending inventory restock request.
   * If the estimated cost is within the org's maxAutoSpend it executes
   * automatically; otherwise it is staged for owner approval.
   */
  async approveInventoryRestock(
    orgId: number,
    requestId: number,
  ): Promise<Record<string, unknown>> {
    const request = await this.prisma.stockRequest.findFirst({
      where: { id: requestId, tenantId: orgId },
      include: { items: { include: { product: true } } },
    });
    if (!request) return { ok: false, error: 'Stock request not found' };
    if (request.status === RequestStatus.APPROVED) {
      return { ok: false, error: 'Stock request is already approved' };
    }

    const config = await this.getOrCreateConfig(orgId);
    const totalCost = round2(
      request.items.reduce(
        (sum, i) =>
          sum + (i.quantityRequested ?? 0) * i.product.currentBuyPrice,
        0,
      ),
    );
    const withinBudget = totalCost <= config.maxAutoSpend;

    if (withinBudget) {
      await this.markRequestApproved(orgId, requestId);
      await this.logAction(orgId, {
        actionType: 'APPROVE_RESTOCK',
        targetEntity: `StockRequest:${requestId}`,
        description: `Auto-approved restock request #${requestId} (${request.items.length} item(s)) costing ${totalCost} — within maxAutoSpend ${config.maxAutoSpend}.`,
        status: ActionStatus.EXECUTED,
        payload: { requestId, totalCost, withinBudget: true },
      });
      return { ok: true, action: 'approved', requestId, totalCost };
    }

    const staged = await this.stageAction(orgId, {
      actionType: 'APPROVE_RESTOCK',
      targetEntity: `StockRequest:${requestId}`,
      description: `Staged restock approval for request #${requestId} costing ${totalCost} (exceeds maxAutoSpend ${config.maxAutoSpend}).`,
      payload: { requestId, totalCost, withinBudget: false },
    });
    return { ok: true, action: 'staged_for_approval', requestId, totalCost, approvalId: staged.id };
  }

  /** Log a cash variance at a cashier station and alert the owner. */
  async flagFinancialDiscrepancy(
    orgId: number,
    cashierUserId: number,
    missingAmount: number,
    notes?: string,
  ): Promise<Record<string, unknown>> {
    const description = `Cash variance of ${round2(missingAmount)} at cashier User:${cashierUserId} — ${notes || 'no notes'}`;
    await this.logAction(orgId, {
      actionType: 'FLAG_DISCREPANCY',
      targetEntity: `User:${cashierUserId}`,
      description,
      status: ActionStatus.EXECUTED,
      payload: { cashierUserId, missingAmount, notes },
    });
    await this.notifyOwner(orgId, '⚠️ Financial discrepancy flagged', description);
    return { ok: true, logged: true };
  }

  /** Always stages a high-risk action for owner review. Never auto-executes. */
  async stageHighRiskAction(
    orgId: number,
    actionType: string,
    details: string,
    requiredApproval: string,
  ): Promise<Record<string, unknown>> {
    const staged = await this.stageAction(orgId, {
      actionType: 'STAGE_HIGH_RISK',
      targetEntity: null,
      description: details,
      payload: { actionType, details, requiredApproval },
    });
    return { ok: true, staged: staged.id, requiredApproval };
  }

  // =========================================================================
  // Execution on owner approval
  // =========================================================================

  /** Runs a staged action once the owner approves it (owner = authorization). */
  async executeApprovedAction(orgId: number, actionId: string): Promise<void> {
    const log = await this.prisma.agentActionLog.findFirst({
      where: { id: actionId, organizationId: orgId, status: ActionStatus.PENDING_APPROVAL },
    });
    if (!log) throw new Error('Pending action not found');
    const payload = (log.payload ?? {}) as Record<string, unknown>;

    try {
      if (log.actionType === 'APPROVE_RESTOCK' && payload.requestId != null) {
        await this.markRequestApproved(orgId, Number(payload.requestId));
      }
      await this.prisma.agentActionLog.update({
        where: { id: log.id },
        data: { status: ActionStatus.EXECUTED },
      });
      await this.notifyOwner(orgId, '✅ Agent action approved', `Approved: ${log.description}`);
    } catch (err) {
      this.logger.error(`Approved action failed: ${(err as Error).message}`);
      await this.prisma.agentActionLog.update({
        where: { id: log.id },
        data: { status: ActionStatus.FAILED },
      });
      throw err;
    }
  }

  // =========================================================================
  // Internal helpers
  // =========================================================================

  private async markRequestApproved(orgId: number, requestId: number) {
    const ownerUserId = await this.findOwnerUserId(orgId);
    await this.prisma.stockRequest.update({
      where: { id: requestId },
      data: { status: RequestStatus.APPROVED, approvedById: ownerUserId ?? null },
    });
  }

  private async getOrCreateConfig(orgId: number) {
    let config = await this.prisma.organizationAgentConfig.findUnique({
      where: { organizationId: orgId },
    });
    if (!config) {
      config = await this.prisma.organizationAgentConfig.create({
        data: { organizationId: orgId, mode: AgentMode.ADVISORY },
      });
    }
    return config;
  }

  private async stageAction(
    orgId: number,
    data: {
      actionType: string;
      targetEntity: string | null;
      description: string;
      payload: Record<string, unknown>;
    },
  ) {
    const log = await this.logAction(orgId, {
      ...data,
      status: ActionStatus.PENDING_APPROVAL,
    });
    await this.notifyOwner(
      orgId,
      '🛑 Agent action needs your review',
      `${data.description} — Approve or reject it in the Agent dashboard.`,
    );
    return log;
  }

  private async logAction(
    orgId: number,
    data: {
      actionType: string;
      targetEntity: string | null;
      description: string;
      status: ActionStatus;
      payload: Record<string, unknown>;
    },
  ) {
    return this.prisma.agentActionLog.create({
      data: {
        organizationId: orgId,
        actionType: data.actionType,
        targetEntity: data.targetEntity,
        description: data.description,
        status: data.status,
        payload: data.payload as Prisma.InputJsonValue,
      },
    });
  }

  private async findOwnerUserId(orgId: number): Promise<number | null> {
    const ownerRole = await this.prisma.role.findFirst({
      where: { organizationId: orgId, isSystem: true },
      select: { id: true },
    });
    if (!ownerRole) return null;
    const membership = await this.prisma.membership.findFirst({
      where: { organizationId: orgId, roleId: ownerRole.id },
      select: { userId: true },
    });
    return membership?.userId ?? null;
  }

  private async notifyOwner(orgId: number, title: string, message: string) {
    const ownerRole = await this.prisma.role.findFirst({
      where: { organizationId: orgId, isSystem: true },
      select: { id: true },
    });
    await this.prisma.notification.create({
      data: {
        tenantId: orgId,
        type: 'AGENT',
        title,
        message,
        targetRoleId: ownerRole?.id ?? null,
      },
    });

    // The agent runs autonomously (often from a scheduled job with no request
    // context), so a device push is the only way the owner notices immediately.
    if (ownerRole) {
      this.push
        .sendToRoleId({ title, body: message }, ownerRole.id, orgId)
        .catch(() => {});
    }
  }
}

