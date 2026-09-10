"use client";

import DateFilter, { getDateRange } from "@/app/components/DateFilter";
import api from "@/lib/api";
import i18n from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useState } from "react";

type DatePreset = "today" | "week" | "month" | "year";

const money = (n: number) =>
  `${(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${i18n.t("orders.birr")}`;

const STATUS_STYLES: Record<string, string> = {
  DISPATCHED: "bg-amber-100 text-amber-800",
  PREPARING: "bg-blue-100 text-blue-800",
  READY: "bg-teal-100 text-teal-800",
  SERVED: "bg-purple-100 text-purple-800",
  PAID: "bg-green-100 text-green-800",
  CANCELLED: "bg-red-100 text-red-700",
};
const statusBadge = (s: string) => STATUS_STYLES[s] ?? "bg-gray-100 text-gray-700";

export default function HospitalityDashboard() {
  const { t } = useTranslation();
  const tStatus = (s: string) =>
    (t(`orders.st.${s.toLowerCase()}`, { defaultValue: s }) as string) ?? s;
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [startDate, setStartDate] = useState(() => getDateRange("today").start);
  const [endDate, setEndDate] = useState(() => getDateRange("today").end);
  const [data, setData] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get(
        `/reports/hospitality-dashboard?startDate=${startDate}&endDate=${endDate}`,
      );
      setData(r.data);
    } catch {
      /* keep last data */
    }
  }, [startDate, endDate]);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  const kpis = [
    { label: t("hdb.totalRevenue"), value: money(data?.revenue), accent: "text-green-700" },
    { label: t("hdb.activeOrders"), value: String(data?.activeOrders ?? 0), accent: "text-blue-700" },
    { label: t("hdb.avgTicketTime"), value: t("hdb.minutesShort", { n: data?.avgTicketTime ?? 0 }), accent: "text-orange-600" },
    { label: t("hdb.occupiedTables"), value: String(data?.occupiedTables ?? 0), accent: "text-purple-700" },
  ];

  const maxItem = Math.max(1, ...(data?.topItems ?? []).map((t: any) => t.qty));
  const maxCat = Math.max(1, ...(data?.topCategories ?? []).map((c: any) => c.qty));

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <p className="text-gray-500 text-sm">{t("hdb.overviewNote")}</p>
        <div className="bg-white rounded-xl shadow-sm border p-2">
          <DateFilter
            preset={datePreset}
            onPresetChange={setDatePreset}
            startDate={startDate}
            onStartDateChange={setStartDate}
            endDate={endDate}
            onEndDateChange={setEndDate}
          />
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white rounded-xl shadow-sm border p-4">
            <p className="text-xs text-gray-400">{k.label}</p>
            <p className={`text-xl font-bold mt-1 ${k.accent}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Station breakdown + Top selling */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-white rounded-xl shadow-sm border p-4 sm:p-5">
          <h3 className="text-base font-semibold mb-3">{t("hdb.stationBreakdown")}</h3>
          {(data?.stationBreakdown ?? []).length === 0 ? (
            <p className="text-gray-400 text-sm">{t("hdb.noActiveTickets")}</p>
          ) : (
            <div className="space-y-3">
              {(data.stationBreakdown ?? []).map((s: any) => (
                <div key={s.station} className="flex items-center justify-between border-b border-gray-50 last:border-0 pb-2">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{s.station}</p>
                    <p className="text-xs text-gray-400">
                      {s.active === 1
                        ? t("hdb.activeTicketOne", { count: s.active })
                        : t("hdb.activeTickets", { count: s.active })}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-blue-700">
                    {s.avgPrepTimeMin > 0
                      ? t("hdb.minutesShort", { n: `~${s.avgPrepTimeMin}` })
                      : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border p-4 sm:p-5">
          <h3 className="text-base font-semibold mb-3">{t("hdb.topSelling")}</h3>
          {(data?.topItems ?? []).length === 0 ? (
            <p className="text-gray-400 text-sm">{t("hdb.noItemsSold")}</p>
          ) : (
            <ul className="space-y-2">
              {(data.topItems ?? []).map((item: any) => (
                <li key={item.name}>
                  <div className="flex justify-between text-sm mb-0.5">
                    <span className="font-medium text-gray-800">{item.name}</span>
                    <span className="text-gray-500">{t("hdb.soldCount", { count: item.qty })}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 rounded-full"
                      style={{ width: `${Math.round((item.qty / maxItem) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>


      {/* Top categories */}
      <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-5">
        <h3 className="text-base font-semibold mb-3">{t("hdb.topCategories")}</h3>
        {(data?.topCategories ?? []).length === 0 ? (
          <p className="text-gray-400 text-sm">{t("hdb.noCategorySales")}</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {(data.topCategories ?? []).map((c: any) => (
              <div key={c.name} className="border border-gray-100 rounded-lg p-3">
                <p className="text-sm font-medium text-gray-800">{c.name}</p>
                <p className="text-xs text-gray-400">
                  {c.qty === 1
                    ? t("orders.itemCount", { count: c.qty })
                    : t("orders.itemCountPlural", { count: c.qty })}
                </p>
                <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full"
                    style={{ width: `${Math.round((c.qty / maxCat) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Live guest folio */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b flex items-center justify-between">
          <h3 className="text-gray-700 text-base sm:text-lg font-semibold">{t("hdb.folioTitle")}</h3>
          <span className="text-xs text-gray-400">{t("hdb.folioSub")}</span>
        </div>
        {(data?.guestFolio ?? []).length === 0 ? (
          <p className="p-4 sm:p-6 text-center text-gray-400 text-sm">{t("hdb.noFolio")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="p-2 sm:p-3">{t("hdb.thTable")}</th>
                  <th className="p-2 sm:p-3">{t("hdb.thOrder")}</th>
                  <th className="p-2 sm:p-3">{t("hdb.thStatus")}</th>
                  <th className="p-2 sm:p-3 text-right">{t("hdb.thTotal")}</th>
                </tr>
              </thead>
              <tbody>
                {(data.guestFolio ?? []).map((f: any) => (
                  <tr key={f.orderId} className="border-b">
                    <td className="p-2 sm:p-3 font-medium">{f.tableName ?? `#${f.tableId}`}</td>
                    <td className="p-2 sm:p-3 font-mono text-xs">{f.orderNumber}</td>
                    <td className="p-2 sm:p-3">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${statusBadge(f.status)}`}>{tStatus(f.status)}</span>
                    </td>
                    <td className="p-2 sm:p-3 text-right font-semibold">{money(f.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

