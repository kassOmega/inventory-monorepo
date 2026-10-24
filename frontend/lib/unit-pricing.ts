// Shared frontend unit-price resolver for display components. Mirrors the
// backend valuation/sale priority:
//   variant per-unit override -> product unit override -> base ÷ perBase.
// The backend helper remains the source of truth for valuation totals.
import {
  pricePerUnitFromBase,
  type ProductUnitInfo,
} from "./unit-stock";

export type UnitPriceSide = "buyPrice" | "sellPrice";

export interface VariantUnitPriceOverrides {
  [unitId: string]:
    | { buyPrice?: number | null; sellPrice?: number | null }
    | undefined;
}

export function resolveUnitSellPrice(
  baseSellPrice: number | null | undefined,
  unit: ProductUnitInfo,
  variantUnitPrices?: VariantUnitPriceOverrides | null,
): number {
  const variantOverride =
    variantUnitPrices?.[String(unit.unitId)]?.sellPrice;
  if (variantOverride !== null && variantOverride !== undefined) {
    return Number(variantOverride);
  }
  if (unit.sellPrice !== null && unit.sellPrice !== undefined) {
    return Number(unit.sellPrice);
  }
  return pricePerUnitFromBase(Number(baseSellPrice) || 0, unit);
}

export function resolveUnitBuyPrice(
  baseBuyPrice: number | null | undefined,
  unit: ProductUnitInfo,
  variantUnitPrices?: VariantUnitPriceOverrides | null,
): number | null {
  const variantOverride =
    variantUnitPrices?.[String(unit.unitId)]?.buyPrice;
  if (variantOverride !== null && variantOverride !== undefined) {
    return Number(variantOverride);
  }
  if (unit.buyPrice !== null && unit.buyPrice !== undefined) {
    return Number(unit.buyPrice);
  }
  if (baseBuyPrice === null || baseBuyPrice === undefined) return null;
  return pricePerUnitFromBase(Number(baseBuyPrice) || 0, unit);
}
