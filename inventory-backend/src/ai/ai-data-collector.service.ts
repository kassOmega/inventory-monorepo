// src/ai/ai-data-collector.service.ts
// Time-series metric aggregator. Queries the database over a historical window
// (30/60/90 days) and builds a compact digest that is injected into Gemini
// prompts: sales velocity, run-rate / days-of-inventory-remaining, dead & low
// stock, category trends, and staff efficiency metrics.
import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  BusinessMetricsDigest,
  CategoryTrend,
  ChurnInputCustomer,
  DeadStockItem,
  FinanceSnapshot,
  LowStockItem,
  OrderMetrics,
  PricingInputItem,
  ProductVelocity,
  ReorderItem,
  StaffMetric,
} from './entities/ai.entity';

const DAY_MS = 24 * 60 * 60 * 1000;
const LOW_STOCK_THRESHOLD = 10;
const DEAD_STOCK_LOOKBACK_DAYS = 30;
const FRESH_PRODUCT_GRACE_DAYS = 14;
const DIR_WARNING_DAYS = 14;

@Injectable()
export class AiDataCollectorService {
  private readonly logger = new Logger(AiDataCollectorService.name);

  constructor(private readonly prisma: PrismaService) {}

  async collectMetrics(opts: {
    tenantId: number | null;
    businessType: string | null;
    days?: number;
    locationId?: number;
  }): Promise<BusinessMetricsDigest> {
    const days = Math.min(90, Math.max(7, opts.days ?? 30));
    const tenantId = opts.tenantId ?? null;
    const tenantFilter = tenantId != null ? { tenantId } : {};
    const locationFilter =
      opts.locationId != null && opts.locationId > 0
        ? { shopId: opts.locationId }
        : {};

    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - days * DAY_MS);
    const prevStart = new Date(windowStart.getTime() - days * DAY_MS);

    const [sales, inventories, prevSales, orderMetrics] = await Promise.all([
      this.prisma.sale.findMany({
        where: {
          ...tenantFilter,
          ...locationFilter,
          saleDate: { gte: windowStart, lte: windowEnd },
        },
        include: {
          items: { include: { product: { include: { category: true } } } },
          shop: true,
        },
        orderBy: { saleDate: 'asc' },
      }),
      this.prisma.inventory.findMany({
        where: tenantFilter,
        include: {
          product: { include: { category: true } },
          location: true,
        },
      }),
      this.prisma.sale.findMany({
        where: {
          ...tenantFilter,
          ...locationFilter,
          saleDate: { gte: prevStart, lt: windowStart },
        },
        include: {
          items: { include: { product: { include: { category: true } } } },
        },
      }),
      this.fetchOrderMetrics(tenantFilter, windowStart, windowEnd),
    ]);

    // --- Sales aggregation -------------------------------------------------
    const productMap = new Map<number, ProductVelocity>();
    const categoryMap = new Map<string, { unitsSold: number; revenue: number }>();
    const soldProductIds = new Set<number>();
    const staffMap = new Map<
      number,
      { orders: number; revenue: number; profit: number }
    >();
    const hourMap = new Map<number, number>();

    let totalRevenue = 0;
    let totalUnits = 0;

    for (const sale of sales) {
      totalRevenue += sale.totalAmount;
      const staff =
        staffMap.get(sale.soldById) ?? { orders: 0, revenue: 0, profit: 0 };
      staff.orders += 1;
      staff.revenue += sale.totalAmount;
      staff.profit += sale.profit ?? 0;
      staffMap.set(sale.soldById, staff);

      const hour = new Date(sale.saleDate).getHours();
      hourMap.set(hour, (hourMap.get(hour) ?? 0) + 1);

      for (const item of sale.items) {
        const p = item.product;
        soldProductIds.add(p.id);
        totalUnits += item.quantity;
        const revenue = item.unitSellPrice * item.quantity;
        const name = `${p.brand} ${p.baseName}`;
        const cat = p.category?.name ?? 'Uncategorized';

        const entry =
          productMap.get(p.id) ??
          ({
            productId: p.id,
            name,
            category: cat,
            currentStock: 0,
            dailyVelocity: 0,
            daysOfInventoryRemaining: null,
            revenue: 0,
            unitsSold: 0,
          } as ProductVelocity);
        entry.unitsSold += item.quantity;
        entry.revenue += revenue;
        productMap.set(p.id, entry);

        const c = categoryMap.get(cat) ?? { unitsSold: 0, revenue: 0 };
        c.unitsSold += item.quantity;
        c.revenue += revenue;
        categoryMap.set(cat, c);
      }
    }

