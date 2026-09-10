"use client";

import api from "@/lib/api";
import i18n from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

interface Props {
  startDate: string;
  endDate: string;
}

const money = (n: number) => `${(n ?? 0).toFixed(2)} ${i18n.t("orders.birr")}`;

export default function HospitalityReport({ startDate, endDate }: Props) {
  const { t } = useTranslation();
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    api
      .get(`/reports/hospitality?startDate=${startDate}&endDate=${endDate}`)
      .then((r) => setData(r.data))
      .catch(() => setData(null));
  }, [startDate, endDate]);

  if (!data) return <div className="p-8 text-gray-400">{t("common.loading")}</div>;

  const kpis = [
    { label: t("hr.orders"), value: data.orders, color: "text-gray-800" },
    { label: t("hr.revenue"), value: money(data.revenue), color: "text-green-700" },
    { label: t("hr.serviceCharge"), value: money(data.serviceCharge), color: "text-gray-800" },
    { label: t("hr.tax"), value: money(data.tax), color: "text-gray-800" },
    { label: t("hr.discounts"), value: money(data.discount), color: "text-red-600" },
    { label: t("hr.itemsSold"), value: data.itemsSold, color: "text-gray-800" },
    { label: t("hr.avgOrder"), value: money(data.avgOrder), color: "text-blue-700" },
  ];

  const stationData = data.byStation ?? [];
  const maxTopQty = Math.max(1, ...(data.topItems ?? []).map((ti: any) => ti.qty));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white rounded-xl shadow-sm border p-4">
            <p className="text-xs text-gray-400">{k.label}</p>
            <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
          <h3 className="text-base font-semibold mb-3">{t("hr.revenueByStation")}</h3>
          {stationData.length === 0 ? (
            <p className="text-gray-400 text-sm">{t("hr.noSettled")}</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stationData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="station" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }}
                    formatter={(value: any, name: any) => [money(Number(value)), name === "revenue" ? t("hr.revenue") : t("hr.qty")]}
                  />
                  <Bar dataKey="revenue" name="revenue" radius={[4, 4, 0, 0]}>
                    {stationData.map((_: any, i: number) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {stationData.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {stationData.map((s: any, i: number) => (
                <li key={s.station} className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                    {s.station}
                  </span>
                  <span className="text-gray-500">{t("hr.itemsLabel", { qty: s.qty })} · {money(s.revenue)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
          <h3 className="text-base font-semibold mb-3">{t("hr.topSellingItems")}</h3>
          {data.topItems?.length === 0 ? (
            <p className="text-gray-400 text-sm">{t("hr.noItemsSold")}</p>
          ) : (
            <ul className="space-y-2.5">
              {(data.topItems ?? []).map((ti: any) => (
                <li key={ti.name}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-gray-800">{ti.name}</span>
                    <span className="text-gray-500">{ti.qty} × {money(ti.revenue)}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 rounded-full"
                      style={{ width: `${Math.round((ti.qty / maxTopQty) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
        <h3 className="text-base font-semibold mb-3">{t("sr.paymentMethods")}</h3>
        {data.paymentMethods?.length === 0 ? (
          <p className="text-gray-400 text-sm">{t("hr.noPayments")}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="p-2 sm:p-3">{t("sr.method")}</th>
                <th className="p-2 sm:p-3 text-right">{t("sr.count")}</th>
                <th className="p-2 sm:p-3 text-right">{t("sr.total")}</th>
              </tr>
            </thead>
            <tbody>
              {(data.paymentMethods ?? []).map((pm: any) => (
                <tr key={pm.method} className="border-b">
                  <td className="p-2 sm:p-3 font-medium">{pm.method}</td>
                  <td className="p-2 sm:p-3 text-right">{pm.count}</td>
                  <td className="p-2 sm:p-3 text-right font-semibold">{money(pm.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
