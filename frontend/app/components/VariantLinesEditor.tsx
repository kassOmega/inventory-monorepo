"use client";
// Shared "pick a product once, then add only the variants you are selling /
// requesting" editor used by the Sales POS, the Credit-sale form and the
// Request-from-Store form. Each added variant is one line with its own
// quantity (and unit price unless hidePrice is set). Variants that are not
// added are simply not sold/requested. Helpers are pure so callers can reuse
// them for barcode scanning, totals and payload building.
import { useTranslation } from "react-i18next";
import { stockPerUnit } from "@/lib/unit-stock";
import { formatStockQuantity } from "@/lib/unit-display";
import { variantLabel } from "@/lib/variantLabel";

export interface VariantSaleLine {
  variantId: string;
  quantity: number;
  customPrice: string;
  /** Selected unit for stock requests (quantity stays in stock units). */
  unitId?: string;
}

interface Props {
  product: any;
  lines: VariantSaleLine[];
  onChange: (lines: VariantSaleLine[]) => void;
  /** Hide the per-variant unit price (used when requesting stock). */
  hidePrice?: boolean;
  /** Allow adding lines even when the variant shows 0 stock (stock requests). */
  allowOutOfStock?: boolean;
  /** Hide per-variant stock captions/counts (used when restocking). */
  hideStock?: boolean;
  /** While editing a sale: original quantities already on the sale per variant
   *  (keyed by variant id), so allowed max = current stock + original. */
  originalByVariant?: Record<string, number>;
  /** Stock requests: one quantity input + unit selector per variant. */
  quantityUnits?: any[];
  /** Sales: unit selector per variant line, defaulting to the base unit. */
  unitOptions?: any[];
  /** Sales: product view normalized for one variant line's selected unit. */
  productForUnit?: (unit: any) => any;
  /** Sales edit mode: original quantities (in stock units) for one unit. */
  originalForUnit?: (unit: any) => Record<string, number>;
  className?: string;
}

/** Unit price that applies to a variant when no custom price is entered. */
export function variantDefaultPrice(product: any, variant: any): string {
  const base = Number(product?.currentSellPrice) || 0;
  const price = Number(variant?.sellPrice) || base;
  return price ? String(price) : "";
}

/** Per-variant on-hand stock from the product's location-scoped inventory. */
export function variantStockFor(
  product: any,
  variantId: string | number,
): number {
  const id = Number(variantId);
  if (!product?.inventory || !id) return 0;
  return (product.inventory as any[]).reduce(
    (sum, inv) => (inv?.variantId === id ? sum + (inv.quantity ?? 0) : sum),
    0,
  );
}

export function defaultVariantLine(
  product: any,
  variant: any,
): VariantSaleLine {
  return {
    variantId: String(variant.id),
    quantity: 1,
    customPrice: variantDefaultPrice(product, variant),
  };
}

export function addOrBumpVariantLine(
  lines: VariantSaleLine[],
  line: VariantSaleLine,
): VariantSaleLine[] {
  const found = lines.find((l) => l.variantId === line.variantId);
  if (found) {
    return lines.map((l) =>
      l.variantId === line.variantId
        ? { ...l, quantity: l.quantity + 1 }
        : l,
    );
  }
  return [...lines, line];
}

export function setVariantLineQty(
  lines: VariantSaleLine[],
  variantId: string,
  quantity: number,
): VariantSaleLine[] {
  return lines.map((l) =>
    l.variantId === variantId ? { ...l, quantity } : l,
  );
}

export function setVariantLinePrice(
  lines: VariantSaleLine[],
  variantId: string,
  customPrice: string,
): VariantSaleLine[] {
  return lines.map((l) =>
    l.variantId === variantId ? { ...l, customPrice } : l,
  );
}

export function removeVariantLine(
  lines: VariantSaleLine[],
  variantId: string,
): VariantSaleLine[] {
  return lines.filter((l) => l.variantId !== variantId);
}

/** Effective unit price of a variant line (custom price or default). */
export function variantUnitPrice(product: any, line: VariantSaleLine): number {
  if (!product) return 0;
  const v = (product.variants ?? []).find(
    (x: any) => x.id === Number(line.variantId),
  );
  const custom = Number(line.customPrice);
  if (custom) return custom;
  const base = Number(product.currentSellPrice) || 0;
  return Number(v?.sellPrice) || base;
}

