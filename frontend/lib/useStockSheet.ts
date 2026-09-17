"use client";
// Shared state for a "stock sheet": a list of counted rows
// (product · variant · location · counted) plus the system quantities they are
// reconciled against, and one batch save.
//
// Built for the bulk stock count, and reused by the restock sheet next. The row
// IS the unit of work — the matrix view is only a grouped rendering that writes
// into the same rows, so there is one save path and one source of truth
// (blank counted = not counted = skipped).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api, { markHandled } from "./api";

export interface StockSheetVariant {
  id: number;
  sku?: string | null;
  attributes?: Record<string, unknown> | null;
  buyPrice?: number | null;
  sellPrice?: number | null;
  reorderLevel?: number;
}

export interface StockSheetProduct {
  id: number;
  sku?: string;
  brand: string;
  baseName: string;
  hasVariants: boolean;
  isPerishable?: boolean;
  /** Used by the per-item picker: the category the item belongs to. */
  categoryId?: number | null;
  currentBuyPrice?: number;
  currentSellPrice?: number;
  reorderLevel?: number;
  variants?: StockSheetVariant[];
}

export interface StockSheetEntry {
  productId: number;
  variantId: number | null;
  locationId: number;
  quantity: number;
  avgCost: number;
}

/** A raw stock row as the lookup returns it (before it is normalised). */
interface StockEntryRow {
  productId: number;
  variantId: number | null;
  locationId: number;
  quantity: number;
}

export interface StockSheetRow {
  key: string;
  productId: string;
  variantId: string;
  locationId: string;
  /**
   * The number the user entered for this cell: the counted quantity on a count
   * sheet, the quantity being received on a restock. Blank = not filled in, so the
   * cell is skipped on save.
   */
  counted: string;
  /**
   * Whether the user actually typed in this cell. Only touched cells are
   * submitted: a cell that was pre-filled with the on-hand number (or filled by
   * "fill with current") is left out of the save, so an untouched sheet changes
   * nothing. Clearing a cell back to blank also clears the flag.
   */
  touched?: boolean;
  /**
   * Restock only: the per-line cost / selling price (blank = keep current).
   * These belong to the VARIANT, not to one location, so `setVariantField` writes
   * every row of the variant at once — the sheet can never price one item two
   * different ways.
   */
  buyPrice?: string;
  sellPrice?: string;
  /** Restock only, for perishable items. */
  batchNumber?: string;
  expiryDate?: string;
}

/** The variant-level fields shared by every row of one (product, variant) pair. */
export type StockSheetVariantField =
  | "buyPrice"
  | "sellPrice"
  | "batchNumber"
  | "expiryDate";

export interface StockSheetTotals {
  rows: number;
  counted: number;
  changed: number;
  surplus: number;
  shortage: number;
  net: number;
}

