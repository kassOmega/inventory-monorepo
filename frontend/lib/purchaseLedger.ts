// Payables as the vendor ledger lists them.
//
// A purchase row is one product — the API stores one row per purchased line (see
// PurchasesService.createMany) — so "what we took from this vendor in one go" is
// not a row but a group of rows: everything taken from the same shop on the same
// day. The credits page lists those groups through the same day-header + item
// table UI it uses for credit sales (see app/components/CreditLedgerList.tsx).

import { localDayKey } from "./dayKey";
import type { LedgerLine, LedgerLineGroup } from "./saleItems";

export interface PurchaseLike {
  id?: number | string | null;
  /** Human-facing record number, e.g. PU-2026-0001. */
  publicId?: string | null;
  createdAt?: string | null;
  shopId?: number | string | null;
  shop?: { id?: number | string | null; name?: string | null } | null;
  productName?: string | null;
  quantity?: number | string | null;
  unitPrice?: number | string | null;
  totalCost?: number | string | null;
  amountPaid?: number | string | null;
}

export interface PurchaseDayShopGroup<T extends PurchaseLike> {
  /** `<YYYY-MM-DD>:<shopId>` — the list's key and the fold key prefix. */
  key: string;
  dayKey: string;
  shopId: string;
  shopName: string;
  /** The group's newest line, used to order the groups newest-first. */
  createdAt: string | null;
  /** The rows taken, in the order they were entered. */
  lines: T[];
  totalCost: number;
  amountPaid: number;
  /** What is still owed on the group: taken − paid back, never below zero. */
  remaining: number;
}

const time = (value?: string | null) => new Date(value ?? 0).getTime();

/**
 * Group purchases into shop-days: one entry per shop per day, holding every
 * product taken from that shop that day, newest shop-day first.
 */
export function groupPurchasesByDayAndShop<T extends PurchaseLike>(
  rows: readonly T[],
): PurchaseDayShopGroup<T>[] {
  const groups = new Map<string, PurchaseDayShopGroup<T>>();

  for (const row of rows) {
    const dayKey = localDayKey(row.createdAt);
    const shopId = String(row.shop?.id ?? row.shopId ?? "");
    const key = `${dayKey}:${shopId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        dayKey,
        shopId,
        shopName: row.shop?.name ?? "",
        createdAt: row.createdAt ?? null,
        lines: [],
        totalCost: 0,
        amountPaid: 0,
        remaining: 0,
      };
      groups.set(key, group);
    }
    if (!group.shopName) group.shopName = row.shop?.name ?? "";
    group.lines.push(row);
    group.totalCost += Number(row.totalCost ?? 0);
    group.amountPaid += Number(row.amountPaid ?? 0);
  }

  for (const group of groups.values()) {
    // Form order inside the group, so the table reads the way the goods were
    // entered; `id` breaks ties on rows created in the same batch.
    group.lines.sort(
      (a, b) =>
        time(a.createdAt) - time(b.createdAt) ||
        Number(a.id ?? 0) - Number(b.id ?? 0),
    );
    group.remaining = Math.max(0, group.totalCost - group.amountPaid);
    group.createdAt =
      group.lines[group.lines.length - 1]?.createdAt ?? group.createdAt;
  }

  return [...groups.values()].sort(
    (a, b) => time(b.createdAt) - time(a.createdAt),
  );
}

/**
 * One purchase row as a single row of a ledger item table.
 *
 * Shaped like `groupSaleItemsByProduct` output so the shared list renders it
 * with the very same Product / Qty / Price / Subtotal row a sale line gets.
 * `unitPrice × quantity` is what the API stored as `totalCost` (round2 applied
 * server-side), so the row shows the same figure the purchases list does.
 */
export function purchaseLineGroup<T extends PurchaseLike>(
  purchase: T,
): LedgerLineGroup {
  const quantity = Number(purchase.quantity ?? 0);
  const unitPrice = Number(purchase.unitPrice ?? 0);
  return {
    // The row's own id keys the line: each purchase is its own payable, so two
    // rows of the same product must never merge into one tally.
    productId: String(purchase.id ?? purchase.productName ?? ""),
    product: { baseName: purchase.productName ?? "" },
    items: [purchase as LedgerLine],
    quantity,
    subtotal: Number(purchase.totalCost ?? quantity * unitPrice),
    unitPrice,
    hasVariants: false,
  };
}
