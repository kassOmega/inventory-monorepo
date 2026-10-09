// src/purchases/purchases.service.ts
// Unified purchases service. A "quick purchase" (bought and paid for from the
// till) and a "credit purchase" (taken from a vendor on credit) are the *same*
// record — Purchase — separated only by `paymentType`:
//
//   PAID   → approval flips the goods through a linked sale and moves cash
//            (Inventory ↔ Cash) exactly as before.
//   CREDIT → approval only recognises the payable (Inventory ↔ Accounts
//            Payable); the vendor is then paid back through PurchasePayment
//            rows which clear the payable (Accounts Payable ↔ Cash).
//
// Both share one form, one table and one set of endpoints; the shop is either
// the user's own location (shopkeeper) or the one they picked (owner).
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  PurchasePaymentStatus,
  PurchaseStatus,
  TaxDirection,
} from '@prisma/client';
import { asNumericId } from '../common/business-number.util';
import { assertNotDuplicate } from '../common/duplicate.util';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { resolveTax, round2, splitTax } from '../common/tax.util';
import { requireTenantId } from '../common/tenant/tenant.context';
import { FinanceService } from '../finance/finance.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { tr } from '../i18n/i18n.service';

type Tx = Prisma.TransactionClient;
type PaymentType = 'PAID' | 'CREDIT';

/** One bought line. */
export interface PurchaseLine {
  productName: string;
  quantity: number;
  unitPrice: number;
  sellPrice?: number;
}

/** Fields shared by every line of a single submission. */
export interface PurchaseBatch {
  /** 'PAID' (default) or 'CREDIT' — validated at the DTO edge. */
  paymentType?: string;
  vendorCustomerId?: number;
  shopId?: number;
  paymentMethodId?: number;
  notes?: string;
  clientRef?: string;
}

/** Everything the list/table needs in one go. */
const PURCHASE_INCLUDE = {
  shop: true,
  sale: true,
  paymentMethod: true,
  vendorCustomer: true,
  payments: { include: { paymentMethod: true }, orderBy: { paidAt: 'desc' } },
} satisfies Prisma.PurchaseInclude;

/** Filters accepted by the list and by both stat blocks. */
export interface PurchaseFilters {
  status?: string;
  paymentStatus?: string;
  paymentType?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  shopId?: number;
  vendorCustomerId?: number;
}

@Injectable()
export class PurchasesService {
  private readonly logger = new Logger(PurchasesService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private finance: FinanceService,
  ) {}

  // --- Creation -----------------------------------------------------------

  /** Single-line create (legacy shape). */
  async create(dto: PurchaseLine & PurchaseBatch, user: JwtPayload) {
    const [purchase] = await this.createMany([dto], dto, user);
    return purchase;
  }

  /** Multi-line create (what the form posts): one row per line, one batch. */
  async createBulk(
    dto: PurchaseBatch & { items?: PurchaseLine[]; cart?: PurchaseLine[] },
    user: JwtPayload,
  ) {
    const items = dto.items ?? dto.cart ?? [];
    if (!items.length)
      throw new BadRequestException(tr('errors.purchaseItemsRequired'));
    return this.createMany(items, dto, user);
  }

