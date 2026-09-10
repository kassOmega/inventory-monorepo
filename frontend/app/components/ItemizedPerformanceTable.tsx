"use client";
// Real-time itemized performance matrix: revenue & COGS attributed to the
// exact Product / Variant / Menu item sold (no generic income bucketing).
// Columns: Product/Variant | Category | Units Sold | Total Revenue | Total
// COGS | Gross Profit | Gross Margin %.
import api from "@/lib/api";
import Loading from "./Loading";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";

interface ItemizedRow {
  id: string;
  name: string;
  category: string;
  kind: "VARIANT" | "PRODUCT" | "MENU_ITEM" | "SERVICE";
  unitsSold: number;
  unitSymbol: string;
  revenue: number;
  cogs: number;
  profit: number;
  margin: number;
}

interface ItemizedResponse {
  tenantType: "ITEMIZED";
  rows: ItemizedRow[];
  totals: { revenue: number; cogs: number; profit: number; margin: number };
}

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 2 });

const KIND_BADGE: Record<string, string> = {
  VARIANT: "bg-violet-100 text-violet-800",
  PRODUCT: "bg-blue-100 text-blue-800",
  MENU_ITEM: "bg-emerald-100 text-emerald-800",
  SERVICE: "bg-amber-100 text-amber-800",
};
const KIND_LABEL: Record<string, string> = {
  VARIANT: "fin.kindVariant",
  PRODUCT: "fin.kindProduct",
  MENU_ITEM: "fin.kindMenuItem",
  SERVICE: "fin.kindService",
};

export default function ItemizedPerformanceTable({
  startDate,
  endDate,
  businessType,
  locationId,
}: {
  startDate: string;
  endDate: string;
  businessType?: string | null;
  locationId?: string;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<ItemizedResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const q = new URLSearchParams({
      startDate,
      endDate,
      businessType: businessType ?? "RETAIL",
    });
    if (locationId) q.set("locationId", locationId);
    api
      .get(`/finance/itemized-performance?${q.toString()}`)
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [startDate, endDate, businessType, locationId]);

  if (loading) return <Loading />;
  if (!data) {
    return (
      <div className="bg-white rounded-xl border shadow-sm p-6 text-center text-gray-400 text-sm">
        {t("fin.failedLoad")}
      </div>
    );
  }

  const rows = data.rows ?? [];
  const totals = data.totals ?? { revenue: 0, cogs: 0, profit: 0, margin: 0 };

  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      <div className="px-4 sm:px-6 py-4 border-b">
        <h3 className="text-sm sm:text-base font-semibold text-gray-800">
          {t("fin.itemizedTitle")}
        </h3>
        <p className="text-[11px] sm:text-xs text-gray-400 mt-0.5">
          {t("fin.itemizedHint")}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left min-w-[720px] text-xs sm:text-sm">
          <thead className="bg-gray-50 border-b text-[10px] sm:text-xs uppercase text-gray-400">
            <tr>
              <th className="p-2 sm:p-3">{t("fin.colProductVariant")}</th>
              <th className="p-2 sm:p-3">{t("fin.colCategory")}</th>
              <th className="p-2 sm:p-3 text-right">{t("fin.colUnits")}</th>
              <th className="p-2 sm:p-3 text-right">{t("fin.colRevenue")}</th>
              <th className="p-2 sm:p-3 text-right">{t("fin.colCogs")}</th>
              <th className="p-2 sm:p-3 text-right">{t("fin.colProfit")}</th>
              <th className="p-2 sm:p-3 text-right">{t("fin.colMargin")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b hover:bg-gray-50">
                <td className="p-2 sm:p-3">
                  <span className="font-medium text-gray-800">{r.name}</span>
                  <span
                    className={`ml-2 inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold align-middle ${
                      KIND_BADGE[r.kind] ?? KIND_BADGE.PRODUCT
                    }`}
                  >
                    {t(KIND_LABEL[r.kind] ?? "fin.kindProduct") ?? r.kind}
                  </span>
                </td>
                <td className="p-2 sm:p-3 text-gray-500">{r.category}</td>
                <td className="p-2 sm:p-3 text-right text-gray-700 whitespace-nowrap">
                  {fmt(r.unitsSold)}
                  {r.unitSymbol ? ` ${r.unitSymbol}` : ""}
                </td>
                <td className="p-2 sm:p-3 text-right text-gray-700 whitespace-nowrap">
                  {fmt(r.revenue)} {t("orders.birr")}
                </td>
                <td className="p-2 sm:p-3 text-right text-gray-500 whitespace-nowrap">
                  -{fmt(r.cogs)} {t("orders.birr")}
                </td>
                <td
                  className={`p-2 sm:p-3 text-right font-semibold whitespace-nowrap ${
                    r.profit >= 0 ? "text-green-700" : "text-red-600"
                  }`}
                >
                  {fmt(r.profit)} {t("orders.birr")}
                </td>
                <td className="p-2 sm:p-3 text-right text-gray-600">
                  {fmt(r.margin)}%
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="p-6 text-center text-gray-400 text-xs sm:text-sm"
                >
                  {t("fin.noItemized")}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 font-semibold text-gray-800">
              <td colSpan={3} className="p-2 sm:p-3">
                {t("orders.totalLabel")}
              </td>
              <td className="p-2 sm:p-3 text-right whitespace-nowrap">
                {fmt(totals.revenue)} {t("orders.birr")}
              </td>
              <td className="p-2 sm:p-3 text-right text-gray-500 whitespace-nowrap">
                -{fmt(totals.cogs)} {t("orders.birr")}
              </td>
              <td
                className={`p-2 sm:p-3 text-right whitespace-nowrap ${
                  totals.profit >= 0 ? "text-green-700" : "text-red-600"
                }`}
              >
                {fmt(totals.profit)} {t("orders.birr")}
              </td>
              <td className="p-2 sm:p-3 text-right">{fmt(totals.margin)}%</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
