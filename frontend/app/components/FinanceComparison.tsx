"use client";
// Side-by-side finance comparison charts across a custom date range:
// Revenue vs COGS, Revenue vs Overhead, and Net Profit Margin.
import api from "@/lib/api";
import Loading from "./Loading";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import ChartCard, { NumericTable } from "./ChartCard";

interface ComparisonPoint {
  date: string;
  revenue: number;
  cogs: number;
  overhead: number;
  grossProfit: number;
  netProfit: number;
  margin: number;
}

type GroupBy = "day" | "week" | "month";

const fmt = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function FinanceComparison({
  startDate,
  endDate,
  locationId,
}: {
  startDate: string;
  endDate: string;
  locationId?: string;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<ComparisonPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupBy, setGroupBy] = useState<GroupBy>("day");

  useEffect(() => {
    setLoading(true);
    const q = new URLSearchParams({ startDate, endDate, groupBy });
    if (locationId) q.set("locationId", locationId);
    api
      .get(`/finance/comparison?${q.toString()}`)
      .then((r) => setData(Array.isArray(r.data) ? r.data : []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [startDate, endDate, groupBy, locationId]);

  if (loading) return <Loading className="py-16" />;

  const label = (d: string) => {
    if (groupBy === "month") return d;
    if (groupBy === "week") return `${t("fin.wk")} ${d}`;
    const dt = new Date(d + "T00:00:00");
    return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
  const chartData = data.map((p) => ({ ...p, label: label(p.date) }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500 font-medium">{t("fin.groupBy")}</span>
        {(["day", "week", "month"] as const).map((g) => (
          <button
            key={g}
            onClick={() => setGroupBy(g)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium capitalize ${
              groupBy === g
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {t(`fin.grouper${g.charAt(0).toUpperCase()}${g.slice(1)}`)}
          </button>
        ))}
      </div>

      {chartData.length === 0 && (
        <div className="bg-white rounded-xl border shadow-sm p-6 text-center text-sm text-gray-400">
          {t("fin.noComparison")}
        </div>
      )}
      {chartData.length > 0 && (
        <>
          {/* Revenue vs COGS */}
          <ChartCard
            title={t("fin.revVsCogs")}
            headerExtra={
              <span className="text-[10px] sm:text-xs text-gray-400">
                {t("fin.grossProfit")}{" "}
                {fmt(chartData.reduce((s, p) => s + p.grossProfit, 0))} {t("orders.birr")}
              </span>
            }
            chart={
            <div className="h-64 sm:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="label" fontSize={10} tickMargin={6} />
                  <YAxis fontSize={10} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }}
                    formatter={(value: any) => [`${fmt(Number(value))} ${t("orders.birr")}`, undefined]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                  <Bar dataKey="revenue" name={t("fin.chartRevenue")} fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="cogs" name={t("fin.chartCogs")} fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            }
            numeric={
              <NumericTable
                columns={[
                  { key: "label", label: t("fin.groupLabel") },
                  { key: "revenue", label: t("fin.chartRevenue"), align: "right" },
                  { key: "cogs", label: t("fin.chartCogs"), align: "right" },
                  { key: "grossProfit", label: t("fin.grossProfit"), align: "right" },
                ]}
                rows={chartData}
                totals={{
                  label: t("common.total"),
                  revenue: chartData.reduce((s, p) => s + p.revenue, 0),
                  cogs: chartData.reduce((s, p) => s + p.cogs, 0),
                  grossProfit: chartData.reduce((s, p) => s + p.grossProfit, 0),
                }}
                totalsLabel={t("common.total")}
                money={(n) => `${fmt(n)} ${t("orders.birr")}`}
              />
            }
          />

          {/* Revenue vs Overhead */}
          <ChartCard
            title={t("fin.revVsOverhead")}
            chart={
            <div className="h-64 sm:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="label" fontSize={10} tickMargin={6} />
                  <YAxis fontSize={10} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }}
                    formatter={(value: any) => [`${fmt(Number(value))} ${t("orders.birr")}`, undefined]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                  <Bar dataKey="revenue" name={t("fin.chartRevenue")} fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="overhead" name={t("fin.chartOverhead")} fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            }
            numeric={
              <NumericTable
                columns={[
                  { key: "label", label: t("fin.groupLabel") },
                  { key: "revenue", label: t("fin.chartRevenue"), align: "right" },
                  { key: "overhead", label: t("fin.chartOverhead"), align: "right" },
                ]}
                rows={chartData}
                totals={{
                  label: t("common.total"),
                  revenue: chartData.reduce((s, p) => s + p.revenue, 0),
                  overhead: chartData.reduce((s, p) => s + p.overhead, 0),
                }}
                totalsLabel={t("common.total")}
                money={(n) => `${fmt(n)} ${t("orders.birr")}`}
              />
            }
          />

          {/* Net profit + margin */}
          <ChartCard
            title={t("fin.netProfitMargin")}
            chart={
            <div className="h-64 sm:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 16, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="label" fontSize={10} tickMargin={6} />
                  <YAxis fontSize={10} yAxisId="etb" />
                  <YAxis fontSize={10} yAxisId="pct" orientation="right" unit="%" />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }}
                    formatter={(value: any, name: any) =>
                      name === t("fin.chartMargin")
                        ? [`${Number(value).toFixed(1)}%`, name]
                        : [`${fmt(Number(value))} ${t("orders.birr")}`, name]
                    }
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                  <Line
                    yAxisId="etb"
                    type="monotone"
                    dataKey="netProfit"
                    name={t("fin.chartNetProfit")}
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    yAxisId="pct"
                    type="monotone"
                    dataKey="margin"
                    name={t("fin.chartMargin")}
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            }
            numeric={
              <NumericTable
                columns={[
                  { key: "label", label: t("fin.groupLabel") },
                  { key: "netProfit", label: t("fin.chartNetProfit"), align: "right" },
                  { key: "margin", label: t("fin.chartMargin"), align: "right" },
                ]}
                rows={chartData.map((p) => ({ ...p, margin: `${Number(p.margin).toFixed(1)}%` }))}
                totals={{
                  label: t("common.total"),
                  netProfit: chartData.reduce((s, p) => s + p.netProfit, 0),
                }}
                totalsLabel={t("common.total")}
                money={(n) => `${fmt(n)} ${t("orders.birr")}`}
              />
            }
          />
        </>
      )}
    </div>
  );
}

