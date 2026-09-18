"use client";
// The reusable stock sheet: one product card per item, and inside each card one
// row per variant (or a single "How many?" row for a plain product) across the
// locations ticked for that product. A ticked location is a column; a blank cell
// is skipped, and a cell the user never typed in is not submitted at all.
//
// Two operations share it and must never look alike:
//   Stock In    (kind="in")    — ADDS to what is on hand (green "Add to stock")
//   Stock Count (kind="count") — SETS the count, and may also correct the selling
//                                price              (blue "Save counts")
//
// The cards are only layout. Underneath, the sheet is the flat list of
// (product · variant-or-base · location) cells the bulk endpoints already take, so
// validation, the payload and per-row error mapping are unchanged.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import BarcodeScanner from "./BarcodeScanner";
import Modal from "./Modal";
import SearchableSelect from "./SearchableSelect";
import { useConfirm } from "./ConfirmProvider";
import { useToast } from "./ToastProvider";
import { fmtCurrency } from "@/lib/currency";
import { variantLabel } from "@/lib/variantLabel";
import type useStockSheet from "@/lib/useStockSheet";
import type { StockSheetProduct, StockSheetRow } from "@/lib/useStockSheet";

type Sheet = ReturnType<typeof useStockSheet>;

interface StockProductSheetProps {
  sheet: Sheet;
  kind: "in" | "count";
  locations: { id: number; name: string; type?: string }[];
  /**
   * The picker's items: every product the per-card Category → Product selects
   * offer (the bare `GET /products` list, as the sale and request forms use).
   */
  products: StockSheetProduct[];
  productsBusy?: boolean;
  categories?: { id: number; name: string }[];
  /** The user's own location, when their role is bound to one. */
  boundLocationId?: string | null;
  /** Free-text reason (a count) or vendor (a restock). */
  note: string;
  onNoteChange: (value: string) => void;
  saving: boolean;
  onSave: () => void;
  /** Scan-to-add: resolves a code to the cell it added (null = unknown code). */
  onScanCode?: (code: string) => Promise<string | null>;
  /** Quick add: the items currently below their alert level ({n} added). */
  onAddLowStock?: () => Promise<number>;
  /** Which location the low-stock quick add reads (shown on the chip). */
  lowStockLocationId?: string;
  onLowStockLocationChange?: (id: string) => void;
  presetBusy?: boolean;
  /** May this user type a selling price on the count sheet? */
  canEditSellPrice?: boolean;
  /** May this user type per-line costs / selling prices on the restock? */
  canEditPrice?: boolean;
  /**
   * Hosted inside a modal (the product page's Adjust): the action bar sits in the
   * flow instead of pinned to the window, and the confirm step and scanner render
   * inline rather than as a second overlay.
   */
  embedded?: boolean;
}

const productName = (p?: StockSheetProduct | null) =>
  p ? `${p.brand ?? ""} ${p.baseName ?? ""}`.trim() : "";

/** Quantities are whole numbers; anything else the user types is dropped. */
const digitsOnly = (value: string) => value.replace(/[^0-9]/g, "");

/**
 * The location columns a newly added item starts on: the user's own when their role
 * is bound to one, otherwise every location they may work at. Extra columns are
 * harmless — a cell nobody types in is never submitted — and one chip click
 * removes one. Shared with the pages, which need the same rule for a scan.
 */
export function defaultLocationColumns(
  locations: { id: number }[],
  boundLocationId?: string | null,
): string[] {
  const bound = boundLocationId ? String(boundLocationId) : "";
  if (bound && locations.some((l) => String(l.id) === bound)) return [bound];
  return locations.map((l) => String(l.id));
}

/**
 * The columns a low-stock starter opens an item on: every location where the report
 * says that item — or one of the variants being added from it — is below its alert
 * level, falling back to the scope the sheet is reading low stock from.
 */
