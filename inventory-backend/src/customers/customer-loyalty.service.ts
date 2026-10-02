// src/customers/customer-loyalty.service.ts
// Loyalty points: programme config, the ledger of record, and the (idempotent)
// hooks the sales pipeline calls when a sale is created, edited, returned or
// deleted.
//
// Model
//   • LoyaltyProgram — 1:1 per organization; `enabled = false` by default so an
//     existing tenant keeps earning nothing until the owner opts in.
//   • CustomerLoyaltyEntry — the ledger. Points are *signed* (earn positive,
//     reversal/redemption negative) and every row records the resulting balance.
//   • Customer.loyaltyPoints — a cached running total, so the directory and the
//     "points earned" toast never need to aggregate the ledger.
//
// A sale owns at most one EARN row and one REVERSE row
// (`@@unique([saleId, type])`), both rewritten in place rather than appended to.
// That is what makes the pipeline safe to re-run: editing a sale twice, retrying
// an idempotent checkout or deleting a return all converge on the same numbers
// instead of double crediting the customer.
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LoyaltyEntryType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { tr } from '../i18n/i18n.service';
import { getCurrentTenantId } from '../common/tenant/tenant.context';
import { AdjustLoyaltyDto, UpdateLoyaltyProgramDto } from './dto/customer.dto';

/** Values used before the owner has ever opened the loyalty settings. */
const PROGRAM_DEFAULTS = {
  enabled: false,
  pointsPerCurrency: 0.01,
  valuePerPoint: 0,
  minRedeemPoints: 0,
};

export interface LoyaltyProgramView {
  enabled: boolean;
  pointsPerCurrency: number;
  valuePerPoint: number;
  minRedeemPoints: number;
}

/** Everything the sales pipeline needs to (re)compute a sale's points. */
export interface LoyaltySyncInput {
  organizationId: number;
  customerId: number;
  saleId: number;
  /** Gross amount charged by the sale — the base points are earned on. */
  totalAmount: number;
  /** Amount already refunded; the reversal is proportional to it. */
  refundedAmount?: number;
  /** Author of the rows (the cashier); omitted for background/system flows. */
  createdById?: number | null;
  /** Context stored on the rows (invoice number, "returned", …). */
  reason?: string | null;
}

@Injectable()
export class CustomerLoyaltyService {
  constructor(private prisma: PrismaService) {}

  // --- Programme configuration -------------------------------------------

  /** Programme settings for the caller's organization (never creates a row). */
  async getProgram(): Promise<LoyaltyProgramView> {
    const row = await this.prisma.loyaltyProgram.findFirst({
      select: {
        enabled: true,
        pointsPerCurrency: true,
        valuePerPoint: true,
        minRedeemPoints: true,
      },
    });
    return row ?? { ...PROGRAM_DEFAULTS };
  }

  /** Owner-facing update; creates the row on first save. */
  async updateProgram(
    dto: UpdateLoyaltyProgramDto,
  ): Promise<LoyaltyProgramView> {
    const organizationId = getCurrentTenantId();
    if (organizationId == null) {
      throw new BadRequestException(tr('errors.businessRequiredForCustomer'));
    }
    return this.prisma.loyaltyProgram.upsert({
      where: { organizationId },
      create: { organizationId, ...PROGRAM_DEFAULTS, ...dto },
      update: { ...dto },
      select: {
        enabled: true,
        pointsPerCurrency: true,
        valuePerPoint: true,
        minRedeemPoints: true,
      },
    });
  }

  /**
   * Points earned by an amount, per the programme. Floors, so a customer never
   * sees points that are not actually payable.
   */
  pointsForAmount(program: LoyaltyProgramView, amount: number): number {
    if (!program.enabled || program.pointsPerCurrency <= 0) return 0;
    return Math.max(0, Math.floor(amount * program.pointsPerCurrency));
  }

  // --- Sale hooks ---------------------------------------------------------

