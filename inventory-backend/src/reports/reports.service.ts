import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { getCurrentTenantId } from '../common/tenant/tenant.context';
import PDFDocument from 'pdfkit';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuditLogResponse,
  InventoryBreakdownResponse,
  InventoryBreakdownRow,
  PaymentMethodBreakdown,
  ReportVariantDetail,
  SalesSummaryResponse,
  SalesTrendPoint,
  TopProduct,
} from './entities/report.entity';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DEAD_STOCK_MONTHS = 3;
const TOP_PRODUCTS_COUNT = 5;
const AUDIT_TRAIL_LIMIT = 50;

type ReportSection = {
  title: string;
  headers: string[];
  rows: (string | number)[][];
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // =========================================================================
  // Inventory
  // =========================================================================

  async getInventoryBreakdown(
    user: JwtPayload,
    locationId?: number,
    categoryId?: number,
    search?: string,
  ): Promise<InventoryBreakdownResponse> {
    // Staff whose role carries the shared-inventory permission see stock across
    // every location in the organization (read-only). Everyone else stays
    // scoped to their own location; owner behavior is unchanged.
    const sharedView =
      user.locationId !== null &&
      user.permissions?.includes('inventory.shared-view');
    const targetLocationId = sharedView
      ? undefined
      : this.resolveLocationId(user, locationId);
    const productWhere = await this.buildProductWhereClause(categoryId, search);
    const tenantId = getCurrentTenantId();
    // Buying-cost & margin fields are only released to roles that hold
    // reports.view_cost_valuation (owners by default; staff opt-in). Owners are
    // always trusted regardless of their stored role-permission snapshot.
    const canViewCost =
      (user.isSuperuser ?? false) ||
      (user.permissions?.includes('reports.view_cost_valuation') ?? false);
    const r2 = (n: number) => Math.round(n * 100) / 100;

    const inventories = await this.prisma.inventory.findMany({
      where: {
        ...(targetLocationId !== undefined && targetLocationId > 0
          ? { locationId: targetLocationId }
          : {}),
        // When widening past the user's own location, constrain to the active
        // tenant so other organizations' branches never leak in.
        ...(sharedView && tenantId != null ? { tenantId } : {}),
        product: productWhere,
      },
      include: {
        product: {
          select: {
            sku: true,
            brand: true,
            baseName: true,
            currentBuyPrice: true,
            currentSellPrice: true,
            category: { select: { name: true } },
          },
        },
        location: true,
        variant: {
          select: { sku: true, attributes: true, buyPrice: true, sellPrice: true },
        },
      },
    });

    const locations = await this.prisma.location.findMany();
    const productMap = new Map<number, InventoryBreakdownRow>();

    for (const inv of inventories) {
      let data = productMap.get(inv.productId);

      if (!data) {
        data = {
          productId: inv.productId,
          sku: inv.product.sku,
          productName: `${inv.product.brand} ${inv.product.baseName}`,
          category: inv.product.category?.name ?? 'Uncategorized',
          total: 0,
          locations: {},
          variants: [],
        };
        productMap.set(inv.productId, data);
      }

      // Unit prices come from the exact variant sold where available, falling
      // back to the product's catalog price (legacy rows without prices).
      const variantBuy = Number(inv.variant?.buyPrice ?? 0);
      const variantSell = Number(inv.variant?.sellPrice ?? 0);
      const unitBuyPrice =
        variantBuy > 0 ? variantBuy : Number(inv.product.currentBuyPrice) || 0;
      const unitSellPrice =
        variantSell > 0
          ? variantSell
          : Number(inv.product.currentSellPrice) || 0;
      const qty = Number(inv.quantity) || 0;

      // Aggregate correctly: a product can have several variant inventory rows
      // at the same location, so quantities must be summed (not overwritten).
      data.total += qty;
      data.locations[inv.location.name] =
        (data.locations[inv.location.name] ?? 0) + qty;

      // Per-variant breakdown (variantId is null for plain products).
      const variantKey = inv.variantId ?? -1;
      let variantRow = data.variants.find((v: any) => v.id === variantKey);
      if (!variantRow) {
        variantRow = {
          id: variantKey,
          sku: inv.variant?.sku ?? null,
          attributes: (inv.variant?.attributes as Record<string, any>) ?? {},
          quantity: 0,
          locations: {},
          unitBuyPrice,
          unitSellPrice,
          buyTotal: 0,
          sellTotal: 0,
        };
        data.variants.push(variantRow);
      }
      variantRow.quantity += qty;
      variantRow.locations[inv.location.name] =
        (variantRow.locations[inv.location.name] ?? 0) + qty;
      variantRow.buyTotal = r2((variantRow.buyTotal ?? 0) + unitBuyPrice * qty);
      variantRow.sellTotal = r2(
        (variantRow.sellTotal ?? 0) + unitSellPrice * qty,
      );
    }

    // Roll variant valuations up to the product row and compute the grand
    // totals over everything currently in scope.
    let grandTotalBuyingValue = 0;
    let grandTotalSellingValue = 0;
    const rows = Array.from(productMap.values());
    for (const data of rows) {
      const buy = r2(
        data.variants.reduce(
          (s: number, v: any) => s + (Number(v.buyTotal) || 0),
          0,
        ),
      );
      const sell = r2(
        data.variants.reduce(
          (s: number, v: any) => s + (Number(v.sellTotal) || 0),
          0,
        ),
      );
      data.buyTotal = buy;
      data.sellTotal = sell;
      data.estimatedProfit = r2(sell - buy);

      // Each variant row also reports its own profit (sell total − buy total).
      for (const v of data.variants) {
        v.estimatedProfit = r2(
          (Number(v.sellTotal) || 0) - (Number(v.buyTotal) || 0),
        );
      }

      // Product-level unit price: quantity-weighted average across the exact
      // units held, or a simple mean over variant rows when nothing is stocked.
      const weightedUnit = (rowKey: string, totalValue: number) =>
        data.total > 0
          ? r2(totalValue / data.total)
          : data.variants.length > 0
            ? r2(
                data.variants.reduce(
                  (s: number, v: any) => s + (Number(v[rowKey]) || 0),
                  0,
                ) / data.variants.length,
              )
            : 0;
      data.unitBuyPrice = weightedUnit('unitBuyPrice', buy);
      data.unitSellPrice = weightedUnit('unitSellPrice', sell);

      grandTotalBuyingValue += buy;
      grandTotalSellingValue += sell;
    }

    // Staff without reports.view_cost_valuation only get stock quantities and
    // the unit sell price — buying costs, totals and profit never leave the API.
    const rowsForClient = canViewCost
      ? rows
      : rows.map((data) => ({
          productId: data.productId,
          sku: data.sku,
          productName: data.productName,
          category: data.category,
          total: data.total,
          locations: data.locations,
          unitSellPrice: data.unitSellPrice,
          variants: data.variants.map((v: any) => ({
            id: v.id,
            sku: v.sku,
            attributes: v.attributes,
            quantity: v.quantity,
            locations: v.locations,
            unitSellPrice: v.unitSellPrice,
          })),
        }));

    return {
      columns: locations.map((l) => l.name),
      rows: rowsForClient,
      ...(canViewCost
        ? {
            valuation: {
              grandTotalBuyingValue: r2(grandTotalBuyingValue),
              grandTotalSellingValue: r2(grandTotalSellingValue),
              potentialGrossProfit: r2(
                grandTotalSellingValue - grandTotalBuyingValue,
              ),
              potentialMarginPct:
                grandTotalSellingValue > 0
                  ? r2(
                      ((grandTotalSellingValue - grandTotalBuyingValue) /
                        grandTotalSellingValue) *
                        100,
                    )
                  : 0,
            },
          }
        : {}),
    };
  }

  /**
   * Inventory overview for the Reports dashboard: live stock quantities with
   * unit of measure, total stock value (qty × buy price), low-stock / reorder
   * status, and a wastage/spoilage summary (value, count, per-product, log).
   */
  async getInventoryOverview(
    user: JwtPayload,
    locationId?: number,
    startDate?: string,
    endDate?: string,
  ) {
    const targetLocationId = this.resolveLocationId(user, locationId);
    const inventoryWhere: Record<string, unknown> = {
      ...(targetLocationId !== undefined ? { locationId: targetLocationId } : {}),
    };

    const [inventories, wastageEntries] = await Promise.all([
      this.prisma.inventory.findMany({
        where: inventoryWhere,
        include: {
          product: { include: { category: true, unit: true } },
          location: true,
          variant: true,
        },
        orderBy: { product: { baseName: 'asc' } },
      }),
      this.prisma.wastageEntry.findMany({
        where: (() => {
          const w: Record<string, unknown> = {};
          if (startDate || endDate) {
            const cond: Record<string, Date> = {};
            if (startDate) cond.gte = new Date(startDate);
            if (endDate) {
              const e = new Date(endDate);
              e.setHours(23, 59, 59, 999);
              cond.lte = e;
            }
            w.createdAt = cond;
          }
          return w;
        })(),
        include: { product: { include: { unit: true } }, location: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const round2 = (n: number) => Math.round(n * 100) / 100;

    const items = inventories.map((inv) => {
      const quantity = inv.quantity;
      const buyPrice = inv.product?.currentBuyPrice ?? 0;
      const reorderLevel = inv.product?.reorderLevel ?? 0;
      return {
        productId: inv.productId,
        variantId: inv.variantId,
        name: `${inv.product?.brand ?? ''} ${inv.product?.baseName ?? ''}`.trim() || `Product #${inv.productId}`,
        category: inv.product?.category?.name ?? 'Uncategorized',
        unit: inv.product?.unit?.name ?? null,
        quantity,
        currentBuyPrice: buyPrice,
        stockValue: round2(quantity * buyPrice),
        reorderLevel,
        reorderQty: inv.product?.reorderQty ?? null,
        kind: inv.product?.kind ?? 'GOODS',
        location: inv.location?.name ?? null,
        locationId: inv.locationId,
        status:
          quantity <= 0 ? 'OUT' : quantity <= reorderLevel ? 'LOW' : 'OK',
      };
    });

    const totals = items.reduce(
      (acc, i) => {
        acc.stockValue += i.stockValue;
        if (i.status === 'LOW') acc.lowStockCount += 1;
        if (i.status === 'OUT') acc.outOfStockCount += 1;
        acc.itemCount += 1;
        return acc;
      },
      { stockValue: 0, lowStockCount: 0, outOfStockCount: 0, itemCount: 0 },
    );

    const wastageByProduct = new Map<
      number,
      { productId: number; name: string; quantity: number; value: number; count: number }
    >();
    let wastageValue = 0;
    for (const w of wastageEntries) {
      wastageValue += w.totalValue;
      const row = wastageByProduct.get(w.productId) ?? {
        productId: w.productId,
        name: `${w.product?.brand ?? ''} ${w.product?.baseName ?? ''}`.trim() || `Product #${w.productId}`,
        quantity: 0,
        value: 0,
        count: 0,
      };
      row.quantity += w.quantity;
      row.value += w.totalValue;
      row.count += 1;
      wastageByProduct.set(w.productId, row);
    }

    return {
      items,
      totals: {
        stockValue: round2(totals.stockValue),
        lowStockCount: totals.lowStockCount,
        outOfStockCount: totals.outOfStockCount,
        itemCount: totals.itemCount,
      },
      wastage: {
        totalValue: round2(wastageValue),
        totalCount: wastageEntries.length,
        byProduct: [...wastageByProduct.values()]
          .map((r) => ({
            ...r,
            value: round2(r.value),
          }))
          .sort((a, b) => b.value - a.value),
        log: wastageEntries.map((w) => ({
          id: w.id,
          productId: w.productId,
          productName: `${w.product?.brand ?? ''} ${w.product?.baseName ?? ''}`.trim() || `Product #${w.productId}`,
          unit: w.product?.unit?.name ?? null,
          quantity: w.quantity,
          unitCost: w.unitCost,
          totalValue: w.totalValue,
          reason: w.reason,
          location: w.location?.name ?? null,
          createdAt: w.createdAt,
        })),
      },
    };
  }


  // =========================================================================
  // Sales
  // =========================================================================

  async getSalesSummary(
    user: JwtPayload,
    startDate?: string,
    endDate?: string,
    locationId?: number,
    categoryId?: number,
    search?: string,
  ): Promise<SalesSummaryResponse> {
    const targetLocationId = this.resolveLocationId(user, locationId);
    const saleWhere = this.buildSaleWhereClause(
      startDate,
      endDate,
      targetLocationId,
    );

    const sales = await this.prisma.sale.findMany({
      where: saleWhere,
      include: {
        items: { include: { product: { include: { category: true } } } },
        returns: { include: { items: { include: { product: true } } } },
      },
    });

    const categoryNum =
      categoryId !== undefined && !Number.isNaN(categoryId) && categoryId > 0
        ? categoryId
        : null;
    const searchTerm = search?.toLowerCase() || null;

    let totalRevenue = 0;
    let totalCost = 0;
    let totalTax = 0;
    let totalReturnsTax = 0;
    const productSales: Record<string, number> = {};

    // Sale type breakdowns
    let fullyPaidRevenue = 0;
    let fullyPaidCost = 0;
    let fullyPaidTax = 0;
    let partiallyPaidRevenue = 0;
    let partiallyPaidCost = 0;
    let partiallyPaidTax = 0;
    let creditedRevenue = 0;
    let creditedCost = 0;
    let creditedTax = 0;

    for (const sale of sales) {
      // Refunds reduce this sale's revenue/profit (fully returned -> 0).
      const returnedAmount = sale.returns.reduce(
        (s, r) => s + r.totalRefund,
        0,
      );
      const returnedCost = sale.returns.reduce(
        (s, r) =>
          s +
          r.items.reduce(
            (si, ri) => si + ri.unitBuyPrice * ri.quantity,
            0,
          ),
        0,
      );

      let saleRevenue = 0;
      let saleCost = 0;

      if (sale.items.length === 0) {
        // Quick-purchase flip: no line items — use the sale totals directly.
        if (categoryNum || searchTerm) continue;
        saleRevenue = sale.totalAmount;
        saleCost = sale.totalCost;
      } else {
        for (const item of sale.items) {
          if (!this.matchesFilters(item, categoryNum, searchTerm)) continue;
          saleRevenue += item.unitSellPrice * item.quantity;
          saleCost += item.unitBuyPrice * item.quantity;

          const name = `${item.product.brand} ${item.product.baseName}`;
          productSales[name] = (productSales[name] || 0) + item.quantity;
        }
      }

      // Deduct returned quantities from the top-products tally.
      for (const r of sale.returns) {
        for (const ri of r.items) {
          if (!ri.product) continue;
          const pname = `${ri.product.brand} ${ri.product.baseName}`;
          if (productSales[pname]) productSales[pname] -= ri.quantity;
        }
      }

      // Output VAT attributed to the matched line items. When item filters
      // prune the sale to a subset, tax is prorated by the matched revenue
      // share; refunds carry the same VAT proportion as the original sale.
      const fullItemRevenue = sale.items.reduce(
        (s, it) => s + it.unitSellPrice * it.quantity,
        0,
      );
      const share =
        sale.items.length > 0 && fullItemRevenue > 0 && saleRevenue < fullItemRevenue
          ? saleRevenue / fullItemRevenue
          : 1;
      const saleTax = Math.round((sale.taxAmount || 0) * share * 100) / 100;
      const returnedTax =
        share <= 0
          ? 0
          : Math.round(
              (returnedAmount * ((saleTax || 0) / Math.max(1, sale.totalAmount))) *
                100,
            ) / 100;
      const netTax = Math.max(0, saleTax - returnedTax);

      const netRevenue = saleRevenue - returnedAmount;
      const netCost = saleCost - returnedCost;

      totalRevenue += netRevenue;
      totalCost += netCost;
      totalTax += netTax;
      totalReturnsTax += returnedTax;

      if (sale.saleType === 'FULLY_PAID') {
        fullyPaidRevenue += netRevenue;
        fullyPaidCost += netCost;
        fullyPaidTax += netTax;
      } else if (sale.saleType === 'PARTIALLY_PAID') {
        partiallyPaidRevenue += netRevenue;
        partiallyPaidCost += netCost;
        partiallyPaidTax += netTax;
      } else {
        creditedRevenue += netRevenue;
        creditedCost += netCost;
        creditedTax += netTax;
      }
    }

    // Collected (cash received) vs outstanding per sale type. The sale payment
    // fields are kept in sync whenever a credit payment is recorded against a
    // sale, so this reflects the actual money received so far.
    const paymentTotals = {
      fullyPaid: { collected: 0, outstanding: 0 },
      partiallyPaid: { collected: 0, outstanding: 0 },
      credited: { collected: 0, outstanding: 0 },
    };
    for (const sale of sales) {
      const matched =
        sale.items.length === 0
          ? !categoryNum && !searchTerm
          : sale.items.some((item) =>
              this.matchesFilters(item, categoryNum, searchTerm),
            );
      if (!matched) continue;
      const key =
        sale.saleType === 'FULLY_PAID'
          ? 'fullyPaid'
          : sale.saleType === 'PARTIALLY_PAID'
            ? 'partiallyPaid'
            : 'credited';
      paymentTotals[key].collected += sale.paidAmount || 0;
      paymentTotals[key].outstanding += sale.remainingAmount || 0;
    }

    // Total refunds/costs across the reported sales (per-sale netting above
    // already removed them from revenue/profit; these are reported for context).
    const returnsRefund = sales.reduce(
      (s, sale) => s + sale.returns.reduce((s2, r) => s2 + r.totalRefund, 0),
      0,
    );
    const returnsCost = sales.reduce(
      (s, sale) =>
        s +
        sale.returns.reduce(
          (s2, r) =>
            s2 +
            r.items.reduce((s3, ri) => s3 + ri.unitBuyPrice * ri.quantity, 0),
          0,
        ),
      0,
    );

    const totalProfit = totalRevenue - totalTax - totalCost;

    const topProducts: TopProduct[] = Object.entries(productSales)
      .map(([name, qty]) => ({ name, qty }))
      .filter((p) => p.qty > 0)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, TOP_PRODUCTS_COUNT);

    return {
      totalRevenue,
      totalCost,
      totalTax,
      totalProfit,
      returns: { refund: returnsRefund, cost: returnsCost, tax: totalReturnsTax },
      margin: totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100).toFixed(2) : '0.00',
      topProducts,
      breakdown: {
        fullyPaid: {
          revenue: fullyPaidRevenue,
          cost: fullyPaidCost,
          tax: fullyPaidTax,
          profit: fullyPaidRevenue - fullyPaidTax - fullyPaidCost,
          collected: paymentTotals.fullyPaid.collected,
          outstanding: paymentTotals.fullyPaid.outstanding,
        },
        partiallyPaid: {
          revenue: partiallyPaidRevenue,
          cost: partiallyPaidCost,
          tax: partiallyPaidTax,
          profit: partiallyPaidRevenue - partiallyPaidTax - partiallyPaidCost,
          collected: paymentTotals.partiallyPaid.collected,
          outstanding: paymentTotals.partiallyPaid.outstanding,
        },
        credited: {
          revenue: creditedRevenue,
          cost: creditedCost,
          tax: creditedTax,
          profit: creditedRevenue - creditedTax - creditedCost,
          collected: paymentTotals.credited.collected,
          outstanding: paymentTotals.credited.outstanding,
        },
      },
    };
  }

  async getSalesTrend(
    user: JwtPayload,
    startDate?: string,
    endDate?: string,
    locationId?: number,
    categoryId?: number,
    search?: string,
  ): Promise<SalesTrendPoint[]> {
    const targetLocationId = this.resolveLocationId(user, locationId);
    const saleWhere = this.buildSaleWhereClause(startDate, endDate, targetLocationId);

    const sales = await this.prisma.sale.findMany({
      where: saleWhere,
      include: {
        items: { include: { product: true } },
        returns: { select: { totalRefund: true } },
      },
    });

    const categoryNum = categoryId && !Number.isNaN(categoryId) && categoryId > 0 ? categoryId : null;
    const searchTerm = search?.toLowerCase() || null;
    const trend: Record<string, { sales: number; flips: number; collections: number }> = {};

    for (const sale of sales) {
      const returnedAmount = sale.returns.reduce(
        (s, r) => s + r.totalRefund,
        0,
      );
      const date = sale.saleDate.toISOString().slice(0, 10);
      trend[date] = trend[date] || { sales: 0, flips: 0, collections: 0 };
      if (sale.items.length === 0) {
        // Quick-purchase flip
        if (!categoryNum && !searchTerm)
          trend[date].flips += sale.totalAmount - returnedAmount;
      } else {
        let dailyTotal = 0;
        for (const item of sale.items) {
          if (!this.matchesFilters(item, categoryNum, searchTerm)) continue;
          dailyTotal += item.unitSellPrice * item.quantity;
        }
        trend[date].sales += Math.max(0, dailyTotal - returnedAmount);
      }
    }

    // Credit collections, bucketed on the day the money actually arrived.
    const paymentWhere: any = {};
    if (startDate && endDate) {
      const endOfDay = new Date(endDate);
      endOfDay.setHours(23, 59, 59, 999);
      paymentWhere.paidAt = { gte: new Date(startDate), lte: endOfDay };
    }
    const creditPayments = await this.prisma.creditPayment.findMany({
      where: paymentWhere,
      include: {
        sale: { include: { items: { include: { product: true } } } },
        customer: true,
      },
    });
    for (const payment of creditPayments) {
      const shopId = payment.sale?.shopId ?? payment.customer?.shopId ?? null;
      if (targetLocationId && shopId !== targetLocationId) continue;
      if (categoryNum || searchTerm) {
        if (!payment.sale) continue; // unlinked payments only count without product filters
        const matched = payment.sale.items.some((item) =>
          this.matchesFilters(item, categoryNum, searchTerm),
        );
        if (!matched) continue;
      }
      const date = payment.paidAt.toISOString().slice(0, 10);
      trend[date] = trend[date] || { sales: 0, flips: 0, collections: 0 };
      trend[date].collections += payment.amount;
    }

    return Object.entries(trend)
      .map(([date, d]) => ({
        date,
        sales: Math.round(d.sales * 100) / 100,
        flips: Math.round(d.flips * 100) / 100,
        collections: Math.round(d.collections * 100) / 100,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async getMostSold(
    user: JwtPayload,
    locationId?: number,
    categoryId?: number,
    search?: string,
    startDate?: string,
    endDate?: string,
  ): Promise<TopProduct[]> {
    const targetLocationId = this.resolveLocationId(user, locationId);

    // Build date filter for sale via SaleItem relation
    let dateFilter: any = undefined;
    if (startDate && endDate) {
      const eod = new Date(endDate); eod.setHours(23, 59, 59, 999);
      dateFilter = { gte: new Date(startDate), lte: eod };
    }

    const saleWhere: any = {};
    if (targetLocationId) saleWhere.shopId = targetLocationId;
    if (dateFilter) saleWhere.saleDate = dateFilter;

    const items = await this.prisma.saleItem.findMany({
      where: { sale: saleWhere },
      include: { product: true },
    });

    const categoryNum = categoryId && !Number.isNaN(categoryId) && categoryId > 0 ? categoryId : null;
    const searchTerm = search?.toLowerCase() || null;

    const filteredItems = items.filter((item) =>
      this.matchesFilters(item, categoryNum, searchTerm),
    );

    const productMap: Record<string, number> = {};
    for (const item of filteredItems) {
      const name = `${item.product.brand} ${item.product.baseName}`;
      productMap[name] = (productMap[name] || 0) + item.quantity;
    }

    return Object.entries(productMap)
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, TOP_PRODUCTS_COUNT);
  }

  // =========================================================================
  // Stock Health
  // =========================================================================

  // =========================================================================
  // Payment Methods
  // =========================================================================

  async getPaymentMethodsBreakdown(
    user: JwtPayload,
    startDate?: string,
    endDate?: string,
    locationId?: number,
    categoryId?: number,
    search?: string,
  ): Promise<PaymentMethodBreakdown[]> {
    const targetLocationId = this.resolveLocationId(user, locationId);
    const saleWhere = this.buildSaleWhereClause(startDate, endDate, targetLocationId);

    const sales = await this.prisma.sale.findMany({
      where: saleWhere,
      include: {
        paymentMethod: true,
        items: { include: { product: true } },
        returns: { select: { totalRefund: true } },
      },
    });

    const categoryNum = categoryId && !Number.isNaN(categoryId) && categoryId > 0 ? categoryId : null;
    const searchTerm = search?.toLowerCase() || null;

    let start: Date | undefined;
    let endOfDay: Date | undefined;
    if (startDate && endDate) {
      start = new Date(startDate);
      endOfDay = new Date(endDate);
      endOfDay.setHours(23, 59, 59, 999);
    }

    const map = new Map<string, { count: number; total: number }>();
    const add = (method: string, amount: number) => {
      if (amount <= 0) return;
      const entry = map.get(method) || { count: 0, total: 0 };
      entry.count += 1;
      entry.total += amount;
      map.set(method, entry);
    };

    // Money received at sale time — fully paid sales and the initial portion of
    // partial sales — labelled with the sale type (e.g. "Cash (Fully Paid)",
    // "Cash (Partial)").
    const partialSaleIds = sales
      .filter((s) => s.saleType === 'PARTIALLY_PAID')
      .map((s) => s.id);
    const linkedTotals = partialSaleIds.length
      ? await this.prisma.creditPayment.groupBy({
          by: ['saleId'],
          where: { saleId: { in: partialSaleIds } },
          _sum: { amount: true },
        })
      : [];
    const linkedBySale = new Map<number, number>(
      linkedTotals.map((l) => [l.saleId as number, l._sum.amount || 0]),
    );

    for (const sale of sales) {
      let saleTotal = 0;
      if (sale.items.length === 0) {
        if (!categoryNum && !searchTerm) saleTotal = sale.totalAmount;
      } else {
        for (const item of sale.items) {
          if (!this.matchesFilters(item, categoryNum, searchTerm)) continue;
          saleTotal += item.unitSellPrice * item.quantity;
        }
      }
      if (saleTotal === 0) continue;

      // Deduct refunds from the payment method that received the money.
      const returnedAmount = sale.returns.reduce(
        (s, r) => s + r.totalRefund,
        0,
      );

      const methodName = sale.paymentMethod?.name ?? 'Unspecified';
      if (sale.saleType === 'FULLY_PAID') {
        add(
          `${methodName} (Fully Paid)`,
          Math.max(0, (sale.paidAmount || sale.totalAmount) - returnedAmount),
        );
      } else if (sale.saleType === 'PARTIALLY_PAID') {
        // The initial partial amount excludes anything already settled through
        // linked credit payments (those are reported separately below).
        const settled = linkedBySale.get(sale.id) || 0;
        const initialPaid = Math.max(0, (sale.paidAmount || 0) - settled);
        add(`${methodName} (Partial)`, Math.max(0, initialPaid - returnedAmount));
      }
      // CREDITED sales contribute nothing at sale time — only their credit
      // payments (below) count as money received.
    }

    // Credit payments received in the window, by their own payment method.
    const paymentWhere: any = {};
    if (start && endOfDay) paymentWhere.paidAt = { gte: start, lte: endOfDay };
    const creditPayments = await this.prisma.creditPayment.findMany({
      where: paymentWhere,
      include: {
        paymentMethod: true,
        sale: { include: { items: { include: { product: true } } } },
        customer: true,
      },
    });

    for (const payment of creditPayments) {
      const shopId = payment.sale?.shopId ?? payment.customer?.shopId ?? null;
      if (targetLocationId && shopId !== targetLocationId) continue;

      if (categoryNum || searchTerm) {
        if (!payment.sale) continue; // unlinked payments only count without product filters
        const matched = payment.sale.items.some((item) =>
          this.matchesFilters(item, categoryNum, searchTerm),
        );
        if (!matched) continue;
      }

      const methodName = payment.paymentMethod?.name ?? 'Cash';
      add(`${methodName} (Credit)`, payment.amount);
    }

    return Array.from(map.entries()).map(([method, data]) => ({
      method,
      count: data.count,
      totalAmount: Math.round(data.total * 100) / 100,
    }));
  }

  // =========================================================================
  // Hospitality
  // =========================================================================

  /**
   * Hospitality-aware sales report. Restaurant/hotel orders do not create
   * `Sale` rows, so the generic sales reports are meaningless for hospitality
   * businesses. This aggregates settled `Order` rows instead.
   */
  async getHospitalityReport(startDate?: string, endDate?: string) {
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const dateFilter: Record<string, Date> = {};
    if (startDate) dateFilter.gte = new Date(`${startDate}T00:00:00`);
    if (endDate) dateFilter.lte = new Date(`${endDate}T23:59:59`);

    const orders = await this.prisma.order.findMany({
      where: {
        status: 'PAID',
        ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
      },
      include: {
        items: true,
        payments: { include: { paymentMethod: true } },
      },
    });

    const revenue = orders.reduce((s, o) => s + (o.paidAmount || 0), 0);
    const serviceCharge = orders.reduce((s, o) => s + (o.serviceCharge || 0), 0);
    const tax = orders.reduce((s, o) => s + (o.tax || 0), 0);
    const discount = orders.reduce((s, o) => s + (o.discount || 0), 0);

    const stationMap = new Map<string, { qty: number; revenue: number }>();
    const itemMap = new Map<string, { qty: number; revenue: number }>();
    let itemsSold = 0;

    for (const order of orders) {
      for (const item of order.items) {
        itemsSold += item.quantity;
        const rev = item.unitPrice * item.quantity;

        const stationLabel = item.stationName ?? 'Unassigned';
        const st = stationMap.get(stationLabel) ?? { qty: 0, revenue: 0 };
        st.qty += item.quantity;
        st.revenue += rev;
        stationMap.set(stationLabel, st);

        const it = itemMap.get(item.name) ?? { qty: 0, revenue: 0 };
        it.qty += item.quantity;
        it.revenue += rev;
        itemMap.set(item.name, it);
      }
    }

    const paymentMap = new Map<string, { count: number; total: number }>();
    for (const order of orders) {
      for (const p of order.payments) {
        if (p.status === 'VOIDED') continue;
        const name = p.paymentMethod?.name ?? 'Unspecified';
        const entry = paymentMap.get(name) ?? { count: 0, total: 0 };
        entry.count++;
        entry.total += p.amount;
        paymentMap.set(name, entry);
      }
    }

    return {
      orders: orders.length,
      revenue: round2(revenue),
      serviceCharge: round2(serviceCharge),
      tax: round2(tax),
      discount: round2(discount),
      itemsSold,
      avgOrder: orders.length ? round2(revenue / orders.length) : 0,
      byStation: Array.from(stationMap.entries()).map(([station, d]) => ({
        station,
        qty: d.qty,
        revenue: round2(d.revenue),
      })),
      topItems: Array.from(itemMap.entries())
        .map(([name, d]) => ({ name, qty: d.qty, revenue: round2(d.revenue) }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 8),
      paymentMethods: Array.from(paymentMap.entries()).map(([method, d]) => ({
        method,
        count: d.count,
        totalAmount: round2(d.total),
      })),
    };
  }

  // =========================================================================
  // =========================================================================
  // Hospitality Dashboard & Staff/Station Activity Audit
  // =========================================================================

  private readonly LIVE_ORDER_STATUSES = [
    'DISPATCHED',
    'PREPARING',
    'READY',
    'SERVED',
  ] as const;

  private readonly CHAIN_LABEL: Record<string, string> = {
    DISPATCHED: 'Waiter',
    PREPARING: 'Station Prep',
    READY: 'Station Ready',
    SERVED: 'Waiter',
    PAID: 'Cashier',
    CANCELLED: 'Manager',
  };

  /** Ordered, de-duplicated station names an order's items route through. */
  private orderStationRoute(order: { items: any[] }): string[] {
    const names: string[] = [];
    for (const item of order.items ?? []) {
      const route = (item.stationRoute as Array<{ name: string }>) ?? [];
      if (route.length) {
        for (const r of route) if (!names.includes(r.name)) names.push(r.name);
      } else if (item.stationName && !names.includes(item.stationName)) {
        names.push(item.stationName);
      }
    }
    return names;
  }

  /**
   * Derive per-station preparation stages from the order's audit trail. Each
   * PREPARING -> READY pair is one stage (stations are attributed in route
   * order). A stage still in PREPARING is measured against "now", so live
   * hang-offs (> HANG_MIN minutes) are flagged instantly.
   */
  private orderStationStages(
    history: Array<{ status: string; createdAt: Date }>,
    routeNames: string[],
  ): Array<{
    station: string;
    startedAt: Date;
    readyAt: Date | null;
    durationMin: number;
    hanging: boolean;
  }> {
    const HANG_MIN = 15;
    const stages: any[] = [];
    let preparingAt: Date | null = null;
    for (const h of history) {
      if (h.status === 'PREPARING') {
        preparingAt = new Date(h.createdAt);
      } else if (h.status === 'READY' && preparingAt) {
        const startedAt = preparingAt;
        const readyAt = new Date(h.createdAt);
        const durationMin = Math.round((readyAt.getTime() - startedAt.getTime()) / 60000);
        stages.push({
          station: routeNames[stages.length] ?? 'Station',
          startedAt,
          readyAt,
          durationMin,
          hanging: durationMin > HANG_MIN,
        });
        preparingAt = null;
      }
    }
    if (preparingAt) {
      const now = new Date();
      const durationMin = Math.round((now.getTime() - preparingAt.getTime()) / 60000);
      stages.push({
        station: routeNames[stages.length] ?? 'Station',
        startedAt: preparingAt,
        readyAt: null,
        durationMin,
        hanging: durationMin > HANG_MIN,
      });
    }
    return stages;
  }
  async getHospitalityDashboard(startDate?: string, endDate?: string) {
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const end = endDate ? new Date(`${endDate}T23:59:59`) : new Date();
    const start = startDate
      ? new Date(`${startDate}T00:00:00`)
      : new Date(new Date().setHours(0, 0, 0, 0));

    const paidOrders = await this.prisma.order.findMany({
      where: { status: 'PAID', createdAt: { gte: start, lte: end } },
      include: { items: true, history: { orderBy: { createdAt: 'asc' } } },
    });

    const revenue = paidOrders.reduce((s, o) => s + (o.paidAmount || 0), 0);
    const ticketTimes: number[] = [];
    for (const o of paidOrders) {
      const paidAt = (o.history ?? []).find((h) => h.status === 'PAID')?.createdAt;
      if (paidAt) {
        ticketTimes.push(
          (new Date(paidAt).getTime() - new Date(o.createdAt).getTime()) / 60000,
        );
      }
    }
    const avgTicketTime = ticketTimes.length
      ? Math.round(ticketTimes.reduce((s, t) => s + t, 0) / ticketTimes.length)
      : 0;

    const liveOrders = await this.prisma.order.findMany({
      where: { status: { in: [...this.LIVE_ORDER_STATUSES] as any } },
      include: { items: true, table: true, history: { orderBy: { createdAt: 'asc' } } },
    });

    const stationMap = new Map<string, { active: number; prepDurations: number[] }>();
    for (const o of liveOrders) {
      const stages = this.orderStationStages(o.history ?? [], this.orderStationRoute(o));
      for (const stage of stages) {
        const entry = stationMap.get(stage.station) ?? { active: 0, prepDurations: [] };
        entry.prepDurations.push(stage.durationMin);
        stationMap.set(stage.station, entry);
      }
      for (const it of o.items ?? []) {
        if (it.status === 'SERVED') continue;
        const label = it.stationName ?? it.stationKey ?? 'Unassigned';
        const entry = stationMap.get(label) ?? { active: 0, prepDurations: [] };
        entry.active += it.quantity;
        stationMap.set(label, entry);
      }
    }

    const itemMap = new Map<string, number>();
    const menuItemIds = new Set<number>();
    for (const o of [...paidOrders, ...liveOrders]) {
      for (const it of o.items ?? []) {
        itemMap.set(it.name, (itemMap.get(it.name) ?? 0) + it.quantity);
        if (it.menuItemId) menuItemIds.add(it.menuItemId);
      }
    }
    const menuItems = menuItemIds.size
      ? await this.prisma.menuItem.findMany({
          where: { id: { in: [...menuItemIds] } },
          include: { menuCategory: true },
        })
      : [];
    const itemCategory = new Map(
      menuItems.map((m) => [m.id, m.menuCategory?.name ?? 'Uncategorized']),
    );
    const catMap = new Map<string, number>();
    for (const o of [...paidOrders, ...liveOrders]) {
      for (const it of o.items ?? []) {
        const cat = it.menuItemId
          ? itemCategory.get(it.menuItemId) ?? 'Uncategorized'
          : 'Uncategorized';
        catMap.set(cat, (catMap.get(cat) ?? 0) + it.quantity);
      }
    }

    const occupiedTables = await this.prisma.diningTable.count({
      where: { status: 'OCCUPIED' },
    });

    return {
      range: { start: start.toISOString(), end: end.toISOString() },
      revenue: round2(revenue),
      activeOrders: liveOrders.length,
      avgTicketTime,
      stationBreakdown: Array.from(stationMap.entries()).map(([station, d]) => ({
        station,
        active: d.active,
        avgPrepTimeMin: d.prepDurations.length
          ? Math.round(d.prepDurations.reduce((s, x) => s + x, 0) / d.prepDurations.length)
          : 0,
      })),
      topItems: Array.from(itemMap.entries())
        .map(([name, qty]) => ({ name, qty }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 8),
      topCategories: Array.from(catMap.entries())
        .map(([name, qty]) => ({ name, qty }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 6),
      occupiedTables,
      guestFolio: liveOrders
        .filter((o) => o.tableId)
        .map((o) => ({
          tableId: o.tableId,
          tableName: o.table?.name ?? null,
          orderId: o.id,
          orderNumber: o.orderNumber,
          totalAmount: o.totalAmount,
          status: o.status,
        })),
    };
  }




  async getManufacturingDashboard(
    startDate?: string,
    endDate?: string,
    locationId?: number,
  ) {
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const end = endDate ? new Date(`${endDate}T23:59:59`) : new Date();
    const start = startDate
      ? new Date(`${startDate}T00:00:00`)
      : new Date(new Date().setHours(0, 0, 0, 0));
    const tenantId = getCurrentTenantId() ?? 0;
    const locWhere = locationId && locationId > 0 ? { locationId } : {};

    const bomsTotal = await this.prisma.billOfMaterials.count({
      where: { organizationId: tenantId },
    });

    // Completed work orders in the period drive production + COGM KPIs.
    const completedInRange = await this.prisma.workOrder.findMany({
      where: {
        organizationId: tenantId,
        status: "COMPLETED",
        completedAt: { gte: start, lte: end },
        ...locWhere,
      },
    });

    const statusGroups = await this.prisma.workOrder.groupBy({
      by: ["status"],
      _count: { _all: true },
      where: { organizationId: tenantId, ...locWhere },
    });
    const statusCount: Record<string, number> = {};
    for (const g of statusGroups) {
      statusCount[g.status] = g._count._all;
    }

    const targeted = completedInRange.reduce(
      (s, w) => s + (w.targetQuantity || 0),
      0,
    );
    const produced = completedInRange.reduce(
      (s, w) => s + (w.producedQuantity || 0),
      0,
    );
    const cogmTotal = completedInRange.reduce(
      (s, w) => s + (w.totalCogmCost || 0),
      0,
    );
    const costed = completedInRange.filter((w) => (w.cogmUnitCost || 0) > 0);
    const avgCogmUnit = costed.length
      ? round2(costed.reduce((s, w) => s + w.cogmUnitCost, 0) / costed.length)
      : 0;

    const scrapAgg = await this.prisma.productionScrapLog.aggregate({
      where: {
        organizationId: tenantId,
        createdAt: { gte: start, lte: end },
        ...(locationId && locationId > 0 ? { workOrder: { locationId } } : {}),
      },
      _count: { _all: true },
      _sum: { totalValue: true, quantity: true },
    });


    const incomeAgg = await this.prisma.mfgServiceIncome.aggregate({
      where: { organizationId: tenantId, incomeDate: { gte: start, lte: end } },
      _count: { _all: true },
      _sum: { amount: true },
    });
    const openJobs = await this.prisma.manufacturingOrder.count({
      where: {
        organizationId: tenantId,
        stage: {
          in: ["DESIGN", "PURCHASING_MATERIALS", "MATERIAL_READY", "QUEUED", "PRODUCTION"] as any,
        },
      },
    });
    const completedJobs = await this.prisma.manufacturingOrder.count({
      where: { organizationId: tenantId, stage: "COMPLETED" },
    });
    const issuesOpen = await this.prisma.materialIssue.count({
      where: { organizationId: tenantId, status: { in: ["OPEN", "PARTIAL"] as any } },
    });
    const machinesFaulty = await this.prisma.machine.count({
      where: { organizationId: tenantId, status: { in: ["UNDER_MAINTENANCE"] as any } },
    });
    const activeShifts = await this.prisma.shiftSession.count({
      where: { organizationId: tenantId, status: "ACTIVE" },
    });

    const recentWorkOrders = await this.prisma.workOrder.findMany({
      where: { organizationId: tenantId, ...locWhere },
      include: {
        finishedProduct: { select: { id: true, brand: true, baseName: true } },
        location: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    });

    const recentBatches = await this.prisma.productBatch.findMany({
      where: { tenantId, ...locWhere },
      include: { product: { select: { id: true, brand: true, baseName: true } } },
      orderBy: { createdAt: "desc" },
      take: 6,
    });

    const stockRows = await this.prisma.inventory.findMany({
      where: { tenantId, ...locWhere },
      select: { quantity: true, avgCost: true },
    });
    const stockValue = round2(
      stockRows.reduce((s, r) => s + (r.quantity || 0) * (r.avgCost || 0), 0),
    );

    return {
      range: { start: start.toISOString(), end: end.toISOString() },
      bomsTotal,
      statusCount,
      targeted: round2(targeted),
      produced: round2(produced),
      cogmTotal: round2(cogmTotal),
      avgCogmUnit,
      scrap: {
        count: scrapAgg._count._all ?? 0,
        quantity: round2(scrapAgg._sum.quantity ?? 0),
        value: round2(scrapAgg._sum.totalValue ?? 0),
      },
      stockValue,
      stockRowsCount: stockRows.length,
      recentWorkOrders,
      recentBatches,
      serviceIncome: {
        count: incomeAgg._count._all ?? 0,
        value: round2(incomeAgg._sum.amount ?? 0),
      },
      jobs: { open: openJobs, completed: completedJobs },
      issuesOpen,
      machinesFaulty,
      activeShifts,
    };
  }


  async getHospitalityActivity(
    startDate?: string,
    endDate?: string,
    station?: string,
    userId?: string,
  ) {
    const where: any = {};
    if (startDate && endDate) {
      where.createdAt = {
        gte: new Date(`${startDate}T00:00:00`),
        lte: new Date(`${endDate}T23:59:59`),
      };
    }
    if (userId && !Number.isNaN(Number(userId))) where.createdById = Number(userId);

    let orders = await this.prisma.order.findMany({
      where,
      include: {
        items: true,
        table: true,
        history: { orderBy: { createdAt: 'asc' } },
        payments: { include: { paymentMethod: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (station) {
      const key = station.toLowerCase();
      orders = orders.filter((o) =>
        (o.items ?? []).some((it: any) => {
          const route = (it.stationRoute as Array<{ name: string; key: string }>) ?? [];
          return (
            route.some((r) => r.key === key || r.name.toLowerCase() === key) ||
            (it.stationKey && it.stationKey.toLowerCase() === key) ||
            (it.stationName && it.stationName.toLowerCase() === key)
          );
        }),
      );
    }

    const records = orders.map((o) => {
      const routeNames = this.orderStationRoute(o);
      const stages = this.orderStationStages(o.history ?? [], routeNames);
      const chain = (o.history ?? []).map((h) => ({
        status: h.status,
        label: this.CHAIN_LABEL[h.status] ?? h.status,
        actorName: h.actorName,
        actorRole: h.actorRole,
        actorId: h.actorId,
        createdAt: h.createdAt,
      }));
      const items = (o.items ?? []).map((it) => ({
        id: it.id,
        name: it.name,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        status: it.status,
        stationName: it.stationName,
        route: (it.stationRoute as Array<{ name: string; key: string }>) ?? [],
      }));
      const hist = o.history ?? [];
      return {
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        totalAmount: o.totalAmount,
        discount: o.discount,
        tableName: o.table?.name ?? null,
        createdAt: o.createdAt,
        items,
        chain,
        stages,
        hanging: stages.filter((s) => s.hanging),
        ticketTimeMin: hist.length
          ? Math.round(
              (new Date(hist[hist.length - 1].createdAt).getTime() -
                new Date(o.createdAt).getTime()) /
                60000,
            )
          : null,
      };
    });

    const byStation = new Map<
      string,
      { itemsPrepared: number; prepDurations: number[]; orders: number }
    >();
    const byRole = new Map<string, { actions: number; orders: number }>();
    for (const o of orders) {
      const rolesSeenInOrder = new Set<string>();
      for (const h of o.history ?? []) {
        const role = h.actorRole || this.CHAIN_LABEL[h.status] || 'Unknown';
        const entry = byRole.get(role) ?? { actions: 0, orders: 0 };
        entry.actions++;
        if (!rolesSeenInOrder.has(role)) {
          entry.orders++;
          rolesSeenInOrder.add(role);
        }
        byRole.set(role, entry);
      }
      const stationsSeen = new Set<string>();
      for (const it of o.items ?? []) {
        const label = it.stationName ?? it.stationKey ?? 'Unassigned';
        const entry = byStation.get(label) ?? { itemsPrepared: 0, prepDurations: [], orders: 0 };
        entry.itemsPrepared += it.quantity;
        byStation.set(label, entry);
        stationsSeen.add(label);
      }
      const stages = this.orderStationStages(o.history ?? [], this.orderStationRoute(o));
      for (const s of stages) {
        const entry = byStation.get(s.station) ?? { itemsPrepared: 0, prepDurations: [], orders: 0 };
        entry.prepDurations.push(s.durationMin);
        byStation.set(s.station, entry);
        stationsSeen.add(s.station);
      }
      for (const st of stationsSeen) {
        const entry = byStation.get(st)!;
        entry.orders += 1;
        byStation.set(st, entry);
      }
    }

    return {
      summary: {
        byStation: Array.from(byStation.entries()).map(([station, d]) => ({
          station,
          itemsPrepared: d.itemsPrepared,
          orders: d.orders,
          avgPrepTimeMin: d.prepDurations.length
            ? Math.round(d.prepDurations.reduce((s, x) => s + x, 0) / d.prepDurations.length)
            : 0,
        })),
        byRole: Array.from(byRole.entries()).map(([role, d]) => ({
          role,
          actions: d.actions,
          orders: d.orders,
        })),
      },
      orders: records,
    };
  }


  // Low Stock / Dead Stock
  // =========================================================================

  async getLowStock(
    user: JwtPayload,
    search?: string,
    categoryId?: string,
    locationId?: string,
  ) {
    const targetLocationId =
      user.locationId !== null
        ? user.locationId
        : locationId
          ? Number(locationId)
          : undefined;

    const where: any = {};
    if (categoryId) where.categoryId = Number(categoryId);
    if (search) {
      const attrIds = await this.prisma.findProductIdsByAttributes(search);
      where.OR = [
        { baseName: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { barcode: { contains: search, mode: 'insensitive' } },
        ...(attrIds.length > 0 ? [{ id: { in: attrIds } }] : []),
        {
          variants: {
            some: {
              OR: [
                { sku: { contains: search, mode: 'insensitive' } },
                { barcode: { contains: search, mode: 'insensitive' } },
              ],
            },
          },
        },
        {
          batches: {
            some: { batchNumber: { contains: search, mode: 'insensitive' } },
          },
        },
      ];
    }

    // Get all low-stock inventory entries directly, grouped by product
    const lowInventories = await this.prisma.inventory.findMany({
      where: {
        ...(targetLocationId ? { locationId: targetLocationId } : {}),
        product: { ...where, reorderLevel: { gt: 0 } },
      },
      include: {
        product: true,
        location: true,
        variant: { select: { id: true, sku: true, attributes: true } },
      },
    });

    // Group by product; keep a per-variant breakdown so variant items collapse
    // under a single parent row (mirroring the Inventory report).
    const productMap = new Map<
      number,
      {
        id: number;
        name: string;
        total: number;
        locations: string[];
        variants: Map<number, ReportVariantDetail>;
      }
    >();

    for (const inv of lowInventories) {
      // Only count inventory below this product threshold.
      if (inv.quantity >= inv.product.reorderLevel) continue;
      let entry = productMap.get(inv.productId);
      if (!entry) {
        entry = {
          id: inv.productId,
          name: `${inv.product.brand} ${inv.product.baseName}`,
          total: 0,
          locations: [],
          variants: new Map(),
        };
        productMap.set(inv.productId, entry);
      }
      entry.total += inv.quantity;
      entry.locations.push(inv.location.name);

      const variantId = inv.variantId ?? -1;
      let variant = entry.variants.get(variantId);
      if (!variant) {
        variant = {
          variantId,
          sku: inv.variant?.sku ?? null,
          attributes: (inv.variant?.attributes as Record<string, any>) ?? {},
          quantity: 0,
          locations: [],
        };
        entry.variants.set(variantId, variant);
      }
      variant.quantity += inv.quantity;
      variant.locations?.push(inv.location.name);
    }

    // If Shopkeeper, find their active requests to prevent duplicates
    const pendingRequests = new Map<number, string>();
    if (user.locationType === 'SHOP' && user.locationId) {
      const activeRequests = await this.prisma.requestItem.findMany({
        where: {
          request: {
            shopId: user.locationId,
            status: {
              in: [
                'PENDING',
                'PARTIALLY_APPROVED',
                'APPROVED',
                'PARTIALLY_DISPATCHED',
              ],
            },
          },
          status: { in: ['PENDING', 'APPROVED'] },
        },
        include: { request: true },
      });

      for (const reqItem of activeRequests) {
        if (!pendingRequests.has(reqItem.productId)) {
          pendingRequests.set(
            reqItem.productId,
            reqItem.request.status.replace(/_/g, ' '),
          );
        }
      }
    }

    return Array.from(productMap.values())
      .map((p) => ({
        id: p.id,
        name: p.name,
        total: p.total,
        locationName: p.locations[0] || null,
        requestedStatus: pendingRequests.get(p.id) || null,
        variants: Array.from(p.variants.values()),
      }))
      .sort((a, b) => a.total - b.total);
  }

  async getDeadStock(
    user: JwtPayload,
    search?: string,
    categoryId?: string,
    locationId?: string,
  ) {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - DEAD_STOCK_MONTHS);

    const productWhere: any = {};
    if (categoryId) productWhere.categoryId = Number(categoryId);
    if (search) {
      const attrIds = await this.prisma.findProductIdsByAttributes(search);
      productWhere.OR = [
        { baseName: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { barcode: { contains: search, mode: 'insensitive' } },
        ...(attrIds.length > 0 ? [{ id: { in: attrIds } }] : []),
        {
          variants: {
            some: {
              OR: [
                { sku: { contains: search, mode: 'insensitive' } },
                { barcode: { contains: search, mode: 'insensitive' } },
              ],
            },
          },
        },
        {
          batches: {
            some: { batchNumber: { contains: search, mode: 'insensitive' } },
          },
        },
      ];
    }

    // Determine which location(s) to check inventory for
    let inventoryLocationId: number | undefined;
    if (user.locationId === null) {
      inventoryLocationId =
        locationId && Number(locationId) > 0 ? Number(locationId) : undefined;
    } else {
      inventoryLocationId = user.locationId ?? undefined;
    }

    // Get inventory at the target location with quantity > 0
    const inventories = await this.prisma.inventory.findMany({
      where: {
        quantity: { gt: 0 },
        ...(inventoryLocationId ? { locationId: inventoryLocationId } : {}),
        product: productWhere,
      },
      include: {
        product: true,
        location: true,
        variant: { select: { id: true, sku: true, attributes: true } },
      },
    });

    // A product is "dead" per product + location — its variant rows are
    // detail for a single parent, never separate parent rows (otherwise the
    // same recent-sale check repeats once per variant and duplicates rows).
    const checked = new Set<string>();
    const deadMap = new Map<
      string,
      {
        id: number;
        name: string;
        locationId: number;
        locationName: string;
        variants: ReportVariantDetail[];
      }
    >();

    for (const inv of inventories) {
      const key = `${inv.productId}:${inv.locationId}`;
      if (!checked.has(key)) {
        checked.add(key);
        const recentSaleItems = await this.prisma.saleItem.findFirst({
          where: {
            productId: inv.productId,
            sale: {
              shopId: inv.locationId,
              saleDate: { gte: threeMonthsAgo },
            },
          },
        });
        if (!recentSaleItems) {
          deadMap.set(key, {
            id: inv.productId,
            name: `${inv.product.brand} ${inv.product.baseName}`,
            locationId: inv.locationId,
            locationName: inv.location.name,
            variants: [],
          });
        }
      }
      const dead = deadMap.get(key);
      if (!dead) continue;
      dead.variants.push({
        variantId: inv.variantId ?? -1,
        sku: inv.variant?.sku ?? null,
        attributes: (inv.variant?.attributes as Record<string, any>) ?? {},
        quantity: inv.quantity,
      });
    }

    return Array.from(deadMap.values());
  }

  // =========================================================================
  // Audit
  // =========================================================================

  async getAuditTrail(): Promise<AuditLogResponse[]> {
    const logs = await this.prisma.auditLog.findMany({
      include: {
        user: { select: { id: true, email: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: AUDIT_TRAIL_LIMIT,
    });

    return logs.map((log) => ({
      id: log.id,
      userId: log.userId,
      action: log.action,
      details: log.details,
      createdAt: log.createdAt,
      user: {
        id: log.user.id,
        email: log.user.email,
        name: log.user.name,
      },
    }));
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  /**
   * Owners can query any location; non-owners are locked to their own.
   * Returns undefined for owner with no locationId filter (show all).
   * Returns 0 or negative as undefined to avoid filtering on invalid IDs.
   */
  private resolveLocationId(
    user: JwtPayload,
    locationId?: number,
  ): number | undefined {
    if (user.locationId !== null) {
      return user.locationId ?? undefined;
    }

    // Owner: if locationId is 0, NaN, or negative, treat as "no filter"
    if (
      locationId === undefined ||
      locationId === null ||
      Number.isNaN(locationId) ||
      locationId <= 0
    ) {
      return undefined;
    }

    return locationId;
  }

  /**
   * Build a `Prisma.ProductWhereInput` from optional category and search.
   */
  private async buildProductWhereClause(
    categoryId?: number,
    search?: string,
  ): Promise<Prisma.ProductWhereInput> {
    const where: Prisma.ProductWhereInput = {};

    if (
      categoryId !== undefined &&
      categoryId !== null &&
      !Number.isNaN(categoryId) &&
      categoryId > 0
    ) {
      where.categoryId = categoryId;
    }

    if (search) {
      const attrIds = await this.prisma.findProductIdsByAttributes(search);
      where.OR = [
        { baseName: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { barcode: { contains: search, mode: 'insensitive' } },
        ...(attrIds.length > 0 ? [{ id: { in: attrIds } }] : []),
        {
          variants: {
            some: {
              OR: [
                { sku: { contains: search, mode: 'insensitive' } },
                { barcode: { contains: search, mode: 'insensitive' } },
              ],
            },
          },
        },
        {
          batches: {
            some: { batchNumber: { contains: search, mode: 'insensitive' } },
          },
        },
      ];
    }

    return where;
  }

  /**
   * Build a `Prisma.SaleWhereInput` from optional date range and location.
   */
  private buildSaleWhereClause(
    startDate?: string,
    endDate?: string,
    locationId?: number,
  ): Prisma.SaleWhereInput {
    const where: Prisma.SaleWhereInput = {};

    if (startDate && endDate) {
      const endOfDay = new Date(endDate);
      endOfDay.setHours(23, 59, 59, 999);
      where.saleDate = {
        gte: new Date(startDate),
        lte: endOfDay,
      };
    }

    if (
      locationId !== undefined &&
      locationId !== null &&
      !Number.isNaN(locationId) &&
      locationId > 0
    ) {
      where.shopId = locationId;
    }

    return where;
  }

  /**
   * Check whether a sale item matches the given category and search filters.
   * Accepts any object with a `product` that has `categoryId`, `baseName`,
   * and `brand` fields — works across SaleItem and other item-like shapes.
   */
  private matchesFilters(
    item: {
      product: {
        categoryId: number | null;
        baseName: string;
        brand: string;
        sku?: string;
        attributes?: unknown;
      };
    },
    categoryId: number | null,
    searchTerm: string | null,
  ): boolean {
    if (
      categoryId !== null &&
      !Number.isNaN(categoryId) &&
      categoryId > 0 &&
      item.product.categoryId !== categoryId
    ) {
      return false;
    }

    if (searchTerm !== null) {
      const haystack = [
        item.product.baseName,
        item.product.brand,
        item.product.sku ?? '',
        JSON.stringify(item.product.attributes ?? {}),
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(searchTerm)) {
        return false;
      }
    }

    return true;
  }

  // =========================================================================
  // Unified Stats (Sales + Purchases)
  // =========================================================================

  async getUnifiedStats(user: JwtPayload, locationId?: number, startDate?: string, endDate?: string, categoryId?: number, search?: string) {
    const shopId = this.resolveLocationId(user, locationId);

    let dateFilter: any = undefined;
    if (startDate && endDate) {
      const endOfDay = new Date(endDate);
      endOfDay.setHours(23, 59, 59, 999);
      dateFilter = { gte: new Date(startDate), lte: endOfDay };
    }

    const baseWhere: any = {};
    if (shopId) baseWhere.shopId = shopId;
    else if (user.locationType === 'SHOP') baseWhere.shopId = user.locationId;
    if (dateFilter) baseWhere.saleDate = dateFilter;

    // Optional item-level filter (regular sales only; flips have no items)
    let itemFilter: any = undefined;
    if (categoryId) itemFilter = { product: { categoryId: +categoryId } };
    if (search) {
      itemFilter = {
        ...(itemFilter || {}),
        product: {
          ...(itemFilter?.product || {}),
          OR: [
            { brand: { contains: search, mode: 'insensitive' } },
            { baseName: { contains: search, mode: 'insensitive' } },
            { barcode: { contains: search, mode: 'insensitive' } },
          ],
        },
      };
    }
    const salesWhere: any = { ...baseWhere, ...(itemFilter ? { items: { some: itemFilter } } : {}) };

    const regularSales = await this.prisma.sale.aggregate({
      where: { ...salesWhere, purchaseId: null },
      _sum: { totalAmount: true, totalCost: true, profit: true, taxAmount: true },
      _count: true,
    });

    const flips = await this.prisma.sale.aggregate({
      where: { ...baseWhere, purchaseId: { not: null } },
      _sum: { totalAmount: true, totalCost: true, profit: true, taxAmount: true },
      _count: true,
    });

    // Sale type breakdown (gross, all sales) + actual collections per type
    const [fullyPaid, partiallyPaid, credited] = await Promise.all([
      this.prisma.sale.aggregate({ where: { ...baseWhere, saleType: 'FULLY_PAID' }, _sum: { totalAmount: true, totalCost: true, taxAmount: true, profit: true, paidAmount: true, remainingAmount: true } }),
      this.prisma.sale.aggregate({ where: { ...baseWhere, saleType: 'PARTIALLY_PAID' }, _sum: { totalAmount: true, totalCost: true, taxAmount: true, profit: true, paidAmount: true, remainingAmount: true } }),
      this.prisma.sale.aggregate({ where: { ...baseWhere, saleType: 'CREDITED' }, _sum: { totalAmount: true, totalCost: true, taxAmount: true, profit: true, paidAmount: true, remainingAmount: true } }),
    ]);

    // Returns within the same window (attributed to the sale type so the
    // breakdown reflects net revenue/profit).
    const returnWhere: any = {};
    if (shopId) returnWhere.shopId = shopId;
    else if (user.locationType === 'SHOP') returnWhere.shopId = user.locationId;
    if (dateFilter) returnWhere.createdAt = dateFilter;

    const returns = await this.prisma.return.findMany({
      where: returnWhere,
      include: {
        items: true,
        sale: { select: { saleType: true, purchaseId: true, taxAmount: true, totalAmount: true } },
      },
    });
    const typeReturns = {
      fullyPaid: { refund: 0, cost: 0, tax: 0 },
      partiallyPaid: { refund: 0, cost: 0, tax: 0 },
      credited: { refund: 0, cost: 0, tax: 0 },
    };
    let returnsRefund = 0;
    let returnsCost = 0;
    let returnsTax = 0;
    // Returns attributed to regular sales vs quick-purchase flips.
    let regularReturns = { refund: 0, cost: 0, tax: 0 };
    let flipReturns = { refund: 0, cost: 0, tax: 0 };
    for (const r of returns) {
      returnsRefund += r.totalRefund;
      let cost = 0;
      for (const ri of r.items) cost += ri.unitBuyPrice * ri.quantity;
      returnsCost += cost;
      const s = r.sale;
      const tax =
        s?.taxAmount && s.totalAmount > 0
          ? Math.round((r.totalRefund * (s.taxAmount / s.totalAmount)) * 100) / 100
          : 0;
      returnsTax += tax;
      const key =
        s?.saleType === 'PARTIALLY_PAID'
          ? 'partiallyPaid'
          : s?.saleType === 'CREDITED'
            ? 'credited'
            : 'fullyPaid';
      typeReturns[key].refund += r.totalRefund;
      typeReturns[key].cost += cost;
      typeReturns[key].tax += tax;
      if (s?.purchaseId != null) {
        flipReturns.refund += r.totalRefund;
        flipReturns.cost += cost;
        flipReturns.tax += tax;
      } else {
        regularReturns.refund += r.totalRefund;
        regularReturns.cost += cost;
        regularReturns.tax += tax;
      }
    }

    const grossRevenue = (regularSales._sum.totalAmount || 0) + (flips._sum.totalAmount || 0);
    const grossCost = (regularSales._sum.totalCost || 0) + (flips._sum.totalCost || 0);
    const grossTax = (regularSales._sum.taxAmount || 0) + (flips._sum.taxAmount || 0);

    const netRevenue = grossRevenue - returnsRefund;
    const netCost = grossCost - returnsCost;
    const totalTax = Math.max(0, grossTax - returnsTax);
    // Profit after VAT: revenue - tax - cost.
    const netProfit = netRevenue - totalTax - netCost;
    const margin = netRevenue > 0 ? (netProfit / netRevenue) * 100 : 0;

    const pendingCount = await this.prisma.purchase.count({
      where: { status: 'PENDING', ...(shopId ? { shopId } : {}) },
    });

    const salesRevenue = (regularSales._sum.totalAmount || 0) - regularReturns.refund;
    const salesTax = Math.max(0, (regularSales._sum.taxAmount || 0) - regularReturns.tax);
    const salesCost = (regularSales._sum.totalCost || 0) - regularReturns.cost;
    const salesProfit = salesRevenue - salesTax - salesCost;
    const flipsRevenue = (flips._sum.totalAmount || 0) - flipReturns.refund;
    const flipsTax = Math.max(0, (flips._sum.taxAmount || 0) - flipReturns.tax);
    const flipsCost = (flips._sum.totalCost || 0) - flipReturns.cost;
    const flipsProfit = flipsRevenue - flipsTax - flipsCost;
    const salesMargin = salesRevenue > 0 ? (salesProfit / salesRevenue) * 100 : 0;
    const flipsMargin = flipsRevenue > 0 ? (flipsProfit / flipsRevenue) * 100 : 0;

    return {
      sales: {
        revenue: salesRevenue,
        cost: salesCost,
        tax: salesTax,
        profit: salesProfit,
        count: regularSales._count,
        margin: +salesMargin.toFixed(1),
        breakdown: {
          fullyPaid: {
            revenue: (fullyPaid._sum.totalAmount || 0) - typeReturns.fullyPaid.refund,
            cost: (fullyPaid._sum.totalCost || 0) - typeReturns.fullyPaid.cost,
            tax: Math.max(0, (fullyPaid._sum.taxAmount || 0) - typeReturns.fullyPaid.tax),
            profit:
              (fullyPaid._sum.totalAmount || 0) - typeReturns.fullyPaid.refund -
              Math.max(0, (fullyPaid._sum.taxAmount || 0) - typeReturns.fullyPaid.tax) -
              ((fullyPaid._sum.totalCost || 0) - typeReturns.fullyPaid.cost),
            collected: fullyPaid._sum.paidAmount || 0,
            outstanding: fullyPaid._sum.remainingAmount || 0,
          },
          partiallyPaid: {
            revenue: (partiallyPaid._sum.totalAmount || 0) - typeReturns.partiallyPaid.refund,
            cost: (partiallyPaid._sum.totalCost || 0) - typeReturns.partiallyPaid.cost,
            tax: Math.max(0, (partiallyPaid._sum.taxAmount || 0) - typeReturns.partiallyPaid.tax),
            profit:
              (partiallyPaid._sum.totalAmount || 0) - typeReturns.partiallyPaid.refund -
              Math.max(0, (partiallyPaid._sum.taxAmount || 0) - typeReturns.partiallyPaid.tax) -
              ((partiallyPaid._sum.totalCost || 0) - typeReturns.partiallyPaid.cost),
            collected: partiallyPaid._sum.paidAmount || 0,
            outstanding: partiallyPaid._sum.remainingAmount || 0,
          },
          credited: {
            revenue: (credited._sum.totalAmount || 0) - typeReturns.credited.refund,
            cost: (credited._sum.totalCost || 0) - typeReturns.credited.cost,
            tax: Math.max(0, (credited._sum.taxAmount || 0) - typeReturns.credited.tax),
            profit:
              (credited._sum.totalAmount || 0) - typeReturns.credited.refund -
              Math.max(0, (credited._sum.taxAmount || 0) - typeReturns.credited.tax) -
              ((credited._sum.totalCost || 0) - typeReturns.credited.cost),
            collected: credited._sum.paidAmount || 0,
            outstanding: credited._sum.remainingAmount || 0,
          },
        },
      },
      flips: {
        revenue: flipsRevenue,
        cost: flipsCost,
        tax: flipsTax,
        profit: flipsProfit,
        count: flips._count,
        margin: +flipsMargin.toFixed(1),
      },
      returns: { refund: returnsRefund, cost: returnsCost, tax: returnsTax },
      pendingPurchases: pendingCount,
      combined: {
        totalRevenue: netRevenue,
        totalCost: netCost,
        totalTax,
        netProfit,
        margin: +margin.toFixed(1),
      },
    };
  }

  // =========================================================================
  // Cash Ledger & Day Sheet
  // =========================================================================

  async getCashLedger(user: JwtPayload, locationId?: number, startDate?: string, endDate?: string) {
    const shopId = this.resolveLocationId(user, locationId);
    const where: any = {};
    if (shopId) where.shopId = shopId;
    else if (user.locationType === 'SHOP') where.shopId = user.locationId;
    if (startDate && endDate) {
      const eod = new Date(endDate);
      eod.setHours(23, 59, 59, 999);
      where.createdAt = { gte: new Date(startDate), lte: eod };
    }
    return this.prisma.cashEntry.findMany({
      where,
      include: { shop: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDaySheet(user: JwtPayload, locationId?: number, startDate?: string, endDate?: string) {
    const shopId = this.resolveLocationId(user, locationId);
    const shopWhere: any = {};
    if (shopId) shopWhere.shopId = shopId;
    else if (user.locationType === 'SHOP') shopWhere.shopId = user.locationId;

    let start: Date | undefined;
    let end: Date | undefined;
    if (startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
    }

    // Opening balance = net of all entries before the window
    const beforeWhere: any = { ...shopWhere };
    if (start) beforeWhere.createdAt = { lt: start };

    const beforeEntries = await this.prisma.cashEntry.findMany({ where: beforeWhere });
    let balance = 0;
    for (const e of beforeEntries) {
      balance += e.type === 'INFLOW' ? e.amount : -e.amount;
    }
    const opening = balance;

    // Entries within the window, grouped by day
    const inWhere: any = { ...shopWhere };
    if (start && end) inWhere.createdAt = { gte: start, lte: end };

    const entries = await this.prisma.cashEntry.findMany({
      where: inWhere,
      orderBy: { createdAt: 'asc' },
    });

    const days: Record<string, { date: string; inflow: number; outflow: number; closing: number }> = {};
    let totalInflow = 0;
    let totalOutflow = 0;
    for (const e of entries) {
      const date = e.createdAt.toISOString().slice(0, 10);
      days[date] = days[date] || { date, inflow: 0, outflow: 0, closing: 0 };
      if (e.type === 'INFLOW') {
        days[date].inflow += e.amount;
        totalInflow += e.amount;
        balance += e.amount;
      } else {
        days[date].outflow += e.amount;
        totalOutflow += e.amount;
        balance -= e.amount;
      }
      days[date].closing = balance;
    }

    return {
      opening,
      totalInflow,
      totalOutflow,
      closing: balance,
      days: Object.values(days).sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  // =========================================================================
  // CSV exports
  // =========================================================================

  private toCsv(headers: string[], rows: (string | number)[][]): string {
    const escape = (value: string | number) => {
      const s = String(value ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [
      headers.map(escape).join(','),
      ...rows.map((row) => row.map(escape).join(',')),
    ].join('\n');
  }

  private buildCsv(sections: ReportSection[]): string {
    const escape = (value: string | number) => {
      const s = String(value ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return sections
      .map((section) => {
        const headerRow = section.headers.map(escape).join(',');
        const dataRows = section.rows.map((row) =>
          row.map(escape).join(','),
        );
        return [section.title, headerRow, ...dataRows].join('\n');
      })
      .join('\n\n');
  }

  /** Valuation columns for tabular exports. Unit sell price is always present;
   *  the cost side is added only when the caller received `valuation` (i.e. they
   *  hold reports.view_cost_valuation). */
  private inventoryValuationColumns(data: InventoryBreakdownResponse) {
    const hasValuation = !!data.valuation;
    const headers = hasValuation
      ? ['Buy Price', 'Sell Price', 'Buy Value', 'Sell Value', 'Est. Profit']
      : ['Sell Price'];
    const cells = (r: any) =>
      hasValuation
        ? [
            r.unitBuyPrice ?? '',
            r.unitSellPrice ?? '',
            r.buyTotal ?? '',
            r.sellTotal ?? '',
            r.estimatedProfit ?? '',
          ]
        : [r.unitSellPrice ?? ''];
    return { headers, cells };
  }

  async getInventoryBreakdownCsv(
    user: JwtPayload,
    locationId?: number,
    categoryId?: number,
    search?: string,
  ): Promise<string> {
    const data = await this.getInventoryBreakdown(
      user,
      locationId,
      categoryId,
      search,
    );
    const valuationCols = this.inventoryValuationColumns(data);
    const headers = [
      'Product',
      'Category',
      'Total',
      ...data.columns,
      ...valuationCols.headers,
    ];
    const rows = data.rows.map((r) => [
      r.productName,
      r.category,
      r.total,
      ...data.columns.map((c) => r.locations[c] ?? 0),
      ...valuationCols.cells(r),
    ]);
    return this.toCsv(headers, rows);
  }

  async getLowStockCsv(
    user: JwtPayload,
    search?: string,
    categoryId?: string,
    locationId?: string,
  ): Promise<string> {
    const data = await this.getLowStock(user, search, categoryId, locationId);
    const headers = ['Product', 'Total', 'Location', 'Request Status'];
    const rows = data.map((d) => [
      d.name,
      d.total,
      d.locationName ?? '',
      d.requestedStatus ?? '',
    ]);
    return this.toCsv(headers, rows);
  }

  async getDeadStockCsv(
    user: JwtPayload,
    search?: string,
    categoryId?: string,
    locationId?: string,
  ): Promise<string> {
    const data = await this.getDeadStock(user, search, categoryId, locationId);
    const headers = ['Product', 'Location'];
    const rows = data.map((d) => [d.name, d.locationName]);
    return this.toCsv(headers, rows);
  }

  // =========================================================================
  // PDF exports
  // =========================================================================

  private buildPdf(sections: ReportSection[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margin: 40,
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      sections.forEach((section, idx) => {
        if (idx > 0) doc.addPage();

        const { headers, rows } = section;
        const colCount = Math.max(headers.length, 1);
        const left = 40;
        const colWidth = (doc.page.width - 80) / colCount;
        const lineHeight = 16;

        doc.font('Helvetica-Bold').fontSize(14).text(section.title);
        doc.moveDown(0.4);

        const renderRow = (cells: (string | number)[], bold: boolean) => {
          const startY = doc.y;
          cells.forEach((cell, i) => {
            doc
              .font(bold ? 'Helvetica-Bold' : 'Helvetica')
              .fontSize(bold ? 9 : 8)
              .text(String(cell ?? ''), left + i * colWidth, startY, {
                width: colWidth - 6,
                height: lineHeight,
                ellipsis: true,
                lineBreak: false,
              });
          });
          doc.y = startY + lineHeight;
        };

        if (doc.y > doc.page.height - 80) doc.addPage();
        renderRow(headers, true);
        doc.moveDown(0.2);

        for (const row of rows) {
          if (doc.y > doc.page.height - 80) doc.addPage();
          renderRow(row, false);
        }
      });

      doc.end();
    });
  }

  async getInventoryBreakdownPdf(
    user: JwtPayload,
    locationId?: number,
    categoryId?: number,
    search?: string,
  ): Promise<Buffer> {
    const data = await this.getInventoryBreakdown(
      user,
      locationId,
      categoryId,
      search,
    );
    const valuationCols = this.inventoryValuationColumns(data);
    const headers = [
      'Product',
      'Category',
      'Total',
      ...data.columns,
      ...valuationCols.headers,
    ];
    const rows = data.rows.map((r) => [
      r.productName,
      r.category,
      r.total,
      ...data.columns.map((c) => r.locations[c] ?? 0),
      ...valuationCols.cells(r),
    ]);
    return this.buildPdf([{ title: 'Inventory Breakdown', headers, rows }]);
  }

  async getLowStockPdf(
    user: JwtPayload,
    search?: string,
    categoryId?: string,
    locationId?: string,
  ): Promise<Buffer> {
    const data = await this.getLowStock(user, search, categoryId, locationId);
    const headers = ['Product', 'Total', 'Location', 'Request Status'];
    const rows = data.map((d) => [
      d.name,
      d.total,
      d.locationName ?? '',
      d.requestedStatus ?? '',
    ]);
    return this.buildPdf([{ title: 'Low Stock Report', headers, rows }]);
  }

  async getDeadStockPdf(
    user: JwtPayload,
    search?: string,
    categoryId?: string,
    locationId?: string,
  ): Promise<Buffer> {
    const data = await this.getDeadStock(user, search, categoryId, locationId);
    const headers = ['Product', 'Location'];
    const rows = data.map((d) => [d.name, d.locationName]);
    return this.buildPdf([{ title: 'Dead Stock Report', headers, rows }]);
  }

  // =========================================================================
  // Sales & combined exports
  // =========================================================================

  private async getSalesSections(
    user: JwtPayload,
    startDate?: string,
    endDate?: string,
    locationId?: number,
    categoryId?: number,
    search?: string,
  ): Promise<ReportSection[]> {
    const summary = await this.getSalesSummary(
      user,
      startDate,
      endDate,
      locationId,
      categoryId,
      search,
    );
    const paymentMethods = await this.getPaymentMethodsBreakdown(
      user,
      startDate,
      endDate,
      locationId,
      categoryId,
      search,
    );
    const salesList = await this.getSalesListSection(
      user,
      startDate,
      endDate,
      locationId,
      categoryId,
      search,
    );

    return [
      {
        title: 'Sales Summary',
        headers: ['Metric', 'Value'],
        rows: [
          ['Revenue', summary.totalRevenue],
          ['Cost', summary.totalCost],
          ['Tax (VAT)', summary.totalTax],
          ['Profit (after tax)', summary.totalProfit],
          ['Margin', `${summary.margin}%`],
        ],
      },
      {
        title: 'Sale Type Breakdown',
        headers: ['Type', 'Revenue', 'Cost', 'Tax (VAT)', 'Profit', 'Collected', 'Outstanding'],
        rows: [
          [
            'Fully Paid',
            summary.breakdown.fullyPaid.revenue,
            summary.breakdown.fullyPaid.cost,
            summary.breakdown.fullyPaid.tax,
            summary.breakdown.fullyPaid.profit,
            summary.breakdown.fullyPaid.collected,
            summary.breakdown.fullyPaid.outstanding,
          ],
          [
            'Partially Paid',
            summary.breakdown.partiallyPaid.revenue,
            summary.breakdown.partiallyPaid.cost,
            summary.breakdown.partiallyPaid.tax,
            summary.breakdown.partiallyPaid.profit,
            summary.breakdown.partiallyPaid.collected,
            summary.breakdown.partiallyPaid.outstanding,
          ],
          [
            'Credited',
            summary.breakdown.credited.revenue,
            summary.breakdown.credited.cost,
            summary.breakdown.credited.tax,
            summary.breakdown.credited.profit,
            summary.breakdown.credited.collected,
            summary.breakdown.credited.outstanding,
          ],
        ],
      },
      {
        title: 'Top Selling Products',
        headers: ['Product', 'Quantity'],
        rows: summary.topProducts.map((p) => [p.name, p.qty]),
      },
      {
        title: 'Payment Methods',
        headers: ['Method', 'Count', 'Total Amount'],
        rows: paymentMethods.map((p) => [p.method, p.count, p.totalAmount]),
      },
      {
        title: 'Credit Collections by Payment Method',
        headers: ['Method', 'Count', 'Total Amount'],
        rows: paymentMethods
          .filter((p) => p.method.includes('(Credit)'))
          .map((p) => [p.method, p.count, p.totalAmount]),
      },
      salesList,
    ];
  }

  private async getSalesListSection(
    user: JwtPayload,
    startDate?: string,
    endDate?: string,
    locationId?: number,
    categoryId?: number,
    search?: string,
  ): Promise<ReportSection> {
    const targetLocationId = this.resolveLocationId(user, locationId);
    const saleWhere = this.buildSaleWhereClause(
      startDate,
      endDate,
      targetLocationId,
    );
    const categoryNum =
      categoryId !== undefined &&
      categoryId !== null &&
      !Number.isNaN(categoryId) &&
      categoryId > 0
        ? categoryId
        : null;
    const searchTerm = search?.toLowerCase() || null;

    const sales = await this.prisma.sale.findMany({
      where: saleWhere,
      include: {
        items: { include: { product: { include: { category: true } } } },
        shop: true,
        returns: { select: { totalRefund: true } },
      },
      orderBy: { saleDate: 'desc' },
      take: 500,
    });

    const rows = sales
      .filter((s) => {
        if (!categoryNum && !searchTerm) return true;
        return s.items.some((item) =>
          this.matchesFilters(item, categoryNum, searchTerm),
        );
      })
      .map((s) => {
        const returned = s.returns.reduce((sum, r) => sum + r.totalRefund, 0);
        return [
          s.invoiceNumber,
          s.saleDate.toISOString().slice(0, 10),
          s.shop?.name ?? '',
          s.items.map((i) => `${i.quantity}x ${i.product.baseName}`).join(', '),
          s.totalAmount,
          Math.max(0, s.totalAmount - returned),
          s.taxAmount ?? 0,
          s.saleType,
        ];
      });

    return {
      title: 'Sales List',
      headers: ['Invoice', 'Date', 'Shop', 'Items', 'Total', 'Net', 'Tax (VAT)', 'Type'],
      rows,
    };
  }

  async getSalesCsv(
    user: JwtPayload,
    startDate?: string,
    endDate?: string,
    locationId?: number,
    categoryId?: number,
    search?: string,
  ): Promise<string> {
    const sections = await this.getSalesSections(
      user,
      startDate,
      endDate,
      locationId,
      categoryId,
      search,
    );
    return this.buildCsv(sections);
  }

  async getSalesPdf(
    user: JwtPayload,
    startDate?: string,
    endDate?: string,
    locationId?: number,
    categoryId?: number,
    search?: string,
  ): Promise<Buffer> {
    const sections = await this.getSalesSections(
      user,
      startDate,
      endDate,
      locationId,
      categoryId,
      search,
    );
    return this.buildPdf(sections);
  }

  private async getFullReportSections(
    user: JwtPayload,
    startDate?: string,
    endDate?: string,
    locationId?: number,
    categoryId?: number,
    search?: string,
  ): Promise<ReportSection[]> {
    const salesSections = await this.getSalesSections(
      user,
      startDate,
      endDate,
      locationId,
      categoryId,
      search,
    );

    const inventory = await this.getInventoryBreakdown(
      user,
      locationId,
      categoryId,
      search,
    );

    const categoryStr =
      categoryId !== undefined && categoryId > 0
        ? String(categoryId)
        : undefined;
    const locationStr =
      locationId !== undefined && locationId > 0
        ? String(locationId)
        : undefined;

    const lowStock = await this.getLowStock(
      user,
      search,
      categoryStr,
      locationStr,
    );
    const deadStock = await this.getDeadStock(
      user,
      search,
      categoryStr,
      locationStr,
    );

    return [
      ...salesSections,
      {
        title: 'Inventory Breakdown',
        headers: [
          'Product',
          'Category',
          'Total',
          ...inventory.columns,
          ...this.inventoryValuationColumns(inventory).headers,
        ],
        rows: inventory.rows.map((r) => [
          r.productName,
          r.category,
          r.total,
          ...inventory.columns.map((c) => r.locations[c] ?? 0),
          ...this.inventoryValuationColumns(inventory).cells(r),
        ]),
      },
      {
        title: 'Low Stock',
        headers: ['Product', 'Total', 'Location', 'Request Status'],
        rows: lowStock.map((d) => [
          d.name,
          d.total,
          d.locationName ?? '',
          d.requestedStatus ?? '',
        ]),
      },
      {
        title: 'Dead Stock',
        headers: ['Product', 'Location'],
        rows: deadStock.map((d) => [d.name, d.locationName]),
      },
    ];
  }

  async getFullReportCsv(
    user: JwtPayload,
    startDate?: string,
    endDate?: string,
    locationId?: number,
    categoryId?: number,
    search?: string,
  ): Promise<string> {
    const sections = await this.getFullReportSections(
      user,
      startDate,
      endDate,
      locationId,
      categoryId,
      search,
    );
    return this.buildCsv(sections);
  }

  async getFullReportPdf(
    user: JwtPayload,
    startDate?: string,
    endDate?: string,
    locationId?: number,
    categoryId?: number,
    search?: string,
  ): Promise<Buffer> {
    const sections = await this.getFullReportSections(
      user,
      startDate,
      endDate,
      locationId,
      categoryId,
      search,
    );
    return this.buildPdf(sections);
  }
}
