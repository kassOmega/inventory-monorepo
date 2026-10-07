"use client";

import api from "@/lib/api";
import { DateField, ListFilters } from "@/app/components/ListFilters";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export default function CarWashWasherReportsPage() {
  const { t } = useTranslation();
  const [report, setReport] = useState<any>(null);
  const [startDate, setStartDate] = useState(() => new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState("");

  const load = () => {
    const q = new URLSearchParams({ startDate, endDate });
    api.get(`/carwash/reports/washers?${q.toString()}`).then((r) => setReport(r.data)).catch(() => setError(t("carwash.failedLoad")));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chartData = report?.washers?.filter((w: any) => w.commission > 0).map((w: any) => ({ name: w.name, commission: w.commission })) ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">{t("carwash.washerReports")}</h1>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      <ListFilters>
        <DateField value={startDate} onChange={setStartDate} label={t("carwash.dateFrom")} />
        <DateField value={endDate} onChange={setEndDate} label={t("carwash.dateTo")} />
        <button onClick={load} className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium">{t("carwash.reports")}</button>
      </ListFilters>

      {chartData.length > 0 && (
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <h2 className="font-semibold text-gray-800 mb-3">{t("carwash.washerPerformance")}</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="commission" fill="#16a34a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.washer")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.commission")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.quantity")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.totalRevenue")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.totalCommission")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {report?.washers?.map((w: any) => (
              <tr key={w.washerId}>
                <td className="px-4 py-2 font-medium whitespace-nowrap">{w.name}</td>
                <td className="px-4 py-2 whitespace-nowrap">{w.commissionRate}%</td>
                <td className="px-4 py-2 whitespace-nowrap">{w.washCount}</td>
                <td className="px-4 py-2 whitespace-nowrap">{w.totalRevenue}</td>
                <td className="px-4 py-2 font-semibold whitespace-nowrap">{w.commission.toFixed(2)}</td>
              </tr>
            ))}
            {(!report?.washers || report.washers.length === 0) && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">{t("carwash.noWashers")}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
