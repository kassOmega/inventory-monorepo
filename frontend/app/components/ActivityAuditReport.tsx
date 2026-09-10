"use client";

import api from "@/lib/api";
import i18n from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useState } from "react";

const money = (n: number) =>
  `${(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${i18n.t("orders.birr")}`;

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};

const STATUS_STYLES: Record<string, string> = {
  DISPATCHED: "bg-amber-100 text-amber-800",
  PREPARING: "bg-blue-100 text-blue-800",
  READY: "bg-teal-100 text-teal-800",
  SERVED: "bg-purple-100 text-purple-800",
  PAID: "bg-green-100 text-green-800",
  CANCELLED: "bg-red-100 text-red-700",
};
const statusBadge = (s: string) => STATUS_STYLES[s] ?? "bg-gray-100 text-gray-700";

// Union of station names an order's items route through, e.g. "Butcher -> Kitchen".
const orderRoute = (order: any) => {
  const names: string[] = [];
  for (const it of order.items ?? []) {
    for (const r of it.route ?? []) {
      if (r.name && !names.includes(r.name)) names.push(r.name);
    }
    if ((it.route ?? []).length === 0 && it.stationName && !names.includes(it.stationName)) {
      names.push(it.stationName);
    }
  }
  return names.length ? names.join(" -> ") : "—";
};

// Role-colored step badges for the staff chain, e.g.
// [Waiter: Daniel Girma] ➔ [Prep: Fikru] ➔ [Ready: Fikru] ➔ [Cashier: Sara]
const CHAIN_ROLE_BADGE: Record<string, string> = {
  Waiter: "bg-blue-100 text-blue-800",
  Prep: "bg-amber-100 text-amber-800",
  Ready: "bg-green-100 text-green-800",
  Cashier: "bg-gray-100 text-gray-700",
  Manager: "bg-red-100 text-red-700",
};

const chainSteps = (order: any) =>
  (order.chain ?? []).map((c: any) => {
    let role = c.label ?? "—";
    if (role === "Station Prep") role = "Prep";
    else if (role === "Station Ready") role = "Ready";
    return {
      role,
      name: c.actorName ?? "?",
      badge: CHAIN_ROLE_BADGE[role] ?? "bg-gray-100 text-gray-700",
    };
  });

// Localized display for the known chain labels.
const roleKey = (label: string): string => {
  const map: Record<string, string> = {
    Waiter: "roleWaiter",
    Prep: "rolePrep",
    Ready: "roleReady",
    Cashier: "roleCashier",
    Manager: "roleManager",
    "Station Prep": "roleStationPrep",
    "Station Ready": "roleStationReady",
  };
  return map[label] ?? "";
};

interface Props {
  startDate: string;
  endDate: string;
}

