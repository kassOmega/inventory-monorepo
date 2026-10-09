"use client";

import api from "@/lib/api";
import Button from "@/app/components/Button";
import { useAuth } from "@/context/AuthContext";
import { getDateRange, type DatePreset } from "@/app/components/DateFilter";
import FilterPanel from "@/app/components/FilterPanel";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ChartCard, { NumericTable } from "@/app/components/ChartCard";

export default function CarWashCollectionPage() {
  const { hasPermission } = useAuth();
  const { t } = useTranslation();
  const [summary, setSummary] = useState<any>(null);
  const [collections, setCollections] = useState<any[]>([]);
  const [todayCollections, setTodayCollections] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const canRecord = hasPermission("carwash.collections.create");

  const init = getDateRange("month");
  const [datePreset, setDatePreset] = useState<DatePreset>("month");
  const [startDate, setStartDate] = useState(init.start);
  const [endDate, setEndDate] = useState(init.end);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [s, c, tc] = await Promise.all([
        api.get(`/carwash/summary?startDate=${startDate}&endDate=${endDate}`),
        api.get(`/carwash/collections?startDate=${startDate}&endDate=${endDate}`),
        // Today's collections decide whether the daily collection is already settled.
        api.get(`/carwash/collections?startDate=${today}&endDate=${today}`).catch(() => ({ data: [] })),
      ]);
      setSummary(s.data);
      setCollections(c.data);
      setTodayCollections(Array.isArray(tc.data) ? tc.data : []);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("carwash.failedLoad"));
    }
  }, [t, startDate, endDate]);

  useEffect(() => {
    load();
  }, [load]);

  // A day is settled once a collection exists whose remaining balance is zero
  // (the owner share for the day has been handed over in full).
  const settledToday = todayCollections.some(
    (c) => (c.remainingBalance ?? 0) <= 0.0001,
  );

  // The gap is the money still on the air for the selected range: enable the
  // button only while something is left to collect.
  const gap = summary?.gap ?? 0;
  const canCollect = canRecord && gap > 0.0001 && !settledToday;

  const recordCollection = async () => {
    setError("");
    setRecording(true);
    try {
      await api.post("/carwash/collections", {});
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedSave"));
    } finally {
      setRecording(false);
    }
  };

  const tiles = summary
    ? [
        [t("carwash.totalRevenue"), summary.totalRevenue],
        [t("carwash.totalCommission"), summary.totalCommission],
        [t("carwash.ownerShare"), summary.ownerShare],
        [t("carwash.collected"), summary.collectedAmount],
        [t("carwash.gap"), summary.gap],
        [t("carwash.equipmentRevenue"), summary.equipmentRevenue],
        [t("carwash.totalExpenses"), summary.totalExpenses],
        [t("carwash.netProfit"), summary.netProfit],
      ]
    : [];

  const chartData = summary
    ? [
        { name: t("carwash.totalRevenue"), value: summary.totalRevenue },
        { name: t("carwash.totalCommission"), value: summary.totalCommission },
        { name: t("carwash.ownerShare"), value: summary.ownerShare },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">{t("carwash.collection")}</h1>
        {canRecord && (
          <Button
            onClick={recordCollection}
            loading={recording}
            disabled={!canCollect}
            shape="rounded"
            title={!canCollect ? t("carwash.noGap") : undefined}
            className={
              !canCollect
                ? "!bg-gray-300 !text-gray-600 cursor-not-allowed"
                : "!bg-gray-800 !text-white"
            }
          >
            {settledToday
              ? t("carwash.collectionSettled")
              : gap > 0.0001
                ? `${t("carwash.recordCollection")} (${t("carwash.gap")}: ${gap.toLocaleString()})`
                : t("carwash.noGap")}
          </Button>
        )}
      </div>
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
        searchPlaceholder={t("carwash.collection")}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {tiles.map(([label, value]) => (
          <div key={label} className="bg-white p-4 rounded-lg border border-gray-200">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-xl font-bold text-gray-800 mt-1">{(value ?? 0).toLocaleString()}</p>
          </div>
        ))}
      </div>

      {chartData.length > 0 && (
        <ChartCard
          title={t("carwash.todayBreakdown")}
          chart={
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
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
              rows={chartData}
              money={(n) => (n ?? 0).toLocaleString()}
            />
          }
        />
      )}

      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.date")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.total")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.ownerShare")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.netProfit")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.notes")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {collections.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-2 whitespace-nowrap">{new Date(c.collectionDate).toLocaleDateString()}</td>
                <td className="px-4 py-2 whitespace-nowrap">{c.totalAmount}</td>
                <td className="px-4 py-2 whitespace-nowrap">{c.dailyOwnerShare ?? "—"}</td>
                <td className="px-4 py-2 whitespace-nowrap">{c.netProfit ?? "—"}</td>
                <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{c.notes ?? "—"}</td>
              </tr>
            ))}
            {collections.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">{t("carwash.noCollections")}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
