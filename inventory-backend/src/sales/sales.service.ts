import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TaxDirection } from '@prisma/client';
import { assertNotDuplicate } from '../common/duplicate.util';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { getCurrentTenantId, requireTenantId } from '../common/tenant/tenant.context';
import { resolveTax, round2, splitTax } from '../common/tax.util';
import { FinanceService } from '../finance/finance.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { inventoryFind, inventoryUpsert } from '../common/inventory.util';
import { CreateSaleDto } from './dto/create-sale.dto';
import { ReturnSaleDto } from './dto/return-sale.dto';

// Define the structure of the mapped items we are collecting
interface SaleItemCreationInput {
  productId: number;
  variantId?: number | null;
  batchId?: number | null;
  quantity: number;
  unitSellPrice: number;
  unitBuyPrice: number;
  tenantId?: number | null;
}

@Injectable()
export class SalesService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private finance: FinanceService,
  ) {}

  /** Chart accounts required by the automatic sales posting engine. */
  private requiredPostingAccounts() {
    return ['Sales Revenue', 'Cash', 'Inventory Asset'];
  }

  /**
   * Throw a clear error when the chart of accounts is missing entries the
   * automatic postings need, instead of silently leaving the ledger behind.
   */
  private async assertPostingAccounts(
    tx: Prisma.TransactionClient,
    tenantId: number | null,
    context: string,
  ) {
    if (tenantId == null) return;
    const accounts = await tx.account.findMany({
      where: { tenantId },
      select: { name: true },
    });
    const missing = this.requiredPostingAccounts().filter(
      (name) => !accounts.some((a) => a.name === name),
    );
    if (missing.length > 0) {
      throw new BadRequestException(
        `${context} could not be completed because the automatic ledger posting needs a chart-of-accounts entry that is missing: ${missing.join(', ')}. Add it in Finance -> Accounts, then retry.`,
      );
    }
  }

  /** Post sale income inside the sale transaction; surface missing accounts. */
  private async postSaleIncomeChecked(
    saleId: number,
    tenantId: number,
    tx: Prisma.TransactionClient,
  ) {
    const posted = await this.finance.postSaleIncome(saleId, tenantId, tx);
    if (posted === 0) {
      const existing = await tx.otherIncome
        .findFirst({
          where: { tenantId, source: 'SALE', sourceId: saleId },
        })
        .catch(() => null);
      if (!existing) await this.assertPostingAccounts(tx, tenantId, 'Sale');
    }
    return posted;
  }

  /** Reverse a return's postings; surface missing accounts instead of swallowing. */
  private async reversePostingsChecked(
    returnId: number,
    tenantId: number | null,
    tx: Prisma.TransactionClient,
  ) {
    const reversed = await this.finance.reverseSalePostings(returnId, tenantId, tx);
    if (reversed === 0) {
      const existing = await tx.cogsEntry
        .findFirst({
          where: { tenantId, source: 'SALE_REVERSAL', sourceId: returnId },
        })
        .catch(() => null);
      if (!existing) await this.assertPostingAccounts(tx, tenantId, 'Return reversal');
    }
    return reversed;
  }

  /** Deduct one sale line's stock, resolving variant + FIFO batch allocation. */
  private async deductSaleItem(
    tx: Prisma.TransactionClient,
    args: {
      productId: number;
      variantId: number | null;
      quantity: number;
      shopId: number;
      customPrice?: number;
      tenantId?: number | null;
    },
  ): Promise<SaleItemCreationInput[]> {
    const inventory = await inventoryFind(
      tx,
      {
        productId: args.productId,
        variantId: args.variantId,
        locationId: args.shopId,
      },
      { product: true },
    );
    if (!inventory || inventory.quantity < args.quantity) {
      throw new BadRequestException(
        `Insufficient stock for Product ID: ${args.productId}`,
      );
    }
    const product = inventory.product;

    let sellPrice = args.customPrice ?? product.currentSellPrice;
    let buyPrice = product.currentBuyPrice;
    if (args.variantId != null) {
      const variant = await tx.productVariant.findUnique({
        where: { id: args.variantId },
      });
      if (args.customPrice == null && variant?.sellPrice != null) {
        sellPrice = variant.sellPrice;
      }
      if (variant?.buyPrice != null) {
        buyPrice = variant.buyPrice;
      }
    }

    await tx.inventory.update({
      where: { id: inventory.id },
      data: { quantity: { decrement: args.quantity } },
    });

    const results: SaleItemCreationInput[] = [];
    if (product.isPerishable) {
      const allocs = await this.allocateFifoBatches(tx, {
        productId: args.productId,
        quantity: args.quantity,
      });
      for (const a of allocs) {
        results.push({
          productId: args.productId,
          variantId: args.variantId,
          batchId: a.batchId,
          quantity: a.quantity,
          unitSellPrice: sellPrice,
          unitBuyPrice: buyPrice,
          tenantId: args.tenantId,
        });
      }
    } else {
      results.push({
        productId: args.productId,
        variantId: args.variantId,
        batchId: null,
        quantity: args.quantity,
        unitSellPrice: sellPrice,
        unitBuyPrice: buyPrice,
        tenantId: args.tenantId,
      });
    }
    return results;
  }

  /** FIFO: deduct `quantity` from the earliest-expiring batches. */
  private async allocateFifoBatches(
    tx: Prisma.TransactionClient,
    args: { productId: number; quantity: number },
  ): Promise<{ batchId: number; quantity: number }[]> {
    let remaining = args.quantity;
    const allocs: { batchId: number; quantity: number }[] = [];
    const batches = await tx.productBatch.findMany({
      where: { productId: args.productId, quantity: { gt: 0 } },
      orderBy: [
        { expiryDate: { sort: 'asc', nulls: 'last' } },
        { id: 'asc' },
      ],
    });
    for (const batch of batches) {
      if (remaining <= 0) break;
      const take = Math.min(batch.quantity, remaining);
      await tx.productBatch.update({
        where: { id: batch.id },
        data: { quantity: { decrement: take } },
      });
      allocs.push({ batchId: batch.id, quantity: take });
      remaining -= take;
    }
    if (remaining > 0) {
      throw new BadRequestException(
        `Insufficient batch stock for perishable product (${remaining} unit(s) short)`,
      );
    }
    return allocs;
  }

  /** Restore stock to inventory (and its batch) when a sale is undone/returned. */
  private async restoreSaleItem(
    tx: Prisma.TransactionClient,
    args: {
      productId: number;
      variantId?: number | null;
      batchId?: number | null;
      quantity: number;
      locationId: number;
    },
  ) {
    await inventoryUpsert(tx, {
      tenantId: requireTenantId(),
      productId: args.productId,
      variantId: args.variantId ?? null,
      locationId: args.locationId,
      increment: args.quantity,
    });
    if (args.batchId != null) {
      await tx.productBatch.update({
        where: { id: args.batchId },
        data: { quantity: { increment: args.quantity } },
      });
    }
  }

  /** Human-readable product/variant label used in validation messages. */
  private async describeSaleProduct(
    tx: Prisma.TransactionClient,
    productId: number,
    variantId: number | null,
  ): Promise<string> {
    const p = await tx.product.findFirst({
      where: { id: productId },
      select: { brand: true, baseName: true },
    });
    let label = p ? `${p.brand} ${p.baseName}`.trim() : `Product #${productId}`;
    if (variantId != null) {
      const v = await tx.productVariant.findUnique({
        where: { id: variantId },
        select: { attributes: true },
      });
      const attrs = Object.values(
        (v?.attributes ?? {}) as Record<string, unknown>,
      )
        .filter(Boolean)
        .join(' ');
      if (attrs) label += ` • ${attrs}`;
    }
    return label;
  }

  async createSale(
    dto: CreateSaleDto,
    user: JwtPayload,
    opts: { tx?: Prisma.TransactionClient; requestId?: number } = {},
  ) {
    // Owner must select a shop; shopkeepers use their own location
    const shopId = user.locationId ?? dto.shopId;
    if (!shopId) throw new BadRequestException('Shop location is required');

    const saleType = (dto.saleType ?? 'FULLY_PAID') as any;
    const tenantId = requireTenantId();

    const run = async (tx: Prisma.TransactionClient) => {
      let totalAmount = 0;
      let totalCost = 0;

      const saleItemsData: SaleItemCreationInput[] = [];

      for (const item of dto.items) {
        const results = await this.deductSaleItem(tx, {
          productId: item.productId,
          variantId: item.variantId ?? null,
          quantity: item.quantity,
          shopId,
          customPrice: item.customPrice,
          tenantId,
        });
        for (const r of results) {
          totalAmount += r.unitSellPrice * r.quantity;
          totalCost += r.unitBuyPrice * r.quantity;
          saleItemsData.push(r);
        }
      }

      // Per-company output VAT from the configured default OUTPUT rate.
      // totalAmount stays the gross the customer pays; in exclusive mode the
      // tax is added on top. Profit is computed on net (tax-free) revenue.
      let taxAmount = 0;
      let taxRateId: number | null = null;
      const taxCtx = await resolveTax(tx, tenantId, TaxDirection.OUTPUT);
      if (taxCtx.enabled && taxCtx.rate > 0) {
        const split = splitTax(totalAmount, taxCtx.rate, taxCtx.inclusive);
        taxAmount = split.tax;
        totalAmount = taxCtx.inclusive
          ? totalAmount
          : round2(totalAmount + split.tax);
        taxRateId = taxCtx.rateId;
      }

      const profit = totalAmount - taxAmount - totalCost;

      let paidAmount: number;
      let remainingAmount: number;

      if (saleType === 'FULLY_PAID') {
        paidAmount = totalAmount;
        remainingAmount = 0;
      } else if (saleType === 'PARTIALLY_PAID') {
        paidAmount = dto.paidAmount ?? 0;
        if (paidAmount <= 0) throw new BadRequestException('Paid amount required for partially paid');
        if (paidAmount >= totalAmount) throw new BadRequestException('Paid amount must be less than total');
        remainingAmount = totalAmount - paidAmount;
      } else {
        paidAmount = 0;
        remainingAmount = totalAmount;
      }

      if ((saleType === 'FULLY_PAID' || saleType === 'PARTIALLY_PAID') && !dto.paymentMethodId) {
        throw new BadRequestException('Payment method is required');
      }
      if ((saleType === 'PARTIALLY_PAID' || saleType === 'CREDITED') && !dto.customerId) {
        throw new BadRequestException('Customer is required for credit/partial');
      }

      const sale = await tx.sale.create({
        data: {
          tenantId,
          invoiceNumber: `INV-${Date.now()}`,
          shopId,
          totalAmount,
          totalCost,
          profit,
          taxAmount,
          taxRateId,
          soldById: user.sub,
          paidAmount,
          remainingAmount,
          saleType,
          paymentMethodId: dto.paymentMethodId ?? null,
          customerId: dto.customerId ?? null,
          notes: dto.notes ?? null,
          clientRef: dto.clientRef ?? null,
          requestId: opts.requestId ?? null,
          items: { create: saleItemsData },
        },
      });

      // Universal finance auto-posting: income + COGS + journal for every
      // completed sale (Retail Checkout, Wholesale Invoices, direct sales).
      // Missing chart accounts surface as an error instead of a silent skip.
      await this.postSaleIncomeChecked(sale.id, tenantId, tx);

      if (saleType === 'PARTIALLY_PAID' || saleType === 'CREDITED') {
        await tx.creditSale.create({
          data: {
            tenantId,
            customerId: dto.customerId!,
            saleId: sale.id,
            shopId,
            totalAmount: remainingAmount,
            items: { create: saleItemsData.map((si) => ({
              tenantId, productId: si.productId, quantity: si.quantity, unitPrice: si.unitSellPrice,
            })) },
          },
        });
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          userId: user.sub,
          action: 'SALE',
          details: `Sale #${sale.invoiceNumber}: $${totalAmount.toFixed(2)} (${saleType}) at Shop ID ${shopId}`,
        },
      });

      // Check low stock for each product after sale. This runs through the SAME
      // transaction client: the stock was just decremented inside `tx`, and an
      // outside read would still see the pre-sale quantity and skip the alert.
      for (const item of dto.items) {
        await this.notifications.checkAndNotifyLowStock(
          item.productId,
          shopId,
          tx,
        );
      }

      return sale;
    };

    if (opts.tx) {
      try {
        return await run(opts.tx);
      } catch (err) {
        return assertNotDuplicate(err, 'This sale was already submitted. Please refresh and try again.');
      }
    }
    try {
      return await this.prisma.$transaction(run);
    } catch (err) {
      return assertNotDuplicate(err, 'This sale was already submitted. Please refresh and try again.');
    }
  }

  async findAll(
    user: JwtPayload,
    filters?: {
      locationId?: string;
      categoryId?: string;
      search?: string;
      saleType?: string;
      paymentMethodId?: string;
      dateFrom?: string;
      dateTo?: string;
    },
    paging?: { page: number; pageSize: number; enabled?: boolean },
  ) {
    const where: Record<string, unknown> = {};

    // A user with a location only sees the sales recorded at that location. Both
    // counter types sell from their own location (`createSale` books the sale at
    // `user.locationId`), so STORE users used to get `shopId: -1` — an always
    // empty list, including the very sale they had just made.
    if (user.locationId) {
      where.shopId = user.locationId;
    } else if (filters?.locationId) {
      where.shopId = Number(filters.locationId);
    }

    if (filters?.dateFrom && filters?.dateTo) {
      (where as any).saleDate = {
        gte: new Date(`${filters.dateFrom}T00:00:00`),
        lte: new Date(`${filters.dateTo}T23:59:59`),
      };
    }
    if (filters?.categoryId) {
      (where as any).items = {
        some: { product: { categoryId: Number(filters.categoryId) } },
      };
    }
    if (filters?.saleType) {
      (where as any).saleType = filters.saleType;
    }
    if (filters?.paymentMethodId) {
      (where as any).saleType = { not: 'CREDITED' };
      (where as any).paymentMethodId = Number(filters.paymentMethodId);
    }
    const q = (filters?.search ?? '').trim().toLowerCase();
    if (q) {
      (where as any).OR = [
        { invoiceNumber: { contains: q, mode: 'insensitive' } },
        { customer: { name: { contains: q, mode: 'insensitive' } } },
        { purchase: { productName: { contains: q, mode: 'insensitive' } } },
        {
          items: {
            some: {
              product: {
                OR: [
                  { brand: { contains: q, mode: 'insensitive' } },
                  { baseName: { contains: q, mode: 'insensitive' } },
                ],
              },
            },
          },
        },
      ];
    }

    const include = {
      items: { include: { product: true, variant: true, batch: true } },
      shop: true,
      paymentMethod: true,
      customer: true,
      purchase: true,
      soldBy: true,
      fiscalReceipt: true,
      returns: {
        include: { items: { select: { unitBuyPrice: true, quantity: true } } },
      },
    };

    const list = () =>
      this.prisma.sale.findMany({
        where,
        include,
        orderBy: { saleDate: 'desc' },
      });

    // Page rows need a summary over the SAME filtered set (not just the page
    // window) so the Payments tab totals and fiscal-print grouping never drift.
    if (!paging?.enabled) return list();

    const all = await list();
    const returnedFor = (s: any) =>
      (s.returns || []).reduce(
        (sum: number, r: any) => sum + (r.totalRefund || 0),
        0,
      );

    const pmap = new Map<string, number>();
    for (const s of all) {
      const name =
        s.saleType === 'CREDITED'
          ? 'Credit'
          : s.paymentMethod?.name || 'Unspecified';
      pmap.set(name, (pmap.get(name) || 0) + Math.max(0, s.totalAmount - returnedFor(s)));
    }
    const paymentBreakdown = Array.from(pmap.entries())
      .map(([method, total]) => ({ method, total }))
      .sort((a, b) => b.total - a.total);

    const byCust = new Map<
      number,
      { label: string; saleIds: number[]; total: number }
    >();
    for (const s of all) {
      if (
        s.saleType !== 'FULLY_PAID' ||
        s.fiscalStatus === 'PRINTED' ||
        s.customerId == null
      ) {
        continue;
      }
      const g =
        byCust.get(s.customerId) ?? {
          label: s.customer?.name ?? `Customer #${s.customerId}`,
          saleIds: [],
          total: 0,
        };
      g.saleIds.push(s.id);
      g.total += s.totalAmount ?? 0;
      byCust.set(s.customerId, g);
    }
    const saleGroups = Array.from(byCust.entries()).map(
      ([customerId, g]) => ({
        customerId,
        label: g.label,
        saleIds: g.saleIds,
        count: g.saleIds.length,
        total: g.total,
      }),
    );

    const start = (paging.page - 1) * paging.pageSize;
    return {
      data: all.slice(start, start + paging.pageSize),
      total: all.length,
      page: paging.page,
      pageSize: paging.pageSize,
      summary: { paymentBreakdown, saleGroups },
    };
  }

  async findOne(id: number, user: JwtPayload) {
    const where: Record<string, unknown> = { id };

    // Same scoping as findAll: a user with a location sees sales booked at that
    // location (a storekeeper's own sale used to be unreachable by id).
    if (user.locationId) {
      where.shopId = user.locationId;
    }

    const sale = await this.prisma.sale.findFirst({
      where,
      include: {
        items: { include: { product: true, variant: true, batch: true } },
        shop: true,
        paymentMethod: true,
        customer: true,
        purchase: true,
        soldBy: true,
        fiscalReceipt: true,
        returns: {
          include: { items: { select: { unitBuyPrice: true, quantity: true } } },
        },
      },
    });

    if (!sale) throw new NotFoundException('Sale not found');
    return sale;
  }

  /**
   * Refresh auto-posted ledger entries after a sale edit: wipe the original
   * SALE journal/income/COGS (plus existing RTRN reversals) and re-post against
   * the current totals so the ledger always mirrors the edited sale.
   */
  private async refreshSalePostings(
    tx: Prisma.TransactionClient,
    saleId: number,
    tenantId: number,
  ) {
    const returns = await tx.return.findMany({
      where: { saleId },
      select: { id: true },
    });
    const references = [`SALE-${saleId}`, ...returns.map((r) => `RTRN-${r.id}`)];
    await tx.otherIncome.deleteMany({
      where: { tenantId, source: 'SALE', sourceId: saleId },
    });
    await tx.cogsEntry.deleteMany({
      where: {
        tenantId,
        OR: [
          { source: 'SALE', sourceId: saleId },
          { source: 'SALE_REVERSAL', saleId },
        ],
      },
    });
    await tx.journalEntry.deleteMany({
      where: { tenantId, reference: { in: references } },
    });
    await this.postSaleIncomeChecked(saleId, tenantId, tx);
    for (const r of returns) {
      await this.reversePostingsChecked(r.id, tenantId, tx);
    }
  }

  async updateSale(id: number, dto: CreateSaleDto, user: JwtPayload) {
    const tenantId = requireTenantId();
    return this.prisma.$transaction(async (tx) => {
      // 1. Find old sale
      const oldSale = await tx.sale.findUnique({
        where: { id },
        include: { items: true, creditSale: true },
      });
      if (!oldSale) throw new NotFoundException('Sale not found');

      // Determine shopId: owner uses dto.shopId or old sale's shopId, shopkeeper uses their location
      const shopId = user.locationId ?? dto.shopId ?? oldSale.shopId;
      if (!shopId) throw new BadRequestException('Shop location is required');

      // 2. Restore old inventory
      for (const oldItem of oldSale.items) {
        await this.restoreSaleItem(tx, {
          productId: oldItem.productId,
          variantId: oldItem.variantId,
          batchId: oldItem.batchId,
          quantity: oldItem.quantity,
          locationId: oldSale.shopId,
        });
      }

      // Original allocated quantities per product+variant so the delta
      // validation below reports availability that includes what this very
      // sale already owns (stock was restored above, so `available` after the
      // restore already equals currentStock + originalQty).
      const originalByKey = new Map<string, number>();
      for (const oi of oldSale.items) {
        const key = `${oi.productId}:${oi.variantId ?? ''}`;
        originalByKey.set(key, (originalByKey.get(key) ?? 0) + oi.quantity);
      }

      // 3. Process new items
      let totalAmount = 0;
      let totalCost = 0;
      const saleItemsData: SaleItemCreationInput[] = [];

      for (const item of dto.items) {
        // Delta-aware validation: only the increase above the original
        // allocation needs to be covered by stock available at this shop.
        const originalQty = originalByKey.get(
          `${item.productId}:${item.variantId ?? ''}`,
        ) ?? 0;
        const quantityDelta = item.quantity - originalQty;
        if (quantityDelta > 0) {
          const inventory = await inventoryFind(tx, {
            productId: item.productId,
            variantId: item.variantId ?? null,
            locationId: shopId,
          });
          // After the restore above the row already contains the original
          // allocation, so the pre-edit stock is available - originalQty.
          const currentStock = Math.max(0, (inventory?.quantity ?? 0) - originalQty);
          if (quantityDelta > currentStock) {
            const name = await this.describeSaleProduct(
              tx,
              item.productId,
              item.variantId ?? null,
            );
            throw new BadRequestException(
              `Cannot sell ${item.quantity}x "${name}". Only ${currentStock + originalQty} available.`,
            );
          }
        }
        const results = await this.deductSaleItem(tx, {
          productId: item.productId,
          variantId: item.variantId ?? null,
          quantity: item.quantity,
          shopId,
          customPrice: item.customPrice,
          tenantId,
        });
        for (const r of results) {
          totalAmount += r.unitSellPrice * r.quantity;
          totalCost += r.unitBuyPrice * r.quantity;
          saleItemsData.push(r);
        }
      }

      // 4. Determine payment fields
      const saleType = (dto.saleType ?? oldSale.saleType) as any;
      let paidAmount: number;
      let remainingAmount: number;

      if (saleType === 'FULLY_PAID') {
        paidAmount = totalAmount;
        remainingAmount = 0;
      } else if (saleType === 'PARTIALLY_PAID') {
        paidAmount = dto.paidAmount ?? oldSale.paidAmount;
        if (paidAmount <= 0) throw new BadRequestException('Paid amount required');
        if (paidAmount >= totalAmount) throw new BadRequestException('Paid amount must be less than total');
        remainingAmount = totalAmount - paidAmount;
      } else {
        paidAmount = 0;
        remainingAmount = totalAmount;
      }

      // 5. Delete old items and update sale
      await tx.saleItem.deleteMany({ where: { saleId: id } });
      const updated = await tx.sale.update({
        where: { id },
        data: {
          shopId,
          totalAmount,
          totalCost,
          profit: totalAmount - totalCost,
          paidAmount,
          remainingAmount,
          saleType,
          paymentMethodId: dto.paymentMethodId ?? oldSale.paymentMethodId,
          customerId: dto.customerId !== undefined ? dto.customerId : oldSale.customerId,
          notes: dto.notes !== undefined ? dto.notes : oldSale.notes,
          items: { create: saleItemsData },
        },
      });

      // 6. Handle credit sale
      if (oldSale.creditSale) {
        await tx.creditSale.delete({ where: { id: oldSale.creditSale.id } });
      }
      if (saleType === 'PARTIALLY_PAID' || saleType === 'CREDITED') {
        if (!dto.customerId && !oldSale.customerId)
          throw new BadRequestException('Customer is required');
        await tx.creditSale.create({
          data: {
            tenantId,
            customerId: (dto.customerId ?? oldSale.customerId)!,
            saleId: id,
            shopId,
            totalAmount: remainingAmount,
            items: { create: saleItemsData.map((si) => ({
              tenantId, productId: si.productId, quantity: si.quantity, unitPrice: si.unitSellPrice,
            })) },
          },
        });
      }

      // Refresh the auto-posted ledger entries so they mirror the edited
      // sale (income, COGS, journal and any existing return reversals).
      await this.refreshSalePostings(tx, id, tenantId);

      await tx.auditLog.create({
        data: {
          tenantId,
          userId: user.sub,
          action: 'UPDATE_SALE',
          details: `Updated sale #${oldSale.invoiceNumber}: $${totalAmount.toFixed(2)} (${saleType})`,
        },
      });

      return updated;
    }).then(async (updated) => {
      for (const item of dto.items) {
        await this.notifications.checkAndNotifyLowStock(item.productId, updated.shopId);
      }
      return updated;
    });
  }

  async removeSale(id: number, user: JwtPayload) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: {
        items: true,
        returns: { include: { items: true } },
        creditSale: true,
      },
    });
    if (!sale) throw new NotFoundException('Sale not found');

    if (user.locationId !== null && user.locationId !== sale.shopId) {
      throw new ForbiddenException('You can only delete sales from your own shop');
    }

    await this.prisma.$transaction(async (tx) => {
      // 1. Restock: sold quantity minus already-returned quantity per product
      const returnedByProduct = new Map<number, number>();
      for (const r of sale.returns) {
        for (const ri of r.items) {
          returnedByProduct.set(
            ri.productId,
            (returnedByProduct.get(ri.productId) ?? 0) + ri.quantity,
          );
        }
      }
      for (const item of sale.items) {
        const toRestock = item.quantity - (returnedByProduct.get(item.productId) ?? 0);
        if (toRestock <= 0) continue;
        await this.restoreSaleItem(tx, {
          productId: item.productId,
          variantId: item.variantId,
          batchId: item.batchId,
          quantity: toRestock,
          locationId: sale.shopId,
        });
      }

      // 2. Delete the sale's returns + their cash OUTFLOW refund entries
      const returnIds = sale.returns.map((r) => r.id);
      if (returnIds.length > 0) {
        await tx.cashEntry.deleteMany({
          where: { source: 'RETURN', refId: { in: returnIds } },
        });
        await tx.return.deleteMany({ where: { saleId: id } });
      }

      // 2.5 Wipe auto-posted finance entries (income, COGS, journal) for this
      // sale and its returns so the ledger stays in sync with the deletion.
      await tx.otherIncome.deleteMany({
        where: { tenantId: sale.tenantId ?? null, source: 'SALE', sourceId: id },
      });
      await tx.cogsEntry.deleteMany({
        where: { tenantId: sale.tenantId ?? null, saleId: id },
      });
      await tx.journalEntry.deleteMany({
        where: {
          tenantId: sale.tenantId ?? null,
          reference: {
            in: [`SALE-${id}`, ...returnIds.map((r) => `RTRN-${r}`)],
          },
        },
      });

      // 3. Delete the credit sale entirely
      await tx.creditSale.deleteMany({ where: { saleId: id } });

      // 4. Wipe linked credit payments so payment-channel reports stay accurate
      await tx.creditPayment.deleteMany({ where: { saleId: id } });

      // 5. Delete the sale (sale items cascade; purchase link nulls)
      await tx.sale.delete({ where: { id } });

      await tx.auditLog.create({
        data: {
          userId: user.sub,
          action: 'SALE_DELETED',
          details: `Deleted sale #${sale.invoiceNumber}: $${sale.totalAmount.toFixed(2)} (${sale.saleType}) — restocked items`,
        },
      });
    });

    return { message: 'Sale deleted' };
  }

  async removeReturn(id: number, user: JwtPayload, restore: boolean) {
    const ret = await this.prisma.return.findUnique({
      where: { id },
      include: {
        items: true,
        sale: { include: { creditSale: true, items: true } },
      },
    });
    if (!ret) throw new NotFoundException('Return not found');

    if (user.locationId !== null && user.locationId !== ret.shopId) {
      throw new ForbiddenException('You can only delete returns from your own shop');
    }

    const sale = ret.sale;
    const returnedCost = ret.items.reduce(
      (sum, ri) => sum + ri.unitBuyPrice * ri.quantity,
      0,
    );

    await this.prisma.$transaction(async (tx) => {
      // Reverse the restock in BOTH modes: the item leaves stock again
      // (re-sold for "full undo", written off for "damaged").
      for (const ri of ret.items) {
        const inv = await inventoryFind(tx, {
          productId: ri.productId,
          locationId: ret.shopId,
        });
        if (inv) {
          await tx.inventory.update({
            where: { id: inv.id },
            data: { quantity: { decrement: ri.quantity } },
          });
        }
      }

      if (restore) {
        // Full undo: the refund never happened — remove the cash OUTFLOW entry
        await tx.cashEntry.deleteMany({
          where: { source: 'RETURN', refId: id },
        });

        // Restore the credit balance the return had reduced
        if (sale && sale.saleType !== 'FULLY_PAID') {
          const newRemaining = sale.remainingAmount + ret.totalRefund;
          await tx.sale.update({
            where: { id: sale.id },
            data: { remainingAmount: newRemaining },
          });
          if (sale.creditSale) {
            await tx.creditSale.update({
              where: { id: sale.creditSale.id },
              data: { totalAmount: sale.creditSale.totalAmount + ret.totalRefund },
            });
          } else if (sale.customerId && newRemaining > 0) {
            // Credit sale had been fully paid off by the return — recreate it
            await tx.creditSale.create({
              data: {
                customerId: sale.customerId,
                saleId: sale.id,
                shopId: sale.shopId,
                totalAmount: newRemaining,
                items: {
                  create: sale.items.map((si) => ({
                    productId: si.productId,
                    quantity: si.quantity,
                    unitPrice: si.unitSellPrice,
                  })),
                },
              },
            });
          }
        }
      } else if (sale) {
        // Written off: the refund stands, so bake it into the sale so reports
        // stay reduced even after the return record is gone.
        const newTotal = Math.max(0, sale.totalAmount - ret.totalRefund);
        const newCost = Math.max(0, sale.totalCost - returnedCost);
        const newPaid =
          sale.saleType === 'FULLY_PAID'
            ? Math.max(0, sale.paidAmount - ret.totalRefund)
            : sale.paidAmount;
        await tx.sale.update({
          where: { id: sale.id },
          data: {
            totalAmount: newTotal,
            totalCost: newCost,
            profit: newTotal - newCost,
            paidAmount: newPaid,
          },
        });
        // Cash OUTFLOW entry + remainingAmount/creditSale stay as-is
      }

      await tx.return.delete({ where: { id } });

      // Wipe the finance reversal entries tied to this return.
      await tx.cogsEntry.deleteMany({
        where: {
          tenantId: sale?.tenantId ?? null,
          source: 'SALE_REVERSAL',
          sourceId: id,
        },
      });
      await tx.journalEntry.deleteMany({
        where: { tenantId: sale?.tenantId ?? null, reference: `RTRN-${id}` },
      });

      await tx.auditLog.create({
        data: {
          userId: user.sub,
          action: 'RETURN_DELETED',
          details: `Deleted return #${id}: $${ret.totalRefund.toFixed(2)} refund (${restore ? 'full undo' : 'written off'})`,
        },
      });
    });

    return { message: 'Return deleted' };
  }

  async returnSale(saleId: number, dto: ReturnSaleDto, user: JwtPayload) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: {
        items: { include: { product: true, variant: true, batch: true } },
        returns: { include: { items: true } },
        creditSale: true,
      },
    });
    if (!sale) throw new NotFoundException('Sale not found');

    if (user.locationId !== null && user.locationId !== sale.shopId) {
      throw new ForbiddenException('You can only return sales from your own shop');
    }

    const tenantId = requireTenantId();

    return this.prisma.$transaction(async (tx) => {
      let totalRefund = 0;
      const returnItemsData: { productId: number; quantity: number; unitPrice: number; unitBuyPrice: number; tenantId?: number | null }[] = [];

      for (const item of dto.items) {
        const saleItem = sale.items.find((i) => i.productId === item.productId);
        if (!saleItem) {
          throw new BadRequestException(`Product ${item.productId} was not in this sale`);
        }

        const alreadyReturned = sale.returns.reduce(
          (sum, r) =>
            sum +
            r.items
              .filter((ri) => ri.productId === item.productId)
              .reduce((s, ri) => s + ri.quantity, 0),
          0,
        );
        const maxReturnable = saleItem.quantity - alreadyReturned;
        if (item.quantity > maxReturnable) {
          throw new BadRequestException(
            `Cannot return ${item.quantity} of product ${item.productId} (max ${maxReturnable})`,
          );
        }

        // Restore inventory at the shop (variant + batch aware)
        await this.restoreSaleItem(tx, {
          productId: item.productId,
          variantId: saleItem.variantId,
          batchId: saleItem.batchId,
          quantity: item.quantity,
          locationId: sale.shopId,
        });

        const refund = saleItem.unitSellPrice * item.quantity;
        totalRefund += refund;
        returnItemsData.push({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: saleItem.unitSellPrice,
          tenantId,
          unitBuyPrice: saleItem.unitBuyPrice,
        });
      }

      const created = await tx.return.create({
        data: {
          tenantId,
          saleId,
          shopId: sale.shopId,
          totalRefund,
          reason: dto.reason,
          refundMethodId: dto.refundMethodId ?? null,
          createdById: user.sub,
          items: { create: returnItemsData },
        },
        include: { items: true },
      });

      // Universal finance: reverse the auto-posted income/COGS for the
      // returned items (restore inventory, reduce COGS, reverse cash/AR).
      // Missing chart accounts surface as an error instead of a silent skip.
      const returnHasValue =
        created.totalRefund > 0 ||
        (created.items ?? []).some((ri) => (ri.unitBuyPrice ?? 0) * ri.quantity > 0);
      if (returnHasValue) {
        await this.reversePostingsChecked(created.id, tenantId, tx);
      } else {
        await this.finance.reverseSalePostings(created.id, tenantId, tx);
      }

      // Money side: refund cash out, or reduce the outstanding credit balance
      if (sale.saleType === 'FULLY_PAID') {
        await tx.cashEntry.create({
          data: {
            shopId: sale.shopId,
            type: 'OUTFLOW',
            amount: totalRefund,
            source: 'RETURN',
            refId: created.id,
            description: `Refund for sale #${sale.invoiceNumber}`,
            createdById: user.sub,
          },
        });
      } else if (sale.creditSale || sale.remainingAmount > 0) {
        const newRemaining = Math.max(0, sale.remainingAmount - totalRefund);
        await tx.sale.update({
          where: { id: sale.id },
          data: { remainingAmount: newRemaining },
        });
        if (sale.creditSale) {
          const newCredit = Math.max(0, sale.creditSale.totalAmount - totalRefund);
          if (newCredit <= 0) {
            await tx.creditSale.delete({ where: { id: sale.creditSale.id } });
          } else {
            await tx.creditSale.update({
              where: { id: sale.creditSale.id },
              data: { totalAmount: newCredit },
            });
          }
        }
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          userId: user.sub,
          action: 'RETURN_SALE',
          details: `Returned items from sale #${sale.invoiceNumber}: ${totalRefund.toFixed(2)} refund`,
        },
      });

      return created;
    }).then(async (created) => {
      for (const item of dto.items) {
        await this.notifications.checkAndNotifyLowStock(item.productId, sale.shopId);
      }
      return created;
    });
  }

  async findReturns(user: JwtPayload) {
    return this.prisma.return.findMany({
      where:
        user.locationId === null
          ? {}
          : { shopId: user.locationId ?? undefined },
      include: {
        items: { include: { product: true } },
        sale: { select: { invoiceNumber: true } },
        shop: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
