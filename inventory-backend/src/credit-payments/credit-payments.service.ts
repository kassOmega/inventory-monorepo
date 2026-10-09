import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { asNumericId } from '../common/business-number.util';
import { auditBestEffort } from '../common/audit.util';
import { PrismaService } from '../prisma/prisma.service';
import { FinanceService } from '../finance/finance.service';
import { getCurrentTenantId } from '../common/tenant/tenant.context';
import { tr } from '../i18n/i18n.service';

type Tx = Prisma.TransactionClient;

@Injectable()
export class CreditPaymentsService {
  constructor(
    private prisma: PrismaService,
    private finance: FinanceService,
  ) {}

  /** Accept a numeric id or the UUID publicId, returning the numeric key. */
  async resolveCreditPaymentId(ref: string): Promise<number> {
    const numeric = asNumericId(ref);
    if (numeric != null) return numeric;
    const row = await this.prisma.creditPayment.findUnique({
      where: { publicId: ref },
      select: { id: true },
    });
    if (!row) throw new NotFoundException(tr('errors.paymentNotFound'));
    return row.id;
  }

  async create(data: {
    customerId: number;
    amount: number;
    notes?: string;
    paymentMethodId?: number;
    saleId?: number | null;
    actorId?: number;
  }) {
    const { actorId, ...paymentData } = data;
    return this.prisma.$transaction(async (tx) => {
      if (paymentData.saleId) {
        await this.assertAttribution(tx, paymentData.customerId, paymentData.saleId, paymentData.amount);
      }
      const payment = await tx.creditPayment.create({ data: paymentData });
      if (paymentData.saleId) {
        await this.applyToSale(tx, paymentData.saleId, paymentData.amount);
      }
      // Post the cash settlement to the ledger (Dr Cash/Bank / Cr AR).
      await this.finance
        .postCreditPayment({
          creditPaymentId: payment.id,
          amount: paymentData.amount,
          tenantId: getCurrentTenantId(),
          tx,
          createdById: actorId ?? null,
          paymentMethodId: paymentData.paymentMethodId ?? null,
        })
        .catch(() => {});
      if (actorId != null) {
        await auditBestEffort(tx, {
          userId: actorId,
          action: 'CREDIT_PAYMENT',
          details: `Credit payment ${paymentData.amount} for customer #${paymentData.customerId}`,
        });
      }
      return payment;
    });
  }

  async update(
    id: number,
    data: {
      amount?: number;
      notes?: string;
      paymentMethodId?: number;
      paidAt?: string;
      saleId?: number | null;
    },
    actorId?: number,
  ) {
    const existing = await this.prisma.creditPayment.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException(tr('errors.paymentNotFound'));

    return this.prisma.$transaction(async (tx) => {
      const newSaleId =
        data.saleId === undefined ? existing.saleId : data.saleId;
      const newAmount = data.amount ?? existing.amount;

      // Revert the old attribution first so the sale balance is restored.
      if (existing.saleId) {
        await this.revertFromSale(tx, existing.saleId, existing.amount);
      }
      if (newSaleId) {
        await this.assertAttribution(tx, existing.customerId, newSaleId, newAmount);
      }

      const updated = await tx.creditPayment.update({
        where: { id },
        data: {
          ...(data.amount !== undefined ? { amount: data.amount } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
          ...(data.paymentMethodId !== undefined
            ? { paymentMethodId: data.paymentMethodId }
            : {}),
          ...(data.paidAt !== undefined
            ? { paidAt: new Date(data.paidAt) }
            : {}),
          saleId: newSaleId,
        },
      });

      if (newSaleId) {
        await this.applyToSale(tx, newSaleId, newAmount);
      }
      // Repost the settlement at the new amount: remove the old GL entry, then
      // post again with the corrected amount (both within this transaction).
      await this.reverseCreditPayment(tx, existing.id).catch(() => {});
      await this.finance
        .postCreditPayment({
          creditPaymentId: existing.id,
          amount: newAmount,
          tenantId: getCurrentTenantId(),
          tx,
          createdById: actorId ?? null,
          paymentMethodId:
            data.paymentMethodId !== undefined
              ? data.paymentMethodId
              : existing.paymentMethodId,
        })
        .catch(() => {});
      if (actorId != null) {
        await auditBestEffort(tx, {
          userId: actorId,
          action: 'CREDIT_PAYMENT_UPDATED',
          details: `Credit payment #${id} updated`,
        });
      }
      return updated;
    });
  }

  async remove(id: number, actorId?: number) {
    const existing = await this.prisma.creditPayment.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException(tr('errors.paymentNotFound'));

    return this.prisma.$transaction(async (tx) => {
      if (existing.saleId) {
        await this.revertFromSale(tx, existing.saleId, existing.amount);
      }
      // Remove the GL settlement entry so the ledger reflects the deletion.
      await this.reverseCreditPayment(tx, existing.id).catch(() => {});
      await tx.creditPayment.delete({ where: { id } });
      if (actorId != null) {
        await auditBestEffort(tx, {
          userId: actorId,
          action: 'CREDIT_PAYMENT_DELETED',
          details: `Credit payment #${id} deleted`,
        });
      }
      return { message: 'Payment deleted' };
    });
  }

  /**
   * Validate that the payment can be attributed to the given sale: it must be
   * one of the customer's credit sales and the amount must not exceed what is
   * still owed on it.
   */
  private async assertAttribution(
    tx: Tx,
    customerId: number,
    saleId: number,
    amount: number,
  ) {
    const creditSale = await tx.creditSale.findFirst({
      where: { saleId, customerId },
      include: { sale: true },
    });
    if (!creditSale?.sale) {
      throw new BadRequestException(
        "Payment must be linked to one of the customer's credit sales",
      );
    }
    const remaining = creditSale.sale.remainingAmount;
    if (amount > remaining + 0.0001) {
      throw new BadRequestException(
        tr('errors.creditPaymentExceedsRemaining', { amount, remaining }),
      );
    }
  }

  private async applyToSale(tx: Tx, saleId: number, amount: number) {
    await tx.sale.update({
      where: { id: saleId },
      data: {
        paidAmount: { increment: amount },
        remainingAmount: { decrement: amount },
      },
    });
  }

  private async revertFromSale(tx: Tx, saleId: number, amount: number) {
    await tx.sale.update({
      where: { id: saleId },
      data: {
        paidAmount: { decrement: amount },
        remainingAmount: { increment: amount },
      },
    });
  }

  /** Delete a credit-payment journal entry (its lines cascade) so it can be
   *  re-posted or the payment removed. Idempotent: no entry → no-op. */
  private async reverseCreditPayment(tx: Tx, creditPaymentId: number) {
    const entry = await tx.journalEntry.findFirst({
      where: { tenantId: getCurrentTenantId(), reference: `CRP-${creditPaymentId}` },
      select: { id: true },
    });
    if (entry) await tx.journalEntry.delete({ where: { id: entry.id } });
  }
}