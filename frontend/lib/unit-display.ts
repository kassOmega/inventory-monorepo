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
  const list = units ?? [];
  if (list.length === 0) return {};
  const max = maxPerBase(list);
  const ordered = unitsLargestFirst(list);
  let remaining = Math.abs(Number(stockQty) || 0);
  const out: Record<string, number> = {};
  for (let i = 0; i < ordered.length; i++) {
    const unit = ordered[i];
    const factor = max / (Number(unit.perBase) || 1);
    if (!Number.isFinite(factor) || factor <= 0) continue;
    const raw = remaining / factor;
    const isSmallest = i === ordered.length - 1;
    // Keep the fractional remainder in the smallest unit instead of rounding
    // it away (e.g. 0.5 Meter).
    const count = isSmallest
      ? Math.round(raw * 1e6) / 1e6
      : Math.floor(raw + 1e-9);
    out[String(unit.unitId)] = count;
    remaining -= count * factor;
  }
  return out;
}

function formatCount(n: number): string {
  const rounded = Math.round((Number(n) || 0) * 1e6) / 1e6;
  return Number.isInteger(rounded)
    ? String(rounded)
    : String(rounded).replace(/\.?0+$/, "");
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
    .map(
      (unit) =>
        `${formatCount(counts[String(unit.unitId)])} ${unitName(unit)}`,
    );
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
