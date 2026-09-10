"use client";
// Tenant-aware financial category breakdown.
//  - Hospitality: Meals vs Beverages vs Room Services with sub-category
//    filters (e.g. Beverages -> Beer / Wine / Spirits).
//  - Retail & Distribution: category rows showing Category Revenue vs
//    Category Stock Cost with multi-level drill-down.
import api from "@/lib/api";
import Loading from "./Loading";
import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useState } from "react";

interface BreakdownRow {
  categoryId: number;
  name: string;
  parentId: number | null;
  revenue: number;
  cogs: number;
  profit: number;
  margin: number;
  unitsSold: number;
  stockCost?: number;
  stockQty?: number;
  children?: BreakdownRow[];
}

interface BreakdownResponse {
  tenantType: "PRODUCT_CATEGORY" | "MENU_CATEGORY";
  groups?: {
    groupId: string;
    groupName: string;
    totalRevenue: number;
    totalCogs: number;
    totalProfit: number;
    categories: BreakdownRow[];
  }[];
  categories?: BreakdownRow[];
  totals: {
    revenue: number;
    cogs: number;
    profit: number;
    margin: number;
    stockCost?: number;
    grossProfit?: number;
    overhead?: number;
  };
}

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 2 });

const COLORS = [
  "bg-blue-100 text-blue-800",
  "bg-emerald-100 text-emerald-800",
  "bg-amber-100 text-amber-800",
  "bg-violet-100 text-violet-800",
  "bg-rose-100 text-rose-800",
  "bg-cyan-100 text-cyan-800",
];