  /**
   * Bring a sale's loyalty rows in line with `totalAmount` / `refundedAmount`.
   * Safe to call on every create/update/return: rows are updated in place.
   */
  async syncSaleLoyalty(
    tx: Prisma.TransactionClient,
    input: LoyaltySyncInput,
  ): Promise<{ earned: number; reversed: number; balance: number | null }> {
    const program = await this.ensureProgram(tx, input.organizationId);
    const view: LoyaltyProgramView = {
      enabled: program.enabled,
      pointsPerCurrency: program.pointsPerCurrency,
      valuePerPoint: program.valuePerPoint,
      minRedeemPoints: program.minRedeemPoints,
    };

    const earnRow = await tx.customerLoyaltyEntry.findFirst({
      where: { saleId: input.saleId, type: LoyaltyEntryType.EARN },
      select: { id: true, points: true, customerId: true },
    });

    // Once the programme is off, the existing EARN row is frozen and treated as
    // the amount to reverse — nothing keeps accruing silently.
    const targetEarn = view.enabled
      ? this.pointsForAmount(view, input.totalAmount)
      : (earnRow?.points ?? 0);

    // When the programme is switched off the rows are retired outright (the EARN
    // row is deleted further down and its points handed back), so no reversal is
    // layered on top of that.
    const ratio =
      view.enabled && input.totalAmount > 0
        ? Math.min(
            1,
            Math.max(0, (input.refundedAmount ?? 0) / input.totalAmount),
          )
        : 0;
    const targetReversed = Math.floor(targetEarn * ratio);

    let balance: number | null = null;

    if (view.enabled || earnRow) {
      balance = await this.syncEntry(tx, {
        organizationId: input.organizationId,
        customerId: input.customerId,
        saleId: input.saleId,
        type: LoyaltyEntryType.EARN,
        targetPoints: targetEarn,
        existing: earnRow,
        balanceAfter: balance,
        createdById: input.createdById ?? null,
        reason: input.reason ?? null,
        // An EARN row only exists while points are actually being accrued.
        write: view.enabled && targetEarn > 0,
      });
    }

    if (targetReversed > 0 || earnRow) {
      // Called even at zero: when the target drops back (a return was deleted, or
      // the sale lost its customer) the REVERSE row is removed and its points
      // handed back instead of lingering as a stale reversal.
      balance = await this.syncEntry(tx, {
        organizationId: input.organizationId,
        customerId: input.customerId,
        saleId: input.saleId,
        type: LoyaltyEntryType.REVERSE,
        targetPoints: -targetReversed,
        existing: null,
        balanceAfter: balance,
        createdById: input.createdById ?? null,
        reason: input.reason ?? null,
        write: targetReversed > 0,
        clampAtZero: true,
      });
    }

    return { earned: targetEarn, reversed: targetReversed, balance };
  }

  /**
   * Reverse every point a sale earned (the sale is being deleted). The ledger
   * rows survive the deletion — the FK is `onDelete: SetNull` and the invoice
   * number is kept in `reason`, so the audit trail stays readable.
   */
  async reverseSaleLoyalty(
    tx: Prisma.TransactionClient,
    input: LoyaltySyncInput,
  ): Promise<void> {
    await this.syncSaleLoyalty(tx, {
      ...input,
      refundedAmount: input.totalAmount,
    });
  }