export default function VariantLinesEditor({
  product,
  lines,
  onChange,
  hidePrice = false,
  allowOutOfStock = false,
  hideStock = false,
  originalByVariant = {},
  quantityUnits = [],
  unitOptions = [],
  productForUnit,
  originalForUnit,
  className = "",
}: Props) {
  const { t } = useTranslation();
  const variants: any[] = product?.variants ?? [];
  if (variants.length === 0) return null;

  const chosenIds = new Set(lines.map((l) => l.variantId));
  const remaining = variants.filter((v) => !chosenIds.has(String(v.id)));
  // Sale lines are expressed in the selected unit, so never show a fractional
  // stock caption such as 93.333… after summing location rows.
  const stockFor = (productValue: any, variantId: string | number) =>
    Math.floor(variantStockFor(productValue, variantId));
  const useUnitSelect = quantityUnits.length > 0;
  const quantityBaseUnit =
    quantityUnits.find((u: any) => u.isBase) ?? quantityUnits[0] ?? null;
  const useSaleUnits = unitOptions.length > 0;
  const saleBaseUnit =
    unitOptions.find((u: any) => u.isBase) ?? unitOptions[0] ?? null;
  const baseProduct =
    useSaleUnits && productForUnit
      ? productForUnit(saleBaseUnit)
      : product;
  const columns = hidePrice
    ? "sm:grid-cols-[minmax(0,1fr)_auto_auto]"
    : "sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]";

  return (
    <div className={"rounded-lg border border-gray-200 bg-white p-2.5 " + className}>
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
        {t("sv.variant")}
      </p>

      {lines.map((line) => {
        const v = variants.find((x) => x.id === Number(line.variantId));
        if (!v) return null;
        const saleUnit =
          unitOptions.find(
            (u: any) => String(u.unitId) === String(line.unitId),
          ) ?? saleBaseUnit;
        const lineProduct =
          useSaleUnits && productForUnit
            ? productForUnit(saleUnit)
            : product;
        const stock = stockFor(lineProduct, v.id);
        const extraMap =
          useSaleUnits && originalForUnit
            ? originalForUnit(saleUnit)
            : originalByVariant;
        const extra = extraMap[String(v.id)] ?? 0;
        const allowed = stock + extra;
        const over = !allowOutOfStock && line.quantity > allowed;
        const price = variantUnitPrice(lineProduct, line);
        const selectedUnit =
          quantityUnits.find(
            (u: any) => String(u.unitId) === String(line.unitId),
          ) ?? quantityBaseUnit;
        const stockPerSelected = selectedUnit
          ? stockPerUnit(selectedUnit, quantityUnits)
          : 1;
        const displayQuantity = Math.round(
          (line.quantity / stockPerSelected) * 1e6,
        ) / 1e6;
        const updateLine = (patch: Partial<VariantSaleLine>) =>
          onChange(
            lines.map((l) =>
              l.variantId === line.variantId ? { ...l, ...patch } : l,
            ),
          );
        return (
            <div
              key={line.variantId}
              className={
                "flex flex-col gap-2 border-t border-gray-100 py-2.5 first:border-0 first:pt-0 " +
                "sm:grid " +
                columns +
                " sm:gap-x-3 sm:gap-y-0 sm:items-start"
              }
            >
              <div className="min-w-0 flex items-start justify-between gap-2 sm:block">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 break-words">
                    {variantLabel(v)}
                  </p>
                  {v.sku && (
                    <p className="text-[10px] text-gray-400 truncate">
                      SKU: {v.sku}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onChange(removeVariantLine(lines, line.variantId))
                  }
                  className="sm:hidden text-red-400 hover:text-red-600 px-1.5 py-1 text-lg leading-none"
                  title={t("common.remove")}
                  aria-label={t("common.remove")}
                >
                  ×
                </button>
              </div>

              <div
                className={
                  "grid gap-2 sm:contents " +
                  (hidePrice ? "grid-cols-1" : "grid-cols-2")
                }
              >
                <div className="min-w-0">
                  <span className="block text-[10px] font-medium text-gray-500 mb-1">
                    {t("common.qty")}
                  </span>
                  {useUnitSelect ? (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        value={displayQuantity || ""}
                        onChange={(e) => {
                          const entered =
                            Number(e.target.value.replace(/[^0-9]/g, "")) || 0;
                          updateLine({
                            quantity: entered * stockPerSelected,
                            unitId: String(selectedUnit?.unitId ?? ""),
                          });
                        }}
                        className={
                          "w-16 border p-1.5 rounded text-right text-sm tabular-nums " +
                          (over ? "border-red-500 bg-red-50" : "")
                        }
                      />
                      {selectedUnit && (
                        <select
                          value={String(selectedUnit.unitId)}
                          onChange={(e) =>
                            updateLine({ unitId: e.target.value })
                          }
                          className="w-16 rounded border bg-white p-1.5 text-[11px]"
                          aria-label={t("common.unit")}
                        >
                          {quantityUnits.map((u: any) => (
                            <option key={u.unitId} value={u.unitId}>
                              {u.unit?.name ?? u.name ?? u.unitId}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          onChange(
                            setVariantLineQty(
                              lines,
                              line.variantId,
                              Math.max(1, (line.quantity || 1) - 1),
                            ),
                          )
                        }
                        className="border rounded px-1.5 py-1 text-sm leading-none hover:bg-gray-50"
                        aria-label={t("common.qty") + " -1"}
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        value={line.quantity || ""}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const n = parseInt(raw, 10);
                          onChange(
                            setVariantLineQty(
                              lines,
                              line.variantId,
                              raw === "" || Number.isNaN(n)
                                ? 0
                                : Math.max(0, n),
                            ),
                          );
                        }}
                        className={
                          "w-10 sm:w-16 border p-1.5 rounded text-center text-sm tabular-nums " +
                          (over ? "border-red-500 bg-red-50" : "")
                        }
                      />
                      <button
                        type="button"
                        onClick={() =>
                          onChange(
                            setVariantLineQty(
                              lines,
                              line.variantId,
                              (line.quantity || 0) + 1,
                            ),
                          )
                        }
                        className="border rounded px-1.5 py-1 text-sm leading-none hover:bg-gray-50"
                        aria-label={t("common.qty") + " +1"}
                      >
                        +
                      </button>
                      {useSaleUnits && saleUnit && (
                        <select
                          value={String(saleUnit.unitId)}
                          onChange={(e) =>
                            updateLine({
                              unitId: e.target.value,
                              // Let the price re-derive for the newly selected unit.
                              customPrice: "",
                            })
                          }
                          className="w-16 rounded border bg-white p-1.5 text-[11px]"
                          aria-label={t("common.unit")}
                        >
                          {unitOptions.map((u: any) => (
                            <option key={u.unitId} value={u.unitId}>
                              {u.unit?.name ?? u.name ?? u.unitId}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                  {!hideStock && (
                    <span
                      className={
                        "block mt-1 text-[10px] " +
                        (over ? "text-red-500 font-semibold" : "text-gray-400")
                      }
                    >
                      {t("sv.stock")}:{" "}
                      {useUnitSelect
                        ? formatStockQuantity(stock, quantityUnits)
                        : stock}
                    </span>
                  )}
                </div>

                {!hidePrice && (
                  <div className="min-w-0">
                    <span className="block text-[10px] font-medium text-gray-500 mb-1">
                      {t("sv.price")}
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={line.customPrice}
                      placeholder={price ? String(price) : "0.00"}
                      onChange={(e) =>
                        onChange(
                          setVariantLinePrice(
                            lines,
                            line.variantId,
                            e.target.value,
                          ),
                        )
                      }
                      className="w-full sm:w-28 border p-1.5 rounded text-sm"
                    />
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() =>
                  onChange(removeVariantLine(lines, line.variantId))
                }
                className="hidden sm:inline-flex justify-self-center text-red-400 hover:text-red-600 px-1.5 py-1 text-lg leading-none"
                title={t("common.remove")}
                aria-label={t("common.remove")}
              >
                ×
              </button>

              {over && (
                <p className="sm:col-span-full text-[10px] text-red-500 font-medium">
                  {t("sv.overStock", {
                    n: String(allowed),
                    variant: variantLabel(v),
                  })}
                </p>
              )}
            </div>
          );
        })}
      {remaining.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-2">
          {remaining.map((v) => {
            const stock = stockFor(baseProduct, v.id);
            const extraMap =
              useSaleUnits && originalForUnit
                ? originalForUnit(saleBaseUnit)
                : originalByVariant;
            const extra = extraMap[String(v.id)] ?? 0;
            const allowed = stock + extra;
            const out = !allowOutOfStock && allowed <= 0;
            return (
              <button
                key={v.id}
                type="button"
                disabled={out}
                onClick={() =>
                  onChange(
                    addOrBumpVariantLine(
                      lines,
                      defaultVariantLine(product, v),
                    ),
                  )
                }
                className={
                  "text-xs border rounded-full px-2.5 py-1 " +
                  (out
                    ? "text-gray-300 border-gray-100 cursor-not-allowed"
                    : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-blue-50 hover:border-blue-300")
                }
              >
                + {variantLabel(v)}
                {!hideStock && String(stock) !== "" ? " · " + stock : ""}
              </button>
            );
          })}
        </div>
      )}

      {lines.length === 0 && (
        <p className="text-[10px] text-gray-400 pt-1">{t("sv.addHint")}</p>
      )}
    </div>
  );
}
