"use client";

import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export default function CarWashCollectionPage() {
  const { hasPermission } = useAuth();
  const { t } = useTranslation();
  const [summary, setSummary] = useState<any>(null);
  const [collections, setCollections] = useState<any[]>([]);
  const [error, setError] = useState("");
  const canRecord = hasPermission("carwash.collections.create");

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([api.get("/carwash/summary"), api.get("/carwash/collections")]);
      setSummary(s.data);
      setCollections(c.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("carwash.failedLoad"));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const recordCollection = async () => {
    setError("");
    try {
      await api.post("/carwash/collections", {});
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedSave"));
    }
  };

  const tiles = summary
    ? [
        [t("carwash.totalRevenue"), summary.totalRevenue],
        [t("carwash.totalCommission"), summary.totalCommission],
        [t("carwash.ownerShare"), summary.ownerShare],
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
          <button onClick={recordCollection} className="bg-gray-800 text-white rounded px-4 py-2 text-sm font-medium">
            {t("carwash.recordCollection")}
          </button>
        )}
      </div>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {tiles.map(([label, value]) => (
          <div key={label} className="bg-white p-4 rounded-lg border border-gray-200">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-xl font-bold text-gray-800 mt-1">{(value ?? 0).toLocaleString()}</p>
          </div>
        ))}
      </div>

      {chartData.length > 0 && (
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <h2 className="font-semibold text-gray-800 mb-3">{t("carwash.todayBreakdown")}</h2>
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
        </div>
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