  /** Manual points adjustment from the CRM (bonus, correction, redemption). */
  async adjust(customerId: number, dto: AdjustLoyaltyDto, userId: number) {
    const organizationId = getCurrentTenantId();
    if (organizationId == null) {
      throw new BadRequestException(tr('errors.businessRequiredForCustomer'));
    }
    if (!dto.points) {
      throw new BadRequestException(tr('errors.loyaltyPointsRequired'));
    }
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId },
      select: { id: true, name: true, loyaltyPoints: true },
    });
    if (!customer) throw new NotFoundException(tr('errors.customerNotFound'));

    const nextBalance = customer.loyaltyPoints + dto.points;
    if (nextBalance < 0) {
      throw new BadRequestException(
        tr('errors.loyaltyInsufficientPoints', {
          balance: customer.loyaltyPoints,
        }),
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const balanceAfter = await this.applyDelta(tx, customerId, dto.points);
      const entry = await tx.customerLoyaltyEntry.create({
        data: {
          organizationId,
          customerId,
          type: LoyaltyEntryType.ADJUST,
          points: dto.points,
          balanceAfter,
          reason: dto.reason ?? null,
          createdById: userId,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: organizationId,
          userId,
          action: 'LOYALTY_ADJUST',
          details: `${dto.points > 0 ? '+' : ''}${dto.points} points for ${customer.name} (balance ${balanceAfter})${dto.reason ? ` — ${dto.reason}` : ''}`,
        },
      });
      return { entry, balance: balanceAfter };
    });
  }

  /** Ledger for one customer, newest first (profile history). */
  async history(customerId: number, take = 50) {
    return this.prisma.customerLoyaltyEntry.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        sale: { select: { id: true, invoiceNumber: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
  }

  // --- Internals ----------------------------------------------------------

  /** Upsert the (single) programme row for an organization. */
  private async ensureProgram(
    tx: Prisma.TransactionClient,
    organizationId: number,
  ) {
    return tx.loyaltyProgram.upsert({
      where: { organizationId },
      create: { organizationId, ...PROGRAM_DEFAULTS },
      update: {},
    });
  }

  /**
   * Write one ledger row of `type` for a sale, moving the customer's balance by
   * exactly the difference between the old and the new points value.
   */
  private async syncEntry(
    tx: Prisma.TransactionClient,
    opts: {
      organizationId: number;
      customerId: number;
      saleId: number;
      type: LoyaltyEntryType;
      targetPoints: number;
      existing: { id: number; points: number; customerId: number } | null;
      balanceAfter: number | null;
      createdById: number | null;
      reason: string | null;
      /** false = the row must not exist (delete it, undoing its points). */
      write: boolean;
      clampAtZero?: boolean;
    },
  ): Promise<number | null> {
    const existing =
      opts.existing ??
      (await tx.customerLoyaltyEntry.findFirst({
        where: { saleId: opts.saleId, type: opts.type },
        select: { id: true, points: true, customerId: true },
      }));

    if (!existing) {
      if (!opts.write || opts.targetPoints === 0) return opts.balanceAfter;
      const balanceAfter = await this.applyDelta(
        tx,
        opts.customerId,
        opts.targetPoints,
        { clampAtZero: opts.clampAtZero },
      );
      await tx.customerLoyaltyEntry.create({
        data: {
          organizationId: opts.organizationId,
          customerId: opts.customerId,
          saleId: opts.saleId,
          type: opts.type,
          points: opts.targetPoints,
          balanceAfter,
          reason: opts.reason,
          createdById: opts.createdById,
        },
      });
      return balanceAfter;
    }

    if (!opts.write) {
      // The row must not exist any more: give its points back to the customer
      // it belongs to, then drop it.
      await this.applyDelta(tx, existing.customerId, -existing.points, {
        clampAtZero: true,
      });
      await tx.customerLoyaltyEntry.delete({ where: { id: existing.id } });
      return null;
    }

    let balanceAfter: number | null = opts.balanceAfter;
    if (existing.customerId !== opts.customerId) {
      // The sale was re-billed to a different customer: move the points over.
      await this.applyDelta(tx, existing.customerId, -existing.points, {
        clampAtZero: true,
      });
      balanceAfter = await this.applyDelta(
        tx,
        opts.customerId,
        opts.targetPoints,
        { clampAtZero: opts.clampAtZero },
      );
    } else if (opts.targetPoints !== existing.points) {
      balanceAfter = await this.applyDelta(
        tx,
        opts.customerId,
        opts.targetPoints - existing.points,
        { clampAtZero: opts.clampAtZero },
      );
    }

    await tx.customerLoyaltyEntry.update({
      where: { id: existing.id },
      data: {
        customerId: opts.customerId,
        points: opts.targetPoints,
        balanceAfter,
        reason: opts.reason ?? undefined,
      },
    });
    return balanceAfter;
  }

  /**
   * Move a customer's cached balance and return the new value. `clampAtZero`
   * keeps automatic reversals from pushing a spendable balance below zero.
   */
  private async applyDelta(
    tx: Prisma.TransactionClient,
    customerId: number,
    delta: number,
    opts: { clampAtZero?: boolean } = {},
  ): Promise<number> {
    if (delta === 0) {
      const current = await tx.customer.findFirst({
        where: { id: customerId },
        select: { loyaltyPoints: true },
      });
      return current?.loyaltyPoints ?? 0;
    }
    let effective = delta;
    if (delta < 0 && opts.clampAtZero) {
      const current = await tx.customer.findFirst({
        where: { id: customerId },
        select: { loyaltyPoints: true },
      });
      const available = Math.max(0, current?.loyaltyPoints ?? 0);
      effective = -Math.min(Math.abs(delta), available);
      if (effective === 0) return available;
    }
    const updated = await tx.customer.update({
      where: { id: customerId },
      data: { loyaltyPoints: { increment: effective } },
      select: { loyaltyPoints: true },
    });
    return updated.loyaltyPoints;
  }
}
