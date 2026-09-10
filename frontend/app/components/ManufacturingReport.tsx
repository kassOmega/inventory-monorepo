"use client";

import { statusLabel } from "@/lib/statusLabel";
import api from "@/lib/api";
import i18n from "@/lib/i18n";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

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

interface Props {
  startDate: string;
  endDate: string;
  locationId?: number;
}

export default function ManufacturingReport({
  startDate,
  endDate,
  locationId,
}: Props) {
  const { t } = useTranslation();
  const [data, setData] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const loc = locationId ? `&locationId=${locationId}` : "";
      const r = await api.get(
        `/reports/manufacturing-dashboard?startDate=${startDate}&endDate=${endDate}${loc}`,
      );
      setData(r.data);
    } catch {
      /* keep last data */
    }
  }, [startDate, endDate, locationId]);

  useEffect(() => {
    load();
  }, [load]);

  const statuses = data?.statusCount ?? {};
  const orderStatus = [
    "DRAFT",
    "SCHEDULED",
    "IN_PROGRESS",
    "COMPLETED",
    "CANCELLED",
  ];

  const kpis = [
    { label: t("mfg.report.kpiCompleted"), value: String(statuses.COMPLETED ?? 0), accent: "text-blue-700" },
    { label: t("mfg.report.kpiProduced"), value: `${data?.produced ?? 0} / ${data?.targeted ?? 0}`, accent: "text-green-700" },
    { label: t("mfg.report.kpiCogm"), value: money(data?.cogmTotal), accent: "text-gray-800" },
    { label: t("mfg.report.kpiAvgCogm"), value: money(data?.avgCogmUnit), accent: "text-gray-800" },
    { label: t("mfg.report.kpiScrap"), value: money(data?.scrap?.value), accent: "text-red-600" },
    { label: t("mfg.report.kpiStock"), value: money(data?.stockValue), accent: "text-indigo-700" },
    { label: t("mfg.home.kpiJobs"), value: String(data?.jobs?.open ?? 0), accent: "text-cyan-700" },
    { label: t("mfg.home.kpiServiceIncome"), value: money(data?.serviceIncome?.value), accent: "text-teal-700" },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-5">
        <h3 className="text-base font-semibold mb-3">{t("mfg.report.statusTitle")}</h3>
        <div className="flex flex-wrap gap-2">
          {orderStatus.map((st) => {
            const n = statuses[st] ?? 0;
            return (
              <span key={st} className={`text-xs px-3 py-1.5 rounded-full font-semibold ${statusBadge(st)}`}>
                {statusLabel(st)}: {n}
              </span>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white rounded-xl shadow-sm border p-4">
            <p className="text-xs text-gray-400">{k.label}</p>
            <p className={`text-lg font-bold mt-1 ${k.accent}`}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
        <h3 className="px-4 sm:px-5 py-3 font-semibold border-b border-gray-100">
          {t("mfg.report.ordersTitle")}
        </h3>
        {(data?.recentWorkOrders ?? []).length === 0 ? (
          <p className="p-5 text-sm text-gray-400">{t("mfg.report.noOrders")}</p>
        ) : (
          <table className="w-full text-left text-xs sm:text-sm min-w-[640px]">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="p-3">{t("mfg.workOrders.colProduct")}</th>
                <th className="p-3">{t("mfg.workOrders.colLocation")}</th>
                <th className="p-3 text-center">{t("mfg.workOrders.colQuantity")}</th>
                <th className="p-3">{t("mfg.workOrders.colBatch")}</th>
                <th className="p-3">{t("mfg.workOrders.colStatus")}</th>
                <th className="p-3 text-right">{t("mfg.workOrders.colCogm")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(data?.recentWorkOrders ?? []).map((w: any) => (
                <tr key={w.id} className="hover:bg-gray-50">
                  <td className="p-3 font-medium">
                    {w.finishedProduct?.baseName ?? `#${w.finishedProductId}`}
                  </td>
                  <td className="p-3 text-gray-500">{w.location?.name ?? "—"}</td>
                  <td className="p-3 text-center">
                    {w.targetQuantity} / {w.producedQuantity || 0}
                  </td>
                  <td className="p-3 text-gray-500">{w.batchNumber ?? "—"}</td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${statusBadge(w.status)}`}>
                      {statusLabel(w.status)}
                    </span>
                  </td>
                  <td className="p-3 text-right">{money(w.cogmUnitCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

