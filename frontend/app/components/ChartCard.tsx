"use client";

// Reusable card header with a per-card Chart ⇄ Numeric view toggle.
//
// Each card keeps its own local `view` state (chart vs numeric). The toggle sits
// in the top-right of the header using Lucide `BarChart2` (chart) and `Table`
// (numeric) icons. Cards pass their existing chart as `chart` and a numeric
// summary (built with NumericTable / StatGrid) as `numeric`.
import { type ReactNode, useState } from "react";
import { BarChart2, Table } from "lucide-react";
import { useTranslation } from "react-i18next";

export type CardView = "chart" | "numeric";

interface ChartCardProps {
  title: ReactNode;
  chart: ReactNode;
  numeric: ReactNode;
  /** Extra header content shown before the toggle (e.g. a subtitle). */
  headerExtra?: ReactNode;
  defaultView?: CardView;
  className?: string;
  bodyClassName?: string;
}

export default function ChartCard({
  title,
  chart,
  numeric,
  headerExtra,
  defaultView = "chart",
  className = "",
  bodyClassName = "",
}: ChartCardProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<CardView>(defaultView);

  return (
    <div className={`bg-white rounded-xl shadow-sm border p-4 sm:p-6 ${className}`}>
      <div className="flex items-center justify-between gap-3 mb-3 sm:mb-4">
        <h3 className="text-base sm:text-lg font-semibold">{title}</h3>
        <div className="flex items-center gap-2 flex-shrink-0">
          {headerExtra}
          <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden">
            <button
              type="button"
              onClick={() => setView("chart")}
              aria-label={t("common.chartView")}
              title={t("common.chartView")}
              className={`p-1.5 transition-colors ${
                view === "chart"
                  ? "bg-blue-50 text-blue-600"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              <BarChart2 size={16} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setView("numeric")}
              aria-label={t("common.tableView")}
              title={t("common.tableView")}
              className={`p-1.5 border-l border-gray-200 transition-colors ${
                view === "numeric"
                  ? "bg-blue-50 text-blue-600"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              <Table size={16} aria-hidden />
            </button>
          </div>
        </div>
      </div>
      <div className={bodyClassName}>
        {view === "chart" ? chart : numeric}
      </div>
    </div>
  );
}

interface Column {
  key: string;
  label: ReactNode;
  align?: "left" | "right" | "center";
}

interface NumericTableProps {
  columns: Column[];
  rows: Array<Record<string, any>>;
  /** Optional label + values for a totals row appended at the bottom. */
  totals?: Record<string, any>;
  totalsLabel?: ReactNode;
  /** Show a share % column computed from `shareKey` relative to its total. */
  shareKey?: string;
  emptyLabel?: ReactNode;
  money?: (n: number) => string;
}

/**
 * Compact numeric table used by every numeric card view: clean rows, optional
 * totals row and optional share % column.
 */
export function NumericTable({
  columns,
  rows,
  totals,
  totalsLabel,
  shareKey,
  emptyLabel,
  money,
}: NumericTableProps) {
  const { t } = useTranslation();
  if (rows.length === 0) {
    return (
      <p className="text-sm text-gray-400 py-6 text-center">
        {emptyLabel ?? t("common.noResults")}
      </p>
    );
  }
  const shareTotal = shareKey
    ? rows.reduce((s, r) => s + (Number(r[shareKey]) || 0), 0)
    : 0;

  const render = (value: any, col: Column) => {
    if (value == null) return "—";
    if (money && typeof value === "number" && col.key !== shareKey) {
      // Money columns are those whose key looks like an amount; callers can also
      // pre-format. Keep it simple: only format keys ending in Amount/Revenue/Total.
      if (/amount|revenue|total|profit|cost|price/i.test(col.key)) {
        return money(value);
      }
    }
    return String(value);
  };

  const alignClass = (a?: Column["align"]) =>
    a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs sm:text-sm">
        <thead className="bg-gray-50 border-b">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={`p-2 ${alignClass(c.align)} whitespace-nowrap`}>
                {c.label}
              </th>
            ))}
            {shareKey && (
              <th className="p-2 text-right whitespace-nowrap">{t("common.share")}</th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b last:border-0">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`p-2 ${alignClass(c.align)} ${c.key === columns[0].key ? "font-medium" : ""}`}
                >
                  {render(row[c.key], c)}
                </td>
              ))}
              {shareKey && (
                <td className="p-2 text-right text-gray-500 whitespace-nowrap">
                  {shareTotal > 0
                    ? `${Math.round(((Number(row[shareKey]) || 0) / shareTotal) * 100)}%`
                    : "—"}
                </td>
              )}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr className="border-t bg-gray-50 font-semibold">
              {columns.map((c) => (
                <td key={c.key} className={`p-2 ${alignClass(c.align)} whitespace-nowrap`}>
                  {c.key === columns[0].key
                    ? totalsLabel ?? t("common.total")
                    : render(totals[c.key], c)}
                </td>
              ))}
              {shareKey && <td className="p-2 text-right">100%</td>}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

interface StatItem {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  accent?: string;
}

/** Grid of metric stat cards, used for trend / breakdown numeric views. */
export function StatGrid({
  items,
  cols = 3,
}: {
  items: StatItem[];
  cols?: 2 | 3 | 4;
}) {
  const gridCols =
    cols === 2
      ? "grid-cols-2"
      : cols === 4
        ? "grid-cols-2 md:grid-cols-4"
        : "grid-cols-2 md:grid-cols-3";
  return (
    <div className={`grid ${gridCols} gap-3`}>
      {items.map((it, i) => (
        <div key={i} className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
          <p className="text-[11px] uppercase tracking-wide text-gray-400">{it.label}</p>
          <p className={`text-lg font-bold mt-1 ${it.accent ?? "text-gray-800"}`}>
            {it.value}
          </p>
          {it.sub != null && <p className="text-xs text-gray-500 mt-0.5">{it.sub}</p>}
        </div>
      ))}
    </div>
  );
}
