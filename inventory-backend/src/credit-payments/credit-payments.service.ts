import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { asNumericId } from '../common/business-number.util';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

@Injectable()
export class CreditPaymentsService {
  constructor(private prisma: PrismaService) {}

  /** Accept a numeric id or the UUID publicId, returning the numeric key. */
  async resolveCreditPaymentId(ref: string): Promise<number> {
    const numeric = asNumericId(ref);
    if (numeric != null) return numeric;
    const row = await this.prisma.creditPayment.findUnique({
      where: { publicId: ref },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Payment not found');
    return row.id;
  }

  async create(data: {
    customerId: number;
    amount: number;
    notes?: string;
    paymentMethodId?: number;
    saleId?: number | null;
  }) {
    return this.prisma.$transaction(async (tx) => {
      if (data.saleId) {
        await this.assertAttribution(tx, data.customerId, data.saleId, data.amount);
      }
      const payment = await tx.creditPayment.create({ data });
      if (data.saleId) {
        await this.applyToSale(tx, data.saleId, data.amount);
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
  ) {
    const existing = await this.prisma.creditPayment.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Payment not found');

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
      return updated;
    });
  }

  async remove(id: number) {
    const existing = await this.prisma.creditPayment.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Payment not found');

    return this.prisma.$transaction(async (tx) => {
      if (existing.saleId) {
        await this.revertFromSale(tx, existing.saleId, existing.amount);
      }
      await tx.creditPayment.delete({ where: { id } });
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
        `Payment of ${amount} exceeds the remaining balance of ${remaining} for that sale`,
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
}