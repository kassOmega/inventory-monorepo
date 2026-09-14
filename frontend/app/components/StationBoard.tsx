"use client";

import api from "@/lib/api";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useState } from "react";

const NEXT: Record<string, string> = {
  QUEUED: "PREPARING",
  PREPARING: "READY",
  // Stations stop at READY — the waiter marks SERVED when taking the order
  // to the customer, and multi-hop items are handed to the next station.
};

export default function StationBoard({ station }: { station: string }) {
  const { t } = useTranslation();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const statusWord = (s: string) =>
    (t(`board.st.${s.toLowerCase()}`, { defaultValue: s }) as string) ?? s;

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/restaurant/kitchen?station=${station}`);
      setOrders(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("board.failedLoad"));
    } finally {
      setLoading(false);
    }
  }, [station]);

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [load]);

  const advance = async (orderId: number, itemId: number, status: string) => {
    const next = NEXT[status];
    if (!next) return;
    try {
      await api.patch(`/restaurant/orders/${orderId}/items/${itemId}/status`, { status: next });
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("board.failedUpdateItem"));
    }
  };

  // Multi-hop handoff: move an item to the next station in its route.
  const advanceToNext = async (orderId: number, itemId: number) => {
    try {
      await api.post(`/restaurant/orders/${orderId}/items/${itemId}/advance`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("board.failedHandoff"));
    }
  };

  const nextStationName = (it: any) => {
    const route: any[] = it.stationRoute ?? [];
    return route[it.stationIndex + 1]?.name ?? null;
  };

  // Full route for the item (e.g. "Butcher → Kitchen → Bar").
  const routeName = (it: { stationRoute?: Array<{ name: string }> }) =>
    (it.stationRoute ?? []).map((r) => r.name).join(" → ");

  if (loading) return <p className="text-gray-500 p-6">{t("board.loading", { station })}</p>;

  const boardOrders = orders.filter((o) => (o.items ?? []).length > 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">{t("board.title", { station })}</h1>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {boardOrders.map((o) => (
          <div key={o.id} className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="font-medium text-sm text-gray-800">
                {o.orderNumber}
                {o.table ? ` · ${o.table.name}` : ""}
                {o.guestTag && (
                  <span className="ml-2 inline-block bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded text-[10px] font-medium align-middle">
                    {o.guestTag}
                  </span>
                )}
              </span>
              <span className="text-xs text-gray-400">{statusWord(o.status)}</span>
            </div>
            <ul className="space-y-2">
              {o.items.map((it: any) => {
                const nextName = nextStationName(it);
                const readyWithNext = it.status === "READY" && nextName;
                return (
                  <li key={it.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-gray-700">
                      {it.quantity}× {it.name}
                      {(routeName(it) || nextName) && it.status !== "SERVED" && (
                        <span className="text-[10px] text-gray-400 block">
                          {routeName(it) && it.stationIndex > 0
                            ? `${t("board.at")} ${routeName(it).split(" → ")[it.stationIndex]} · ${t("board.next")}: ${nextName ?? t("board.serve")}`
                            : nextName
                              ? `→ ${t("board.next")}: ${nextName}`
                              : ""}
                        </span>
                      )}
                    </span>
                    {readyWithNext ? (
                      <button
                        onClick={() => advanceToNext(o.id, it.id)}
                        className="px-2 py-1 rounded text-xs font-medium bg-teal-600 text-white hover:bg-teal-700"
                        title={t("board.handoffTitle", { name: nextName })}
                      >
                        → {nextName}
                      </button>
                    ) : (
                      <button
                        onClick={() => advance(o.id, it.id, it.status)}
                        disabled={!NEXT[it.status]}
                        className="px-2 py-1 rounded text-xs font-medium bg-blue-600 text-white disabled:bg-gray-200 disabled:text-gray-400"
                      >
                        {statusWord(NEXT[it.status] ?? it.status)}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {boardOrders.length === 0 && (
          <p className="text-gray-400 text-sm col-span-full">{t("board.noActive", { station })}</p>
        )}
      </div>
    </div>
  );
}
