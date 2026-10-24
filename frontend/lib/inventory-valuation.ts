// UI formatting for the backend inventory valuation. The calculation itself
// lives in inventory-backend/src/common/inventory-valuation.util.ts so the
// product modal and reports use exactly the same per-variant/per-unit math.
import { fmtCurrency } from "./currency";

export interface UnitValuationLine {
  unitId: number;
  name: string;
  perBase: number;
  count: number;
  buyPrice: number;
  sellPrice: number;
  buyTotal: number;
  sellTotal: number;
}

export interface ProductValuationRow {
  variantId: number | null;
  variant: any;
  quantity: number;
  quantityText: string;
  unitLines: UnitValuationLine[];
  buyTotal: number;
  sellTotal: number;
  profit: number;
}

export interface ProductValuation {
  rows: ProductValuationRow[];
  totals: { buyTotal: number; sellTotal: number; profit: number };
}

/** "Roll ETB 1,200.00, Meter ETB 12.00" — per-unit prices in ladder order. */
export function formatUnitPriceLines(
  lines: UnitValuationLine[] | null | undefined,
  side: "buyPrice" | "sellPrice",
  fallback = "",
): string {
  if (!lines || lines.length === 0) return fallback;
  return lines
    .map((line) => `${line.name} ${fmtCurrency(line[side])}`)
    .join(", ");
}
