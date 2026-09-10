// src/ai/entities/ai.entity.ts
// Shared response types for the AI Business Advisor module.

export type TargetPeriod = 'NEXT_7_DAYS' | 'NEXT_30_DAYS' | 'NEXT_QUARTER';

export interface GrowthCategory {
  category: string;
  growthPercent: number;
  reasoning: string;
}

export interface RevenueProjection {
  projectedRevenue: number;
  projectedUnits: number;
  topGrowthCategories: GrowthCategory[];
}

export interface StockOutWarning {
  product: string;
  currentStock: number;
  dailyVelocity: number;
  daysRemaining: number;
  recommendedReorderQty: number;
  recommendedReorderDate: string;
}

export interface DeadStockPlanItem {
  product: string;
  quantityInStock: number;
  suggestedDiscountPct: number;
  strategy: string;
}

export interface StaffingAdjustment {
  day: string;
  shift: string;
  recommendedStaff: number;
  reasoning: string;
}

export interface ForecastReport {
  revenueProjection: RevenueProjection;
  stockOutWarnings: StockOutWarning[];
  deadStockPlan: DeadStockPlanItem[];
  staffingAdjustments: StaffingAdjustment[];
}

// ---------------------------------------------------------------------------
// Metrics digest shapes (injected into Gemini prompts)
// ---------------------------------------------------------------------------

export interface ProductVelocity {
  productId: number;
  name: string;
  category: string;
  currentStock: number;
  dailyVelocity: number;
  daysOfInventoryRemaining: number | null;
  revenue: number;
  unitsSold: number;
}

export interface StaffMetric {
  userId: number;
  userName: string;
  ordersCount: number;
  revenue: number;
  profit: number;
}

export interface LowStockItem {
  productId: number;
  name: string;
  currentStock: number;
  dailyVelocity: number;
  daysRemaining: number;
  locations: string[];
}

export interface DeadStockItem {
  productId: number;
  name: string;
  currentStock: number;
  locations: string[];
}

export interface CategoryTrend {
  category: string;
  unitsSold: number;
  revenue: number;
  previousUnits: number;
  growthPct: number;
}

export interface OrderMetrics {
  totalRevenue: number;
  avgPerDay: number;
  topItems: { name: string; qty: number; revenue: number }[];
}

export interface BusinessMetricsDigest {
  tenantId: number | null;
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  businessType: string | null;
  totalRevenue: number;
  totalUnitsSold: number;
  avgDailyRevenue: number;
  topProducts: ProductVelocity[];
  categoryTrends: CategoryTrend[];
  lowStockItems: LowStockItem[];
  deadStockItems: DeadStockItem[];
  staff: StaffMetric[];
  peakSalesHours: { hour: number; orders: number }[];
  orderMetrics?: OrderMetrics;
}

// ---------------------------------------------------------------------------
// Cash flow forecast inputs & report
// ---------------------------------------------------------------------------

export interface FinanceSnapshot {
  tenantId: number | null;
  businessType: string | null;
  currency: string;
  generatedAt: string;
  avgDailySalesRevenue: number;
  avgDailyOrderRevenue: number;
  avgDailyExpenses: number; // recurring expenses (Expense rows)
  avgDailyPurchaseOutflow: number; // purchases paid/expected within the window
  cashFloatBalance: number; // money currently in the till(s)
  outstandingReceivables: number; // total unpaid credit-sales balances
  receivablesByAge: { bucket: string; amount: number; count: number }[];
  projectedDaysOfCover: number | null; // cash float / net daily burn (null if burn <= 0)
  // --- Live finance engine feed (COGS / margins / overhead / velocity) ---
  avgDailyCogs: number; // average daily Cost of Goods Sold
  totalCogs: number; // COGS across the whole window
  grossProfit: number; // revenue - COGS
  grossMargin: number; // % (revenue - COGS) / revenue
  overheadByCategory: { name: string; amount: number }[]; // Rent, Salaries, Utilities...
  dailyRevenueSeries: { date: string; revenue: number }[]; // sales velocity per day
  stockValue: number; // Σ inventory.qty × product.currentBuyPrice
  projectedPurchaseBudget: number; // estimated cost of current reorder needs
  netCashPosition: number; // cash float + confirmed collections − outstanding AP
}

export interface CashFlowBucket {
  period: string; // "NEXT_30_DAYS" | "NEXT_60_DAYS" | "NEXT_90_DAYS"
  openingBalance: number;
  inflows: number; // expected sales collections + credit collections + other income
  outflows: number; // expenses + purchases + wages + other payables
  netCashFlow: number;
  closingBalance: number;
}

export interface LiquidityRisk {
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  month: string; // month label the risk applies to
  description: string;
  recommendedAction: string;
}

export interface CashFlowForecastReport {
  summary: string;
  buckets: CashFlowBucket[];
  liquidityRisks: LiquidityRisk[];
  keyActions: string[];
}

// ---------------------------------------------------------------------------
// Dynamic pricing inputs & report
// ---------------------------------------------------------------------------

export interface PricingInputItem {
  productId: number;
  name: string;
  category: string;
  currentBuyPrice: number;
  currentSellPrice: number;
  marginPct: number;
  /** % change in purchase cost over the window (negative = cheaper). */
  buyPriceTrendPct: number;
  totalStock: number;
  unitsSold: number; // in the window
  dailyVelocity: number;
  daysOfInventoryRemaining: number | null;
  velocityBucket: 'FAST' | 'NORMAL' | 'SLOW' | 'DEAD';
}

export interface PricingRecommendation {
  productId: number;
  product: string;
  direction: 'RAISE' | 'HOLD' | 'DISCOUNT';
  currentSellPrice: number;
  suggestedSellPrice: number;
  suggestedDiscountPct: number | null;
  reason: string;
  expectedImpact: string;
}

export interface PricingReport {
  summary: string;
  recommendations: PricingRecommendation[];
  marginStrategy: string[];
}

// ---------------------------------------------------------------------------
// Customer churn inputs & report
// ---------------------------------------------------------------------------

export interface ChurnInputCustomer {
  customerId: number;
  name: string;
  phone: string | null;
  lastActivityAt: string | null;
  daysSinceLastActivity: number | null;
  activityCount90d: number;
  avgSpend: number;
  outstandingCredit: number;
  bucket: 'ACTIVE' | 'AT_RISK' | 'CHURNED';
}

export interface ChurnRiskItem {
  customerId: number;
  name: string;
  risk: 'HIGH' | 'MEDIUM' | 'LOW';
  daysInactive: number;
  outstandingCredit: number;
  suggestedWinBackOffer: string;
  expectedRecoveryValue: number;
}

export interface ChurnReport {
  summary: string;
  atRisk: ChurnRiskItem[];
  retentionStrategy: string[];
}

// ---------------------------------------------------------------------------
// Purchase order draft inputs & report
// ---------------------------------------------------------------------------

export interface ReorderItem {
  productId: number;
  name: string;
  category: string;
  currentStock: number;
  reorderLevel: number;
  suggestedQty: number;
  unitPrice: number; // current buy price
  estimatedCost: number;
  urgency: 'CRITICAL' | 'HIGH' | 'NORMAL';
  daysRemaining: number | null;
}

export interface PoDraftLine {
  productId: number;
  product: string;
  currentStock: number;
  suggestedQty: number;
  unitPrice: number;
  estimatedCost: number;
  urgency: 'CRITICAL' | 'HIGH' | 'NORMAL';
}

export interface PoDraftReport {
  supplier: string | null;
  notes: string;
  items: PoDraftLine[];
  estimatedTotal: number;
}
