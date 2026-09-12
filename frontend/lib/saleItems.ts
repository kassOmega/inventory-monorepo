// Grouping for sale item lists (sales and credit sales).
//
// A sale stores one row per product + variant, so the same product can appear on
// several rows. Lists that want one line per product (folding the variants into
// an accordion) group them with this helper.

export interface SaleItemLike {
  productId?: number | string | null;
  product?: { id?: number | string } | null;
  variantId?: number | string | null;
  variant?: { id?: number | string } | null;
  quantity?: number | string | null;
  unitPrice?: number | string | null;
}

export interface SaleItemGroup<T extends SaleItemLike> {
  /** Product id (or "" when the row has no product relation). */
  productId: string;
  product: T["product"];
  items: T[];
  /** Sum of the line quantities. */
  quantity: number;
  /** Sum of quantity × unitPrice. */
  subtotal: number;
  /** Unit price shared by every line, or null when the lines differ. */
  unitPrice: number | null;
  /** True when any line belongs to a variant, so the group should fold. */
  hasVariants: boolean;
}

/**
 * Group a sale's items by product, keeping first-appearance order so the list
 * reads the same way the sale was rung up.
 */
export function groupSaleItemsByProduct<T extends SaleItemLike>(
  items: readonly T[],
): SaleItemGroup<T>[] {
  const groups = new Map<string, SaleItemGroup<T>>();

  for (const item of items) {
    const key = String(item.productId ?? item.product?.id ?? "");
    let group = groups.get(key);
    if (!group) {
      group = {
        productId: key,
        product: item.product,
        items: [],
        quantity: 0,
        subtotal: 0,
        unitPrice: null,
        hasVariants: false,
      };
      groups.set(key, group);
    }
    const quantity = Number(item.quantity ?? 0);
    group.items.push(item);
    group.quantity += quantity;
    group.subtotal += quantity * Number(item.unitPrice ?? 0);
    if (item.variantId || item.variant) group.hasVariants = true;
  }

  for (const group of groups.values()) {
    const prices = new Set(
      group.items.map((i) => Number(i.unitPrice ?? 0)),
    );
    group.unitPrice =
      prices.size === 1 ? Number(group.items[0].unitPrice ?? 0) : null;
  }
  return [...groups.values()];
}

/**
 * Attach each credit-sale line to the variant of the underlying sale's line.
 *
 * Credit-sale lines are copies of the sale's items, created from them in the
 * same order (see the creditSale.create call in sales.service), and they store
 * no variant of their own — so lines of the same product pair up positionally
 * with the sale's lines. Only the variant is taken from the sale line; the
 * quantity and price shown stay the credit line's own.
 */
export function attachSaleVariants<
  T extends SaleItemLike,
  S extends SaleItemLike,
>(lines: readonly T[], saleItems: readonly S[]): T[] {
  if (!saleItems.length) return [...lines];

  // The sale's lines per product, in their original order.
  const byProduct = new Map<string, S[]>();
  for (const item of saleItems) {
    const key = String(item.productId ?? item.product?.id ?? "");
    const list = byProduct.get(key);
    if (list) list.push(item);
    else byProduct.set(key, [item]);
  }

  const cursor = new Map<string, number>();
  return lines.map((line) => {
    const key = String(line.productId ?? line.product?.id ?? "");
    const index = cursor.get(key) ?? 0;
    cursor.set(key, index + 1);
    const variant = byProduct.get(key)?.[index]?.variant ?? null;
    return variant ? { ...line, variant, variantId: variant.id } : line;
  });
}

