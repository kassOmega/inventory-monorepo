/** ProductUnit row shape used for valuation (prices are per unit). */
export interface ValuationUnit {
  unitId: number;
  perBase: number;
  isBase?: boolean | null;
  isDefaultSale?: boolean | null;
  buyPrice?: number | null;
  sellPrice?: number | null;
  unit?: { name?: string | null; symbol?: string | null } | null;
}

export interface ValuationVariant {
  id?: number | null;
  sku?: string | null;
  buyPrice?: number | null;
  sellPrice?: number | null;
  unitPrices?: Record<
    string,
    { buyPrice?: number | null; sellPrice?: number | null } | undefined
  > | null;
}

export interface ValuationProduct {
  currentBuyPrice?: number | null;
  currentSellPrice?: number | null;
  unit?: { name?: string | null; symbol?: string | null } | null;
  units?: ValuationUnit[] | null;
  variants?: ValuationVariant[] | null;
}

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

export interface QuantityValuation {
  quantity: number;
  quantityText: string;
  unitLines: UnitValuationLine[];
  buyTotal: number;
  sellTotal: number;
  profit: number;
}

export interface ProductValuationRow extends QuantityValuation {
  variantId: number | null;
  variant: ValuationVariant | null;
}

export interface ProductValuation {
  rows: ProductValuationRow[];
  totals: { buyTotal: number; sellTotal: number; profit: number };
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const roundTo = (n: number, digits: number) => {
  const factor = 10 ** digits;
  return Math.round((Number(n) || 0) * factor) / factor;
};
const formatCount = (n: number) => {
  const rounded = roundTo(n, 6);
  return Number.isInteger(rounded)
    ? String(rounded)
    : String(rounded).replace(/\.?0+$/, '');
};

/**
 * Price for one unit.
 *
 * Priority (mirrors SalesService):
 *   variant per-unit override -> product unit override ->
 *   variant base price ÷ perBase -> product base price ÷ perBase.
 *
 * Per-unit overrides are already per unit, so they are used directly.
 */
function resolveUnitPrice(
  product: ValuationProduct,
  variant: ValuationVariant | null | undefined,
  unit: ValuationUnit,
  side: 'buyPrice' | 'sellPrice',
): number {
  const perBase = Number(unit.perBase) || 1;
  const variantOverride =
    variant?.unitPrices?.[String(unit.unitId)]?.[side];
  if (variantOverride !== null && variantOverride !== undefined) {
    return Number(variantOverride);
  }
  const unitOverride = unit[side];
  if (unitOverride !== null && unitOverride !== undefined) {
    return Number(unitOverride);
  }
  const variantBase = variant?.[side];
  if (variantBase !== null && variantBase !== undefined && Number(variantBase) > 0) {
    return Number(variantBase) / perBase;
  }
  const productBase =
    side === 'buyPrice' ? product.currentBuyPrice : product.currentSellPrice;
  return (Number(productBase) || 0) / perBase;
}

function unitName(
  unit: ValuationUnit | null | undefined,
  fallback = '',
): string {
  return unit?.unit?.name ?? fallback;
}

/**
 * Value one quantity (stock units) for one product/variant.
 *
 * The quantity is broken into the product's unit ladder, and every unit's
 * count is multiplied by that unit's own price. This is the calculation that
 * turns `29637` stock units into `296 Roll 37 Meter` and values each part.
 */
export function valueVariantQuantity(
  product: ValuationProduct,
  variant: ValuationVariant | null | undefined,
  quantity: number,
): QuantityValuation {
  const units = product.units ?? [];
  const qty = Number(quantity) || 0;

  const sign = qty < 0 ? -1 : 1;
  const absQty = Math.abs(qty);

  // Legacy products without a ProductUnit ladder: one price, one line.
  if (units.length === 0) {
    const buyPrice = round2(resolveUnitPrice(product, variant, {
      unitId: 0,
      perBase: 1,
      unit: product.unit ?? null,
    }, 'buyPrice'));
    const sellPrice = round2(resolveUnitPrice(product, variant, {
      unitId: 0,
      perBase: 1,
      unit: product.unit ?? null,
    }, 'sellPrice'));
    const buyTotal = round2(sign * absQty * buyPrice);
    const sellTotal = round2(sign * absQty * sellPrice);
    const name = product.unit?.name ?? '';
    return {
      quantity: qty,
      quantityText: `${sign < 0 ? '-' : ''}${formatCount(absQty)}${name ? ` ${name}` : ''}`,
      unitLines: [
        {
          unitId: 0,
          name,
          perBase: 1,
          count: absQty,
          buyPrice,
          sellPrice,
          buyTotal,
          sellTotal,
        },
      ],
      buyTotal,
      sellTotal,
      profit: round2(sellTotal - buyTotal),
    };
  }

  const ordered = [...units].sort(
    (a, b) => (Number(a.perBase) || 1) - (Number(b.perBase) || 1),
  );
  const max = Math.max(1, ...ordered.map((unit) => Number(unit.perBase) || 1));
  const countByUnit = new Map<number, number>();
  let remaining = absQty;
  for (let i = 0; i < ordered.length; i++) {
    const unit = ordered[i];
    const perUnit = max / (Number(unit.perBase) || 1);
    const isSmallest = i === ordered.length - 1;
    const rawCount = perUnit > 0 ? remaining / perUnit : 0;
    // Keep the smallest unit fractional so 0.5 Meter is not rounded away.
    const count = isSmallest
      ? roundTo(rawCount, 6)
      : Math.floor(rawCount + 1e-9);
    countByUnit.set(Number(unit.unitId), count);
    remaining -= count * perUnit;
  }

  // Include every configured unit in the price line so the UI can show
  // "Roll 1,200, Meter 12" even when one count is zero.
  const unitLines: UnitValuationLine[] = ordered.map((unit) => {
    const unitId = Number(unit.unitId);
    const count = countByUnit.get(unitId) ?? 0;
    const buyPrice = round2(
      resolveUnitPrice(product, variant, unit, 'buyPrice'),
    );
    const sellPrice = round2(
      resolveUnitPrice(product, variant, unit, 'sellPrice'),
    );
    return {
      unitId,
      name: unitName(unit),
      perBase: Number(unit.perBase) || 1,
      count,
      buyPrice,
      sellPrice,
      buyTotal: round2(sign * count * buyPrice),
      sellTotal: round2(sign * count * sellPrice),
    };
  });

  const buyTotal = round2(
    unitLines.reduce((sum, line) => sum + line.buyTotal, 0),
  );
  const sellTotal = round2(
    unitLines.reduce((sum, line) => sum + line.sellTotal, 0),
  );

  const parts = ordered
    .map((unit) => ({
      unit,
      count: countByUnit.get(Number(unit.unitId)) ?? 0,
    }))
    .filter((part) => Math.abs(part.count) > 1e-9)
    .map((part) => `${formatCount(part.count)} ${unitName(part.unit)}`);
  const quantityText =
    parts.length > 0
      ? `${sign < 0 ? '-' : ''}${parts.join(' ')}`
      : `0 ${unitName(
          ordered.find((unit) => unit.isBase) ?? ordered[ordered.length - 1],
        )}`;

  return {
    quantity: qty,
    quantityText,
    unitLines,
    buyTotal,
    sellTotal,
    profit: round2(sellTotal - buyTotal),
  };
}

/**
 * Value every stock row of a product. Rows are grouped by variant and
 * quantities are summed before valuation, so multiple locations do not create
 * duplicate variant rows.
 */
export function valueProductInventory(
  product: ValuationProduct,
  inventoryRows: Array<{
    variantId?: number | null;
    quantity?: number | null;
  }>,
): ProductValuation {
  const byVariant = new Map<number | null, number>();
  for (const row of inventoryRows) {
    const key = row.variantId ?? null;
    byVariant.set(key, (byVariant.get(key) ?? 0) + (Number(row.quantity) || 0));
  }

  const variants = product.variants ?? [];
  const variantById = new Map<number, ValuationVariant>();
  for (const variant of variants) {
    if (variant.id != null) variantById.set(Number(variant.id), variant);
  }

  // A variant product can have rows for every variant; a plain product has
  // a single null-variant row.
  const keys =
    byVariant.size > 0
      ? [...byVariant.keys()]
      : variants.length > 0
        ? variants
            .map((variant) => (variant.id == null ? null : Number(variant.id)))
            .filter((id, index, list) => list.indexOf(id) === index)
        : [null];

  const rows: ProductValuationRow[] = keys.map((variantId) => {
    const variant =
      variantId == null ? null : (variantById.get(Number(variantId)) ?? null);
    const quantity = byVariant.get(variantId) ?? 0;
    return {
      variantId,
      variant,
      ...valueVariantQuantity(product, variant, quantity),
    };
  });

  return {
    rows,
    totals: {
      buyTotal: round2(rows.reduce((s, row) => s + row.buyTotal, 0)),
      sellTotal: round2(rows.reduce((s, row) => s + row.sellTotal, 0)),
      profit: round2(rows.reduce((s, row) => s + row.profit, 0)),
    },
  };
}
