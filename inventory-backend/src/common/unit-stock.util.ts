export interface StockUnitLike {
  unitId?: number;
  perBase: number;
}

export function maxPerBase(units: StockUnitLike[] | null | undefined): number {
  return Math.max(1, ...(units ?? []).map((u) => Number(u.perBase) || 1));
}

export function stockPerUnit(perBase: number, maxPerBaseValue: number): number {
  return maxPerBaseValue / perBase;
}

export function toStockQuantity(
  quantity: number,
  unitPerBase: number | null | undefined,
  units: StockUnitLike[] | null | undefined,
): number {
  const qty = Number(quantity) || 0;
  if (!unitPerBase) return qty;
  return qty * stockPerUnit(Number(unitPerBase), maxPerBase(units));
}

export function toStockFromUnitCounts(
  counts: Record<string, string | number>,
  units: StockUnitLike[] | null | undefined,
): number {
  const list = units ?? [];
  return list.reduce((sum, unit) => {
    const count = Number(counts[String(unit.unitId)] || 0);
    if (!Number.isFinite(count) || count <= 0) return sum;
    return (
      sum +
      count * stockPerUnit(Number(unit.perBase) || 1, maxPerBase(list))
    );
  }, 0);
}

export function fromStockQuantity(
  stockQty: number,
  unitPerBase: number | null | undefined,
  units: StockUnitLike[] | null | undefined,
): number {
  const perUnit = stockPerUnit(
    Number(unitPerBase) || 1,
    maxPerBase(units),
  );
  return perUnit > 0 ? (Number(stockQty) || 0) / perUnit : 0;
}

export function baseToStockQuantity(
  baseQty: number,
  units: StockUnitLike[] | null | undefined,
): number {
  return (Number(baseQty) || 0) * maxPerBase(units);
}


export function pricePerUnitFromBase(
  basePrice: number,
  unitPerBase: number | null | undefined,
): number {
  return (Number(basePrice) || 0) / (Number(unitPerBase) || 1);
}

export function stockPriceFromBase(
  basePrice: number,
  units: StockUnitLike[] | null | undefined,
): number {
  return (Number(basePrice) || 0) / maxPerBase(units);
}

export function stockPriceFromUnit(
  unitPrice: number,
  perBase: number,
  maxPerBaseValue: number,
): number {
  return unitPrice / stockPerUnit(perBase, maxPerBaseValue);
}

export function isWholeStockQuantity(value: number): boolean {
  return Math.abs(Number(value) - Math.round(Number(value))) < 1e-6;
}

export function splitStockQuantity<T extends StockUnitLike>(
  stockQty: number,
  units: T[] | null | undefined,
): { unit: T; quantity: number }[] {
  const list = [...(units ?? [])].sort(
    (a, b) => Number(a.perBase) - Number(b.perBase),
  );
  const max = maxPerBase(list);
  let remaining = Math.round(Number(stockQty) || 0);
  const out: { unit: T; quantity: number }[] = [];
  for (const unit of list) {
    const perUnit = stockPerUnit(Number(unit.perBase) || 1, max);
    const quantity = Math.floor(remaining / perUnit);
    if (quantity <= 0) continue;
    out.push({ unit, quantity });
    remaining -= quantity * perUnit;
  }
  return out;
}

export function convertStockQuantityBetweenLadders(
  stockQty: number,
  oldUnits: StockUnitLike[],
  newUnits: StockUnitLike[],
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
    return (
      (Number(stockQty) || 0) *
      (newMax / (Number(oldStockInNew.perBase) || 1))
    );
  }
  for (const next of newUnits) {
    const previous = oldUnits.find(
      (u) => Number(u.unitId) === Number(next.unitId),
    );
    if (!previous) continue;
    return (
      (Number(stockQty) || 0) *
      (((Number(previous.perBase) || 1) * newMax) /
        (oldMax * (Number(next.perBase) || 1)))
    );
  }
  return null;
}
