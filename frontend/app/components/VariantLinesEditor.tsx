"use client";
// Shared "pick a product once, then add only the variants you are selling /
// requesting" editor used by the Sales POS, the Credit-sale form and the
// Request-from-Store form. Each added variant is one line with its own
// quantity (and unit price unless hidePrice is set). Variants that are not
// added are simply not sold/requested. Helpers are pure so callers can reuse
// them for barcode scanning, totals and payload building.
import { useTranslation } from "react-i18next";
import { variantLabel } from "@/lib/variantLabel";

export interface VariantSaleLine {
  variantId: string;
  quantity: number;
  customPrice: string;
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
  className = "",
}: Props) {
  const { t } = useTranslation();
  const variants: any[] = product?.variants ?? [];
  if (variants.length === 0) return null;

  const chosenIds = new Set(lines.map((l) => l.variantId));
  const remaining = variants.filter((v) => !chosenIds.has(String(v.id)));
  const stockFor = (variantId: string | number) =>
    variantStockFor(product, variantId);
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
        const stock = stockFor(v.id);
        const extra = originalByVariant[String(v.id)] ?? 0;
        const allowed = stock + extra;
        const over = !allowOutOfStock && line.quantity > allowed;
        const price = variantUnitPrice(product, line);
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
                      min="1"
                      value={line.quantity}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        onChange(
                          setVariantLineQty(
                            lines,
                            line.variantId,
                            Number.isNaN(n) || n < 1 ? 1 : n,
                          ),
                        );
                      }}
                      className={
                        "w-10 sm:w-16 border p-1.5 rounded text-center text-sm " +
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
                  </div>
                  {!hideStock && (
                    <span
                      className={
                        "block mt-1 text-[10px] " +
                        (over ? "text-red-500 font-semibold" : "text-gray-400")
                      }
                    >
                      {t("sv.stock")}: {stock}
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
            const stock = stockFor(v.id);
            const extra = originalByVariant[String(v.id)] ?? 0;
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
