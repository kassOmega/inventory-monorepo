"use client";

import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { getDateRange } from "@/app/components/DateFilter";
import FilterPanel, { FilterSelect } from "@/app/components/FilterPanel";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import ChartCard, { NumericTable } from "./ChartCard";

// Car-wash vertical overview (stat tiles + quick actions), consumed by
// `/dashboard/carwash` and the dashboard home for CAR_WASH users.
//
// The vertical is role- and business-specific end to end:
//   - the filters below are sent to the backend as query params,
//   - the backend forces a washer's own scope (a washer can never widen it),
//   - the tiles/chart render whatever the filtered response returns.
interface CarWashDashboardData {
  role?: "washer" | "staff";
  washerName?: string | null;
  commissionRate?: number | null;
  startDate?: string;
  endDate?: string;
  todayWashes?: number;
  todayRevenue?: number;
  todayCommission?: number;
  weekCommission?: number;
  ownerShare?: number;
  daily?: Array<{ date: string; commission: number; revenue: number }>;
  activeWashers?: number;
  openBookings?: number;
}

type DatePreset = "today" | "week" | "month" | "year";
const fmt = (n: number) =>
  (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function CarWashDashboard() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const [data, setData] = useState<CarWashDashboardData | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [washers, setWashers] = useState<any[]>([]);
  const [washTypes, setWashTypes] = useState<any[]>([]);
  const [error, setError] = useState("");

  // --- Filters (auto-apply: changing any of these refetches) ---
  const initial = getDateRange("today");
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [startDate, setStartDate] = useState(initial.start);
  const [endDate, setEndDate] = useState(initial.end);
  const [washerId, setWasherId] = useState("");
  const [washTypeId, setWashTypeId] = useState("");
  const [search, setSearch] = useState("");

  const isWasher = data?.role === "washer";
  const canViewWashers = hasPermission("carwash.washers.view");
  const canViewWashTypes = hasPermission("carwash.prices.view");

  useEffect(() => {
    const q = new URLSearchParams({
      startDate,
      endDate,
      ...(washerId ? { washerId } : {}),
      ...(washTypeId ? { washTypeId } : {}),
    });
    setError("");
    api
      .get(`/carwash/dashboard?${q.toString()}`)
      .then((r) => setData(r.data))
      .catch(() => setError(t("carwash.failedLoad")));
    api
      .get(`/carwash/summary?startDate=${startDate}&endDate=${endDate}`)
      .then((r) => setSummary(r.data))
      .catch(() => undefined);
  }, [startDate, endDate, washerId, washTypeId, t]);

  useEffect(() => {
    if (canViewWashers) {
      api.get("/carwash/washers").then((r) => setWashers(r.data)).catch(() => undefined);
    }
    // Wash types are gated by carwash.prices.view (washers lack it) — only fetch
    // when allowed so the washer dashboard never fires a 403.
    if (canViewWashTypes) {
      api.get("/carwash/wash-types").then((r) => setWashTypes(r.data)).catch(() => undefined);
    }
  }, [canViewWashers, canViewWashTypes]);

  // Client-side text filter over the returned daily series / lists (the search
  // field narrows what the backend already scoped to this business + role).
  const filteredWashers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return washers;
    return washers.filter((w) => (w.name ?? "").toLowerCase().includes(q));
  }, [washers, search]);

  // --- Shared filter panel (same component every business uses) ---
  const filterBar = (
    <FilterPanel
      showDateFilter
      datePreset={datePreset}
      onDatePresetChange={setDatePreset}
      startDate={startDate}
      onStartDateChange={setStartDate}
      endDate={endDate}
      onEndDateChange={setEndDate}
      search={!isWasher && canViewWashers ? search : undefined}
      onSearchChange={!isWasher && canViewWashers ? setSearch : undefined}
      searchPlaceholder={t("carwash.washersLabel")}
      extra={
        <>
          {!isWasher && canViewWashers && (
            <FilterSelect
              value={washerId}
              onChange={setWasherId}
              label={t("carwash.washer")}
              allLabel={t("carwash.allWashers")}
              options={filteredWashers.map((w) => ({ value: String(w.id), label: w.name ?? `#${w.id}` }))}
            />
          )}
          {canViewWashTypes && (
            <FilterSelect
              value={washTypeId}
              onChange={setWashTypeId}
              label={t("carwash.washType")}
              allLabel={t("carwash.allWashTypes")}
              options={washTypes.map((w) => ({ value: String(w.id), label: w.name ?? `#${w.id}` }))}
            />
          )}
        </>
      }
    />
  );

  if (data?.role === "washer") {
    const daily = data.daily ?? [];
    const period = data.todayCommission ?? 0;
    const max = Math.max(period, 1);
    const progressPct = Math.round((period / max) * 100);
    const dailyChart = daily.map((d) => ({ name: d.date.slice(5), commission: d.commission }));

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{t("carwash.myDashboard")}</h1>
          {data.washerName && (
            <p className="text-sm text-gray-500 mt-1">
              {data.washerName} · {t("carwash.commission")} {data.commissionRate ?? 0}%
            </p>
          )}
        </div>

        {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}
        {filterBar}

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { label: t("carwash.washesToday"), value: data.todayWashes ?? 0, accent: "text-blue-600" },
            { label: t("carwash.revenueToday"), value: fmt(data.todayRevenue ?? 0), accent: "text-gray-800" },
            { label: t("carwash.myCommission"), value: fmt(data.todayCommission ?? 0), accent: "text-green-600" },
          ].map((c) => (
            <div key={c.label} className="bg-white p-4 rounded-lg border border-gray-200">
              <p className="text-xs text-gray-500">{c.label}</p>
              <p className={`text-2xl font-bold mt-1 ${c.accent}`}>{c.value}</p>
            </div>
          ))}
        </div>

        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-semibold text-gray-800">{t("carwash.incomeProgress")}</h2>
            <span className="text-xs text-gray-500">
              {data.startDate} → {data.endDate}
            </span>
          </div>
          <div className="h-3 w-full rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <p className="text-xs text-gray-500 mt-2">{t("carwash.todayCommission")}: {fmt(period)}</p>
        </div>

        {dailyChart.length > 0 && (
          <ChartCard
            title={`${t("carwash.myCommission")} — ${t("carwash.last7Days")}`}
            chart={
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyChart}>
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
                  { key: "name", label: t("carwash.date") },
                  { key: "commission", label: t("carwash.myCommission"), align: "right" },
                ]}
                rows={dailyChart}
                shareKey="commission"
                totals={{
                  name: t("common.total"),
                  commission: dailyChart.reduce((s: number, d: any) => s + (d.commission || 0), 0),
                }}
                totalsLabel={t("common.total")}
                money={fmt}
              />
            }
          />
        )}

        <div className="flex gap-2 flex-wrap text-sm">
          <Link href="/dashboard/carwash/washes" className="px-3 py-2 rounded bg-gray-800 text-white">
            {t("carwash.recordWashAction")}
          </Link>
        </div>
      </div>
    );
  }

  const cards = [
    { label: t("carwash.washesToday"), value: data?.todayWashes ?? 0, href: "/dashboard/carwash/washes", icon: "🧽", accent: "text-blue-600" },
    { label: t("carwash.revenueToday"), value: fmt(data?.todayRevenue ?? 0), href: "/dashboard/carwash/collection", icon: "💰", accent: "text-emerald-600" },
    { label: t("carwash.activeWashers"), value: data?.activeWashers ?? 0, href: "/dashboard/carwash/washers", icon: "👷", accent: "text-violet-600" },
    { label: t("carwash.openBookings"), value: data?.openBookings ?? 0, href: "/dashboard/carwash/bookings", icon: "📅", accent: "text-amber-600" },
  ];

  return (
    <div className="space-y-6">
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}
      {filterBar}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="bg-white p-4 rounded-lg border border-gray-200 hover:border-blue-300 transition"
          >
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span aria-hidden>{c.icon}</span>
              <span>{c.label}</span>
            </div>
            <p className={`text-2xl font-bold mt-1 ${c.accent}`}>{c.value}</p>
          </Link>
        ))}
      </div>

      {summary && (
        <ChartCard
          title={t("carwash.todayIncome")}
          chart={
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={[
                  { name: t("carwash.totalRevenue"), value: summary.totalRevenue },
                  { name: t("carwash.totalCommission"), value: summary.totalCommission },
                  { name: t("carwash.ownerShare"), value: summary.ownerShare },
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
                { key: "name", label: t("carwash.total"), },
                { key: "value", label: t("carwash.amount"), align: "right" },
              ]}
              rows={[
                { name: t("carwash.totalRevenue"), value: summary.totalRevenue },
                { name: t("carwash.totalCommission"), value: summary.totalCommission },
                { name: t("carwash.ownerShare"), value: summary.ownerShare },
              ]}
              money={fmt}
            />
          }
        />
      )}

      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-800 mb-2">{t("carwash.quickActions")}</h2>
        <div className="flex gap-2 flex-wrap text-sm">
          {hasPermission("carwash.bookings.create") && (
            <Link href="/dashboard/carwash/bookings" className="px-3 py-2 rounded bg-blue-600 text-white">
              {t("carwash.newBookingAction")}
            </Link>
          )}
          {hasPermission("carwash.washes.create") && (
            <Link href="/dashboard/carwash/washes" className="px-3 py-2 rounded bg-gray-800 text-white">
              {t("carwash.recordWashAction")}
            </Link>
          )}
          {hasPermission("carwash.washers.view") && (
            <Link href="/dashboard/carwash/washers" className="px-3 py-2 rounded border border-gray-300 text-gray-700">
              {t("carwash.manageWashers")}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
