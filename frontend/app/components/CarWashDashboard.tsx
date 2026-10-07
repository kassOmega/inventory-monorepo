"use client";

import api from "@/lib/api";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Car-wash vertical overview (stat tiles + quick actions), consumed by
// `/dashboard/carwash` and the dashboard home for CAR_WASH users.
interface CarWashDashboardData {
  role?: "washer" | "staff";
  washerName?: string | null;
  commissionRate?: number | null;
  todayWashes?: number;
  todayRevenue?: number;
  todayCommission?: number;
  weekCommission?: number;
  daily?: Array<{ date: string; commission: number; revenue: number }>;
  activeWashers?: number;
  openBookings?: number;
}

const fmt = (n: number) =>
  (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

export default function CarWashDashboard() {
  const { t } = useTranslation();
  const [data, setData] = useState<CarWashDashboardData | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/carwash/dashboard").then((r) => setData(r.data)).catch(() => setError(t("carwash.failedLoad")));
    api.get("/carwash/summary").then((r) => setSummary(r.data)).catch(() => undefined);
  }, [t]);

  if (data?.role === "washer") {
    const daily = data.daily ?? [];
    const week = data.weekCommission ?? 0;
    const today = data.todayCommission ?? 0;
    const progressMax = Math.max(week, today, 1);
    const progressPct = Math.round((today / progressMax) * 100);
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
            <span className="text-xs text-gray-500">{t("carwash.weekCommission")}: {fmt(week)}</span>
          </div>
          <div className="h-3 w-full rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <p className="text-xs text-gray-500 mt-2">{t("carwash.todayCommission")}: {fmt(today)}</p>
        </div>

        {dailyChart.length > 0 && (
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <h2 className="font-semibold text-gray-800 mb-3">{t("carwash.myCommission")} — {t("carwash.last7Days")}</h2>
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
          </div>
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
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <h2 className="font-semibold text-gray-800 mb-3">{t("carwash.todayIncome")}</h2>
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
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-800 mb-2">{t("carwash.quickActions")}</h2>
        <div className="flex gap-2 flex-wrap text-sm">
          <Link href="/dashboard/carwash/bookings" className="px-3 py-2 rounded bg-blue-600 text-white">
            {t("carwash.newBookingAction")}
          </Link>
          <Link href="/dashboard/carwash/washes" className="px-3 py-2 rounded bg-gray-800 text-white">
            {t("carwash.recordWashAction")}
          </Link>
          <Link href="/dashboard/carwash/washers" className="px-3 py-2 rounded border border-gray-300 text-gray-700">
            {t("carwash.manageWashers")}
          </Link>
        </div>
      </div>
    </div>
  );
}