export default function ActivityAuditReport({ startDate, endDate }: Props) {
  const { t } = useTranslation();
  const [station, setStation] = useState("");
  const [userId, setUserId] = useState("");
  const [stations, setStations] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [data, setData] = useState<any>(null);
  const [detailOrder, setDetailOrder] = useState<any>(null);
  // Order ids whose full item list is expanded in-place (vs truncated to 3).
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams();
      if (startDate) q.set("startDate", startDate);
      if (endDate) q.set("endDate", endDate);
      if (station) q.set("station", station);
      if (userId) q.set("userId", userId);
      const r = await api.get(`/reports/hospitality-activity?${q.toString()}`);
      setData(r.data);
    } catch {
      setData(null);
    }
  }, [startDate, endDate, station, userId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .get("/restaurant/stations")
      .then((r) => setStations(Array.isArray(r.data) ? r.data : []))
      .catch(() => {});
    api
      .get("/users")
      .then((r) => setUsers(Array.isArray(r.data) ? r.data : []))
      .catch(() => {});
  }, []);

  const orders = data?.orders ?? [];
  const byStation = data?.summary?.byStation ?? [];
  const byRole = data?.summary?.byRole ?? [];
  const tStatus = (s: string) =>
    (t(`orders.st.${s.toLowerCase()}`, { defaultValue: s }) as string) ?? s;
  const lc = (label: string) => {
    const k = roleKey(label);
    return k ? (t(`act.${k}`) as string) : label;
  };

  return (
    <div className="space-y-6">
      {/* Filters: station + specific user */}
      <div className="bg-white rounded-xl shadow-sm border p-3 sm:p-4 flex flex-wrap items-center gap-3">
        <span className="text-sm text-gray-500">{t("act.filters")}</span>
        <select
          value={station}
          onChange={(e) => setStation(e.target.value)}
          className="border border-gray-300 rounded-lg p-2 text-sm bg-white"
        >
          <option value="">{t("act.allStations")}</option>
          {stations.map((s) => (
            <option key={s.id} value={s.key}>{s.name}</option>
          ))}
        </select>
        <select
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className="border border-gray-300 rounded-lg p-2 text-sm bg-white"
        >
          <option value="">{t("act.allStaff")}</option>
          {users.map((u) => (
            <option key={u.id} value={String(u.id)}>{u.name}</option>
          ))}
        </select>
      </div>

      {/* Aggregations: by station & by role */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-5">
          <h3 className="text-base font-semibold mb-3">{t("act.byStation")}</h3>
          {byStation.length === 0 ? (
            <p className="text-gray-400 text-sm">{t("act.noActivity")}</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="p-2">{t("act.colStation")}</th>
                  <th className="p-2 text-right">{t("act.colItems")}</th>
                  <th className="p-2 text-right">{t("act.colOrders")}</th>
                  <th className="p-2 text-right">{t("act.colAvgPrep")}</th>
                </tr>
              </thead>
              <tbody>
                {byStation.map((s: any) => (
                  <tr key={s.station} className="border-b">
                    <td className="p-2 font-medium">{s.station}</td>
                    <td className="p-2 text-right">{s.itemsPrepared}</td>
                    <td className="p-2 text-right">{s.orders}</td>
                    <td className="p-2 text-right">{s.avgPrepTimeMin > 0 ? t("act.minLabel", { n: s.avgPrepTimeMin }) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-5">
          <h3 className="text-base font-semibold mb-3">{t("act.byRole")}</h3>
          {byRole.length === 0 ? (
            <p className="text-gray-400 text-sm">{t("act.noActivity")}</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="p-2">{t("act.colRole")}</th>
                  <th className="p-2 text-right">{t("act.colActions")}</th>
                  <th className="p-2 text-right">{t("act.colOrders")}</th>
                </tr>
              </thead>
              <tbody>
                {byRole.map((r: any) => (
                  <tr key={r.role} className="border-b">
                    <td className="p-2 font-medium">{lc(r.role)}</td>
                    <td className="p-2 text-right">{r.actions}</td>
                    <td className="p-2 text-right">{r.orders}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>


      {/* Order ID & item chain audit log */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b">
          <h3 className="text-gray-700 text-base sm:text-lg font-semibold">
            {t("act.logTitle")}
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {t("act.logHint")}
          </p>
        </div>
        {orders.length === 0 ? (
          <p className="p-4 sm:p-6 text-center text-gray-400 text-sm">{t("act.noOrders")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="p-2 sm:p-3 whitespace-nowrap">{t("act.colOrderId")}</th>
                  <th className="p-2 sm:p-3 whitespace-nowrap">{t("act.colItems")}</th>
                  <th className="p-2 sm:p-3 whitespace-nowrap">{t("act.colStations")}</th>
                  <th className="p-2 sm:p-3 whitespace-nowrap">{t("act.colStaffChain")}</th>
                  <th className="p-2 sm:p-3 whitespace-nowrap">{t("act.colPlaced")}</th>
                  <th className="p-2 sm:p-3 text-right whitespace-nowrap">{t("act.colTotal")}</th>
                  <th className="p-2 sm:p-3 text-center whitespace-nowrap">{t("act.colDelay")}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o: any) => {
                  const allItems: any[] = o.items ?? [];
                  const expanded = expandedItems.has(o.id);
                  const shownItems = expanded ? allItems : allItems.slice(0, 3);
                  return (
                    <tr
                      key={o.id}
                      onClick={() => setDetailOrder(o)}
                      className="border-b hover:bg-gray-50 cursor-pointer"
                    >
                      <td className="p-2 sm:p-3 whitespace-nowrap">
                        <span className="font-mono text-xs text-blue-700 font-semibold hover:underline">
                          {o.orderNumber}
                        </span>
                        <span className="block text-[10px] text-gray-400 mt-0.5">
                          <span className={`px-1.5 py-0.5 rounded-full font-medium ${statusBadge(o.status)}`}>{tStatus(o.status)}</span>
                        </span>
                      </td>
                      <td className="p-2 sm:p-3">
                        <ul className="space-y-0.5">
                          {shownItems.map((it: any, idx: number) => (
                            <li key={it.id ?? idx} className="text-xs text-gray-600 whitespace-nowrap">
                              • {it.name} x{it.quantity} ({money(it.unitPrice)})
                            </li>
                          ))}
                          {allItems.length > 3 && !expanded && (
                            <li>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedItems((prev) => {
                                    const next = new Set(prev);
                                    next.add(o.id);
                                    return next;
                                  });
                                }}
                                className="text-[11px] text-blue-600 hover:underline font-medium"
                              >
                                {t("act.moreItems", { count: allItems.length - 3 })}
                              </button>
                            </li>
                          )}
                        </ul>
                      </td>
                      <td className="p-2 sm:p-3 text-xs text-gray-500 whitespace-nowrap">{orderRoute(o)}</td>
                      <td className="p-2 sm:p-3">
                        <span className="inline-flex flex-wrap items-center gap-1">
                          {chainSteps(o).map((step: any, i: number) => (
                            <span key={i} className="inline-flex items-center gap-1">
                              {i > 0 && <span className="text-gray-400 text-xs">➔</span>}
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${step.badge}`}>
                                {lc(step.role)}: {step.name}
                              </span>
                            </span>
                          ))}
                        </span>
                      </td>
                      <td className="p-2 sm:p-3 text-xs text-gray-500 whitespace-nowrap">{fmtTime(o.createdAt)}</td>
                      <td className="p-2 sm:p-3 text-right font-semibold whitespace-nowrap">{money(o.totalAmount)}</td>
                      <td className="p-2 sm:p-3 text-center whitespace-nowrap">
                        {(o.hanging ?? []).length > 0 ? (
                          <span className="inline-block bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-[11px] font-semibold">
                            {t("act.hangFlag", { stations: o.hanging.map((h: any) => h.station).join(", "), min: o.hanging[0].durationMin })}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>


      {/* Order detail modal: full items + lifecycle timeline */}
      {detailOrder && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setDetailOrder(null)}
        >
          <div
            className="bg-white rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 mb-3">
              <div>
                <h2 className="font-semibold text-gray-800 font-mono">{detailOrder.orderNumber}</h2>
                <p className="text-xs text-gray-400">
                  {fmtTime(detailOrder.createdAt)}
                  {detailOrder.tableName ? ` · ${t("orders.tablePrefix", { name: detailOrder.tableName })}` : ""}
                  {detailOrder.ticketTimeMin != null ? t("act.ticketMin", { min: detailOrder.ticketTimeMin }) : ""}
                </p>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${statusBadge(detailOrder.status)}`}>
                {tStatus(detailOrder.status)}
              </span>
            </div>

            {/* Full item breakdown */}
            <div className="border border-gray-200 rounded-lg mb-4">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-3 pt-2 pb-1">
                Items
              </p>
              {(detailOrder.items ?? []).map((it: any, idx: number) => (
                <div key={it.id ?? idx} className="flex items-center justify-between px-3 py-1.5 text-sm">
                  <span className="text-gray-700">
                    {it.name} x{it.quantity}
                  </span>
                  <span className="text-xs text-gray-400">
                    {money(it.unitPrice)} {t("act.each")}
                    {it.status ? ` · ${tStatus(it.status)}` : ""}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 text-sm font-semibold">
                <span>{t("orders.totalLabel")}</span>
                <span>{money(detailOrder.totalAmount)}</span>
              </div>
            </div>

            {/* Settlement status + stage durations */}
            <div className="border border-gray-200 rounded-lg mb-4">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-3 pt-2 pb-1">
                {t("act.stagesTitle")}
              </p>
              {(detailOrder.stages ?? []).length === 0 ? (
                <p className="px-3 pb-2 text-xs text-gray-400">{t("act.noStages")}</p>
              ) : (
                (detailOrder.stages ?? []).map((s: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between px-3 py-1.5 text-sm">
                    <span className="text-gray-700">{s.station}</span>
                    <span className="text-xs">
                      <span className={s.hanging ? "text-red-600 font-semibold" : "text-gray-500"}>
                        {fmtTime(s.startedAt)} → {s.readyAt ? fmtTime(s.readyAt) : t("act.now")} · {t("act.minLabel", { n: s.durationMin })}
                        {s.hanging ? ` ${t("act.hangShort")}` : ""}
                      </span>
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Lifecycle chain timeline */}
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">
              {t("act.timeline")}
            </p>
            {(detailOrder.chain ?? []).length === 0 ? (
              <p className="text-sm text-gray-400">{t("act.noHistory")}</p>
            ) : (
              <ol className="space-y-2">
                {(detailOrder.chain ?? []).map((c: any, idx: number) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <span className="mt-1.5 h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                    <div>
                      <p className="text-gray-700">
                        {lc(c.label)}
                        {c.actorName ? <span className="text-gray-400"> {t("orders.byActor", { name: c.actorName })}</span> : null}
                        {c.actorRole && c.actorRole !== c.label ? (
                          <span className="text-gray-400"> ({lc(c.actorRole)})</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-gray-400">{fmtTime(c.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}

            <div className="flex justify-end mt-4">
              <button
                onClick={() => setDetailOrder(null)}
                className="px-4 py-2 rounded bg-gray-200 text-gray-700 text-sm font-medium"
              >
                {t("orders.close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

