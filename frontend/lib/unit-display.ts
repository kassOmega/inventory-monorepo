import {
  baseToStockQuantity,
  maxPerBase,
  unitsLargestFirst,
  type ProductUnitInfo,
} from "./unit-stock";

export function unitName(unit: ProductUnitInfo | null | undefined): string {
  return unit?.unit?.name ?? unit?.name ?? "";
}

export function stockBreakdownCounts(
  stockQty: number,
  units: ProductUnitInfo[] | null | undefined,
): Record<string, number> {
  const qty = Math.round(Number(stockQty) || 0);
  const list = units ?? [];
  if (list.length === 0) return {};
  const max = maxPerBase(list);
  const ordered = unitsLargestFirst(list);
  let remaining = Math.abs(qty);
  const out: Record<string, number> = {};
  for (const unit of ordered) {
    const factor = max / (Number(unit.perBase) || 1);
    if (!Number.isFinite(factor) || factor <= 0) continue;
    const count = Math.floor(remaining / factor);
    out[String(unit.unitId)] = count;
    remaining -= count * factor;
  }
  return out;
}

export function formatStockQuantity(
  stockQty: number,
  units: ProductUnitInfo[] | null | undefined,
): string {
  const qty = Number(stockQty) || 0;
  const list = units ?? [];
  if (list.length === 0) return String(qty);
  if (qty === 0) {
    const base = list.find((u) => u.isBase) ?? unitsLargestFirst(list)[0];
    return `0 ${unitName(base)}`;
  }

  const ordered = unitsLargestFirst(list);
  const counts = stockBreakdownCounts(qty, list);
  const parts = ordered
    .filter((unit) => (counts[String(unit.unitId)] ?? 0) > 0)
    .map((unit) => `${counts[String(unit.unitId)]} ${unitName(unit)}`);
  if (parts.length === 0) {
    const smallest = ordered[ordered.length - 1];
    return `0 ${unitName(smallest)}`;
  }
  return (qty < 0 ? "-" : "") + parts.join(" ");
}

export function formatBaseQuantity(
  baseQty: number,
  units: ProductUnitInfo[] | null | undefined,
): string {
  const list = units ?? [];
  if (list.length === 0) return String(Number(baseQty) || 0);
  return formatStockQuantity(baseToStockQuantity(baseQty, list), list);
}

export function formatSaleLineQuantity(
  item: {
    quantity?: number | string | null;
    stockQuantity?: number | string | null;
    product?: any;
    unit?: { name?: string | null } | null;
  },
  product?: any,
): string {
  const qty = Number(item?.stockQuantity ?? item?.quantity ?? 0) || 0;
  const p = product ?? item?.product;
  const units = (p?.units ?? []) as ProductUnitInfo[];
  if (units.length > 0) return formatStockQuantity(qty, units);
  const name = item?.unit?.name ?? p?.unit?.name ?? "";
  return `${qty}${name ? ` ${name}` : ""}`;
}