let seq = 0;
const nextKey = () => `r${++seq}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

export const rowKeyOf = (row: {
  productId: string;
  variantId: string;
  locationId: string;
}) => `${row.productId}|${row.variantId || "base"}|${row.locationId || "none"}`;

/** The variant-level fields of a cell, as a patch for a newly added cell. */
const variantFieldsOf = (row: StockSheetRow) => ({
  buyPrice: row.buyPrice,
  sellPrice: row.sellPrice,
  batchNumber: row.batchNumber,
  expiryDate: row.expiryDate,
});

export default function useStockSheet() {
  const [rows, setRows] = useState<StockSheetRow[]>([]);
  const [products, setProducts] = useState<StockSheetProduct[]>([]);
  const [stock, setStock] = useState<StockSheetEntry[]>([]);
  const [loadingStock, setLoadingStock] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  /** Row key → message, from the last save attempt. */
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  /**
   * A product whose on-hand numbers are on their way in (see prefillProduct): the
   * cells exist, the numbers are filled as soon as the stock lookup answers.
   */
  const [pendingPrefill, setPendingPrefill] = useState<{
    productId: number;
    variantId: string;
    locationId: string;
  } | null>(null);
  /** The cell a caller asked to focus (a scan, or the item it opened on). */
  const [focusCell, setFocusCell] = useState<string | null>(null);
  /** Session reference for the batch, created on first use (never in render). */
  const batchRef = useRef<string>("");
  const ensureBatchId = useCallback(() => {
    if (!batchRef.current) {
      batchRef.current = `S${Date.now().toString(36)}${Math.random()
        .toString(36)
        .slice(2, 8)}`;
    }
    return batchRef.current;
  }, []);

  /** Product snapshots known to the sheet (search results + stock lookups). */
  const registerProducts = useCallback((list: StockSheetProduct[]) => {
    if (!list?.length) return;
    setProducts((prev) => {
      const byId = new Map(prev.map((p) => [p.id, p]));
      for (const p of list) byId.set(p.id, { ...byId.get(p.id), ...p });
      return Array.from(byId.values());
    });
  }, []);

  const productById = useMemo(() => {
    const map = new Map<number, StockSheetProduct>();
    for (const p of products) map.set(p.id, p);
    return map;
  }, [products]);


  /**
   * Write a count for a (product, variant, location) triple — the product cards
   * fill cells out of order, so this creates the cell when it does not exist yet.
   * Typing marks the cell touched; clearing it back to blank un-marks it again.
   */
  const setCounted = useCallback(
    (productId: string, variantId: string, locationId: string, counted: string) => {
      setRows((prev) => {
        const key = `${productId}|${variantId || "base"}|${locationId || "none"}`;
        const found = prev.find((r) => rowKeyOf(r) === key);
        if (found) {
          return prev.map((r) =>
            r === found ? { ...r, counted, touched: counted !== "" } : r,
          );
        }
        if (counted === "") return prev;
        return [
          ...prev,
          {
            key: nextKey(),
            productId,
            variantId,
            locationId,
            counted,
            touched: true,
          },
        ];
      });
    },
    [],
  );

  /** The cell for a triple, or undefined when the product does not cover it. */
  const rowFor = useCallback(
    (
      productId: string | number,
      variantId: string | number | null,
      locationId: string | number | null,
    ) => {
      const key = `${productId}|${variantId || "base"}|${locationId || "none"}`;
      return rows.find((r) => rowKeyOf(r) === key);
    },
    [rows],
  );

  /**
   * Write a variant-level field (prices, batch, expiry) on every row of that
   * variant — the value belongs to the item, not to one location.
   */
  const setVariantField = useCallback(
    (
      productId: string | number,
      variantId: string | number | null,
      field: StockSheetVariantField,
      value: string,
    ) => {
      const prefix = `${productId}|${variantId || "base"}|`;
      setRows((prev) =>
        prev.map((r) =>
          rowKeyOf(r).startsWith(prefix) ? { ...r, [field]: value } : r,
        ),
      );
    },
    [],
  );

  /** The value of a variant-level field (read off the first row of the variant). */
  const variantFieldFor = useCallback(
    (
      productId: string | number,
      variantId: string | number | null,
      field: StockSheetVariantField,
    ) => {
      const prefix = `${productId}|${variantId || "base"}|`;
      const row = rows.find((r) => rowKeyOf(r).startsWith(prefix));
      return row ? ((row[field] as string | undefined) ?? "") : "";
    },
    [rows],
  );


  /**
   * Add a product to the sheet across the locations given — one cell per
   * variant-or-base × location. Prices or batch data already typed for a variant
   * are carried over to the new cells.
   */
  const addProduct = useCallback(
    (product: StockSheetProduct, locationIds: (string | number)[]) => {
      registerProducts([product]);
      const columns = locationIds.map(String).filter(Boolean);
      if (!columns.length) return;
      setRows((prev) => {
        const seen = new Set(prev.map(rowKeyOf));
        const added: StockSheetRow[] = [];
        const variantIds: string[] = product.hasVariants
          ? (product.variants ?? []).map((v) => String(v.id))
          : [""];
        for (const variantId of variantIds) {
          const prefix = `${product.id}|${variantId || "base"}|`;
          const existing = prev.find((r) => rowKeyOf(r).startsWith(prefix));
          for (const locationId of columns) {
            const row: StockSheetRow = {
              key: nextKey(),
              productId: String(product.id),
              variantId,
              locationId,
              counted: "",
              ...(existing ? variantFieldsOf(existing) : {}),
            };
            if (seen.has(rowKeyOf(row))) continue;
            seen.add(rowKeyOf(row));
            added.push(row);
          }
        }
        return added.length ? [...prev, ...added] : prev;
      });
    },
    [registerProducts],
  );

  /**
   * Tick or untick a location column for one product: ticking adds a cell per
   * variant, unticking drops that product's cells at that location (and any count
   * typed in them).
   */
  const toggleProductLocation = useCallback(
    (product: StockSheetProduct, locationId: string | number) => {
      const column = String(locationId);
      setRows((prev) => {
        const ofProduct = prev.filter(
          (r) => Number(r.productId) === product.id,
        );
        const hasColumn = ofProduct.some((r) => r.locationId === column);
        if (hasColumn) {
          return prev.filter(
            (r) => !(Number(r.productId) === product.id && r.locationId === column),
          );
        }
        const seen = new Set(prev.map(rowKeyOf));
        const added: StockSheetRow[] = [];
        const variantIds: string[] = product.hasVariants
          ? (product.variants ?? []).map((v) => String(v.id))
          : [""];
        for (const variantId of variantIds) {
          const prefix = `${product.id}|${variantId || "base"}|`;
          const existing = prev.find((r) => rowKeyOf(r).startsWith(prefix));
          const row: StockSheetRow = {
            key: nextKey(),
            productId: String(product.id),
            variantId,
            locationId: column,
            counted: "",
            ...(existing ? variantFieldsOf(existing) : {}),
          };
          if (seen.has(rowKeyOf(row))) continue;
          seen.add(rowKeyOf(row));
          added.push(row);
        }
        return added.length ? [...prev, ...added] : prev;
      });
    },
    [],
  );

  /**
   * Remove one product (all of its cells) from the sheet — what a card's remove
   * button does.
   */
  const removeProduct = useCallback((productId: string | number) => {
    setRows((prev) =>
      prev.filter((r) => Number(r.productId) !== Number(productId)),
    );
  }, []);

  /**
   * The item list, as product cards: each product with the columns it covers and
   * its variant rows, in the order the products were added.
   */
  const groups = useMemo(() => {
    const order: number[] = [];
    const perProduct = new Map<
      number,
      { locations: string[]; variants: string[] }
    >();
    for (const row of rows) {
      const productId = Number(row.productId);
      let acc = perProduct.get(productId);
      if (!acc) {
        acc = { locations: [], variants: [] };
        perProduct.set(productId, acc);
        order.push(productId);
      }
      if (row.locationId && !acc.locations.includes(row.locationId)) {
        acc.locations.push(row.locationId);
      }
      if (!acc.variants.includes(row.variantId)) {
        acc.variants.push(row.variantId);
      }
    }
    return order.map((productId) => ({
      productId,
      product: productById.get(productId),
      locationIds: perProduct.get(productId)!.locations,
      variantIds: perProduct.get(productId)!.variants,
    }));
  }, [rows, productById]);

  // ------------------------------------------------------- system quantities
  /** The products/locations currently in play, so one request covers them all. */
  const scope = useMemo(() => {
    const productIds = Array.from(
      new Set(rows.map((r) => r.productId).filter(Boolean)),
    );
    const locationIds = Array.from(
      new Set(rows.map((r) => r.locationId).filter(Boolean)),
    );
    return { productIds, locationIds };
  }, [rows]);

  // Simple-expressions stand-ins for the scope, so the fetch below can depend on
  // two stable strings instead of the whole rows array.
  const productKey = scope.productIds.join(",");
  const locationKey = scope.locationIds.join(",");

  const refreshStock = useCallback(async () => {
    if (!scope.productIds.length || !scope.locationIds.length) {
      setStock([]);
      return;
    }
    setLoadingStock(true);
    try {
      const res = await api.get("/products/stock", {
        params: {
          productIds: scope.productIds.join(","),
          locationIds: scope.locationIds.join(","),
        },
      });
      setStock(res.data?.stock ?? []);
      registerProducts(res.data?.products ?? []);
    } catch (err) {
      markHandled(err);
      setStock([]);
    } finally {
      setLoadingStock(false);
    }
    // The two keys capture the whole scope, so they stand in for `scope` here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productKey, locationKey, registerProducts]);

  // Debounced so typing in a matrix does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      void refreshStock();
    }, 250);
    return () => clearTimeout(timer);
  }, [refreshStock]);

  const entryFor = useCallback(
    (productId: string | number, variantId: string | number | null, locationId: string | number | null) =>
      stock.find(
        (s) =>
          s.productId === Number(productId) &&
          (s.variantId ?? null) === (variantId ? Number(variantId) : null) &&
          s.locationId === Number(locationId),
      ),
    [stock],
  );

  const systemFor = useCallback(
    (row: { productId: string; variantId: string; locationId: string }) =>
      entryFor(row.productId, row.variantId || null, row.locationId)?.quantity ??
      0,
    [entryFor],
  );

  const unitCostFor = useCallback(
    (row: { productId: string; variantId: string; locationId: string }) => {
      const entry = entryFor(row.productId, row.variantId || null, row.locationId);
      if (entry) return entry.avgCost ?? 0;
      return productById.get(Number(row.productId))?.currentBuyPrice ?? 0;
    },
    [entryFor, productById],
  );

  const deltaFor = useCallback(
    (row: { productId: string; variantId: string; locationId: string; counted: string }) => {
      if (row.counted === "" || row.counted === null) return 0;
      const counted = Number(row.counted);
      if (!Number.isFinite(counted)) return 0;
      return round2(counted - systemFor(row));
    },
    [systemFor],
  );

  // ----------------------------------------------------------- totals + save
  /**
   * Show the current on-hand number in every cell (optionally only for the given
   * products) without marking anything touched: the number is there to be
   * corrected, and a sheet saved with no corrections changes nothing.
   */
  const prefillFromOnHand = useCallback(
    (productIds?: (string | number)[]) => {
      const only = productIds?.length ? productIds.map(Number) : null;
      setRows((prev) =>
        prev.map((r) => {
          if (only && !only.includes(Number(r.productId))) return r;
          const system = stock.find(
            (s) =>
              s.productId === Number(r.productId) &&
              (s.variantId ?? null) === (r.variantId ? Number(r.variantId) : null) &&
              s.locationId === Number(r.locationId),
          );
          if (!system) return r;
          return { ...r, counted: String(system.quantity), touched: false };
        }),
      );
    },
    [stock],
  );

  /**
   * Open the sheet on one item: fetch it, give it a column for every location that
   * actually holds it (or the caller's locations when it holds stock nowhere yet),
   * and fill today's numbers in as soon as the stock lookup answers — untouched, so
   * saving without correcting anything changes nothing. The clicked variant's cell
   * is focused. Used by the product page's Adjust modal and the count page's
   * ?productId= deep link alike.
   */
  const prefillProduct = useCallback(
    async (
      productId: number,
      opts: { variantId?: string | number | null; locationIds: (string | number)[] },
    ) => {
      const locationIds = opts.locationIds.map(String).filter(Boolean);
      try {
        const [detail, lookup] = await Promise.all([
          api.get(`/products/${productId}`),
          api.get("/products/stock", {
            params: {
              productIds: productId,
              locationIds: locationIds.join(","),
            },
          }),
        ]);
        const product = detail.data;
        if (!product) return null;
        const stockRows: StockEntryRow[] = lookup.data?.stock ?? [];
        const holding = Array.from(
          new Set(
            stockRows
              .filter(
                (r) =>
                  Number(r.productId) === Number(productId) &&
                  (r.quantity ?? 0) > 0,
              )
              .map((r) => String(r.locationId)),
          ),
        );
        const columns = holding.length ? holding : locationIds;
        addProduct(product, columns);
        registerProducts(lookup.data?.products ?? []);
        setPendingPrefill({
          productId: Number(productId),
          variantId: opts.variantId ? String(opts.variantId) : "",
          locationId: columns[0] ?? "",
        });
        return columns;
      } catch (err) {
        markHandled(err);
        return null;
      }
    },
    [addProduct, registerProducts],
  );

  /** Fill the pre-filled numbers in once the stock lookup has answered. */
  useEffect(() => {
    if (!pendingPrefill || loadingStock) return;
    if (!rows.some((r) => Number(r.productId) === pendingPrefill.productId)) {
      return;
    }
    prefillFromOnHand([pendingPrefill.productId]);
    setFocusCell(
      `${pendingPrefill.productId}|${pendingPrefill.variantId || "base"}|${
        pendingPrefill.locationId
      }`,
    );
    setPendingPrefill(null);
  }, [pendingPrefill, loadingStock, rows, prefillFromOnHand]);

  /** Cells the user actually filled in: the only ones that will be submitted. */
  const touchedRows = useMemo(
    () => rows.filter((r) => r.touched && r.counted !== ""),
    [rows],
  );

  const totals: StockSheetTotals = useMemo(() => {
    const acc: StockSheetTotals = {
      rows: rows.length,
      counted: 0,
      changed: 0,
      surplus: 0,
      shortage: 0,
      net: 0,
    };
    for (const row of touchedRows) {
      acc.counted += 1;
      const delta = deltaFor(row);
      if (delta === 0) continue;
      acc.changed += 1;
      const value = round2(delta * unitCostFor(row));
      if (value > 0) acc.surplus = round2(acc.surplus + value);
      else acc.shortage = round2(acc.shortage + value);
      acc.net = round2(acc.net + value);
    }
    return acc;
  }, [rows.length, touchedRows, deltaFor, unitCostFor]);

  /**
   * Items the backend will be asked to apply: cells the user typed in. A blank
   * cell is skipped — it is never read as a zero count — and a pre-filled cell the
   * user left alone is skipped too, so saving an untouched sheet changes nothing.
   * A count may also carry a new SELLING price (never a buying price).
   */
  const buildItems = useCallback(
    () =>
      touchedRows.map((r) => ({
        productId: Number(r.productId),
        ...(r.variantId ? { variantId: Number(r.variantId) } : {}),
        locationId: Number(r.locationId),
        quantity: Number(r.counted),
        ...(r.sellPrice ? { sellPrice: Number(r.sellPrice) } : {}),
      })),
    [touchedRows],
  );

  /**
   * The same cells shaped for a restock: quantity plus the per-line prices (the
   * product's own average is never sent) and, for perishables, the batch data.
   */
  const buildRestockItems = useCallback(
    () =>
      touchedRows.map((r) => {
        const product = productById.get(Number(r.productId));
        return {
          productId: Number(r.productId),
          ...(r.variantId ? { variantId: Number(r.variantId) } : {}),
          locationId: Number(r.locationId),
          quantity: Number(r.counted),
          ...(r.buyPrice ? { buyPrice: Number(r.buyPrice) } : {}),
          ...(r.sellPrice ? { sellPrice: Number(r.sellPrice) } : {}),
          ...(product?.isPerishable && r.batchNumber
            ? { batchNumber: r.batchNumber }
            : {}),
          ...(product?.isPerishable && r.expiryDate
            ? { expiryDate: r.expiryDate }
            : {}),
        };
      }),
    [touchedRows, productById],
  );

  /**
   * Client-side pre-checks so an obvious mistake costs no round trip. Returns the
   * offending rows keyed for highlighting.
   */
  const validate = useCallback((): { ok: boolean; errors: Record<string, string> } => {
    const errors: Record<string, string> = {};
    for (const row of rows) {
      // Only the cells the user filled in are submitted, so only they are checked.
      if (!row.touched || row.counted === "") continue;
      const product = productById.get(Number(row.productId));
      const counted = Number(row.counted);
      if (!Number.isFinite(counted) || counted < 0) errors[row.key] = "count";
      else if (!row.locationId) errors[row.key] = "location";
      else if (product?.hasVariants && !row.variantId) errors[row.key] = "variant";
    }
    return { ok: Object.keys(errors).length === 0, errors };
  }, [rows, productById]);

  const save = useCallback(
    async (reason?: string) => {
      const check = validate();
      if (!check.ok) {
        setRowErrors(check.errors);
        return { ok: false as const, reason: "invalid" as const };
      }
      const items = buildItems();
      if (items.length === 0) {
        return { ok: false as const, reason: "empty" as const };
      }
      setSaving(true);
      setRowErrors({});
      try {
        const res = await api.post("/products/adjust-stock/bulk", {
          batchId: ensureBatchId(),
          reason: reason?.trim() || undefined,
          items,
        });
        setResult(res.data ?? null);
        // Roll the new counts in: system now equals counted, so every row reads
        // as unchanged and the sheet can be reused for the next location.
        await refreshStock();
        return { ok: true as const, data: res.data };
      } catch (err: any) {
        markHandled(err);
        const list = err?.response?.data?.errors;
        if (Array.isArray(list)) {
          const mapped: Record<string, string> = {};
          for (const e of list) {
            const key = `${e.productId}|${e.variantId || "base"}|${e.locationId || "none"}`;
            const row = rows.find((r) => rowKeyOf(r) === key);
            mapped[row ? row.key : key] = e.message ?? "rejected";
          }
          setRowErrors(mapped);
        }
        return {
          ok: false as const,
          reason: "rejected" as const,
          message: err?.response?.data?.message,
        };
      } finally {
        setSaving(false);
      }
    },
    [validate, buildItems, refreshStock, rows, ensureBatchId],
  );

  /** Start a fresh session — used by "Save & close" and after a completed sheet. */
  const resetSheet = useCallback(() => {
    setRows([]);
    setStock([]);
    setResult(null);
    setRowErrors({});
    batchRef.current = "";
  }, []);

  return {
    rows,
    products,
    productById,
    registerProducts,
    setCounted,
    rowFor,
    setVariantField,
    variantFieldFor,
    addProduct,
    removeProduct,
    toggleProductLocation,
    groups,
    prefillFromOnHand,
    prefillProduct,
    focusCell,
    setFocusCell,
    refreshStock,
    loadingStock,
    systemFor,
    unitCostFor,
    deltaFor,
    totals,
    touchedRows,
    buildItems,
    buildRestockItems,
    validate,
    save,
    saving,
    result,
    rowErrors,
    setRowErrors,
    resetSheet,
  };
}