  private async createMany(
    lines: PurchaseLine[],
    meta: PurchaseBatch,
    user: JwtPayload,
  ) {
    const shop = await this.resolveShop(user, meta.shopId);
    const paymentType: PaymentType =
      meta.paymentType === 'CREDIT' ? 'CREDIT' : 'PAID';

    // A credit purchase must name the vendor we owe; a paid one may name one.
    let vendorCustomerId: number | null = meta.vendorCustomerId ?? null;
    if (paymentType === 'CREDIT' && !vendorCustomerId)
      throw new BadRequestException(tr('errors.vendorRequired'));
    if (vendorCustomerId) {
      const vendor = await this.prisma.customer.findUnique({
        where: { id: Number(vendorCustomerId) },
        select: { id: true },
      });
      if (!vendor) throw new BadRequestException(tr('errors.customerNotFound'));
      vendorCustomerId = vendor.id;
    } else {
      vendorCustomerId = null;
    }

    // Only the paid side draws from a till up front; credit rows settle later.
    const paymentMethodId =
      paymentType === 'PAID'
        ? await this.resolvePaymentMethod(meta.paymentMethodId)
        : null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created: Array<
          Prisma.PurchaseGetPayload<{ include: typeof PURCHASE_INCLUDE }>
        > = [];
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const totalCost = round2(line.unitPrice * line.quantity);
          const sellPrice = line.sellPrice ?? 0;
          // Only a paid purchase carries a sell side of its own (the flip
          // sale); a credit purchase's economics come out of the later resale.
          const revenue =
            paymentType === 'PAID' ? round2(sellPrice * line.quantity) : 0;
          created.push(
            await tx.purchase.create({
              data: {
                shopId: shop.id,
                productName: line.productName,
                quantity: line.quantity,
                unitPrice: line.unitPrice,
                sellPrice,
                totalCost,
                revenue,
                profit: revenue - totalCost,
                status: PurchaseStatus.PENDING,
                paymentType,
                paymentStatus:
                  paymentType === 'PAID'
                    ? PurchasePaymentStatus.PAID
                    : PurchasePaymentStatus.UNPAID,
                amountPaid: 0,
                vendorCustomerId,
                createdById: user.sub,
                paymentMethodId,
                notes: meta.notes ?? null,
                // Per-line key: a retried batch can never double-book a line.
                clientRef: meta.clientRef ? `${meta.clientRef}:${i}` : null,
              },
              include: PURCHASE_INCLUDE,
            }),
          );
        }

        // One notification for the whole batch, so the owner approves a basket
        // instead of a stream of single-line pings.
        const first = created[0];
        const title =
          paymentType === 'CREDIT'
            ? 'Credit Purchase Request'
            : 'Quick Purchase Request';
        const body =
          created.length === 1
            ? `${first.productName} × ${first.quantity} — buy ${first.unitPrice.toFixed(2)} / sell ${first.sellPrice.toFixed(2)} birr (${shop.name})`
            : `${created.length} items — buy ${created
                .reduce((s, p) => s + p.totalCost, 0)
                .toFixed(2)} / sell ${created
                .reduce((s, p) => s + p.revenue, 0)
                .toFixed(2)} birr (${shop.name})`;
        await this.notifications.notifyOwner(title, body, {
          locationId: shop.id,
          type: 'PO_DRAFT',
          // One key per purchase batch — the same batch never re-notifies.
          dedupeKey: `PO_DRAFT:${created.map((c) => c.id).join('-')}`,
        });

