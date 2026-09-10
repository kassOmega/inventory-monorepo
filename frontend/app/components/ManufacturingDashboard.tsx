"use client";

import DateFilter, { getDateRange } from "@/app/components/DateFilter";
import { statusLabel } from "@/lib/statusLabel";
import api from "@/lib/api";
import i18n from "@/lib/i18n";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type DatePreset = "today" | "week" | "month" | "year";

const money = (n: number) =>
  `${(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${i18n.t("orders.birr")}`;

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  SCHEDULED: "bg-amber-100 text-amber-800",
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  COMPLETED: "bg-green-100 text-green-800",
  CANCELLED: "bg-red-100 text-red-700",
};
const statusBadge = (s: string) => STATUS_STYLES[s] ?? "bg-gray-100 text-gray-700";

export default function ManufacturingDashboard() {
  const { t } = useTranslation();
  const [datePreset, setDatePreset] = useState<DatePreset>("week");
  const [startDate, setStartDate] = useState(() => getDateRange("week").start);
  const [endDate, setEndDate] = useState(() => getDateRange("week").end);
  const [data, setData] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get(
        `/reports/manufacturing-dashboard?startDate=${startDate}&endDate=${endDate}`,
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

  const statuses = data?.statusCount ?? {};
  const open =
    (statuses.DRAFT ?? 0) +
    (statuses.SCHEDULED ?? 0) +
    (statuses.IN_PROGRESS ?? 0);
  const completed = statuses.COMPLETED ?? 0;
  const produced = data?.produced ?? 0;
  const targeted = data?.targeted ?? 0;

  const kpis = [
    { label: t("mfg.home.kpiBoms"), value: String(data?.bomsTotal ?? 0), accent: "text-blue-700" },
    { label: t("mfg.home.kpiOpen"), value: String(open), accent: "text-amber-600" },
    { label: t("mfg.home.kpiCompleted"), value: String(completed), accent: "text-green-700" },
    { label: t("mfg.home.kpiProduced"), value: `${produced} / ${targeted}`, accent: "text-purple-700" },
    { label: t("mfg.home.kpiCogm"), value: money(data?.cogmTotal), accent: "text-gray-800" },
    { label: t("mfg.home.kpiAvgCogm"), value: money(data?.avgCogmUnit), accent: "text-gray-800" },
    { label: t("mfg.home.kpiScrap"), value: money(data?.scrap?.value), accent: "text-red-600" },
    { label: t("mfg.home.kpiStock"), value: money(data?.stockValue), accent: "text-indigo-700" },
    { label: t("mfg.home.kpiJobs"), value: String(data?.jobs?.open ?? 0), accent: "text-cyan-700" },
    { label: t("mfg.home.kpiServiceIncome"), value: money(data?.serviceIncome?.value), accent: "text-teal-700" },
  ];


  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <p className="text-gray-500 text-sm">{t("mfg.home.note")}</p>
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

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white rounded-xl shadow-sm border p-4">
            <p className="text-xs text-gray-400">{k.label}</p>
            <p className={`text-xl font-bold mt-1 ${k.accent}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <h3 className="px-4 sm:px-5 py-3 font-semibold border-b border-gray-100">
            {t("mfg.home.recentOrders")}
          </h3>
          {(data?.recentWorkOrders ?? []).length === 0 ? (
            <p className="p-5 text-sm text-gray-400">{t("mfg.home.noOrders")}</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {(data?.recentWorkOrders ?? []).map((w: any) => (
                <li key={w.id} className="px-4 sm:px-5 py-3 text-sm flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-800">
                      {w.finishedProduct?.baseName ?? `#${w.finishedProductId}`}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {w.location?.name ?? "—"} · {t("mfg.workOrders.colBatch")} {w.batchNumber ?? "—"}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${statusBadge(w.status)}`}>
                      {statusLabel(w.status)}
                    </span>
                    <p className="text-xs text-gray-500 mt-1">
                      {w.producedQuantity} / {w.targetQuantity}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <h3 className="px-4 sm:px-5 py-3 font-semibold border-b border-gray-100">
            {t("mfg.home.recentBatches")}
          </h3>
          {(data?.recentBatches ?? []).length === 0 ? (
            <p className="p-5 text-sm text-gray-400">{t("mfg.home.noBatches")}</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {(data?.recentBatches ?? []).map((b: any) => (
                <li key={b.id} className="px-4 sm:px-5 py-3 text-sm flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-800">
                      {b.product?.baseName ?? `#${b.productId}`}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{b.batchNumber}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-semibold text-gray-700">{b.quantity}</p>
                    <p className="text-xs text-gray-400">{money(b.unitCost)}{t("mfg.home.perUnit")}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

