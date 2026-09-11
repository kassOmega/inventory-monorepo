// Cart rules for the POS "scan to cart" flow.
//
// Scanning is a stream: the same code can arrive several times in a row (the
// shopkeeper scans a second unit, or the camera re-reads the same label), so a
// scan must either increment the line that is already in the cart or create a
// new one — never duplicate it.

export interface ScanCartLine {
  variantId: string;
  quantity: number;
  customPrice: string;
}

export interface ScanCartRow {
  productId: string;
  quantity: number;
  customPrice: string;
  search: string;
  catFilter: string;
  variantLines?: ScanCartLine[];
}

export type ScanAction = "ADDED" | "BUMPED" | "NEEDS_VARIANT";

export interface ScanOutcome<T extends ScanCartRow> {
  cart: T[];
  action: ScanAction;
  /** Index of the row that changed (for focus/highlight). */
  rowIndex: number;
  /** Resulting quantity: the row quantity, or the variant line quantity. */
  quantity: number;
}

function isBlank(row: ScanCartRow): boolean {
  return String(row.productId ?? "") === "";
}

/** A pristine row, used to keep one empty row at the bottom of the cart. */
function blankRow(): ScanCartRow {
  return {
    productId: "",
    quantity: 1,
    customPrice: "",
    search: "",
    catFilter: "",
    variantLines: undefined,
  };
}

function bumpLine(lines: ScanCartLine[], variantId: string): ScanCartLine[] {
  return lines.map((l) =>
    l.variantId === variantId ? { ...l, quantity: l.quantity + 1 } : l,
  );
}

/** Add the variant line, or increment it when the row already has it. */
function upsertLine(
  lines: ScanCartLine[],
  line: ScanCartLine,
): ScanCartLine[] {
  return lines.some((l) => l.variantId === line.variantId)
    ? bumpLine(lines, line.variantId)
    : [...lines, line];
}

function trailingBlankIndex<T extends ScanCartRow>(rows: T[]): number {
  const last = rows.length - 1;
  return last >= 0 && isBlank(rows[last]) ? last : -1;
}

/**
 * A blank row the user prepared on purpose: they typed a quantity, a price or a
 * filter on it. The next scan goes there (keeping what they typed) instead of
 * deduping, which is what makes "type 3, then scan the product" work.
 */
function customizedBlankIndex<T extends ScanCartRow>(rows: T[]): number {
  const last = trailingBlankIndex(rows);
  if (last < 0) return -1;
  const row = rows[last];
  const prepared =
    Number(row.quantity) !== 1 ||
    !!row.customPrice ||
    !!row.search ||
    !!row.catFilter;
  return prepared ? last : -1;
}

/** Row the next scanned item lands on: a prepared blank row wins. */
function scanTargetIndex<T extends ScanCartRow>(rows: T[]): number {
  const prepared = customizedBlankIndex(rows);
  return prepared >= 0 ? prepared : trailingBlankIndex(rows);
}

/**
 * Put a product on the given blank row (or append a fresh row) and make sure the
 * cart still ends with exactly one empty row for manual entry.
 */
function fillRow<T extends ScanCartRow>(
  rows: T[],
  target: number,
  productId: string,
  variantLines: ScanCartLine[],
  keepQuantity = false,
): T[] {
  const fill = (row: T): T => ({
    ...row,
    productId,
    quantity: keepQuantity ? row.quantity : 1,
    variantLines: variantLines.length ? variantLines : undefined,
  });

  const template: T = rows.length
    ? rows[rows.length - 1]
    : (blankRow() as unknown as T);
  const next: T[] =
    target >= 0
      ? rows.map((row, i) => (i === target ? fill(row) : row))
      : [...rows, fill(template)];

  const last = next[next.length - 1];
  if (last && !isBlank(last)) {
    next.push({ ...last, ...blankRow() } as T);
  }
  return next;
}

/**
 * Apply a scanned product — optionally a specific variant — to the cart.
 *
 * - plain product already in the cart → that row's quantity + 1
 * - variant already in the cart       → that variant line's quantity + 1
 * - otherwise                         → new row for the product, reusing the
 *   trailing empty row when there is one
 * - a variant product scanned with its product-level code cannot be sold
 *   without a variant, so it only selects the product (NEEDS_VARIANT)
 */
export function addScannedToCart<T extends ScanCartRow>(
  cart: T[],
  product: { id: number | string; hasVariants?: boolean | null },
  variantLine?: ScanCartLine | null,
): ScanOutcome<T> {
  const pid = String(product.id);

  if (variantLine) {
    // One row per product: an extra variant joins the product's existing row.
    const rowIdx = cart.findIndex((row) => String(row.productId) === pid);
    if (rowIdx >= 0) {
      const hadLine = (cart[rowIdx].variantLines ?? []).some(
        (l) => l.variantId === variantLine.variantId,
      );
      const next = cart.map((row, i) =>
        i === rowIdx
          ? {
              ...row,
              variantLines: upsertLine(row.variantLines ?? [], variantLine),
            }
          : row,
      );
      const line = (next[rowIdx].variantLines ?? []).find(
        (l) => l.variantId === variantLine.variantId,
      );
      return {
        cart: next,
        action: hadLine ? "BUMPED" : "ADDED",
        rowIndex: rowIdx,
        quantity: line?.quantity ?? 1,
      };
    }
  } else {
    const idx = cart.findIndex(
      (row) =>
        String(row.productId) === pid && !(row.variantLines ?? []).length,
    );
    if (idx >= 0) {
      const bumped = cart.map((row, i) =>
        i === idx ? { ...row, quantity: row.quantity + 1 } : row,
      );
      return {
        cart: bumped,
        action: "BUMPED",
        rowIndex: idx,
        quantity: bumped[idx].quantity,
      };
    }

    if (product.hasVariants) {
      const target = scanTargetIndex(cart);
      const keepQuantity = customizedBlankIndex(cart) >= 0;
      const next = fillRow(cart, target, pid, [], keepQuantity);
      return {
        cart: next,
        action: "NEEDS_VARIANT",
        rowIndex: target >= 0 ? target : next.length - 2,
        quantity: 0,
      };
    }
  }

  const target = scanTargetIndex(cart);
  const keepQuantity = customizedBlankIndex(cart) >= 0;
  const next = fillRow(
    cart,
    target,
    pid,
    variantLine ? [variantLine] : [],
    keepQuantity,
  );
  const rowIndex = target >= 0 ? target : next.length - 2;
  return {
    cart: next,
    action: "ADDED",
    rowIndex,
    quantity: Number(next[rowIndex]?.quantity) || 1,
  };
}