export default function FinancialBreakdown({
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
  const [data, setData] = useState<BreakdownResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [parentFilter, setParentFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const isInventory =
    businessType === "RETAIL" || businessType === "MANUFACTURING";

  useEffect(() => {
    setLoading(true);
    const q = new URLSearchParams({
      startDate,
      endDate,
      businessType: businessType ?? "RETAIL",
    });
    if (parentFilter) q.set("parentCategoryId", parentFilter);
    if (locationId) q.set("locationId", locationId);
    api
      .get(`/finance/category-breakdown?${q.toString()}`)
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [startDate, endDate, businessType, parentFilter, locationId]);

  const topCategories = data?.categories ?? [];

  // Parent filter options: top-level categories that have children.
  const parentOptions = useMemo(() => {
    const walk = (rows: BreakdownRow[]): BreakdownRow[] =>
      rows.flatMap((r) =>
        r.children?.length ? [r, ...walk(r.children)] : [],
      );
    return walk(topCategories).filter((c) => c.children?.length);
  }, [topCategories]);

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const renderRow = (row: BreakdownRow, depth: number) => {
    const hasChildren = (row.children?.length ?? 0) > 0;
    const isOpen = expanded.has(row.categoryId);
    return (
      <tbody key={row.categoryId}>
        <tr className="border-b hover:bg-gray-50">
          <td
            className="p-2 sm:p-3"
            style={{ paddingLeft: `${12 + depth * 20}px` }}
          >
            <div className="flex items-center gap-1.5">
              {hasChildren && (
                <button
                  onClick={() => toggle(row.categoryId)}
                  className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                >
                  {isOpen ? "▾" : "▸"}
                </button>
              )}
              <span className="font-medium text-gray-800">{row.name}</span>
              {row.parentId != null && (
                <span className="text-[9px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                  {t("fin.bdSub")}
                </span>
              )}
            </div>
          </td>
          <td className="p-2 sm:p-3 text-right text-gray-700">{fmt(row.revenue)}</td>
          <td className="p-2 sm:p-3 text-right text-gray-700">{fmt(row.cogs)}</td>
          <td className="p-2 sm:p-3 text-right font-semibold text-gray-800">{fmt(row.profit)}</td>
          <td className="p-2 sm:p-3 text-right">
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                row.margin >= 20
                  ? "bg-emerald-100 text-emerald-700"
                  : row.margin >= 5
                    ? "bg-amber-100 text-amber-700"
                    : "bg-red-100 text-red-700"
              }`}
            >
              {fmt(row.margin)}%
            </span>
          </td>
          {isInventory && (
            <td className="p-2 sm:p-3 text-right text-gray-700">{fmt(row.stockCost)}</td>
          )}
        </tr>
        {isOpen &&
          hasChildren &&
          (row.children ?? []).map((c) => renderRow(c, depth + 1))}
      </tbody>
    );
  };

  if (loading) return <Loading className="py-16" />;
  if (!data) {
    return (
      <div className="bg-white rounded-xl border shadow-sm p-6 text-center text-sm text-gray-400">
        {t("fin.bdNoFinance")}
      </div>
    );
  }

  const totals = data.totals;

  return (
    <div className="space-y-5">
      {/* Totals strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border shadow-sm p-3 sm:p-4">
          <p className="text-[10px] sm:text-[11px] font-medium text-gray-500 uppercase">{t("fin.bdRevenue")}</p>
          <p className="text-base sm:text-lg font-bold text-gray-800 mt-1">{fmt(totals.revenue)} {t("orders.birr")}</p>
        </div>
        <div className="bg-white rounded-xl border shadow-sm p-3 sm:p-4">
          <p className="text-[10px] sm:text-[11px] font-medium text-gray-500 uppercase">{t("fin.bdCogs")}</p>
          <p className="text-base sm:text-lg font-bold text-gray-800 mt-1">{fmt(totals.cogs)} {t("orders.birr")}</p>
        </div>
        <div className="bg-white rounded-xl border shadow-sm p-3 sm:p-4">
          <p className="text-[10px] sm:text-[11px] font-medium text-gray-500 uppercase">{t("fin.bdGrossProfit")}</p>
          <p className="text-base sm:text-lg font-bold text-emerald-700 mt-1">{fmt(totals.profit ?? totals.grossProfit)} {t("orders.birr")}</p>
        </div>
        <div className="bg-white rounded-xl border shadow-sm p-3 sm:p-4">
          <p className="text-[10px] sm:text-[11px] font-medium text-gray-500 uppercase">{t("fin.bdMargin")}</p>
          <p className="text-base sm:text-lg font-bold text-gray-800 mt-1">{fmt(totals.margin)}%</p>
        </div>
        {isInventory && totals.stockCost != null && (
          <div className="bg-white rounded-xl border shadow-sm p-3 sm:p-4 sm:col-span-4">
            <p className="text-[10px] sm:text-[11px] font-medium text-gray-500 uppercase">
              {t("fin.bdStockCost")}
            </p>
            <p className="text-base sm:text-lg font-bold text-blue-700 mt-1">{fmt(totals.stockCost)} {t("orders.birr")}</p>
          </div>
        )}
      </div>

      {/* Sub-category filter */}
      {parentOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 font-medium">{t("fin.bdDeepFilter")}</span>
          <button
            onClick={() => setParentFilter("")}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium ${
              parentFilter === ""
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {t("common.all")}
          </button>
          {parentOptions.map((c) => (
            <button
              key={c.categoryId}
              onClick={() => setParentFilter(String(c.categoryId))}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium ${
                parentFilter === String(c.categoryId)
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      {/* Hospitality groups */}
      {data.tenantType === "MENU_CATEGORY" && data.groups && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {data.groups.map((g, i) => (
            <div
              key={g.groupId}
              className="bg-white rounded-xl border shadow-sm overflow-hidden"
            >
              <div className={`px-4 py-3 ${COLORS[i % COLORS.length]}`}>
                <p className="text-xs font-semibold uppercase tracking-wide">
                  {g.groupName}
                </p>
                <p className="text-lg font-bold mt-0.5">{fmt(g.totalRevenue)} {t("orders.birr")}</p>
                <p className="text-[11px] opacity-80">
                  {t("fin.bdCOGSProfit", { cogs: fmt(g.totalCogs), profit: fmt(g.totalProfit) })}
                </p>
              </div>
              <ul className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
                {(g.categories ?? []).map((c) => (
                  <li
                    key={c.categoryId}
                    className="px-4 py-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <button
                        onClick={() => toggle(c.categoryId)}
                        className="w-4 h-4 flex items-center justify-center text-gray-400"
                      >
                        {(c.children?.length ?? 0) > 0
                          ? expanded.has(c.categoryId)
                            ? "▾"
                            : "▸"
                          : "•"}
                      </button>
                      <span className="text-sm text-gray-700 truncate">{c.name}</span>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-gray-800">{fmt(c.revenue)}</p>
                      <p className="text-[10px] text-gray-400">
                        {t("fin.bdCOGSMargin", { cogs: fmt(c.cogs), margin: fmt(c.margin) })}
                      </p>
                    </div>
                  </li>
                ))}
                {(g.categories ?? []).length === 0 && (
                  <li className="px-4 py-3 text-sm text-gray-400">
                    {t("fin.bdNoGroupData")}
                  </li>
                )}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Retail / inventory table */}
      {data.tenantType === "PRODUCT_CATEGORY" && (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-gray-50 border-b text-[10px] sm:text-xs uppercase text-gray-400">
              <tr>
                <th className="p-2 sm:p-3">{t("fin.bdColCategory")}</th>
                <th className="p-2 sm:p-3 text-right">{t("fin.bdRevenue")}</th>
                <th className="p-2 sm:p-3 text-right">{t("fin.bdCogs")}</th>
                <th className="p-2 sm:p-3 text-right">{t("fin.bdGrossProfit")}</th>
                <th className="p-2 sm:p-3 text-right">{t("fin.bdMargin")}</th>
                <th className="p-2 sm:p-3 text-right">{t("fin.bdColStockCost")}</th>
              </tr>
            </thead>
            {topCategories.map((c) => renderRow(c, 0))}
            {topCategories.length === 0 && (
              <tbody>
                <tr>
                  <td
                    colSpan={isInventory ? 6 : 5}
                    className="p-6 text-center text-gray-400 text-xs sm:text-sm"
                  >
                    {t("fin.bdNoCategorySales")}
                  </td>
                </tr>
              </tbody>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