export function lowStockColumns(
  row: {
    locationIds?: number[];
    variants?: { variantId?: number | null; locationIds?: number[] }[];
  },
  wantedVariantIds: number[],
  fallback: string,
): string[] {
  const wanted = new Set(wantedVariantIds.map(Number));
  const variantLocations = (row.variants ?? [])
    .filter(
      (v) =>
        wanted.size === 0 || wanted.has(Number(v.variantId)),
    )
    .flatMap((v) => v.locationIds ?? []);
  const ids = [...(row.locationIds ?? []), ...variantLocations].filter(
    (id) => Number.isFinite(id) && id > 0,
  );
  const columns = Array.from(new Set(ids.map(String)));
  return columns.length ? columns : [fallback].filter(Boolean);
}

/**
 * One cell: what the user typed for this item at this location. The on-hand
 * number sits underneath so a wrong count is obvious without another screen, and
 * the before → after pair appears as soon as the cell is touched.
 */
function QtyCell({
  sheet,
  kind,
  productId,
  variantId,
  locationId,
  focusKey,
  onFocused,
}: {
  sheet: Sheet;
  kind: "in" | "count";
  productId: number;
  variantId: string;
  locationId: string;
  focusKey?: string | null;
  onFocused?: () => void;
}) {
  const { t } = useTranslation();
  const row: StockSheetRow | undefined = sheet.rowFor(
    productId,
    variantId,
    locationId,
  );
  const value = row?.counted ?? "";
  const system = sheet.systemFor({
    productId: String(productId),
    variantId,
    locationId,
  });
  const error = row ? sheet.rowErrors[row.key] : undefined;
  const touched = row?.touched === true && value !== "";
  const delta = touched ? Number(value) - system : null;
  const inputId = `cell-${productId}-${variantId || "base"}-${locationId}`;

  useEffect(() => {
    if (focusKey && focusKey === inputId) {
      document.getElementById(inputId)?.focus();
      onFocused?.();
    }
  }, [focusKey, inputId, onFocused]);

  return (
    <div>
      <input
        id={inputId}
        inputMode="numeric"
        value={value}
        onChange={(e) =>
          sheet.setCounted(
            String(productId),
            variantId,
            locationId,
            digitsOnly(e.target.value),
          )
        }
        placeholder={String(system)}
        className={`w-20 border rounded-lg px-2 py-1.5 text-right text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
          error
            ? "border-red-400 bg-red-50"
            : touched
              ? "border-blue-400 bg-blue-50/50"
              : "border-gray-300"
        }`}
      />
      <div className="text-[10px] leading-tight mt-0.5 whitespace-nowrap">
        {error ? (
          <span className="text-red-600">{error}</span>
        ) : delta !== null ? (
          <span
            className={
              delta === 0
                ? "text-gray-400"
                : delta > 0
                  ? "text-green-600"
                  : "text-red-600"
            }
          >
            {system} → {value}
          </span>
        ) : kind === "count" ? (
          <span className="text-gray-400">
            {t("sc.onHand", { count: system })}
          </span>
        ) : (
          <span className="text-transparent">·</span>
        )}
      </div>
    </div>
  );
}

