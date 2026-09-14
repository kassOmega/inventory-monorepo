"use client";

import api from "@/lib/api";
import DateFilter, { getDateRange } from "@/app/components/DateFilter";
import { useAuth } from "@/context/AuthContext";
import FiscalPrintButton from "@/app/components/FiscalPrintButton";
import FiscalPrintPreviewModal from "@/app/components/FiscalPrintPreviewModal";
import {
  ackFiscalBatch,
  dispatchFiscalPrint,
  fetchFiscalBatchSummary,
  markBatchPrintFailed,
  markBatchPrintPending,
  prepareFiscalPrintPayload,
} from "@/lib/fiscal";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const TABS = ["Pending", "Summary", "Floats", "Collections"];

export default function CashierPage() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const canConfirm = hasPermission("cashier.confirm");
  const canManageFloat = hasPermission("finance.manage");

  const [tab, setTab] = useState("Pending");
  const [pending, setPending] = useState<any[]>([]);
  // Order ids for the consolidated fiscal batch currently being printed.
  const [batchOrderIds, setBatchOrderIds] = useState<number[]>([]);
  const [batchPreview, setBatchPreview] = useState<any>(null);
  const [batchPrinting, setBatchPrinting] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [floats, setFloats] = useState<any[]>([]);
  const [collections, setCollections] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [floatForm, setFloatForm] = useState({ recipientId: "", amount: "" });
  const [collectionForm, setCollectionForm] = useState({ fromUserId: "", amount: "" });
  const [pendingWaiter, setPendingWaiter] = useState("");
  const [pendingPreset, setPendingPreset] = useState<"today" | "week" | "month" | "year">("today");
  const [pendingFrom, setPendingFrom] = useState(() => getDateRange("today").start);
  const [pendingTo, setPendingTo] = useState(() => getDateRange("today").end);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (pendingWaiter) params.set("waiterId", pendingWaiter);
    if (pendingFrom) params.set("dateFrom", pendingFrom);
    if (pendingTo) params.set("dateTo", pendingTo);
    const qs = params.toString();
    try {
      const [p, s, f, c, st] = await Promise.all([
        api.get(`/cashier/pending${qs ? `?${qs}` : ""}`),
        api.get("/cashier/summary"),
        api.get("/cashier/floats"),
        api.get("/cashier/collections"),
        api.get("/cashier/staff"),
      ]);
      setPending(p.data);
      setSummary(s.data);
      setFloats(f.data);
      setCollections(c.data);
      setStaff(st.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("cashier.failedLoad"));
    } finally {
      setLoading(false);
    }
  }, [pendingWaiter, pendingFrom, pendingTo]);

  useEffect(() => {
    load();
  }, [load]);

  const confirm = async (p: any) => {
    try {
      const url =
        p.kind === "FACILITY"
          ? `/cashier/facility-payments/${p.id}/confirm`
          : `/cashier/payments/${p.id}/confirm`;
      await api.post(url);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("cashier.failedConfirm"));
    }
  };

  // Consolidated fiscal printing, grouped by party (customer name → table →
  // walk-in) so another customer's fees can never be mixed into one invoice.
  const groups = useMemo(() => {
    const byKey = new Map<string, any[]>();
    for (const p of pending) {
      const o = p.order;
      if (!o) continue;
      const key = o.customerName
        ? `cust:${o.customerName}`
        : o.tableId
          ? `table:${o.tableId}`
          : `walkin:${p.id}`;
      const arr = byKey.get(key) ?? [];
      arr.push(p);
      byKey.set(key, arr);
    }
    return Array.from(byKey.entries()).map(([key, payments]) => ({
      key,
      label: payments[0]?.order?.customerName
        ? payments[0].order.customerName
        : payments[0]?.order?.table
          ? t("orders.tablePrefix", { name: payments[0].order.table.name })
          : t("cashier.walkIn"),
      payments,
    }));
  }, [pending, t]);

  const openBatchPreview = async (orderIds: number[]) => {
    if (orderIds.length === 0) return;
    setError("");
    try {
      const summary = await fetchFiscalBatchSummary({ orderIds });
      setBatchOrderIds(orderIds);
      setBatchPreview(prepareFiscalPrintPayload(summary));
    } catch (e: any) {
      setError(
        e?.response?.data?.message ??
          e?.message ??
          t("cashier.failedFiscalSummary"),
      );
    }
  };
  const confirmBatchPrint = async () => {
    if (!batchPreview) return;
    setBatchPrinting(true);
    try {
      await markBatchPrintPending({ orderIds: batchOrderIds });
      const agent = await dispatchFiscalPrint(batchPreview);
      await ackFiscalBatch({ orderIds: batchOrderIds }, agent);
      setBatchPreview(null);
      setBatchOrderIds([]);
      await load();
    } catch (e: any) {
      try {
        await markBatchPrintFailed(
          { orderIds: batchOrderIds },
          e?.message ?? t("cashier.fiscalPrintFailed"),
        );
      } catch {
        // ack-side failure is reported below
      }
      setError(e?.message ?? t("cashier.fiscalPrintFailed"));
      setBatchPreview(null);
      await load();
    } finally {
      setBatchPrinting(false);
    }
  };

  const recordFloat = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/cashier/floats", { recipientId: Number(floatForm.recipientId), amount: Number(floatForm.amount) });
      setFloatForm({ recipientId: "", amount: "" });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("cashier.failedRecordFloat"));
    }
  };

  const recordCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/cashier/collections", { fromUserId: Number(collectionForm.fromUserId), amount: Number(collectionForm.amount) });
      setCollectionForm({ fromUserId: "", amount: "" });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("cashier.failedRecordCollection"));
    }
  };

  if (loading) return <p className="text-gray-500">{t("common.loading")}</p>;

  const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">{t("nav.cashier")}</h1>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-2">
        {TABS.map((tabId) => (
          <button
            key={tabId}
            onClick={() => setTab(tabId)}
            className={`px-3 py-1.5 rounded text-sm font-medium ${tab === tabId ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}
          >
            {t(`cashier.tabs.${tabId.toLowerCase()}`)}
          </button>
        ))}
      </div>

      {tab === "Pending" && (
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <h2 className="font-semibold text-gray-800 mb-3">{t("cashier.pendingTitle")}</h2>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <select value={pendingWaiter} onChange={(e) => setPendingWaiter(e.target.value)} className="border border-gray-300 rounded p-2 text-sm">
              <option value="">{t("cashier.allWaiters")}</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <DateFilter
              preset={pendingPreset}
              onPresetChange={setPendingPreset}
              startDate={pendingFrom}
              onStartDateChange={setPendingFrom}
              endDate={pendingTo}
              onEndDateChange={setPendingTo}
            />
          </div>
          {pending.length === 0 && <p className="text-gray-400 text-sm">{t("cashier.noPending")}</p>}
          {/* Facility day-pass payments carry no order → no fiscal receipt, so they
              render outside the consolidated fiscal groups below. */}
          {pending.some((p) => p.kind === "FACILITY") && (
            <ul className="divide-y divide-gray-100 mb-3">
              {pending
                .filter((p) => p.kind === "FACILITY")
                .map((p) => (
                  <li key={`${p.kind}-${p.id}`} className="py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800">
                        {p.facilityVisit?.customer?.name ?? "Guest"} — {p.notes ?? "Facility day pass"} · {money(p.amount)}
                      </p>
                      <p className="text-xs text-gray-400">
                        <span className="bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded text-[10px] font-medium mr-1">
                          Facility
                        </span>
                        {p.paymentMethod?.name ?? "—"}
                        {p.collectedByName ? ` · Collected: ${p.collectedByName}` : ""}
                      </p>
                    </div>
                    {canConfirm && (
                      <button onClick={() => confirm(p)} className="bg-green-600 text-white rounded px-3 py-1.5 text-xs font-medium shrink-0">
                        {t("cashier.confirm")}
                      </button>
                    )}
                  </li>
                ))}
            </ul>
          )}
          {groups.map((g) => {
            const printable = g.payments.filter(
              (p) =>
                p.order?.status === "PAID" && p.order?.fiscalStatus !== "PRINTED",
            );
            const printableIds = [...new Set(printable.map((p) => p.order.id))];
            const total = g.payments.reduce((s, p) => s + (p.amount ?? 0), 0);
            return (
              <div key={g.key} className="border border-gray-200 rounded-lg p-3 mb-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{g.label}</p>
                    <p className="text-xs text-gray-400">
                      {t(g.payments.length === 1 ? "cashier.orderCount" : "cashier.orderCountPlural", { count: g.payments.length })} · {money(total)}
                    </p>
                  </div>
                  {printableIds.length > 0 && (
                    <button
                      onClick={() => openBatchPreview(printableIds)}
                      disabled={batchPrinting}
                      className="text-xs bg-gray-800 text-white rounded px-3 py-1.5 font-medium shrink-0 disabled:opacity-40"
                    >
                      🖨 {t("orders.printFiscalInvoice")} ({printableIds.length})
                    </button>
                  )}
                </div>
                <ul className="divide-y divide-gray-100">
                  {g.payments.map((p) => (
                    <li key={p.id} className="py-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800">
                          {p.order?.orderNumber} {p.order?.table ? `· ${p.order.table.name}` : ""} — {money(p.amount)}
                        </p>
                        <p className="text-xs text-gray-400">
                          {p.paymentMethod?.name ?? "—"}
                          {p.collectedByName ? ` · ${t("cashier.waiterLabel")}: ${p.collectedByName}` : ""}
                        </p>
                      </div>
                      {canConfirm && (
                        <button onClick={() => confirm(p.id)} className="bg-green-600 text-white rounded px-3 py-1.5 text-xs font-medium shrink-0">
                          {t("cashier.confirm")}
                        </button>
                      )}
                      {p.order?.status === "PAID" && (
                        <FiscalPrintButton
                          target={{ kind: "order", id: p.order.id }}
                          fiscalStatus={p.order?.fiscalStatus}
                          receipt={p.order?.fiscalReceipt}
                          onUpdated={load}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {batchPreview && (
            <FiscalPrintPreviewModal
              payload={batchPreview}
              onClose={() => setBatchPreview(null)}
              onConfirm={confirmBatchPrint}
              printing={batchPrinting}
            />
          )}
        </div>
      )}

      {tab === "Summary" && summary && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-lg border border-gray-200">
              <p className="text-xs text-gray-400">{t("cashier.totalSales")}</p>
              <p className="text-lg font-bold text-gray-800">{money(summary.totals.sales)}</p>
            </div>
            <div className="bg-white p-4 rounded-lg border border-gray-200">
              <p className="text-xs text-gray-400">{t("cashier.cashSales")}</p>
              <p className="text-lg font-bold text-gray-800">{money(summary.totals.cashSales)}</p>
            </div>
            <div className="bg-white p-4 rounded-lg border border-gray-200">
              <p className="text-xs text-gray-400">{t("cashier.digitalSales")}</p>
              <p className="text-lg font-bold text-gray-800">{money(summary.totals.digitalSales)}</p>
            </div>
            <div className="bg-white p-4 rounded-lg border border-gray-200">
              <p className="text-xs text-gray-400">{t("cashier.expectedCash")}</p>
              <p className="text-lg font-bold text-green-700">{money(summary.totals.expectedPhysicalCash)}</p>
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <h3 className="font-semibold text-gray-800 mb-2">{t("cashier.byCollector")}</h3>
            <ul className="divide-y divide-gray-100 text-sm">
              {summary.collectors.map((c: any) => (
                <li key={c.userId} className="py-1.5 flex justify-between">
                  <span>{c.name}</span>
                  <span>{t("cashier.expected")} {money(c.expectedPhysicalCash)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white p-4 rounded-lg border border-gray-200">
              <h3 className="font-semibold text-gray-800 mb-2">{t("cashier.byMethod")}</h3>
              <ul className="text-sm space-y-1">
                {summary.methods.map((m: any) => (
                  <li key={m.method} className="flex justify-between">
                    <span>{m.method}</span>
                    <span>{money(m.total)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-white p-4 rounded-lg border border-gray-200">
              <h3 className="font-semibold text-gray-800 mb-2">{t("cashier.byStation")}</h3>
              <ul className="text-sm space-y-1">
                {summary.categories.map((c: any) => (
                  <li key={c.station} className="flex justify-between">
                    <span>{c.station}</span>
                    <span>{money(c.total)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {tab === "Floats" && (
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <h2 className="font-semibold text-gray-800 mb-3">{t("cashier.floatsTitle")}</h2>
          {canManageFloat && (
            <form onSubmit={recordFloat} className="flex gap-2 mb-3">
              <select value={floatForm.recipientId} onChange={(e) => setFloatForm({ ...floatForm, recipientId: e.target.value })} className="border border-gray-300 rounded p-2 text-sm flex-1" required>
                <option value="">{t("cashier.recipient")}</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <input type="number" placeholder={t("orders.amount")} value={floatForm.amount} onChange={(e) => setFloatForm({ ...floatForm, amount: e.target.value })} className="border border-gray-300 rounded p-2 text-sm w-28" required />
              <button type="submit" className="bg-gray-800 text-white rounded px-3 text-sm">{t("cashier.give")}</button>
            </form>
          )}
          <ul className="text-sm text-gray-700 space-y-1">
            {floats.map((f) => (
              <li key={f.id} className="flex justify-between">
                <span>{staff.find((s) => s.id === f.recipientId)?.name ?? f.recipientId}</span>
                <span>{money(f.amount)}</span>
              </li>
            ))}
            {floats.length === 0 && <li className="text-gray-400">{t("cashier.noFloats")}</li>}
          </ul>
        </div>
      )}

      {tab === "Collections" && (
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <h2 className="font-semibold text-gray-800 mb-3">{t("cashier.collectionsTitle")}</h2>
          {canManageFloat && (
            <form onSubmit={recordCollection} className="flex flex-wrap gap-2 mb-3">
              <select
                value={collectionForm.fromUserId}
                onChange={(e) => {
                  const id = e.target.value;
                  const expected = summary?.collectors?.find((c: any) => String(c.userId) === id)?.expectedPhysicalCash ?? 0;
                  setCollectionForm({ fromUserId: id, amount: expected > 0 ? String(expected) : "" });
                }}
                className="border border-gray-300 rounded p-2 text-sm flex-1"
                required
              >
                <option value="">{t("cashier.from")}</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <input type="number" placeholder={t("cashier.amountAuto")} value={collectionForm.amount} onChange={(e) => setCollectionForm({ ...collectionForm, amount: e.target.value })} className="border border-gray-300 rounded p-2 text-sm w-28" required />
              <button type="submit" className="bg-blue-600 text-white rounded px-3 text-sm">{t("cashier.collect")}</button>
            </form>
          )}

          {summary?.collectors?.length > 0 && (
            <ul className="divide-y divide-gray-100 text-sm mb-3">
              {summary.collectors.map((c: any) => (
                <li key={c.userId} className="py-1.5 flex items-center justify-between gap-2">
                  <span>{c.name}</span>
                  <span className="text-gray-500">{t("cashier.expected")} {money(c.expectedPhysicalCash)}</span>
                  {canManageFloat && c.expectedPhysicalCash > 0 && (
                    <button
                      onClick={() => api.post("/cashier/collections", { fromUserId: c.userId, amount: c.expectedPhysicalCash }).then(load)}
                      className="text-xs bg-blue-600 text-white rounded px-2 py-1 shrink-0"
                    >
                      {t("cashier.collect")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <ul className="text-sm text-gray-700 space-y-1">
            {collections.map((c) => (
              <li key={c.id} className="flex justify-between">
                <span>{staff.find((s) => s.id === c.fromUserId)?.name ?? c.fromUserId}</span>
                <span>{money(c.amount)}</span>
              </li>
            ))}
            {collections.length === 0 && <li className="text-gray-400">{t("cashier.noCollections")}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
