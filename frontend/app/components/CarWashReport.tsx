"use client";

// Car-wash report body. Rendered by both the shared reports page (CAR_WASH
// tab set) and the dedicated /dashboard/carwash/reports page, so a car-wash
// business always sees the same figures regardless of entry point. The date
// range is owned by the caller (via the shared FilterPanel), keeping the
// filtering flow identical to every other business.
import api from "@/lib/api";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ChartCard, { NumericTable } from "./ChartCard";

const fmt = (n: number) =>
  (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function CarWashReport({
  startDate,
  endDate,
  showQuickLinks = true,
}: {
  startDate: string;
  endDate: string;
  showQuickLinks?: boolean;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    const q = new URLSearchParams({ startDate, endDate });
    api
      .get(`/carwash/reports/breakdown?${q.toString()}`)
      .then((r) => setData(r.data))
      .catch(() => setError(t("carwash.failedLoad")));
  }, [startDate, endDate, t]);

  const tiles = data
    ? [
        { label: t("carwash.totalRevenue"), value: data.totalRevenue, icon: "💰", accent: "text-emerald-600" },
        { label: t("carwash.totalCommission"), value: data.totalCommission, icon: "👷", accent: "text-violet-600" },
        { label: t("carwash.ownerShare"), value: data.ownerShare, icon: "🏦", accent: "text-blue-600" },
        { label: t("carwash.totalExpenses"), value: data.totalExpenses, icon: "🧾", accent: "text-rose-600" },
        { label: t("carwash.equipmentRevenue"), value: data.totalEquipmentRevenue, icon: "🧽", accent: "text-cyan-600" },
        { label: t("carwash.netProfit"), value: data.netProfit, icon: "📈", accent: "text-green-600" },
        { label: t("carwash.totalIncome"), value: data.totalIncome, icon: "💵", accent: "text-amber-600" },
        { label: t("carwash.washCount"), value: data.washCount, icon: "🚗", accent: "text-slate-600" },
      ]
    : [];

  if (error) {
    return <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>;
  }

  return (
    <div className="space-y-6">
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {tiles.map((c) => (
              <div key={c.label} className="bg-white p-4 rounded-lg border border-gray-200">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span aria-hidden>{c.icon}</span>
                  <span>{c.label}</span>
                </div>
                <p className={`text-xl font-bold mt-1 ${c.accent}`}>{fmt(c.value)}</p>
              </div>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <ChartCard
              title={`📊 ${t("carwash.revenueBreakdown")}`}
              chart={
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[
                    { name: t("carwash.totalRevenue"), value: data.totalRevenue },
                    { name: t("carwash.totalCommission"), value: data.totalCommission },
                    { name: t("carwash.ownerShare"), value: data.ownerShare },
                    { name: t("carwash.totalExpenses"), value: data.totalExpenses },
                    { name: t("carwash.netProfit"), value: data.netProfit },
                  ]}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              }
              numeric={
                <NumericTable
                  columns={[
                    { key: "name", label: t("carwash.total") },
                    { key: "value", label: t("carwash.amount"), align: "right" },
                  ]}
                  rows={[
                    { name: t("carwash.totalRevenue"), value: data.totalRevenue },
                    { name: t("carwash.totalCommission"), value: data.totalCommission },
                    { name: t("carwash.ownerShare"), value: data.ownerShare },
                    { name: t("carwash.totalExpenses"), value: data.totalExpenses },
                    { name: t("carwash.netProfit"), value: data.netProfit },
                  ]}
                  money={fmt}
                />
              }
            />

            <ChartCard
              title={`👷 ${t("carwash.washerEarnings")}`}
              chart={
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={(data.washerEarnings ?? []).map((w: any) => ({ name: w.name, commission: w.commission }))}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="commission" fill="#16a34a" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              }
              numeric={
                <NumericTable
                  columns={[
                    { key: "name", label: t("carwash.washer") },
                    { key: "commission", label: t("carwash.totalCommission"), align: "right" },
                  ]}
                  rows={(data.washerEarnings ?? []).map((w: any) => ({ name: w.name, commission: w.commission }))}
                  shareKey="commission"
                  totals={{
                    name: t("common.total"),
                    commission: (data.washerEarnings ?? []).reduce((s: number, w: any) => s + (w.commission || 0), 0),
                  }}
                  totalsLabel={t("common.total")}
                  money={fmt}
                />
              }
            />
          </div>

          <ChartCard
            title={`💳 ${t("carwash.paidVsUnpaid")}`}
            chart={
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: t("carwash.paid"), value: data.paidEquipmentRevenue },
                      { name: t("carwash.unpaid"), value: data.unpaidEquipmentRevenue },
                    ]}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label
                  >
                    <Cell fill="#16a34a" />
                    <Cell fill="#f59e0b" />
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
            }
            numeric={
              <NumericTable
                columns={[
                  { key: "name", label: t("carwash.status") },
                  { key: "value", label: t("carwash.amount"), align: "right" },
                ]}
                rows={[
                  { name: t("carwash.paid"), value: data.paidEquipmentRevenue },
                  { name: t("carwash.unpaid"), value: data.unpaidEquipmentRevenue },
                ]}
                shareKey="value"
                totals={{
                  name: t("common.total"),
                  value: (data.paidEquipmentRevenue || 0) + (data.unpaidEquipmentRevenue || 0),
                }}
                totalsLabel={t("common.total")}
                money={fmt}
              />
            }
          />

          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
              <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-800">{t("carwash.washerEarnings")}</div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs text-gray-500">
                  <tr>
                    <th className="px-4 py-2 whitespace-nowrap">{t("carwash.washer")}</th>
                    <th className="px-4 py-2 text-right whitespace-nowrap">{t("carwash.totalCommission")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.washerEarnings.map((w: any) => (
                    <tr key={w.washerId}>
                      <td className="px-4 py-2 font-medium whitespace-nowrap">{w.name}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">{(w.commission ?? 0).toFixed(2)}</td>
                    </tr>
                  ))}
                  {data.washerEarnings.length === 0 && <tr><td colSpan={2} className="px-4 py-6 text-center text-gray-400">{t("carwash.noWashers")}</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
              <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-800">{t("carwash.popularItems")}</div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs text-gray-500">
                  <tr>
                    <th className="px-4 py-2 whitespace-nowrap">{t("carwash.item")}</th>
                    <th className="px-4 py-2 text-right whitespace-nowrap">{t("carwash.qty")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.popularItems.map((p: any) => (
                    <tr key={p.id}>
                      <td className="px-4 py-2 font-medium whitespace-nowrap">{p.name}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">{p.quantity}</td>
                    </tr>
                  ))}
                  {data.popularItems.length === 0 && <tr><td colSpan={2} className="px-4 py-6 text-center text-gray-400">{t("carwash.noEquipment")}</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
              <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-800">{t("carwash.paidEquipment")}</div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs text-gray-500">
                  <tr>
                    <th className="px-4 py-2 whitespace-nowrap">{t("carwash.washer")}</th>
                    <th className="px-4 py-2 text-right whitespace-nowrap">{t("carwash.total")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.paidEquipmentByWasher.map((w: any) => (
                    <tr key={w.washerId}>
                      <td className="px-4 py-2 font-medium whitespace-nowrap">{w.name}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">{(w.total ?? 0).toFixed(2)}</td>
                    </tr>
                  ))}
                  {data.paidEquipmentByWasher.length === 0 && <tr><td colSpan={2} className="px-4 py-6 text-center text-gray-400">{t("carwash.noEquipment")}</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
              <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-800">{t("carwash.unpaidEquipment")}</div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs text-gray-500">
                  <tr>
                    <th className="px-4 py-2 whitespace-nowrap">{t("carwash.washer")}</th>
                    <th className="px-4 py-2 text-right whitespace-nowrap">{t("carwash.total")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.unpaidEquipmentByWasher.map((w: any) => (
                    <tr key={w.washerId}>
                      <td className="px-4 py-2 font-medium whitespace-nowrap">{w.name}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">{(w.total ?? 0).toFixed(2)}</td>
                    </tr>
                  ))}
                  {data.unpaidEquipmentByWasher.length === 0 && <tr><td colSpan={2} className="px-4 py-6 text-center text-gray-400">{t("carwash.noEquipment")}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
            <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-800">{t("carwash.lowStockItems")}</div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2 whitespace-nowrap">{t("carwash.name")}</th>
                  <th className="px-4 py-2 whitespace-nowrap">{t("carwash.stock")}</th>
                  <th className="px-4 py-2 whitespace-nowrap">{t("carwash.minimumStock")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.lowStockItems.map((p: any) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2 font-medium whitespace-nowrap">{p.name}</td>
                    <td className="px-4 py-2 text-red-600 font-semibold whitespace-nowrap">{p.stock}</td>
                    <td className="px-4 py-2 whitespace-nowrap">{p.minimumStock}</td>
                  </tr>
                ))}
                {data.lowStockItems.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-400">{t("carwash.noEquipment")}</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showQuickLinks && (
        <div className="flex gap-2 text-sm">
          <Link href="/dashboard/carwash/washes" className="px-3 py-2 rounded border border-gray-300 text-gray-700">{t("carwash.carWashList")}</Link>
          <Link href="/dashboard/carwash/collection" className="px-3 py-2 rounded border border-gray-300 text-gray-700">{t("carwash.collection")}</Link>
          <Link href="/dashboard/carwash/expenses" className="px-3 py-2 rounded border border-gray-300 text-gray-700">{t("carwash.expenses")}</Link>
        </div>
      )}
    </div>
  );
}