export default function StockProductSheet({
  sheet,
  kind,
  locations,
  products = [],
  productsBusy,
  categories = [],
  boundLocationId = null,
  note,
  onNoteChange,
  saving,
  onSave,
  onScanCode,
  onAddLowStock,
  lowStockLocationId = "",
  onLowStockLocationChange,
  presetBusy,
  canEditSellPrice = false,
  canEditPrice = false,
  embedded = false,
}: StockProductSheetProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const isCount = kind === "count";
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  /** The category chosen on each card (keyed by product id). */
  const [cardCategory, setCardCategory] = useState<Record<number, string>>({});
  /** Cards added but not yet given a product ("Add item" duplicates the card). */
  const [drafts, setDrafts] = useState<{ key: string; categoryId: string }[]>([
    { key: "d0", categoryId: "" },
  ]);

  // The sheet can ask for one cell to be focused (a scan, or the item the modal
  // was opened on).
  useEffect(() => {
    if (!sheet.focusCell) return;
    const [productId, variantId, locationId] = sheet.focusCell.split("|");
    if (!productId || !locationId) return;
    setFocusKey(`cell-${productId}-${variantId || "base"}-${locationId}`);
    sheet.setFocusCell(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet.focusCell]);

  const locationName = useCallback(
    (id: string | number) =>
      locations.find((l) => String(l.id) === String(id))?.name ?? "",
    [locations],
  );

  /**
   * The locations a newly added item starts on: the user's own when their role is
   * bound to one, otherwise every location they may work at. Extra columns are
   * harmless — a cell nobody types in is never submitted.
   */
  const defaultColumns = useMemo(
    () => defaultLocationColumns(locations, boundLocationId),
    [boundLocationId, locations],
  );

  /** The product that belongs to one card (both selects are inside the card). */
  const addToSheet = useCallback(
    (productId: string) => {
      const product = products.find((p) => String(p.id) === productId);
      if (!product) return;
      if (!defaultColumns.length) {
        toast.error(t("sc.pickLocationFirst"));
        return;
      }
      sheet.addProduct(product, defaultColumns);
    },
    [products, defaultColumns, sheet, t, toast],
  );

  /** Picking a product on a card: the card fills in with its locations. */
  const handlePickProduct = (
    productId: string,
    draftKey?: string,
  ) => {
    addToSheet(productId);
    if (draftKey) {
      setDrafts((prev) => prev.filter((d) => d.key !== draftKey));
    }
  };

  /** Choosing another product on a filled card swaps it for the new one. */
  const handleReplaceProduct = async (currentId: number, productId: string) => {
    if (String(currentId) === productId) return;
    const ok = await confirm(t("sc.replaceItemConfirm"));
    if (!ok) return;
    sheet.removeProduct(currentId);
    addToSheet(productId);
  };

  /** Removing a card is destructive once something was typed in it. */
  const handleRemoveProduct = async (productId: number) => {
    const typed = sheet.rows.some(
      (r) => Number(r.productId) === productId && r.touched && r.counted !== "",
    );
    if (typed) {
      const ok = await confirm(t("sc.removeItemConfirm"));
      if (!ok) return;
    }
    sheet.removeProduct(productId);
  };

  /** The category shown on a card (its own product's, unless changed by hand). */
  const categoryFor = (product: StockSheetProduct) =>
    cardCategory[product.id] ??
    (product.categoryId != null ? String(product.categoryId) : "");

  /**
   * The products a card's picker offers: the chosen category's items, with items
   * already on other cards disabled (one card per product).
   */
  const productOptionsFor = (categoryId: string, selfId?: number) =>
    products
      .filter(
        (p) => !categoryId || String(p.categoryId) === String(categoryId),
      )
      .map((p) => ({
        value: String(p.id),
        label: `${productName(p)}${p.sku ? ` · ${p.sku}` : ""}`,
        searchText: `${p.brand ?? ""} ${p.baseName ?? ""} ${p.sku ?? ""}`,
        disabled:
          p.id !== selfId && sheet.groups.some((g) => g.productId === p.id),
      }));

  const categoryOptions = (
    <>
      <option value="">{t("common.all")}</option>
      {categories.map((c) => (
        <option key={c.id} value={String(c.id)}>
          {c.name}
        </option>
      ))}
    </>
  );

  /** Scan-to-add: the resolved cell gets the focus so counting can continue. */
  const handleScan = async (code: string) => {
    if (!onScanCode) return;
    const key = await onScanCode(code);
    if (!key) {
      toast.error(t("sc.scanUnknown", { code }));
      return;
    }
    const [productId, variantId, locationId] = key.split("|");
    setFocusKey(`cell-${productId}-${variantId}-${locationId}`);
  };

  const handlePreset = async (fn?: () => Promise<number>) => {
    if (!fn) return;
    const count = await fn();
    if (count > 0) toast.success(t("sc.presetAdded", { count }));
    else toast.error(t("sc.presetNone"));
  };

  /** What the confirm step shows: one line per location about to be touched. */
  const summary = useMemo(() => {
    const map = new Map<
      string,
      { name: string; cells: number; units: number; zeros: number }
    >();
    for (const row of sheet.touchedRows) {
      const acc =
        map.get(row.locationId) ??
        { name: locationName(row.locationId), cells: 0, units: 0, zeros: 0 };
      const counted = Number(row.counted);
      acc.cells += 1;
      acc.units += isCount ? counted - sheet.systemFor(row) : counted;
      if (isCount && counted === 0) acc.zeros += 1;
      map.set(row.locationId, acc);
    }
    return Array.from(map.values());
  }, [sheet, isCount, locationName]);

  const touchedCount = sheet.touchedRows.length;
  const totals = sheet.totals;
  const showCost = !isCount && canEditPrice;
  const showSell = isCount ? canEditSellPrice : canEditPrice;
  const hasZeroWarning = summary.some((s) => s.zeros > 0);

  /** The confirm step's body — a panel inside a modal, a dialog on a page. */
  const confirmPanel = (
    <div className="space-y-3 text-sm">
      <p className="text-gray-600">
        {isCount ? t("sc.confirmCount") : t("sc.confirmIn")}
      </p>
      <ul className="space-y-1">
        {summary.map((s) => (
          <li
            key={s.name}
            className="flex items-center justify-between gap-3 border-b border-gray-100 pb-1"
          >
            <span className="text-gray-700">{s.name}</span>
            <span className="text-gray-500 text-xs">
              {t("sc.cellsCounted", { count: s.cells })} ·{" "}
              {s.units >= 0 ? `+${s.units}` : s.units} {t("sc.units")}
            </span>
          </li>
        ))}
      </ul>
      {hasZeroWarning && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
          {t("sc.confirmZero")}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={() => setConfirmOpen(false)}
          className="text-sm px-3 py-2 rounded-lg border"
        >
          {t("sc.confirmCancel")}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            setConfirmOpen(false);
            onSave();
          }}
          className={`text-sm px-4 py-2 rounded-lg text-white font-medium disabled:opacity-50 ${
            isCount ? "bg-blue-600" : "bg-green-600"
          }`}
        >
          {isCount ? t("sc.saveCounts") : t("sc.addToStock")}
        </button>
      </div>
    </div>
  );

  const scanner = onScanCode ? (
    <BarcodeScanner
      onScan={(code) => {
        setScannerOpen(false);
        void handleScan(code);
      }}
    />
  ) : null;

  return (
    <div className={embedded ? "space-y-3" : "space-y-4 pb-28"}>
      {/* What this screen does. The two operations must never look alike. */}
      <div
        className={`rounded-xl border p-3 text-sm ${
          isCount
            ? "bg-blue-50 border-blue-200 text-blue-900"
            : "bg-green-50 border-green-200 text-green-900"
        }`}
      >
        <span className="font-semibold mr-1">
          {isCount ? t("sc.nameCount") : t("sc.nameIn")}
        </span>
        {isCount ? t("sc.ruleCount") : t("sc.ruleIn")}
      </div>

      {/* Session note, plus the one quick add that is still useful. */}
      <div className="bg-white rounded-xl border shadow-sm p-3 flex flex-wrap items-center gap-2">
        {onAddLowStock && (
          <>
            <span className="text-[11px] text-gray-500">{t("sc.presets")}</span>
            <button
              type="button"
              disabled={presetBusy}
              onClick={() => void handlePreset(onAddLowStock)}
              className="text-xs px-2.5 py-1 rounded-full border border-amber-300 bg-amber-50 text-amber-800 disabled:opacity-50"
            >
              {t("sc.presetLowStock")}
              {" · "}
              {lowStockLocationId
                ? locationName(lowStockLocationId)
                : t("sc.allLocations")}
            </button>
            {locations.length > 1 && onLowStockLocationChange && (
              <select
                value={lowStockLocationId}
                onChange={(e) => onLowStockLocationChange(e.target.value)}
                title={t("sc.lowStockScope")}
                className="border rounded-lg px-2 py-1 text-xs bg-white"
              >
                <option value="">{t("sc.allLocations")}</option>
                {locations.map((l) => (
                  <option key={l.id} value={String(l.id)}>
                    {l.name}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
        <span className="flex-1" />
        <label className="text-[11px] text-gray-500">
          {isCount ? t("sc.reason") : t("sc.vendor")}
        </label>
        <input
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder={t("sc.reasonPlaceholder")}
          className="border rounded-lg px-2 py-1 text-sm w-full sm:w-56"
        />
      </div>

      {sheet.groups.length === 0 ? (
        <p className="text-xs text-gray-500 px-1">
          {isCount ? t("sc.noRowsCount") : t("sc.noRowsIn")}
        </p>
      ) : null}

      {sheet.groups.map((group) => {
        const product = group.product;
        if (!product) return null;
        const columns = group.locationIds;
        const variantIds = product.hasVariants ? group.variantIds : [""];
        const variantOf = (variantId: string) =>
          (product.variants ?? []).find((v) => String(v.id) === variantId);
        const variantName = (variantId: string) => {
          if (!variantId) return t("sc.base");
          const variant = variantOf(variantId);
          return variant ? variantLabel(variant) : `#${variantId}`;
        };
        const baseSell = product.currentSellPrice ?? 0;
        const baseBuy = product.currentBuyPrice ?? 0;

        return (
          <div
            key={product.id}
            className="bg-white rounded-xl border shadow-sm overflow-hidden"
          >
            <div className="p-3 border-b bg-gray-50 space-y-2">
              <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                <div className="w-full sm:w-44">
                  <label className="block text-[11px] text-gray-500 mb-1">
                    {t("products.category")}
                  </label>
                  <select
                    value={categoryFor(product)}
                    onChange={(e) =>
                      setCardCategory((prev) => ({
                        ...prev,
                        [product.id]: e.target.value,
                      }))
                    }
                    className="border p-2 rounded-lg w-full bg-white text-sm"
                  >
                    {categoryOptions}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-[11px] text-gray-500 mb-1">
                    {t("sc.item")}
                  </label>
                  <SearchableSelect
                    options={productOptionsFor(categoryFor(product), product.id)}
                    value={String(product.id)}
                    onChange={(value) =>
                      void handleReplaceProduct(product.id, value)
                    }
                    placeholder={
                      productsBusy
                        ? t("sc.searching")
                        : t("restock.searchProduct")
                    }
                    clearable
                    clearLabel={t("common.clearField")}
                    className="w-full"
                  />
                </div>
                {onScanCode && (
                  <button
                    type="button"
                    onClick={() => setScannerOpen(true)}
                    className="shrink-0 border rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                  >
                    📷 {t("sc.scan")}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-gray-500">
                  {product.sku ?? ""}
                  {product.isPerishable ? ` · ${t("sc.perishable")}` : ""}
                </span>
                <span className="flex items-center gap-2 text-[11px]">
                  {isCount && (
                    <>
                      <button
                        type="button"
                        onClick={() => sheet.prefillFromOnHand([product.id])}
                        className="text-blue-700 hover:underline"
                      >
                        {t("sc.fillCurrent")}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          variantIds.forEach((v) =>
                            columns.forEach((l) =>
                              sheet.setCounted(String(product.id), v, l, ""),
                            ),
                          )
                        }
                        className="text-gray-600 hover:underline"
                      >
                        {t("sc.clearCard")}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleRemoveProduct(product.id)}
                    className="text-red-600 hover:underline"
                    title={t("sc.removeProduct")}
                  >
                    ✕
                  </button>
                </span>
              </div>
            </div>

            {/* Which locations this item is being worked on. */}
            <div className="flex flex-wrap items-center gap-1 px-3 pt-2">
              <span className="text-[11px] text-gray-500">
                {t("sc.locationsForItem")}
              </span>
              {locations.map((loc) => {
                const on = columns.includes(String(loc.id));
                return (
                  <button
                    key={loc.id}
                    type="button"
                    onClick={() => sheet.toggleProductLocation(product, loc.id)}
                    className={`text-[11px] px-2 py-0.5 rounded-full border ${
                      on
                        ? "bg-blue-600 border-blue-600 text-white"
                        : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {loc.name}
                  </button>
                );
              })}
            </div>

            <div className="p-3 overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-gray-500 text-left">
                    {product.hasVariants && (
                      <th className="p-1 font-medium">{t("sc.colVariant")}</th>
                    )}
                    {columns.map((locationId) => (
                      <th key={locationId} className="p-1 font-medium">
                        {locationName(locationId)}
                      </th>
                    ))}
                    {showCost && (
                      <th className="p-1 font-medium">{t("sc.colBuyPrice")}</th>
                    )}
                    {showSell && (
                      <th className="p-1 font-medium">{t("sc.colSellPrice")}</th>
                    )}
                    {!isCount && product.isPerishable && (
                      <>
                        <th className="p-1 font-medium">
                          {t("sc.batchNumber")}
                        </th>
                        <th className="p-1 font-medium">{t("sc.expiry")}</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {variantIds.map((variantId) => {
                    const variant = variantOf(variantId);
                    return (
                      <tr
                        key={variantId || "base"}
                        className="border-t border-gray-100 align-top"
                      >
                        {product.hasVariants && (
                          <td className="p-1 text-xs text-gray-600 whitespace-nowrap">
                            {variantName(variantId)}
                          </td>
                        )}
                        {columns.map((locationId) => (
                          <td key={locationId} className="p-1">
                            <QtyCell
                              sheet={sheet}
                              kind={kind}
                              productId={product.id}
                              variantId={variantId}
                              locationId={locationId}
                              focusKey={focusKey}
                              onFocused={() => setFocusKey(null)}
                            />
                          </td>
                        ))}
                        {showCost && (
                          <td className="p-1">
                            <input
                              type="number"
                              inputMode="decimal"
                              step="0.01"
                              min="0"
                              value={sheet.variantFieldFor(
                                product.id,
                                variantId,
                                "buyPrice",
                              )}
                              onChange={(e) =>
                                sheet.setVariantField(
                                  product.id,
                                  variantId,
                                  "buyPrice",
                                  e.target.value,
                                )
                              }
                              placeholder={String(variant?.buyPrice ?? baseBuy)}
                              className="w-24 border rounded-lg px-2 py-1.5 text-right text-sm"
                            />
                          </td>
                        )}
                        {showSell && (
                          <td className="p-1">
                            <input
                              type="number"
                              inputMode="decimal"
                              step="0.01"
                              min="0"
                              value={sheet.variantFieldFor(
                                product.id,
                                variantId,
                                "sellPrice",
                              )}
                              onChange={(e) =>
                                sheet.setVariantField(
                                  product.id,
                                  variantId,
                                  "sellPrice",
                                  e.target.value,
                                )
                              }
                              placeholder={String(variant?.sellPrice ?? baseSell)}
                              className="w-24 border rounded-lg px-2 py-1.5 text-right text-sm"
                            />
                            {isCount && (
                              <div className="text-[10px] text-gray-400 mt-0.5">
                                {t("sc.keepPrice")}
                              </div>
                            )}
                          </td>
                        )}
                        {!isCount && product.isPerishable && (
                          <>
                            <td className="p-1">
                              <input
                                value={sheet.variantFieldFor(
                                  product.id,
                                  variantId,
                                  "batchNumber",
                                )}
                                onChange={(e) =>
                                  sheet.setVariantField(
                                    product.id,
                                    variantId,
                                    "batchNumber",
                                    e.target.value,
                                  )
                                }
                                placeholder={t("sc.batchNumber")}
                                className="w-28 border rounded-lg px-2 py-1.5 text-sm"
                              />
                            </td>
                            <td className="p-1">
                              <input
                                type="date"
                                value={sheet.variantFieldFor(
                                  product.id,
                                  variantId,
                                  "expiryDate",
                                )}
                                onChange={(e) =>
                                  sheet.setVariantField(
                                    product.id,
                                    variantId,
                                    "expiryDate",
                                    e.target.value,
                                  )
                                }
                                title={t("sc.expiry")}
                                className="w-36 border rounded-lg px-2 py-1.5 text-sm"
                              />
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-[10px] text-gray-400 mt-2">
                {isCount ? t("sc.prefillHint") : t("sc.inHint")}
              </p>
            </div>
          </div>
        );
      })}

      {/* An item card with nothing chosen yet — "Add item" duplicates this shape. */}
      {drafts.map((draft) => (
        <div
          key={draft.key}
          className="bg-white rounded-xl border shadow-sm p-3 space-y-2"
        >
          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="w-full sm:w-44">
              <label className="block text-[11px] text-gray-500 mb-1">
                {t("products.category")}
              </label>
              <select
                value={draft.categoryId}
                onChange={(e) =>
                  setDrafts((prev) =>
                    prev.map((d) =>
                      d.key === draft.key
                        ? { ...d, categoryId: e.target.value }
                        : d,
                    ),
                  )
                }
                className="border p-2 rounded-lg w-full bg-white text-sm"
              >
                {categoryOptions}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-[11px] text-gray-500 mb-1">
                {t("sc.item")}
              </label>
              <SearchableSelect
                options={productOptionsFor(draft.categoryId)}
                value=""
                onChange={(value) => handlePickProduct(value, draft.key)}
                placeholder={
                  productsBusy ? t("sc.searching") : t("restock.searchProduct")
                }
                clearable
                clearLabel={t("common.clearField")}
                className="w-full"
              />
            </div>
            <button
              type="button"
              onClick={() =>
                setDrafts((prev) => prev.filter((d) => d.key !== draft.key))
              }
              className="shrink-0 text-red-400 hover:text-red-600 text-sm px-2 py-2"
              title={t("common.remove")}
            >
              ✕
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() =>
          setDrafts((prev) => [
            ...prev,
            {
              key: `d${Date.now().toString(36)}${prev.length}`,
              categoryId: "",
            },
          ])
        }
        className="w-full border border-dashed border-gray-300 rounded-xl py-3 text-sm text-gray-600 bg-gray-50 hover:bg-white"
      >
        + {t("sc.addItemCard")}
      </button>

      {/* What will be submitted, and the one button that submits it. Inside a modal
          the bar sits in the flow; on a page it is pinned to the bottom. */}
      <div
        className={
          embedded
            ? "bg-white border rounded-xl shadow-sm p-3 flex flex-wrap items-center justify-between gap-3"
            : "fixed bottom-0 left-0 right-0 sm:sticky sm:bottom-0 z-30 bg-white/95 backdrop-blur border-t sm:border sm:rounded-xl shadow-lg p-3 flex flex-wrap items-center justify-between gap-3"
        }
      >
        <div className="text-xs text-gray-600 space-y-0.5">
          <p className="font-medium text-gray-800">
            {isCount
              ? t("sc.totalsCountSummary", {
                  cells: touchedCount,
                  changed: totals.changed,
                })
              : t("sc.totalsInSummary", { items: touchedCount })}
          </p>
          {totals.changed > 0 && (
            <p className="flex flex-wrap gap-3">
              <span>
                <span className="text-gray-500">{t("sc.surplus")}: </span>
                <span className="text-green-700 font-semibold">
                  {fmtCurrency(totals.surplus)}
                </span>
              </span>
              <span>
                <span className="text-gray-500">{t("sc.shortage")}: </span>
                <span className="text-red-600 font-semibold">
                  {fmtCurrency(totals.shortage)}
                </span>
              </span>
              <span>
                <span className="text-gray-500">{t("sc.net")}: </span>
                <span className="font-semibold">{fmtCurrency(totals.net)}</span>
              </span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <button
            type="button"
            disabled={saving || touchedCount === 0}
            onClick={() => setConfirmOpen(true)}
            className={`text-sm px-4 py-2 rounded-lg text-white font-medium disabled:opacity-50 ${
              isCount
                ? "bg-blue-600 hover:bg-blue-700"
                : "bg-green-600 hover:bg-green-700"
            }`}
          >
            {saving
              ? t("sc.saving")
              : isCount
                ? t("sc.saveCounts")
                : t("sc.addToStock")}
          </button>
        </div>
      </div>

      {embedded ? (
        confirmOpen ? (
          <div className="bg-white border rounded-xl shadow-sm p-3">
            {confirmPanel}
          </div>
        ) : null
      ) : (
        <Modal
          isOpen={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          title={t("sc.confirmTitle")}
        >
          {confirmPanel}
        </Modal>
      )}

      {onScanCode &&
        (embedded ? (
          <div className="bg-white border rounded-xl shadow-sm p-3">
            {scanner}
          </div>
        ) : (
          <Modal
            isOpen={scannerOpen}
            onClose={() => setScannerOpen(false)}
            title={t("sc.scan")}
          >
            {scanner}
          </Modal>
        ))}
    </div>
  );
}
