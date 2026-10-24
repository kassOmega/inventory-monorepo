"use client";
// Responsive per-unit price cards for a product (or one variant). Prices are
// the effective ones: variant override -> product unit override -> base ÷ perBase.
import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { fmtCurrency } from "@/lib/currency";
import { pricePerUnitFromBase } from "@/lib/unit-stock";

export interface ProductUnitPriceRow {
  unitId: number;
  perBase: number;
  isBase?: boolean | null;
  isDefaultSale?: boolean | null;
  sellPrice?: number | null;
  buyPrice?: number | null;
  unit?: { name?: string | null; symbol?: string | null } | null;
  name?: string | null;
}

type VariantUnitPrices = Record<
  string,
  { buyPrice?: number | null; sellPrice?: number | null } | undefined
>;

function Badge({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "blue" | "green" | "indigo";
}) {
  const cls =
    tone === "green"
      ? "bg-emerald-100 text-emerald-700"
      : tone === "indigo"
        ? "bg-indigo-100 text-indigo-700"
        : "bg-blue-100 text-blue-700";
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
    >
      {children}
    </span>
  );
}

export default function ProductUnitPrices({
  units,
  baseSellPrice,
  baseBuyPrice,
  canViewProfit = false,
  variantUnitPrices = null,
  className = "",
}: {
  units: ProductUnitPriceRow[] | null | undefined;
  /** Price for one base unit (product/variant current price). */
  baseSellPrice: number;
  baseBuyPrice?: number | null;
  canViewProfit?: boolean;
  variantUnitPrices?: VariantUnitPrices | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const list = [...(units ?? [])].sort(
    (a, b) => (Number(b.perBase) || 1) - (Number(a.perBase) || 1),
  );
  if (list.length === 0) return null;

  const maxPerBase = Math.max(
    1,
    ...list.map((unit) => Number(unit.perBase) || 1),
  );
  const baseUnit =
    list.find((unit) => unit.isBase) ?? list[list.length - 1] ?? null;
  const baseUnitName = baseUnit?.unit?.name ?? baseUnit?.name ?? "";
  const stockUnitId = list.find(
    (unit) => (Number(unit.perBase) || 1) === maxPerBase,
  )?.unitId;

  return (
    <div
      className={`grid gap-2 whitespace-normal sm:grid-cols-2 lg:grid-cols-3 ${className}`}
    >
      {list.map((unit) => {
        const name = unit.unit?.name ?? unit.name ?? "—";
        const override = variantUnitPrices?.[String(unit.unitId)];
        const sell =
          override?.sellPrice != null
            ? Number(override.sellPrice)
            : unit.sellPrice != null
              ? Number(unit.sellPrice)
              : pricePerUnitFromBase(baseSellPrice, unit);
        const buy =
          override?.buyPrice != null
            ? Number(override.buyPrice)
            : unit.buyPrice != null
              ? Number(unit.buyPrice)
              : baseBuyPrice != null
                ? pricePerUnitFromBase(baseBuyPrice, unit)
                : null;
        const isBase = !!unit.isBase || unit.unitId === baseUnit?.unitId;

        return (
          <div
            key={unit.unitId}
            className={
              "rounded-lg border p-2.5 " +
              (isBase
                ? "border-blue-200 bg-blue-50/40"
                : "border-gray-200 bg-white")
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-1">
              <span className="min-w-0 truncate text-sm font-medium text-gray-800">
                {name}
              </span>
              <span className="flex flex-wrap gap-1">
                {isBase && <Badge tone="blue">{t("pf.baseUnit")}</Badge>}
                {unit.isDefaultSale && (
                  <Badge tone="green">{t("pf.defaultSale")}</Badge>
                )}
                {unit.unitId === stockUnitId && (
                  <Badge tone="indigo">{t("pf.stockUnit")}</Badge>
                )}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-gray-500">
              {isBase
                ? t("pf.baseUnit")
                : `${t("pf.perBase", { unit: baseUnitName })}: ${unit.perBase}`}
            </p>
            <div
              className={
                "mt-1.5 grid gap-1 " +
                (canViewProfit ? "grid-cols-2" : "grid-cols-1")
              }
            >
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400">
                  {t("pf.sellPrice")}
                </p>
                <p className="text-sm font-semibold text-gray-800">
                  {fmtCurrency(sell)}
                </p>
              </div>
              {canViewProfit && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-gray-400">
                    {t("pf.buyPrice")}
                  </p>
                  <p className="text-sm font-semibold text-gray-800">
                    {buy != null ? fmtCurrency(buy) : "—"}
                  </p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
