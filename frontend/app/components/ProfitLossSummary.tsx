"use client";

import api from "@/lib/api";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";

interface Props {
  startDate: string;
  endDate: string;
}

const money = (n: number) =>
  (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * At-a-glance P&L summary (Total Revenue / Cost of Goods Sold / Total
 * Expenses / Gross Profit / Net Profit) for a date range, backed by
 * GET /finance/profit-loss. Renders nothing while loading or on error so it
 * never blocks the reports page.
 */
export default function ProfitLossSummary({ startDate, endDate }: Props) {
  const { t } = useTranslation();
  const [pl, setPl] = useState<any>(null);

  useEffect(() => {
    api
      .get(`/finance/profit-loss?startDate=${startDate}&endDate=${endDate}`)
      .then((r) => setPl(r.data))
      .catch(() => setPl(null));
  }, [startDate, endDate]);

  if (!pl) return null;

  const cards = [
    { label: t("reports.plTotalRevenue"), value: pl.totalRevenue ?? 0, color: "text-gray-800" },
    { label: t("reports.plCostOfGoods"), value: pl.costOfGoodsSold ?? 0, color: "text-red-600" },
    { label: t("reports.plOperationalExpenses"), value: pl.expenses ?? 0, color: "text-red-600" },
    { label: t("reports.plTotalExpenses"), value: pl.totalCosts ?? 0, color: "text-red-600" },
    { label: t("reports.plGrossProfit"), value: pl.grossProfit ?? 0, color: "text-gray-800" },
    {
      label: t("reports.plNetProfit"),
      value: pl.netProfit ?? 0,
      color: (pl.netProfit ?? 0) >= 0 ? "text-green-700" : "text-red-600",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="bg-white rounded-xl shadow-sm border p-4">
          <p className="text-xs text-gray-400">{c.label}</p>
          <p className={`text-lg font-bold ${c.color}`}>{money(c.value)}</p>
        </div>
      ))}
    </div>
  );
}