    // --- Inventory / stock -------------------------------------------------
    const stockMap = new Map<number, { qty: number; locations: Set<string> }>();
    for (const inv of inventories) {
      const s = stockMap.get(inv.productId) ?? {
        qty: 0,
        locations: new Set<string>(),
      };
      s.qty += inv.quantity;
      s.locations.add(inv.location.name);
      stockMap.set(inv.productId, s);
    }

    for (const entry of productMap.values()) {
      const stock = stockMap.get(entry.productId);
      entry.currentStock = stock?.qty ?? 0;
      entry.dailyVelocity = round2(entry.unitsSold / days);
      entry.daysOfInventoryRemaining =
        entry.dailyVelocity > 0
          ? round1(entry.currentStock / entry.dailyVelocity)
          : null;
    }

    const topProducts = [...productMap.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // --- Low stock (items that will run out soon or are already too low) ---
    const lowStockItems: LowStockItem[] = [];
    const flaggedLowIds = new Set<number>();

    for (const entry of productMap.values()) {
      const dir = entry.daysOfInventoryRemaining;
      const isLow =
        (dir != null && dir <= DIR_WARNING_DAYS) ||
        (entry.currentStock > 0 && entry.currentStock <= LOW_STOCK_THRESHOLD);
      if (isLow) {
        flaggedLowIds.add(entry.productId);
        lowStockItems.push({
          productId: entry.productId,
          name: entry.name,
          currentStock: entry.currentStock,
          dailyVelocity: entry.dailyVelocity,
          daysRemaining: dir ?? 0,
          locations: [...(stockMap.get(entry.productId)?.locations ?? [])],
        });
      }
    }

    // Never-sold products still sitting at very low stock.
    for (const [pid, stock] of stockMap) {
      if (flaggedLowIds.has(pid) || soldProductIds.has(pid)) continue;
      if (stock.qty > 0 && stock.qty <= LOW_STOCK_THRESHOLD) {
        const product = inventories.find((i) => i.productId === pid)?.product;
        if (!product) continue;
        lowStockItems.push({
          productId: pid,
          name: `${product.brand} ${product.baseName}`,
          currentStock: stock.qty,
          dailyVelocity: 0,
          daysRemaining: 0,
          locations: [...stock.locations],
        });
      }
    }

    // --- Dead stock (zero sales in 30+ days but still on the shelf) ---------
    const deadStockItems: DeadStockItem[] = [];
    const graceDate = new Date(
      windowEnd.getTime() - FRESH_PRODUCT_GRACE_DAYS * DAY_MS,
    );
    for (const [pid, stock] of stockMap) {
      if (stock.qty <= 0 || soldProductIds.has(pid)) continue;
      const product = inventories.find((i) => i.productId === pid)?.product;
      if (!product) continue;
      if (product.createdAt > graceDate) continue; // brand-new stock, not dead yet
      deadStockItems.push({
        productId: pid,
        name: `${product.brand} ${product.baseName}`,
        currentStock: stock.qty,
        locations: [...stock.locations],
      });
    }

    // --- Category trends (growth vs the previous window) --------------------
    const prevCategoryMap = new Map<string, number>();
    for (const sale of prevSales) {
      for (const item of sale.items) {
        const cat = item.product.category?.name ?? 'Uncategorized';
        prevCategoryMap.set(cat, (prevCategoryMap.get(cat) ?? 0) + item.quantity);
      }
    }

    const categoryTrends: CategoryTrend[] = [];
    for (const [cat, cur] of categoryMap) {
      const prev = prevCategoryMap.get(cat) ?? 0;
      const growthPct =
        prev > 0
          ? ((cur.unitsSold - prev) / prev) * 100
          : cur.unitsSold > 0
            ? 100
            : 0;
      categoryTrends.push({
        category: cat,
        unitsSold: cur.unitsSold,
        revenue: round2(cur.revenue),
        previousUnits: prev,
        growthPct: round1(growthPct),
      });
    }
    categoryTrends.sort((a, b) => b.growthPct - a.growthPct);

    return {
      tenantId,
      windowDays: days,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      businessType: opts.businessType ?? null,
      totalRevenue: round2(totalRevenue),
      totalUnitsSold: totalUnits,
      avgDailyRevenue: round2(totalRevenue / days),
      topProducts,
      categoryTrends,
      lowStockItems: lowStockItems.slice(0, 25),
      deadStockItems: deadStockItems.slice(0, 25),
      staff: await this.buildStaffMetrics(staffMap),
      peakSalesHours: [...hourMap.entries()]
        .map(([hour, orders]) => ({ hour, orders }))
        .sort((a, b) => b.orders - a.orders)
        .slice(0, 6),
      orderMetrics,
    };
  }

