export interface ProductUnitInfo {
  unitId: number;
  perBase: number;
  isBase?: boolean | null;
  isHistorical?: boolean | null;
  isDefaultSale?: boolean | null;
  buyPrice?: number | null;
  sellPrice?: number | null;
  unit?: { id?: number; name?: string | null; symbol?: string | null } | null;
  name?: string | null;
}

export function unitsLargestFirst(units: ProductUnitInfo[]): ProductUnitInfo[] {
  return [...units].sort((a, b) => Number(a.perBase) - Number(b.perBase));
}

export function maxPerBase(units: ProductUnitInfo[] | null | undefined): number {
  return Math.max(1, ...(units ?? []).map((u) => Number(u.perBase) || 1));
}

export function stockPerUnit(
  unit: ProductUnitInfo | null | undefined,
  units: ProductUnitInfo[] | null | undefined,
): number {
  if (!unit) return 1;
  return maxPerBase(units) / (Number(unit.perBase) || 1);
}

export function defaultSaleUnit(
  product: { units?: ProductUnitInfo[] | null; unitId?: number | null } | null | undefined,
): ProductUnitInfo | null {
  const units = product?.units ?? [];
  if (units.length === 0) return null;
  return (
    units.find((u) => u.isDefaultSale) ??
    units.find((u) => u.isBase) ??
    units[0] ??
    null
  );
}

export function toStockQuantity(
  quantity: number,
  unit: ProductUnitInfo | null | undefined,
  units: ProductUnitInfo[] | null | undefined,
): number {
  const qty = Number(quantity) || 0;
  if (!unit || !units?.length) return qty;
  return qty * stockPerUnit(unit, units);
}

export function toStockFromCounts(
  counts: Record<string, string | number>,
  units: ProductUnitInfo[] | null | undefined,
): number {
  const list = units ?? [];
  return list.reduce((sum, unit) => {
    const count = Number(counts[String(unit.unitId)] || 0);
    if (!Number.isFinite(count) || count <= 0) return sum;
    return sum + count * stockPerUnit(unit, list);
  }, 0);
}

export function fromStockQuantity(
  stockQty: number,
  unit: ProductUnitInfo | null | undefined,
  units: ProductUnitInfo[] | null | undefined,
): number {
  const qty = Number(stockQty) || 0;
  const perUnit = stockPerUnit(unit, units);
  return perUnit > 0 ? qty / perUnit : 0;
}

export function baseToStockQuantity(
  baseQty: number,
  units: ProductUnitInfo[] | null | undefined,
): number {
  return (Number(baseQty) || 0) * maxPerBase(units);
}

/** Legacy compatibility: per-unit counts → base units. */

export function unitSellPrice(
  product: { currentSellPrice?: number | null; units?: ProductUnitInfo[] | null },
  unit: ProductUnitInfo | null | undefined,
): number {
  if (!unit) return Number(product.currentSellPrice) || 0;
  if (unit.sellPrice != null) return Number(unit.sellPrice);
  const perBase = Number(unit.perBase) || 1;
  return (Number(product.currentSellPrice) || 0) / perBase;
}

/** Price per selected unit for a variant (variant prices are per base unit). */

export function pricePerUnitFromBase(
  basePrice: number,
  unit: { perBase?: number | string | null } | null | undefined,
): number {
  return (Number(basePrice) || 0) / (Number(unit?.perBase) || 1);
}

export function stockPriceFromBase(
  basePrice: number,
  units: ProductUnitInfo[] | null | undefined,
): number {
  return (Number(basePrice) || 0) / maxPerBase(units);
}

export function convertStockQuantityBetweenLadders(
  stockQty: number,
  oldUnits: ProductUnitInfo[],
  newUnits: ProductUnitInfo[],
  oldStockUnitId?: number | null,
): number | null {
  if (!oldUnits.length || !newUnits.length) return Number(stockQty) || 0;
  const oldMax = maxPerBase(oldUnits);
  const newMax = maxPerBase(newUnits);
  const oldStock =
    oldUnits.find((u) => Number(u.unitId) === Number(oldStockUnitId)) ??
    oldUnits.find((u) => Number(u.perBase) === oldMax) ??
    oldUnits[0];
  const oldStockInNew = newUnits.find(
    (u) => Number(u.unitId) === Number(oldStock.unitId),
  );
  if (oldStockInNew) {
    return (Number(stockQty) || 0) * (newMax / (Number(oldStockInNew.perBase) || 1));
  }
  for (const next of newUnits) {
    const previous = oldUnits.find(
      (u) => Number(u.unitId) === Number(next.unitId),
    );
    if (!previous) continue;
    const factor =
      ((Number(previous.perBase) || 1) * newMax) /
      (oldMax * (Number(next.perBase) || 1));
    return (Number(stockQty) || 0) * factor;
  }
  return null;
}
