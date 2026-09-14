import { Prisma } from '@prisma/client';

// Both PrismaClient (services) and Prisma.TransactionClient expose the same
// inventory delegate, so helpers accept either.
type InventoryDelegate = Prisma.TransactionClient['inventory'];
type Tx = { inventory: InventoryDelegate };

/**
 * Inventory helpers.
 *
 * Stock lives at the variant level: plain products use variantId = null;
 * variant products use the specific variant id. The DB unique constraint is
 * (productId, variantId, locationId) — Postgres allows multiple NULL variantId
 * rows, but Prisma's findUnique/upsert reject null compound keys, so lookups
 * go through findFirst (the constraint still prevents true duplicates).
 */

export async function inventoryFind(
  tx: Tx,
  input: { productId: number; locationId: number; variantId?: number | null },
  include?: Prisma.InventoryInclude,
): Promise<any> {
  return tx.inventory.findFirst({
    where: {
      productId: input.productId,
      locationId: input.locationId,
      variantId: input.variantId ?? null,
    },
    include,
  });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Increment an existing row or create it (upsert semantics via findFirst).
 *  When `unitCost` is provided on a positive increment, the row's weighted
 *  average cost (avgCost) is reweighted: (oldQty×oldAvg + inc×unitCost) /
 *  (oldQty + inc). Outflows (negative increments) never change avgCost — they
 *  are valued at the existing average for COGS. */
export async function inventoryUpsert(
  tx: Tx,
  input: {
    productId: number;
    locationId: number;
    variantId?: number | null;
    increment: number;
    // Required: Inventory.tenantId is a NOT NULL FK to Organization.
    tenantId: number;
    unitCost?: number | null;
  },
) {
  const row = await tx.inventory.findFirst({
    where: {
      productId: input.productId,
      locationId: input.locationId,
      variantId: input.variantId ?? null,
    },
  });
  const inc = input.increment;
  if (row) {
    const data: Prisma.InventoryUpdateInput = { quantity: { increment: inc } };
    if (inc > 0 && input.unitCost != null && input.unitCost > 0) {
      const newQty = Math.max(0, (row.quantity ?? 0) + inc);
      const oldVal = (row.quantity ?? 0) * (row.avgCost ?? 0);
      data.avgCost =
        newQty > 0 ? round2((oldVal + inc * input.unitCost) / newQty) : input.unitCost;
    }
    return tx.inventory.update({ where: { id: row.id }, data });
  }
  return tx.inventory.create({
    data: {
      tenantId: input.tenantId,
      productId: input.productId,
      variantId: input.variantId ?? null,
      locationId: input.locationId,
      quantity: inc,
      ...(inc > 0 && input.unitCost != null && input.unitCost > 0
        ? { avgCost: input.unitCost }
        : {}),
    },
  });
}

/** Set an existing row to an absolute quantity or create it. */
export async function inventorySet(
  tx: Tx,
  input: {
    productId: number;
    locationId: number;
    variantId?: number | null;
    quantity: number;
    // Required: Inventory.tenantId is a NOT NULL FK to Organization.
    tenantId: number;
  },
) {
  const row = await tx.inventory.findFirst({
    where: {
      productId: input.productId,
      locationId: input.locationId,
      variantId: input.variantId ?? null,
    },
  });
  if (row) {
    return tx.inventory.update({
      where: { id: row.id },
      data: { quantity: input.quantity },
    });
  }
  return tx.inventory.create({
    data: {
      tenantId: input.tenantId,
      productId: input.productId,
      variantId: input.variantId ?? null,
      locationId: input.locationId,
      quantity: input.quantity,
    },
  });
}
