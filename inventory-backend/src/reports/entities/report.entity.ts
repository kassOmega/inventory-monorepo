// ---------------------------------------------------------------------------
// Report response DTO / entity types
// ---------------------------------------------------------------------------

export interface InventoryVariantRow {
  id: number | null;
  sku: string | null;
  attributes: Record<string, any>;
  quantity: number;
  locations: Record<string, number>;
  /** Unit catalog sell price — always returned. */
  unitSellPrice?: number;
  /** Cost fields below are only returned when the caller holds
   *  reports.view_cost_valuation (they expose buying costs & margins). */
  unitBuyPrice?: number;
  buyTotal?: number;
  sellTotal?: number;
  estimatedProfit?: number;
}

export interface InventoryBreakdownRow {
  productId: number;
  sku: string;
  productName: string;
  category: string;
  total: number;
  locations: Record<string, number>;
  /** Per-variant × per-location breakdown for expandable report rows. */
  variants: InventoryVariantRow[];
  /** Unit catalog sell price — always returned. */
  unitSellPrice?: number;
  /** Cost fields below are only returned when the caller holds
   *  reports.view_cost_valuation. */
  unitBuyPrice?: number;
  buyTotal?: number;
  sellTotal?: number;
  estimatedProfit?: number;
}

export interface InventoryBreakdownResponse {
  columns: string[];
  rows: InventoryBreakdownRow[];
  /** Grand totals over all filtered items/locations. Only present for callers
   *  holding reports.view_cost_valuation. */
  valuation?: {
    grandTotalBuyingValue: number;
    grandTotalSellingValue: number;
    potentialGrossProfit: number;
    potentialMarginPct: number;
  };
}

export interface SalesSummaryResponse {
  totalRevenue: number;
  totalCost: number;
  totalTax: number;
  totalProfit: number; // after tax: revenue - tax - cost
  returns?: { refund: number; cost: number; tax: number };
  margin: string;
  topProducts: TopProduct[];
  breakdown: {
    fullyPaid: { revenue: number; cost: number; tax: number; profit: number; collected: number; outstanding: number };
    partiallyPaid: { revenue: number; cost: number; tax: number; profit: number; collected: number; outstanding: number };
    credited: { revenue: number; cost: number; tax: number; profit: number; collected: number; outstanding: number };
  };
}

export interface SalesTrendPoint {
  date: string;
  sales: number;
  flips: number;
  collections: number;
}

export interface TopProduct {
  name: string;
  qty: number;
}

export interface ReportVariantDetail {
  /** -1 represents the plain/standard unit of a non-variant product. */
  variantId: number | null;
  sku: string | null;
  attributes: Record<string, any>;
  quantity: number;
  /** Names of the locations where this unit currently meets the filter. */
  locations?: string[];
}

export interface LowStockProduct {
  id: number;
  name: string;
  total: number;
  locationName?: string | null;
  requestedStatus?: string | null;
  /** One entry per variant that is below threshold (plain products get one). */
  variants: ReportVariantDetail[];
}

export interface DeadStockProduct {
  id: number;
  name: string;
  locationId: number | null;
  locationName: string;
  /** Variant rows stocked at this location with no recent sale. */
  variants: ReportVariantDetail[];
}

export interface AuditLogResponse {
  id: number;
  userId: number;
  action: string;
  details: string;
  createdAt: Date;
  user: {
    id: number;
    email: string;
    name: string;
  };
}

export interface PaymentMethodBreakdown {
  method: string;
  count: number;
  totalAmount: number;
}