  /**
   * Cash flow snapshot for liquidity forecasting: average daily sales/order
   * revenue, recurring expenses, purchase outflow, cash in the till, and the
   * outstanding receivables balance (credit sales minus payments) by age.
   */
  async collectFinanceMetrics(opts: {
    tenantId: number | null;
    businessType: string | null;
    days?: number;
  }): Promise<FinanceSnapshot> {
    const days = Math.min(90, Math.max(7, opts.days ?? 30));
    const tenantId = opts.tenantId ?? null;
    const tenantFilter = tenantId != null ? { tenantId } : {};
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - days * DAY_MS);

    const [
      sales,
      orderMetrics,
      orders,
      orderItems,
      expenses,
      purchases,
      floats,
      creditSales,
      creditPayments,
      incomes,
      folioCharges,
      inventories,
      products,
    ] = await Promise.all([
      this.prisma.sale.findMany({
        where: { ...tenantFilter, saleDate: { gte: windowStart, lte: windowEnd } },
        select: { totalAmount: true, totalCost: true, saleDate: true },
      }),
      this.fetchOrderMetrics(tenantFilter, windowStart, windowEnd),
      this.prisma.order.findMany({
        where: {
          ...tenantFilter,
          status: OrderStatus.PAID,
          createdAt: { gte: windowStart, lte: windowEnd },
        },
        select: { totalAmount: true, createdAt: true },
      }),
      this.prisma.orderItem.findMany({
        where: {
          ...tenantFilter,
          order: {
            status: OrderStatus.PAID,
            createdAt: { gte: windowStart, lte: windowEnd },
          },
        },
        select: { cost: true, quantity: true },
      }),
      this.prisma.expense.findMany({
        where: { ...tenantFilter, expenseDate: { gte: windowStart, lte: windowEnd } },
        select: { amount: true, account: { select: { name: true } } },
      }),
      this.prisma.purchase.findMany({
        where: { ...tenantFilter, createdAt: { gte: windowStart, lte: windowEnd } },
        select: { totalCost: true },
      }),
      this.prisma.cashFloat.findMany({ where: tenantFilter, select: { amount: true } }),
      this.prisma.creditSale.findMany({
        where: tenantFilter,
        select: { totalAmount: true, createdAt: true },
      }),
      this.prisma.creditPayment.findMany({
        where: tenantFilter,
        select: { amount: true },
      }),
      this.prisma.otherIncome.findMany({
        where: {
          ...tenantFilter,
          source: null,
          incomeDate: { gte: windowStart, lte: windowEnd },
        },
        select: { amount: true, incomeDate: true },
      }),
      this.prisma.folioEntry.findMany({
        where: {
          ...tenantFilter,
          type: 'CHARGE',
          createdAt: { gte: windowStart, lte: windowEnd },
        },
        select: { amount: true, createdAt: true },
      }),
      this.prisma.inventory.findMany({
        where: tenantFilter,
        select: { quantity: true, product: { select: { currentBuyPrice: true } } },
      }),
      this.prisma.product.findMany({
        where: { ...tenantFilter, inventory: { some: {} } },
        select: {
          currentBuyPrice: true,
          reorderLevel: true,
          reorderQty: true,
          inventory: { select: { quantity: true } },
        },
      }),
    ]);

    const totalSales = sales.reduce((s, r) => s + r.totalAmount, 0);
    const totalSaleCogs = sales.reduce((s, r) => s + r.totalCost, 0);
    const orderRevenue = orders.reduce((s, o) => s + o.totalAmount, 0);
    const orderCogs = orderItems.reduce(
      (s, i) => s + (i.cost ?? 0) * i.quantity,
      0,
    );
    const otherIncome = incomes.reduce((s, i) => s + i.amount, 0);
    const folioRevenue = folioCharges.reduce((s, f) => s + f.amount, 0);
    const totalExpenses = expenses.reduce((s, r) => s + r.amount, 0);
    const totalPurchases = purchases.reduce((s, r) => s + r.totalCost, 0);
    const cashFloatBalance = floats.reduce((s, r) => s + r.amount, 0);

