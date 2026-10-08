"use client";

import api from "@/lib/api";
import FilterPanel from "@/app/components/FilterPanel";
import { getDateRange, type DatePreset } from "@/app/components/DateFilter";
import { useTranslation } from "react-i18next";
import { useEffect, useState, Fragment } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export default function CarWashWasherReportsPage() {
  const { t } = useTranslation();
  const [report, setReport] = useState<any>(null);
  const init = getDateRange("week");
  const [datePreset, setDatePreset] = useState<DatePreset>("week");
  const [startDate, setStartDate] = useState(init.start);
  const [endDate, setEndDate] = useState(init.end);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  // Drill-down: the washes a washer completed in the selected range.
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [washRows, setWashRows] = useState<any[]>([]);
  const [washLoading, setWashLoading] = useState(false);

  const load = () => {
    const q = new URLSearchParams({ startDate, endDate });
    api
      .get(`/carwash/reports/washers?${q.toString()}`)
      .then((r) => setReport(r.data))
      .catch(() => setError(t("carwash.failedLoad")));
  };

  // Auto-apply: refetch whenever the date range changes.
  useEffect(() => {
    load();
    setExpandedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  const toggleWasher = async (washerId: number) => {
    if (expandedId === washerId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(washerId);
    setWashLoading(true);
    try {
      const q = new URLSearchParams({ startDate, endDate });
      const r = await api.get(
        `/carwash/reports/washers/${washerId}/washes?${q.toString()}`,
      );
      setWashRows(Array.isArray(r.data) ? r.data : []);
    } catch {
      setWashRows([]);
    } finally {
      setWashLoading(false);
    }
  };

  const chartData =
    report?.washers
      ?.filter((w: any) => w.commission > 0)
      .map((w: any) => ({ name: w.name, commission: w.commission })) ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">{t("carwash.washerReports")}</h1>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      <FilterPanel
        showDateFilter
        datePreset={datePreset}
        onDatePresetChange={setDatePreset}
        startDate={startDate}
        onStartDateChange={setStartDate}
        endDate={endDate}
        onEndDateChange={setEndDate}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("carwash.washerReports")}
      />

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
              <Fragment key={w.washerId}>
                <tr
                  onClick={() => toggleWasher(w.washerId)}
                  className="cursor-pointer hover:bg-gray-50"
                >
                  <td className="px-4 py-2 font-medium whitespace-nowrap">
                    <span className="text-gray-400 mr-1">{expandedId === w.washerId ? "▾" : "▸"}</span>
                    {w.name}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{w.commissionRate}%</td>
                  <td className="px-4 py-2 whitespace-nowrap">{w.washCount}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{w.totalRevenue}</td>
                  <td className="px-4 py-2 font-semibold whitespace-nowrap">{w.commission.toFixed(2)}</td>
                </tr>
                {expandedId === w.washerId && (
                  <tr>
                    <td colSpan={5} className="bg-gray-50 px-4 py-3">
                      {washLoading ? (
                        <p className="text-xs text-gray-400">{t("common.loading")}</p>
                      ) : washRows.length === 0 ? (
                        <p className="text-xs text-gray-400">{t("carwash.noWashes")}</p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead className="text-gray-500">
                            <tr>
                              <th className="text-left py-1">{t("carwash.date")}</th>
                              <th className="text-left py-1">{t("carwash.washType")}</th>
                              <th className="text-left py-1">{t("carwash.vehicleType")}</th>
                              <th className="text-left py-1">{t("carwash.plateNumber")}</th>
                              <th className="text-right py-1">{t("carwash.amount")}</th>
                              <th className="text-right py-1">{t("carwash.commission")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {washRows.map((row) => (
                              <tr key={row.id} className="border-t border-gray-200">
                                <td className="py-1">{new Date(row.date).toLocaleString()}</td>
                                <td className="py-1">{row.washType ?? "—"}</td>
                                <td className="py-1">{row.vehicleType}</td>
                                <td className="py-1">{row.plateNumber ?? "—"}</td>
                                <td className="py-1 text-right">{row.amount}</td>
                                <td className="py-1 text-right font-medium text-green-700">
                                  {(row.commission ?? 0).toFixed(2)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {(!report?.washers || report.washers.length === 0) && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  {t("carwash.noWashers")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
