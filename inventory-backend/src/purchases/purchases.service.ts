import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { TaxDirection } from '@prisma/client';
import { assertNotDuplicate } from '../common/duplicate.util';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { resolveTax, round2, splitTax } from '../common/tax.util';
import { getCurrentTenantId, requireTenantId } from '../common/tenant/tenant.context';
import { FinanceService } from '../finance/finance.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PurchasesService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private finance: FinanceService,
  ) {}

  async create(
    dto: {
      productName: string;
      quantity: number;
      unitPrice: number;
      sellPrice: number;
      notes?: string;
      paymentMethodId?: number;
      clientRef?: string;
    },
    user: JwtPayload,
  ) {
    if (!user.locationId) throw new BadRequestException('You must be assigned to a shop');
    const shop = await this.prisma.location.findUnique({ where: { id: user.locationId } });
    if (!shop || shop.type !== 'SHOP') throw new ForbiddenException('Only shopkeepers can create purchases');

    const shopId = user.locationId;
    const totalCost = dto.unitPrice * dto.quantity;
    const revenue = dto.sellPrice * dto.quantity;
    const profit = revenue - totalCost;

    // Resolve payment method: explicit id, else default to "Cash"
    let paymentMethodId: number | null = dto.paymentMethodId ?? null;
    if (!paymentMethodId) {
      const cash = await this.prisma.paymentMethod.findFirst({
        where: { name: { equals: 'Cash', mode: 'insensitive' } },
      });
      if (!cash) throw new BadRequestException('No "Cash" payment method found. Please add one first.');
      paymentMethodId = cash.id;
    }

    try {
      // Create a PENDING purchase — it is NOT visible in reports until the owner approves.
      const purchase = await this.prisma.purchase.create({
        data: {
          shopId,
          productName: dto.productName,
          quantity: dto.quantity,
          unitPrice: dto.unitPrice,
          sellPrice: dto.sellPrice,
          totalCost,
          revenue,
          profit,
          status: 'PENDING',
          createdById: user.sub,
          paymentMethodId,
          notes: dto.notes,
          clientRef: dto.clientRef ?? null,
        },
      });

      // Notify the owner that a quick purchase needs approval
      await this.notifications.notifyOwner(
        'Quick Purchase Request',
        `${dto.productName} × ${dto.quantity} — buy ${dto.unitPrice.toFixed(2)} / sell ${dto.sellPrice.toFixed(2)} birr (${shop.name})`,
        { locationId: shopId },
      );

      return purchase;
    } catch (err) {
      return assertNotDuplicate(err, 'This purchase was already submitted. Please refresh and try again.');
    }
  }

  async findAll(user: JwtPayload, status?: string, search?: string, startDate?: string, endDate?: string, shopId?: number) {
    const where: any = {};
    if (status) where.status = status;
    if (user.locationType === 'SHOP') {
      where.createdById = user.sub;
    } else if (shopId) {
      where.shopId = Number(shopId);
    }
    if (search) where.productName = { contains: search, mode: 'insensitive' };
    if (startDate && endDate) {
      const endOfDay = new Date(endDate);
      endOfDay.setHours(23, 59, 59, 999);
      where.createdAt = { gte: new Date(startDate), lte: endOfDay };
    }
    return this.prisma.purchase.findMany({
      where,
      include: { shop: true, sale: true, paymentMethod: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async approve(id: number, user: JwtPayload) {
    const purchase = await this.prisma.purchase.findUnique({ where: { id }, include: { sale: true } });
    if (!purchase) throw new BadRequestException('Purchase not found');
    if (purchase.status !== 'PENDING') throw new BadRequestException('Purchase is not pending');
    if (purchase.sale) throw new BadRequestException('Purchase already has a linked sale');

    const shopId = purchase.shopId;

    return this.prisma.$transaction(async (tx) => {
      const tenantId = requireTenantId();

      // Output VAT snapshot for the flip sale — same rule as sales.service.createSale.
      // totalAmount is the gross the customer pays; in exclusive mode the tax is
      // added on top. Profit is computed on net (tax-free) revenue.
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
          soldById: purchase.createdById,
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
          description: `Purchased ${purchase.quantity} × ${purchase.productName}`,
          createdById: user.sub,
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
          createdById: user.sub,
        },
      });

      // 2.5 Universal finance: procurement (Inventory ↔ Cash) for the buy
      // side + income/COGS/journal for the flip sale, all in the same tx.
      await this.finance
        .postProcurement({
          ref: `PUR-${purchase.id}`,
          description: `Quick purchase: ${purchase.quantity} × ${purchase.productName}`,
          amount: purchase.totalCost,
          entryDate: purchase.createdAt,
          createdById: user.sub,
          paid: true, // the buy side was paid out of cash
          tenantId,
          tx,
        })
        .catch(() => false);
      await this.finance
        .postSaleIncome(sale.id, tenantId, tx)
        .catch(() => 0);

      // 3. Audit trail
      await tx.auditLog.create({
        data: {
          userId: user.sub,
          action: 'QUICK_PURCHASE',
          details: `Approved quick purchase #${purchase.id} → sale #${sale.invoiceNumber}: cost ${purchase.totalCost.toFixed(2)}, revenue ${totalAmount.toFixed(2)}, tax ${taxAmount.toFixed(2)}, profit ${profit.toFixed(2)}`,
        },
      });

      // 4. Mark approved
      await tx.purchase.update({
        where: { id: purchase.id },
        data: { status: 'APPROVED', approvedById: user.sub },
      });

      return tx.purchase.findUnique({
        where: { id: purchase.id },
        include: { sale: true, paymentMethod: true },
      });
    });
  }

  async reject(id: number, user: JwtPayload) {
    const purchase = await this.prisma.purchase.findUnique({ where: { id } });
    if (!purchase) throw new BadRequestException('Purchase not found');
    if (purchase.status !== 'PENDING') throw new BadRequestException('Purchase is not pending');

    return this.prisma.purchase.update({
      where: { id },
      data: { status: 'REJECTED', approvedById: user.sub },
    });
  }

  async stats(user: JwtPayload, shopId?: number, search?: string, startDate?: string, endDate?: string) {
    const where: any = { status: 'APPROVED' };
    if (shopId) where.shopId = Number(shopId);
    else if (user.locationType === 'SHOP') where.shopId = user.locationId;
    if (search) where.productName = { contains: search, mode: 'insensitive' };
    if (startDate && endDate) {
      const endOfDay = new Date(endDate);
      endOfDay.setHours(23, 59, 59, 999);
      where.createdAt = { gte: new Date(startDate), lte: endOfDay };
    }

    const approved = await this.prisma.purchase.findMany({ where });

    const totalCost = approved.reduce((s, p) => s + p.totalCost, 0);
    const totalRevenue = approved.reduce((s, p) => s + p.revenue, 0);
    const totalProfit = approved.reduce((s, p) => s + p.profit, 0);

    const pendingWhere: any = { status: 'PENDING' };
    if (shopId) pendingWhere.shopId = Number(shopId);
    else if (user.locationType === 'SHOP') pendingWhere.shopId = user.locationId;
    const pendingCount = await this.prisma.purchase.count({ where: pendingWhere });

    return {
      totalCost,
      totalRevenue,
      totalProfit,
      approvedCount: approved.length,
      pendingCount,
    };
  }
}