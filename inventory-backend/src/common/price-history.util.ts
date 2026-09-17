// src/common/price-history.util.ts
//
// Price-history writes. One price action (a restock, a purchase, a receive, a
// product edit) touches the product's own row plus zero or more variants, so it
// writes one row per change and gives them all the same `batchRef` — that is what
// lets the history page show the product's main row (the average) with its
// per-variant detail underneath.
import { Prisma } from '@prisma/client';

// Both PrismaClient (services) and Prisma.TransactionClient expose the same
// delegate, so the helper accepts either.
type PriceHistoryDb = Prisma.TransactionClient;

/** One price change for a product, or for one of its variants. */
export interface PriceChange {
  productId: number;
  /** Set for a variant row; omit/null for the product's own (average) row. */
  variantId?: number | null;
  oldBuyPrice: number;
  newBuyPrice: number;
  oldSellPrice: number;
  newSellPrice: number;
}

/** What caused the change (shown on the history page). */
export type PriceChangeSource =
  | 'RESTOCK'
  | 'PURCHASE'
  | 'REQUEST'
  | 'PRODUCT_EDIT'
  /** A stock count that also corrected the selling price. */
  | 'COUNT';

/** A token shared by every row one user action writes. */
export const newPriceBatchRef = () =>
  `PH${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * Record price changes. Rows whose prices did not actually move are skipped
 * unless `keepUnchanged` is set — a variant-only change still writes the parent
 * row (with keepUnchanged) so every action has a main row to group under.
 */
export async function recordPriceChanges(
  db: PriceHistoryDb,
  opts: {
    tenantId?: number | null;
    userId: number;
    source: PriceChangeSource;
    batchRef?: string;
    changes: PriceChange[];
    keepUnchanged?: boolean;
  },
): Promise<string> {
  const batchRef = opts.batchRef ?? newPriceBatchRef();
  for (const change of opts.changes) {
    const unchanged =
      change.oldBuyPrice === change.newBuyPrice &&
      change.oldSellPrice === change.newSellPrice;
    if (unchanged && !opts.keepUnchanged) continue;
    await db.priceHistory.create({
      data: {
        ...(opts.tenantId != null ? { tenantId: opts.tenantId } : {}),
        productId: change.productId,
        variantId: change.variantId ?? null,
        batchRef,
        source: opts.source,
        oldBuyPrice: change.oldBuyPrice,
        newBuyPrice: change.newBuyPrice,
        oldSellPrice: change.oldSellPrice,
        newSellPrice: change.newSellPrice,
        updatedById: opts.userId,
      },
    });
  }
  return batchRef;
}