    const totalRevenue =
      totalSales + orderRevenue + otherIncome + folioRevenue;
    const totalCogs = totalSaleCogs + orderCogs;
    const grossProfit = totalRevenue - totalCogs;
    const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    // Overhead broken down by account (Rent, Salaries, Utilities, Marketing...).
    const overheadMap = new Map<string, number>();
    for (const e of expenses) {
      const name = e.account?.name ?? 'Other';
      overheadMap.set(name, (overheadMap.get(name) ?? 0) + e.amount);
    }

    // Daily sales velocity series — drives the 30/60/90-day cash flow inflow.
    const revenueByDay = new Map<string, number>();
    const addDay = (date: Date, amount: number) => {
      const key = date.toISOString().slice(0, 10);
      revenueByDay.set(key, (revenueByDay.get(key) ?? 0) + amount);
    };
    for (const s of sales) addDay(s.saleDate, s.totalAmount);
    for (const o of orders) addDay(o.createdAt, o.totalAmount);
    for (const inc of incomes) addDay(inc.incomeDate, inc.amount);
    for (const f of folioCharges) addDay(f.createdAt, f.amount);
    const dailyRevenueSeries = [...revenueByDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, revenue]) => ({ date, revenue: round2(revenue) }));

    // Current inventory value (Σ qty × buy price).
    const stockValue = inventories.reduce(
      (s, i) => s + (i.product?.currentBuyPrice ?? 0) * i.quantity,
      0,
    );

    // Estimated budget for current reorder needs (reorder-level based).
    const projectedPurchaseBudget = products.reduce((s, p) => {
      const onHand = p.inventory.reduce((x, i) => x + i.quantity, 0);
      if (onHand >= p.reorderLevel) return s;
      const suggestedQty = Math.max(
        1,
        p.reorderQty ?? Math.max(1, p.reorderLevel - onHand),
      );
      return s + suggestedQty * (p.currentBuyPrice ?? 0);
    }, 0);

    // Outstanding receivables + age buckets (for collections forecasting).
    const totalCreditIssued = creditSales.reduce((s, cs) => s + cs.totalAmount, 0);
    const totalPaid = creditPayments.reduce((s, p) => s + p.amount, 0);
    const outstanding = Math.max(0, totalCreditIssued - totalPaid);
    const ageMap = new Map<string, { amount: number; count: number }>();
    const now = Date.now();
    for (const cs of creditSales) {
      const ageDays = Math.floor((now - cs.createdAt.getTime()) / DAY_MS);
      const bucket =
        ageDays < 30 ? '0-30d' : ageDays < 60 ? '31-60d' : ageDays < 90 ? '61-90d' : '90d+';
      const row = ageMap.get(bucket) ?? { amount: 0, count: 0 };
      row.amount += cs.totalAmount;
      row.count += 1;
      ageMap.set(bucket, row);
    }

    const avgDailySalesRevenue = round2(totalSales / days);
    const avgDailyOrderRevenue = round2(orderRevenue / days);
    const avgDailyExpenses = round2(totalExpenses / days);
    const avgDailyPurchaseOutflow = round2(totalPurchases / days);
    const avgDailyCogs = round2(totalCogs / days);
    const netDailyBurn =
      avgDailyExpenses +
      avgDailyPurchaseOutflow +
      avgDailyCogs -
      avgDailySalesRevenue -
      avgDailyOrderRevenue;

    return {
      tenantId,
      businessType: opts.businessType ?? null,
      currency: 'ETB',
      generatedAt: windowEnd.toISOString(),
      avgDailySalesRevenue,
      avgDailyOrderRevenue,
      avgDailyExpenses,
      avgDailyPurchaseOutflow,
      cashFloatBalance: round2(cashFloatBalance),
      outstandingReceivables: round2(outstanding),
      receivablesByAge: [...ageMap.entries()].map(([bucket, v]) => ({
        bucket,
        amount: round2(v.amount),
        count: v.count,
      })),
      projectedDaysOfCover:
        netDailyBurn > 0 ? Math.round(cashFloatBalance / netDailyBurn) : null,
      // --- Live finance engine feed ---
      avgDailyCogs,
      totalCogs: round2(totalCogs),
      grossProfit: round2(grossProfit),
      grossMargin: round2(grossMargin),
      overheadByCategory: [...overheadMap.entries()].map(([name, amount]) => ({
        name,
        amount: round2(amount),
      })),
      dailyRevenueSeries,
      stockValue: round2(stockValue),
      projectedPurchaseBudget: round2(projectedPurchaseBudget),
      netCashPosition: round2(
        cashFloatBalance + totalPaid - totalPurchases,
      ),
    };
  }

  /**
   * Per-product pricing inputs: margins, stock, velocity and velocity bucket.
   * Sorted by units sold, capped so the prompt stays compact.
   */
  async collectPricingMetrics(opts: {
    tenantId: number | null;
    days?: number;
  }): Promise<PricingInputItem[]> {
    const days = Math.min(90, Math.max(7, opts.days ?? 30));
    const tenantId = opts.tenantId ?? null;
    const tenantFilter = tenantId != null ? { tenantId } : {};
    const windowStart = new Date(Date.now() - days * DAY_MS);

    const [products, saleItems, priceHistory] = await Promise.all([
      this.prisma.product.findMany({
        where: tenantFilter,
        include: { category: true, inventory: true },
      }),
      this.prisma.saleItem.findMany({
        where: { sale: { ...tenantFilter, saleDate: { gte: windowStart } } },
        select: { productId: true, quantity: true, unitSellPrice: true },
      }),
      this.prisma.priceHistory.findMany({
        where: { ...tenantFilter, updatedAt: { gte: windowStart } },
        select: { productId: true, newBuyPrice: true, oldBuyPrice: true },
      }),
    ]);

    const salesByProduct = new Map<number, { units: number; revenue: number }>();
    for (const si of saleItems) {
      const row = salesByProduct.get(si.productId) ?? { units: 0, revenue: 0 };
      row.units += si.quantity;
      row.revenue += si.unitSellPrice * si.quantity;
      salesByProduct.set(si.productId, row);
    }

    // Purchase-cost trend per product: oldest → newest buy price in the
    // window, expressed as % change so the AI can protect eroding margins.
    const costTrendByProduct = new Map<number, number>();
    const firstByProduct = new Map<number, number>();
    for (const ph of priceHistory) {
      if (!firstByProduct.has(ph.productId)) firstByProduct.set(ph.productId, ph.oldBuyPrice);
      costTrendByProduct.set(ph.productId, ph.newBuyPrice);
    }
    const trendPct = (productId: number): number => {
      const first = firstByProduct.get(productId);
      const latest = costTrendByProduct.get(productId);
      if (first == null || latest == null || first <= 0) return 0;
      return round1(((latest - first) / first) * 100);
    };

    return products
      .map((p) => {
        const totalStock = p.inventory.reduce((s, i) => s + i.quantity, 0);
        const sold = salesByProduct.get(p.id) ?? { units: 0, revenue: 0 };
        const dailyVelocity = round2(sold.units / days);
        const daysRemaining =
          dailyVelocity > 0 ? Math.round(totalStock / dailyVelocity) : null;
        const marginPct =
          p.currentSellPrice > 0
            ? round1(((p.currentSellPrice - p.currentBuyPrice) / p.currentSellPrice) * 100)
            : 0;
        let velocityBucket: PricingInputItem['velocityBucket'] = 'NORMAL';
        if (sold.units === 0) velocityBucket = 'DEAD';
        else if (dailyVelocity > 2) velocityBucket = 'FAST';
        else if (dailyVelocity < 0.5) velocityBucket = 'SLOW';

        return {
          productId: p.id,
          name: `${p.brand} ${p.baseName}`,
          category: p.category?.name ?? 'Uncategorized',
          currentBuyPrice: p.currentBuyPrice,
          currentSellPrice: p.currentSellPrice,
          marginPct,
          buyPriceTrendPct: trendPct(p.id),
          totalStock,
          unitsSold: sold.units,
          dailyVelocity,
          daysOfInventoryRemaining: daysRemaining,
          velocityBucket,
        } satisfies PricingInputItem;
      })
      .sort((a, b) => b.unitsSold - a.unitsSold)
      .slice(0, 40);
  }

  /**
   * Per-customer buying-pattern snapshot for churn risk: last activity,
   * 90-day activity count, average spend and outstanding credit. Buckets
   * customers into ACTIVE (<30d), AT_RISK (30-60d) and CHURNED (>60d).
   */
  async collectChurnMetrics(opts: {
    tenantId: number | null;
    days?: number;
  }): Promise<ChurnInputCustomer[]> {
    const days = Math.min(90, Math.max(7, opts.days ?? 90));
    const tenantId = opts.tenantId ?? null;
    const tenantFilter = tenantId != null ? { organizationId: tenantId } : {};
    const windowStart = new Date(Date.now() - days * DAY_MS);

    const customers = await this.prisma.customer.findMany({
      where: tenantFilter,
      include: {
        creditSales: { select: { totalAmount: true, createdAt: true } },
        creditPayments: { select: { amount: true } },
        serviceBookings: { select: { startsAt: true } },
        serviceTickets: { select: { totalAmount: true, createdAt: true } },
      },
    });
    const customerIds = customers.map((c) => c.id);
    const recentSales =
      customerIds.length > 0
        ? await this.prisma.sale.findMany({
            where: { customerId: { in: customerIds }, saleDate: { gte: windowStart } },
            select: { customerId: true, totalAmount: true, saleDate: true },
          })
        : [];

    const salesByCustomer = new Map<number, Array<{ at: number; amount: number }>>();
    for (const s of recentSales) {
      if (s.customerId == null) continue;
      const list = salesByCustomer.get(s.customerId) ?? [];
      list.push({ at: s.saleDate.getTime(), amount: s.totalAmount });
      salesByCustomer.set(s.customerId, list);
    }

    const now = Date.now();
    const items: ChurnInputCustomer[] = customers.map((c) => {
      const activities: Array<{ at: number; amount: number }> = [];
      for (const cs of c.creditSales)
        activities.push({ at: cs.createdAt.getTime(), amount: cs.totalAmount });
      for (const b of c.serviceBookings)
        activities.push({ at: b.startsAt.getTime(), amount: 0 });
      for (const t of c.serviceTickets)
        activities.push({ at: t.createdAt.getTime(), amount: t.totalAmount });
      for (const s of salesByCustomer.get(c.id) ?? []) activities.push(s);

      const paid = c.creditPayments.reduce((s, p) => s + p.amount, 0);
      const outstanding = c.creditSales.reduce((s, cs) => s + cs.totalAmount, 0) - paid;
      const inWindow = activities.filter((a) => a.at >= windowStart.getTime());
      const last = activities.length ? Math.max(...activities.map((a) => a.at)) : null;
      const daysSince =
        last != null ? Math.max(0, Math.floor((now - last) / DAY_MS)) : null;
      const avgSpend = inWindow.length
        ? inWindow.reduce((s, a) => s + a.amount, 0) / inWindow.length
        : 0;

      let bucket: ChurnInputCustomer['bucket'] = 'ACTIVE';
      if (daysSince == null || daysSince > 60) bucket = 'CHURNED';
      else if (daysSince > 30) bucket = 'AT_RISK';

      return {
        customerId: c.id,
        name: c.name,
        phone: c.phone,
        lastActivityAt: last != null ? new Date(last).toISOString() : null,
        daysSinceLastActivity: daysSince,
        activityCount90d: inWindow.length,
        avgSpend: round2(avgSpend),
        outstandingCredit: round2(Math.max(0, outstanding)),
        bucket,
      };
    });

    return items
      .sort(
        (a, b) =>
          (a.daysSinceLastActivity ?? 999) - (b.daysSinceLastActivity ?? 999),
      )
      .slice(0, 40);
  }

  /**
   * Items at or below their reorder threshold. Suggested quantity is derived
   * from the product's configured reorderQty or from lead-time demand
   * (velocity × lead time) topped up to the reorder level.
   */
  async collectReorderInput(opts: {
    tenantId: number | null;
    days?: number;
    leadTimeDays?: number;
  }): Promise<ReorderItem[]> {
    const days = Math.min(90, Math.max(7, opts.days ?? 30));
    const leadTime = Math.max(1, opts.leadTimeDays ?? 7);
    const tenantId = opts.tenantId ?? null;
    const tenantFilter = tenantId != null ? { tenantId } : {};
    const windowStart = new Date(Date.now() - days * DAY_MS);

    const [products, saleItems] = await Promise.all([
      this.prisma.product.findMany({
        where: { ...tenantFilter, inventory: { some: {} } },
        include: { category: true, inventory: true },
      }),
      this.prisma.saleItem.findMany({
        where: { sale: { ...tenantFilter, saleDate: { gte: windowStart } } },
        select: { productId: true, quantity: true },
      }),
    ]);

    const unitsByProduct = new Map<number, number>();
    for (const si of saleItems) {
      unitsByProduct.set(si.productId, (unitsByProduct.get(si.productId) ?? 0) + si.quantity);
    }

    const orderRank: Record<ReorderItem['urgency'], number> = {
      CRITICAL: 0,
      HIGH: 1,
      NORMAL: 2,
    };
    const items: ReorderItem[] = [];
    for (const p of products) {
      for (const inv of p.inventory) {
        if (inv.quantity >= p.reorderLevel) continue;
        const unitsSold = unitsByProduct.get(p.id) ?? 0;
        const dailyVelocity = unitsSold / days;
        const leadDemand = Math.ceil(dailyVelocity * leadTime);
        const suggestedQty = Math.max(
          1,
          p.reorderQty ?? Math.max(1, leadDemand + p.reorderLevel - inv.quantity),
        );
        const daysRemaining =
          dailyVelocity > 0 ? Math.round(inv.quantity / dailyVelocity) : null;
        let urgency: ReorderItem['urgency'] = 'NORMAL';
        if (inv.quantity === 0) urgency = 'CRITICAL';
        else if (daysRemaining != null && daysRemaining <= leadTime) urgency = 'HIGH';

        items.push({
          productId: p.id,
          name: `${p.brand} ${p.baseName}`,
          category: p.category?.name ?? 'Uncategorized',
          currentStock: inv.quantity,
          reorderLevel: p.reorderLevel,
          suggestedQty,
          unitPrice: p.currentBuyPrice,
          estimatedCost: round2(suggestedQty * p.currentBuyPrice),
          urgency,
          daysRemaining,
        });
      }
    }
    return items
      .sort(
        (a, b) =>
          orderRank[a.urgency] - orderRank[b.urgency] ||
          (a.daysRemaining ?? 0) - (b.daysRemaining ?? 0),
      )
      .slice(0, 30);
  }

  private async buildStaffMetrics(
    staffMap: Map<number, { orders: number; revenue: number; profit: number }>,
  ): Promise<StaffMetric[]> {
    const userIds = [...staffMap.keys()];
    if (userIds.length === 0) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return [...staffMap.entries()]
      .map(([userId, v]) => ({
        userId,
        userName: names.get(userId) ?? 'Staff',
        ordersCount: v.orders,
        revenue: round2(v.revenue),
        profit: round2(v.profit),
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 20);
  }

  /**
   * Hospitality POS revenue (Order/OrderItem). Guarded so that tenants / DBs
   * without the hospitality schema still produce a valid digest.
   */
  private async fetchOrderMetrics(
    tenantFilter: Record<string, unknown>,
    start: Date,
    end: Date,
  ): Promise<OrderMetrics | undefined> {
    try {
      const orders = await this.prisma.order.findMany({
        where: {
          ...tenantFilter,
          status: OrderStatus.PAID,
          createdAt: { gte: start, lte: end },
        },
        include: { items: true },
      });
      let totalRevenue = 0;
      const itemMap = new Map<string, { qty: number; revenue: number }>();
      for (const order of orders) {
        totalRevenue += order.totalAmount ?? 0;
        for (const item of order.items) {
          const e = itemMap.get(item.name) ?? { qty: 0, revenue: 0 };
          e.qty += item.quantity;
          e.revenue += item.unitPrice * item.quantity;
          itemMap.set(item.name, e);
        }
      }
      const spanDays = Math.max(1, (end.getTime() - start.getTime()) / DAY_MS);
      return {
        totalRevenue: round2(totalRevenue),
        avgPerDay: round2(totalRevenue / spanDays),
        topItems: [...itemMap.entries()]
          .map(([name, v]) => ({ name, qty: v.qty, revenue: round2(v.revenue) }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 10),
      };
    } catch (err) {
      this.logger.warn(
        `Order metrics unavailable for this tenant: ${(err as Error).message}`,
      );
      return undefined;
    }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

