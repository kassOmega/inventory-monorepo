"use client";
import api from "@/lib/api";
import { fmtCurrency } from "@/lib/currency";
import Loading from "./Loading";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

interface Props {
  startDate: string;
  endDate: string;
  categoryId: string;
  locationId: string;
  search: string;
  compact?: boolean;
}

export default function SalesReport({ startDate, endDate, categoryId, locationId, search, compact }: Props) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<any>(null);
  const [trend, setTrend] = useState<any[]>([]);
  const [mostSold, setMostSold] = useState<any[]>([]);
  const [paymentBreakdown, setPaymentBreakdown] = useState<any[]>([]);
  const [unified, setUnified] = useState<any>(null);
  const [view, setView] = useState<"summary" | "charts">("charts");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const query = `startDate=${startDate}&endDate=${endDate}&categoryId=${categoryId}&search=${search}&locationId=${locationId}`;
    setLoading(true);
    Promise.all([
      api.get(`/reports/sales-summary?${query}`).catch(() => ({ data: null })),
      api.get(`/reports/sales-trend?${query}`).catch(() => ({ data: [] })),
      api.get(`/reports/most-sold?${query}`).catch(() => ({ data: [] })),
      api.get(`/reports/payment-methods-breakdown?${query}`).catch(() => ({ data: [] })),
      api.get(`/reports/unified-stats?startDate=${startDate}&endDate=${endDate}&locationId=${locationId}&categoryId=${categoryId}&search=${search}`).catch(() => ({ data: null })),
    ]).then(([s, t, m, p, u]) => {
      setSummary(s.data);
      setTrend(t.data);
      setMostSold(m.data);
      setPaymentBreakdown(p.data);
      setUnified(u.data);
    }).finally(() => setLoading(false));
  }, [startDate, endDate, categoryId, locationId, search]);

  if (loading || (!unified && !summary)) return <Loading className="py-24" />;

  return (
    <div className="space-y-6">
      {/* View Toggle */}
      <div className="relative flex bg-gray-200 rounded-full p-0.5 w-44">
        <div
          className={`absolute top-0.5 bottom-0.5 w-[5.25rem] rounded-full bg-white shadow-sm transition-all duration-200 ${
            view === "charts" ? "left-0.5" : "left-[5.5rem]"
          }`}
        />
        {(["charts", "summary"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)}
            className={`relative z-10 flex-1 py-1.5 text-xs font-medium rounded-full transition-colors ${
              view === v ? "text-blue-600" : "text-gray-500 hover:text-gray-700"
            }`}>
            {v === "summary" ? t("sr.viewSummary") : t("sr.viewCharts")}
          </button>
        ))}
      </div>

      {view === "summary" && (
        <div className="space-y-4">
          {/* Sales — inline, from unified */}
          {unified && (
            <div className="bg-white rounded-xl shadow-sm border px-4 py-3 flex items-center gap-4 text-sm flex-wrap">
              <span className="text-xs uppercase text-gray-400 font-semibold">{t("sr.salesBlock")}</span>
              <div className="w-px h-6 bg-gray-200" />
              <span>{t("sr.revenue")} <strong className="text-gray-800">{unified.sales.revenue.toFixed(2)} {t("orders.birr")}</strong></span>
              <span className="text-gray-300">|</span>
              <span>{t("sr.tax")} <strong className="text-gray-800">{unified.sales.tax.toFixed(2)} {t("orders.birr")}</strong></span>
              <span className="text-gray-300">|</span>
              <span>{t("sr.cost")} <strong className="text-gray-800">{unified.sales.cost.toFixed(2)} {t("orders.birr")}</strong></span>
              <span className="text-gray-300">|</span>
              <span>{t("sr.profitAfterTax")} <strong className="text-green-600">{unified.sales.profit.toFixed(2)} {t("orders.birr")}</strong></span>
              <span className="text-gray-300">|</span>
              <span>{t("sr.count")} <strong className="text-gray-800">{unified.sales.count}</strong></span>
              <span className="text-gray-300">|</span>
              <span>{t("sr.margin")} <strong className="text-blue-600">{unified.sales.margin}%</strong></span>
              {unified.sales.breakdown && (
                <div className="w-full mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg bg-green-50 px-3 py-2">
                    <span className="text-green-700 font-semibold">{t("sr.fullyPaid")}</span>
                    <div className="text-gray-700">
                      {unified.sales.breakdown.fullyPaid.revenue.toFixed(2)} {t("orders.birr")}
                    </div>
                  </div>
                  <div className="rounded-lg bg-yellow-50 px-3 py-2">
                    <span className="text-yellow-700 font-semibold">{t("sr.partial")}</span>
                    <div className="text-gray-700">
                      {t("sr.collected")} {unified.sales.breakdown.partiallyPaid.collected.toFixed(2)} {t("orders.birr")}
                    </div>
                    <div className="text-red-600">
                      {t("sr.outstanding")} {unified.sales.breakdown.partiallyPaid.outstanding.toFixed(2)} {t("orders.birr")}
                    </div>
                  </div>
                  <div className="rounded-lg bg-red-50 px-3 py-2">
                    <span className="text-red-700 font-semibold">{t("sr.credit")}</span>
                    <div className="text-gray-700">
                      {t("sr.collected")} {unified.sales.breakdown.credited.collected.toFixed(2)} {t("orders.birr")}
                    </div>
                    <div className="text-red-600">
                      {t("sr.outstanding")} {unified.sales.breakdown.credited.outstanding.toFixed(2)} {t("orders.birr")}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Quick Purchases & Combined — inline */}
          {unified && (
            <>
              <div className="bg-white rounded-xl shadow-sm border px-4 py-3 flex items-center gap-4 text-sm flex-wrap">
                <span className="text-xs uppercase text-gray-400 font-semibold">{t("sr.quickPurchases")}</span>
                <div className="w-px h-6 bg-gray-200" />
                <span>{t("sr.revenue")} <strong className="text-gray-800">{unified.flips.revenue.toFixed(2)} {t("orders.birr")}</strong></span>
                <span className="text-gray-300">|</span>
                <span>{t("sr.tax")} <strong className="text-gray-800">{unified.flips.tax.toFixed(2)} {t("orders.birr")}</strong></span>
                <span className="text-gray-300">|</span>
                <span>{t("sr.cost")} <strong className="text-gray-800">{unified.flips.cost.toFixed(2)} {t("orders.birr")}</strong></span>
                <span className="text-gray-300">|</span>
                <span>{t("sr.profitAfterTax")} <strong className={unified.flips.profit >= 0 ? "text-green-600" : "text-red-600"}>{unified.flips.profit.toFixed(2)} {t("orders.birr")}</strong></span>
                <span className="text-gray-300">|</span>
                <span>{t("sr.count")} <strong className="text-gray-800">{unified.flips.count}</strong></span>
                <span className="text-gray-300">|</span>
                <span>{t("sr.margin")} <strong className="text-blue-600">{unified.flips.margin}%</strong></span>
              </div>

              <div className="bg-blue-50 rounded-xl shadow-sm border border-blue-100 px-4 py-3 flex items-center gap-4 text-sm flex-wrap">
                <span className="text-xs uppercase text-blue-400 font-semibold">{t("sr.combined")}</span>
                <div className="w-px h-6 bg-blue-200" />
                <span>{t("sr.revenue")} <strong className="text-gray-800">{unified.combined.totalRevenue.toFixed(2)} {t("orders.birr")}</strong></span>
                <span className="text-gray-300">|</span>
                <span>{t("sr.tax")} <strong className="text-gray-800">{unified.combined.totalTax.toFixed(2)} {t("orders.birr")}</strong></span>
                <span className="text-gray-300">|</span>
                <span>{t("sr.cost")} <strong className="text-gray-800">{unified.combined.totalCost.toFixed(2)} {t("orders.birr")}</strong></span>
                <span className="text-gray-300">|</span>
                <span>{t("sr.profitAfterTax")} <strong className={unified.combined.netProfit >= 0 ? "text-green-600" : "text-red-600"}>{unified.combined.netProfit.toFixed(2)} {t("orders.birr")}</strong></span>
                <span className="text-gray-300">|</span>
                <span>{t("sr.margin")} <strong className="text-blue-600">{unified.combined.margin}%</strong></span>
              </div>
            </>
          )}
        </div>
      )}

      {view === "charts" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {/* Sales Trend */}
        <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
          <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">{t("sr.salesTrend")}</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trend} margin={{ top: 20, right: 30, left: 40, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickMargin={8} />
                <YAxis tick={{ fontSize: 11 }} width={45} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }} />
                <Legend wrapperStyle={{ paddingTop: "16px", fontSize: 11 }} />
                <Line type="monotone" dataKey="sales" name={t("sr.seriesSales")} stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="flips" name={t("sr.seriesQuick")} stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 3" />
                <Line type="monotone" dataKey="collections" name={t("sr.seriesCollections")} stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="3 3" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Sales Distribution */}
        <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
          <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">{t("sr.salesDistribution")}</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart margin={{ top: 10, right: 10, left: 10, bottom: 32 }}>
                <Pie data={mostSold.slice(0, 8)} dataKey="qty" nameKey="name" cx="50%" cy="45%"
                outerRadius={compact ? 50 : 68} innerRadius={compact ? 22 : 30} paddingAngle={2}>
                  {mostSold.slice(0, 8).map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }} />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: "8px" }} iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Payment Methods Pie */}
        {paymentBreakdown.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
            <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">{t("sr.paymentMethods")}</h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 10, right: 40, left: 40, bottom: 16 }}>
                  <Pie data={paymentBreakdown} dataKey="totalAmount" nameKey="method" cx="50%" cy="45%"
                    outerRadius={compact ? 55 : 62}
                    labelLine={{ stroke: "#9ca3af", strokeWidth: 1 }}
                    label={({ method, totalAmount, x, y, midAngle }: any) => {
                      const isLeft = midAngle > 90 && midAngle < 270;
                      const m =
                        (method as string).length > 18
                          ? `${(method as string).slice(0, 17)}…`
                          : (method as string);
                      return (
                        <text
                          x={x}
                          y={y}
                          fontSize={10}
                          fill="#374151"
                          textAnchor={isLeft ? "end" : "start"}
                          dominantBaseline="central"
                        >
                          {m} {totalAmount.toFixed(0)} {t("orders.birr")}
                        </text>
                      );
                    }}>
                    {paymentBreakdown.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }}
                    formatter={(value: any) => [`${Number(value).toFixed(2)} ${t("orders.birr")}`, t("sr.amount")]} />
                  <Legend wrapperStyle={{ fontSize: 10, paddingTop: "8px" }} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Top Selling Products */}
        <div className={`bg-white rounded-xl shadow-sm border p-4 sm:p-6 ${compact ? "lg:col-span-2" : "lg:col-span-1"}`}>
          <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">{t("sr.topProducts")}</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mostSold} margin={{ top: 10, right: 20, bottom: 20, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} tickMargin={12} angle={-25} textAnchor="end" interval={0} height={80} />
                <YAxis tick={{ fontSize: 10 }} width={40} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }} />
                <Bar dataKey="qty" radius={[4, 4, 0, 0]}>
                  {mostSold.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      )}

      {/* Payment Methods Table */}
      {view === "summary" && paymentBreakdown.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
          <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">{t("sr.paymentMethods")}</h3>
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="p-2 sm:p-3">{t("sr.method")}</th>
                <th className="p-2 sm:p-3 text-right">{t("sr.count")}</th>
                <th className="p-2 sm:p-3 text-right">{t("sr.total")}</th>
              </tr>
            </thead>
            <tbody>
              {paymentBreakdown.map((pm: any) => (
                <tr key={pm.method} className="border-b">
                  <td className="p-2 sm:p-3 font-medium">{pm.method}</td>
                  <td className="p-2 sm:p-3 text-right">{pm.count}</td>
                  <td className="p-2 sm:p-3 text-right font-semibold">{fmtCurrency(pm.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}