        return created;
      });
    } catch (err) {
      return assertNotDuplicate(err, 'errors.purchaseAlreadySubmitted');
    }
  }

  /** Owning shop: the user's own location, else the shop an owner picked. */
  private async resolveShop(user: JwtPayload, shopId?: number) {
    const id = user.locationId ?? (shopId ? Number(shopId) : null);
    if (!id) throw new BadRequestException(tr('errors.shopRequired'));
    const shop = await this.prisma.location.findUnique({ where: { id } });
    if (!shop || shop.type !== 'SHOP')
      throw new ForbiddenException(tr('errors.onlyShopkeepersCreatePurchases'));
    return shop;
  }

  /** Explicit method, else the "Cash" default. */
  private async resolvePaymentMethod(paymentMethodId?: number) {
    if (paymentMethodId) return Number(paymentMethodId);
    const cash = await this.prisma.paymentMethod.findFirst({
      where: { name: { equals: 'Cash', mode: 'insensitive' } },
    });
    if (!cash) throw new BadRequestException(tr('errors.cashMethodRequired'));
    return cash.id;
  }

  // --- Reads --------------------------------------------------------------

  async findAll(user: JwtPayload, filters: PurchaseFilters = {}) {
    return this.prisma.purchase.findMany({
      where: this.buildWhere(user, filters),
      include: PURCHASE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** One purchase by numeric id or publicId (deep links, detail views). */
  async findOne(ref: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id: await this.resolvePurchaseId(ref) },
      include: PURCHASE_INCLUDE,
    });
    if (!purchase) throw new NotFoundException(tr('errors.purchaseNotFound'));
    return purchase;
  }

  /** Shared filter builder for the list and for both stat blocks. */
  private buildWhere(
    user: JwtPayload,
    filters: PurchaseFilters,
  ): Prisma.PurchaseWhereInput {
    const where: Prisma.PurchaseWhereInput = {};
    if (filters.paymentType)
      where.paymentType = filters.paymentType as PaymentType;
    if (filters.status) where.status = filters.status as PurchaseStatus;
    if (filters.paymentStatus)
      where.paymentStatus = filters.paymentStatus as PurchasePaymentStatus;
    if (filters.vendorCustomerId)
      where.vendorCustomerId = Number(filters.vendorCustomerId);
    // A shopkeeper sees their shop's purchases; the owner either everything or
    // the one shop they filtered on.
    if (user.locationType === 'SHOP' && user.locationId != null) {
      where.shopId = user.locationId;
    } else if (filters.shopId) {
      where.shopId = Number(filters.shopId);
    }
    if (filters.search)
      where.productName = { contains: filters.search, mode: 'insensitive' };
    if (filters.startDate && filters.endDate) {
      const endOfDay = new Date(filters.endDate);
      endOfDay.setHours(23, 59, 59, 999);
      where.createdAt = { gte: new Date(filters.startDate), lte: endOfDay };
    }
    return where;
  }

  /**
   * Both stat blocks in one round trip: the paid side (cost / revenue / profit /
   * pending) and the credit side (taken / paid back / still to pay / counts).
   */
  async stats(user: JwtPayload, filters: PurchaseFilters = {}) {
    const base = this.buildWhere(user, filters);
    const paidWhere: Prisma.PurchaseWhereInput = {
      ...base,
      paymentType: 'PAID',
    };
    const creditWhere: Prisma.PurchaseWhereInput = {
      ...base,
      paymentType: 'CREDIT',
    };

    const [paidRows, paidPending, creditRows, creditPending] =
      await Promise.all([
        this.prisma.purchase.findMany({
          where: { ...paidWhere, status: PurchaseStatus.APPROVED },
          select: { totalCost: true, revenue: true, profit: true },
        }),
        this.prisma.purchase.count({
          where: { ...paidWhere, status: PurchaseStatus.PENDING },
        }),
        this.prisma.purchase.findMany({
          where: { ...creditWhere, status: PurchaseStatus.APPROVED },
          select: { totalCost: true, amountPaid: true, paymentStatus: true },
        }),
        this.prisma.purchase.count({
          where: { ...creditWhere, status: PurchaseStatus.PENDING },
        }),
      ]);

    const totalTaken = round2(creditRows.reduce((s, r) => s + r.totalCost, 0));
    const totalPaidToVendor = round2(
      creditRows.reduce((s, r) => s + r.amountPaid, 0),
    );

    return {
      paid: {
        totalCost: round2(paidRows.reduce((s, r) => s + r.totalCost, 0)),
        totalRevenue: round2(paidRows.reduce((s, r) => s + r.revenue, 0)),
        totalProfit: round2(paidRows.reduce((s, r) => s + r.profit, 0)),
        approvedCount: paidRows.length,
        pendingCount: paidPending,
      },
      credit: {
        totalTaken,
        totalPaidToVendor,
        totalRemainingToPay: round2(totalTaken - totalPaidToVendor),
        unpaidCount: creditRows.filter((r) => r.paymentStatus === 'UNPAID')
          .length,
        partiallyPaidCount: creditRows.filter(
          (r) => r.paymentStatus === 'PARTIALLY_PAID',
        ).length,
        settledCount: creditRows.filter((r) => r.paymentStatus === 'PAID')
          .length,
        pendingCount: creditPending,
      },
    };
  }

  // --- Approval -----------------------------------------------------------

  /**
   * Approve a submitted purchase. The fork is the whole point of the unified
   * model: PAID flips the goods through a sale and moves cash, CREDIT only
   * recognises the payable (cleared later through vendor payments).
   */
  async approve(id: number, user: JwtPayload) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: { sale: true },
    });
    if (!purchase) throw new BadRequestException(tr('errors.purchaseNotFound'));
    if (purchase.status !== PurchaseStatus.PENDING)
      throw new BadRequestException(tr('errors.purchaseNotPending'));
    if (purchase.sale)
      throw new BadRequestException(tr('errors.purchaseHasLinkedSale'));

    if (purchase.paymentType === 'CREDIT') {
      return this.approveCredit(purchase, user);
    }
    return this.approvePaid(purchase, user);
  }

  /**
   * Paid purchase: the shop already handed over cash, so approval books the
   * flip sale (goods in for `totalCost`, sold for `revenue`) and moves cash.
   */
  private async approvePaid(
    purchase: Prisma.PurchaseGetPayload<{ include: { sale: true } }>,
    user: JwtPayload,
  ) {
    const shopId = purchase.shopId;
    const soldById = purchase.createdById ?? user.sub;

    return this.prisma.$transaction(async (tx) => {
      const tenantId = requireTenantId();

      // 0. Claim the approval before anything is written. The pre-read above is
      // advisory only: two approvals racing on the same row would each create a
      // flip sale and a pair of cash entries. This conditional update is the
      // compare-and-set that decides the winner (the loser writes nothing).
      await this.claimApproval(tx, purchase.id, user.sub, {
        amountPaid: purchase.totalCost,
        paymentStatus: PurchasePaymentStatus.PAID,
      });

      // Output VAT snapshot for the flip sale — same rule as
      // sales.service.createSale. totalAmount is the gross the customer pays;
      // in exclusive mode the tax is added on top. Profit is computed on net
      // (tax-free) revenue.
      let totalAmount = purchase.revenue;
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
      const profit = totalAmount - taxAmount - purchase.totalCost;

      // 1. Linked sale record (the flip's sell side)
      const sale = await tx.sale.create({
        data: {
          tenantId,
          invoiceNumber: `INV-${Date.now()}`,
          shopId,
          totalAmount,
          totalCost: purchase.totalCost,
          profit,
          taxAmount,
          taxRateId,
          soldById,
          paidAmount: totalAmount,
          remainingAmount: 0,
          saleType: 'FULLY_PAID',
          paymentMethodId: purchase.paymentMethodId,
          purchaseId: purchase.id,
          notes: `Quick purchase: ${purchase.productName}`,
        },
      });

      // 2. Cash ledger: money out (buy cost) then money in (sell revenue)
      await tx.cashEntry.create({
        data: {
          shopId,
          type: 'OUTFLOW',
          amount: purchase.totalCost,
          source: 'PURCHASE',
          refId: purchase.id,
          description: `Quick purchase: ${purchase.productName}`,
          createdById: soldById,
        },
      });
      await tx.cashEntry.create({
        data: {
          shopId,
          type: 'INFLOW',
          amount: totalAmount,
          source: 'SALE',
          refId: sale.id,
          description: `Quick sale: ${purchase.productName}`,
          createdById: soldById,
        },
      });

      // 2.5 Universal finance: procurement (Inventory ↔ Cash) for the buy
      // side + income/COGS/journal for the flip sale, all in the same tx.
      // Neither posting may fail silently: the purchase is approved either way,
      // so a dropped entry leaves stock and the ledger disagreeing.
      const procurementPosted = await this.finance
        .postProcurement({
          ref: `PUR-${purchase.id}`,
          description: `Quick purchase: ${purchase.quantity} × ${purchase.productName}`,
          amount: purchase.totalCost,
          entryDate: purchase.createdAt,
          createdById: soldById,
          paid: true, // the buy side was paid out of cash
          tenantId,
          tx,
        })
        .catch(() => false);
      if (!procurementPosted) {
        this.logger.warn(
          `Purchase #${purchase.id} was approved but its journal entry (PUR-${purchase.id}) is not in the ledger — it may already be posted, or the Inventory/Cash accounts are unmapped.`,
        );
      }
      const incomeRows = await this.finance
        .postSaleIncome(sale.id, tenantId, tx)
        .catch(() => 0);
      if (incomeRows === 0 && sale.totalAmount > 0) {
        this.logger.warn(
          `Flip sale ${sale.invoiceNumber} (purchase #${purchase.id}) was not posted to the ledger — it may already be posted, or no sales-income account is mapped.`,
        );
      }

      // 3. Audit trail
      await tx.auditLog.create({
        data: {
          userId: user.sub,
          action: 'QUICK_PURCHASE',
          details: `Approved quick purchase #${purchase.id} → sale #${sale.invoiceNumber}: cost ${purchase.totalCost.toFixed(2)}, revenue ${totalAmount.toFixed(2)}, tax ${taxAmount.toFixed(2)}, profit ${profit.toFixed(2)}`,
        },
      });

      // 4. Mark approved — the buy side is settled in full, up front. The row
      // was already flipped to APPROVED/PAID by the guard in step 0.

      return tx.purchase.findUnique({
        where: { id: purchase.id },
        include: PURCHASE_INCLUDE,
      });
    });
  }

  /**
   * Credit purchase: nothing was sold and no cash moved, so approval simply
   * recognises what we owe — Inventory ↔ Accounts Payable. The cash leg is
   * booked per vendor payment (see createPayment), keeping the payable balance
   * honest at every point in between.
   */
  private async approveCredit(
    purchase: Prisma.PurchaseGetPayload<{ include: { sale: true } }>,
    user: JwtPayload,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const tenantId = requireTenantId();

      // Claim the approval first (compare-and-set) so a second concurrent
      // approve posts nothing: PUR-<id> is idempotent by reference, and the
      // guard is what keeps the row itself from being flipped twice.
      await this.claimApproval(tx, purchase.id, user.sub, {});

      const procurementPosted = await this.finance
        .postProcurement({
          ref: `PUR-${purchase.id}`,
          description: `Credit purchase: ${purchase.quantity} × ${purchase.productName}`,
          amount: purchase.totalCost,
          entryDate: purchase.createdAt,
          createdById: user.sub,
          paid: false, // credit Accounts Payable instead of Cash
          tenantId,
          tx,
        })
        .catch(() => false);
      if (!procurementPosted) {
        this.logger.warn(
          `Credit purchase #${purchase.id} was approved but its journal entry (PUR-${purchase.id}) is not in the ledger — it may already be posted, or the Inventory/Accounts-Payable accounts are unmapped.`,
        );
      }

      await tx.auditLog.create({
        data: {
          userId: user.sub,
          action: 'CREDIT_PURCHASE',
          details: `Approved credit purchase #${purchase.id}: owed to vendor ${purchase.totalCost.toFixed(2)}`,
        },
      });

      return tx.purchase.findUnique({
        where: { id: purchase.id },
        include: PURCHASE_INCLUDE,
      });
    });
  }

  /**
   * Compare-and-set the PENDING → APPROVED transition. Throws when the row is
   * no longer pending, so a losing racer writes nothing at all (no second flip
   * sale, no second pair of cash entries).
   */
  private async claimApproval(
    tx: Tx,
    purchaseId: number,
    approvedById: number,
    settlement: { amountPaid?: number; paymentStatus?: PurchasePaymentStatus },
  ) {
    const claimed = await tx.purchase.updateMany({
      where: { id: purchaseId, status: PurchaseStatus.PENDING },
      data: { status: PurchaseStatus.APPROVED, approvedById, ...settlement },
    });
    if (claimed.count === 0)
      throw new BadRequestException(tr('errors.purchaseNotPending'));
  }

  async reject(id: number, user: JwtPayload) {
    const purchase = await this.prisma.purchase.findUnique({ where: { id } });
    if (!purchase) throw new BadRequestException(tr('errors.purchaseNotFound'));
    if (purchase.status !== PurchaseStatus.PENDING)
      throw new BadRequestException(tr('errors.purchaseNotPending'));

    return this.prisma.purchase.update({
      where: { id },
      data: { status: PurchaseStatus.REJECTED, approvedById: user.sub },
    });
  }

  // --- Editing ------------------------------------------------------------

  /** Correct a submitted line; money derived from quantity × price follows. */
  async update(
    id: number,
    dto: {
      productName?: string;
      quantity?: number;
      unitPrice?: number;
      sellPrice?: number;
      notes?: string;
      vendorCustomerId?: number;
    },
  ) {
    const existing = await this.prisma.purchase.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(tr('errors.purchaseNotFound'));

    // Once approved, the row is already in the ledger (a PUR-<id> entry, plus a
    // flip sale for a paid one), so only its notes stay editable — a change to
    // the amount would silently desync Inventory from the record that produced
    // it. Void and re-enter instead.
    if (
      existing.status !== PurchaseStatus.PENDING &&
      (dto.productName !== undefined ||
        dto.quantity !== undefined ||
        dto.unitPrice !== undefined ||
        dto.sellPrice !== undefined ||
        dto.vendorCustomerId !== undefined)
    ) {
      throw new BadRequestException(tr('errors.purchaseApprovedLocked'));
    }

    const quantity = dto.quantity ?? existing.quantity;
    const unitPrice = dto.unitPrice ?? existing.unitPrice;
    const sellPrice = dto.sellPrice ?? existing.sellPrice;
    const totalCost = round2(unitPrice * quantity);
    const isPaid = existing.paymentType === 'PAID';
    // A credit row has no sell side of its own, so revenue/profit stay zero.
    const revenue = isPaid ? round2(sellPrice * quantity) : 0;

    return this.prisma.$transaction(async (tx) => {
      await tx.purchase.update({
        where: { id },
        data: {
          ...(dto.productName !== undefined
            ? { productName: dto.productName }
            : {}),
          ...(dto.quantity !== undefined ? { quantity: dto.quantity } : {}),
          ...(dto.unitPrice !== undefined ? { unitPrice: dto.unitPrice } : {}),
          ...(dto.sellPrice !== undefined ? { sellPrice: dto.sellPrice } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(dto.vendorCustomerId !== undefined
            ? { vendorCustomerId: dto.vendorCustomerId }
            : {}),
          totalCost,
          revenue,
          profit: revenue - totalCost,
        },
      });
      // Editing the amount moves the settlement needle on a credit row.
      if (!isPaid) await this.recomputeSettlement(tx, id);
      return tx.purchase.findUnique({
        where: { id },
        include: PURCHASE_INCLUDE,
      });
    });
  }

  async remove(id: number) {
    const existing = await this.prisma.purchase.findUnique({
      where: { id },
      include: { sale: true, payments: true },
    });
    if (!existing) throw new NotFoundException(tr('errors.purchaseNotFound'));
    // Only a pending row can go. An approved one is already in the general
    // ledger (Inventory ↔ Cash or Inventory ↔ Accounts Payable), so deleting it
    // would strand its PUR-<id> entry with no record behind it; a paid one also
    // owns a flip sale. Both walk through reject/void, never through a delete.
    if (existing.status !== PurchaseStatus.PENDING)
      throw new BadRequestException(tr('errors.purchaseNotPending'));
    // An approved paid purchase is already in the sale, cash and general
    // ledgers — it must be reversed through those flows, not deleted here.
    if (existing.sale)
      throw new BadRequestException(tr('errors.purchaseHasLinkedSale'));
    if (existing.payments.length)
      throw new BadRequestException(tr('errors.purchaseHasPayments'));

    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.purchase.delete({ where: { id } });
      // Belt and braces: a pending row was never posted, but if an entry does
      // exist under this reference it must not outlive the row it describes.
      await this.clearProcurementEntry(tx, requireTenantId(), id);
      return deleted;
    });
  }

  // --- Vendor payments (money this shop pays back for goods taken on credit) ---

  /** Accept a numeric id or the UUID publicId, returning the numeric key. */
  async resolvePurchaseId(ref: string): Promise<number> {
    const numeric = asNumericId(ref);
    if (numeric != null) return numeric;
    const row = await this.prisma.purchase.findUnique({
      where: { publicId: ref },
      select: { id: true },
    });
    if (!row) throw new NotFoundException(tr('errors.purchaseNotFound'));
    return row.id;
  }

  /** Accept a numeric id or the UUID publicId for a vendor payment. */
  async resolvePaymentId(ref: string): Promise<number> {
    const numeric = asNumericId(ref);
    if (numeric != null) return numeric;
    const row = await this.prisma.purchasePayment.findUnique({
      where: { publicId: ref },
      select: { id: true },
    });
    if (!row) throw new NotFoundException(tr('errors.paymentNotFound'));
    return row.id;
  }

  /** Pay the vendor back for a credit purchase; the payable shrinks by `amount`. */
  async createPayment(
    purchaseId: number,
    dto: {
      amount: number;
      paymentMethodId?: number;
      notes?: string;
      paidAt?: string;
      clientRef?: string;
      customerId?: number;
    },
    user: JwtPayload,
  ) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id: purchaseId },
      select: {
        id: true,
        paymentType: true,
        status: true,
        totalCost: true,
        amountPaid: true,
        vendorCustomerId: true,
      },
    });
    if (!purchase) throw new NotFoundException(tr('errors.purchaseNotFound'));
    if (purchase.paymentType !== 'CREDIT')
      throw new BadRequestException(tr('errors.purchaseNotCredit'));
    if (purchase.status !== PurchaseStatus.APPROVED)
      throw new BadRequestException(tr('errors.purchaseNotApproved'));
    if (
      dto.customerId &&
      purchase.vendorCustomerId &&
      dto.customerId !== purchase.vendorCustomerId
    ) {
      throw new BadRequestException(tr('errors.purchaseVendorMismatch'));
    }
    const vendorCustomerId = purchase.vendorCustomerId ?? dto.customerId;
    if (!vendorCustomerId)
      throw new BadRequestException(tr('errors.vendorRequired'));

    const remaining = round2(purchase.totalCost - purchase.amountPaid);
    if (dto.amount > remaining + 0.0001) {
      throw new BadRequestException(
        tr('errors.purchasePaymentExceedsRemaining', { remaining }),
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const tenantId = requireTenantId();
        const payment = await tx.purchasePayment.create({
          data: {
            customerId: vendorCustomerId,
            purchaseId: purchase.id,
            amount: dto.amount,
            paymentMethodId: dto.paymentMethodId ?? null,
            notes: dto.notes,
            ...(dto.paidAt ? { paidAt: new Date(dto.paidAt) } : {}),
            clientRef: dto.clientRef ?? null,
          },
        });

        // Money left the till to settle the bill: Debit AP ↔ Credit Cash.
        await this.finance
          .postVendorBillPayment({
            ref: `VBP-${payment.id}`,
            amount: payment.amount,
            tenantId,
            tx,
            createdById: user.sub,
            entryDate: payment.paidAt,
          })
          .catch(() => false);

        await this.recomputeSettlement(tx, purchase.id);
        return tx.purchasePayment.findUnique({
          where: { id: payment.id },
          include: { paymentMethod: true },
        });
      });
    } catch (err) {
      return assertNotDuplicate(err, 'errors.paymentAlreadySubmitted');
    }
  }

  async updatePayment(
    id: number,
    dto: {
      amount?: number;
      paymentMethodId?: number;
      notes?: string;
      paidAt?: string;
    },
    user: JwtPayload,
  ) {
    const existing = await this.prisma.purchasePayment.findUnique({
      where: { id },
      include: {
        purchase: { select: { id: true, totalCost: true, paymentType: true } },
      },
    });
    if (!existing) throw new NotFoundException(tr('errors.paymentNotFound'));

    const nextAmount = dto.amount ?? existing.amount;
    const others = await this.prisma.purchasePayment.aggregate({
      where: { purchaseId: existing.purchaseId, id: { not: id } },
      _sum: { amount: true },
    });
    const remaining = round2(
      existing.purchase.totalCost - (others._sum.amount ?? 0),
    );
    if (nextAmount > remaining + 0.0001) {
      throw new BadRequestException(
        tr('errors.purchasePaymentExceedsRemaining', { remaining }),
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const tenantId = requireTenantId();
      const updated = await tx.purchasePayment.update({
        where: { id },
        data: {
          ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
          ...(dto.paymentMethodId !== undefined
            ? { paymentMethodId: dto.paymentMethodId }
            : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(dto.paidAt !== undefined ? { paidAt: new Date(dto.paidAt) } : {}),
        },
      });
      if (dto.amount !== undefined && dto.amount !== existing.amount) {
        // A different amount of money left the till: re-book this payment's
        // Accounts-Payable ↔ Cash entry for the corrected amount.
        await this.clearVendorBillEntry(tx, tenantId, id);
        await this.finance
          .postVendorBillPayment({
            ref: `VBP-${id}`,
            amount: updated.amount,
            tenantId,
            tx,
            createdById: user.sub,
            entryDate: updated.paidAt,
          })
          .catch(() => false);
      }
      await this.recomputeSettlement(tx, existing.purchaseId);
      return updated;
    });
  }

  async removePayment(id: number) {
    const existing = await this.prisma.purchasePayment.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException(tr('errors.paymentNotFound'));

    return this.prisma.$transaction(async (tx) => {
      await tx.purchasePayment.delete({ where: { id } });
      // The payment never happened, so its journal entry goes with it.
      await this.clearVendorBillEntry(tx, requireTenantId(), id);
      await this.recomputeSettlement(tx, existing.purchaseId);
      return { message: 'Payment deleted' };
    });
  }

  /** Drop the Accounts-Payable ↔ Cash entry booked for one vendor payment. */
  private async clearVendorBillEntry(
    tx: Tx,
    tenantId: number | null,
    paymentId: number,
  ) {
    await tx.journalEntry.deleteMany({
      where: { tenantId, reference: `VBP-${paymentId}` },
    });
  }

  /**
   * Drop the Inventory ↔ Cash/Accounts-Payable entry booked when a purchase was
   * approved. Purchases post exactly once, at approval, so this is only ever
   * needed when that approval is undone or repaired.
   */
  private async clearProcurementEntry(
    tx: Tx,
    tenantId: number | null,
    purchaseId: number,
  ) {
    await tx.journalEntry.deleteMany({
      where: { tenantId, reference: `PUR-${purchaseId}` },
    });
  }

  /**
   * Credit rows keep their settlement snapshot in sync with their payments:
   * amountPaid + UNPAID / PARTIALLY_PAID / PAID.
   */
  private async recomputeSettlement(tx: Tx, purchaseId: number) {
    const [agg, purchase] = await Promise.all([
      tx.purchasePayment.aggregate({
        where: { purchaseId },
        _sum: { amount: true },
      }),
      tx.purchase.findUnique({
        where: { id: purchaseId },
        select: { totalCost: true, paymentType: true },
      }),
    ]);
    if (!purchase || purchase.paymentType !== 'CREDIT') return;

    const amountPaid = round2(agg._sum.amount ?? 0);
    const paymentStatus: PurchasePaymentStatus =
      amountPaid >= purchase.totalCost - 0.0001
        ? PurchasePaymentStatus.PAID
        : amountPaid > 0
          ? PurchasePaymentStatus.PARTIALLY_PAID
          : PurchasePaymentStatus.UNPAID;
    await tx.purchase.update({
      where: { id: purchaseId },
      data: { amountPaid, paymentStatus },
    });
  }
}
