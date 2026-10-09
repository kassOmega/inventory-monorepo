"use client";

import api from "@/lib/api";
import Button from "@/app/components/Button";
import { newClientRef } from "@/lib/clientRef";
import { statusLabel } from "@/lib/statusLabel";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export default function ServiceTicketsPage() {
  const { t } = useTranslation();
  const [tickets, setTickets] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [form, setForm] = useState({ clientId: "", serviceItemId: "", quantity: "1" });
  const [error, setError] = useState("");
  // Idempotency keys per ticket so a double-tap on Pay can't charge twice.
  const [payRefs, setPayRefs] = useState<Record<number, string>>({});
  // "Add item to ticket" modal.
  const [addItemFor, setAddItemFor] = useState<number | null>(null);
  const [addItemId, setAddItemId] = useState("");
  const [creating, setCreating] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  // Ticket id whose row action (pay / status) is running.
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, i, c] = await Promise.all([
        api.get("/service/tickets"),
        api.get("/service/items"),
        api.get("/service/clients"),
      ]);
      setTickets(t.data);
      setItems(i.data);
      setClients(c.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("svc.tk.failedLoad"));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setCreating(true);
    try {
      await api.post("/service/tickets", {
        clientId: form.clientId ? Number(form.clientId) : null,
        items: [{ serviceItemId: Number(form.serviceItemId), quantity: Number(form.quantity) || 1 }],
      });
      setForm({ clientId: "", serviceItemId: "", quantity: "1" });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("svc.tk.failedCreate"));
    } finally {
      setCreating(false);
    }
  };

  const submitAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (addItemFor == null || !addItemId) return;
    setError("");
    setAddingItem(true);
    try {
      await api.post(`/service/tickets/${addItemFor}/items`, {
        serviceItemId: Number(addItemId),
        quantity: 1,
      });
      setAddItemFor(null);
      setAddItemId("");
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("svc.tk.failedAddItem"));
    } finally {
      setAddingItem(false);
    }
  };

  const pay = async (ticketId: number) => {
    setBusyId(ticketId);
    try {
      const ref = payRefs[ticketId] ?? newClientRef();
      if (!payRefs[ticketId]) setPayRefs((p) => ({ ...p, [ticketId]: ref }));
      await api.post(`/service/tickets/${ticketId}/pay`, { clientRef: ref });
      setPayRefs((p) => {
        const next = { ...p };
        delete next[ticketId];
        return next;
      });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("svc.tk.failedPay"));
    } finally {
      setBusyId(null);
    }
  };

  const setStatus = async (ticketId: number, status: string) => {
    setBusyId(ticketId);
    try {
      await api.patch(`/service/tickets/${ticketId}/status`, { status });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("svc.tk.failedUpdate"));
    } finally {
      setBusyId(null);
    }
  };

  const paid = (ticket: any) => ticket.payments?.reduce((s: number, p: any) => s + p.amount, 0) ?? 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">{t("terms.svc.orders")}</h1>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      <form onSubmit={create} className="bg-white p-4 rounded-lg border border-gray-200 grid grid-cols-1 md:grid-cols-4 gap-3">
        <select value={form.serviceItemId} onChange={(e) => setForm({ ...form, serviceItemId: e.target.value })} className="border border-gray-300 rounded p-2 text-sm" required>
          <option value="">{t("hospitality.pkg.servicePh")}</option>
          {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <input value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} type="number" min="1" className="border border-gray-300 rounded p-2 text-sm" />
        <select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} className="border border-gray-300 rounded p-2 text-sm">
          <option value="">{t("svc.noClient")}</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <Button type="submit" loading={creating} className="!p-2 !text-sm">{t("svc.tk.open")}</Button>
      </form>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2">#</th>
              <th className="px-4 py-2">{t("terms.svc.customer")}</th>
              <th className="px-4 py-2">{t("act.colItems")}</th>
              <th className="px-4 py-2">{t("common.total")}</th>
              <th className="px-4 py-2">{t("status.paid")}</th>
              <th className="px-4 py-2">{t("common.status")}</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {tickets.map((ticket) => (
              <tr key={ticket.id}>
                <td className="px-4 py-2 text-gray-400">#{ticket.id}</td>
                <td className="px-4 py-2">{ticket.client?.name ?? "—"}</td>
                <td className="px-4 py-2 text-xs text-gray-500">{ticket.items?.map((i: any) => i.serviceItem?.name).join(", ") || "—"}</td>
                <td className="px-4 py-2">{ticket.totalAmount}</td>
                <td className="px-4 py-2">{paid(ticket)}</td>
                <td className="px-4 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${ticket.status === "PAID" ? "bg-green-100 text-green-700" : ticket.status === "CANCELLED" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>{statusLabel(ticket.status)}</span>
                </td>
                <td className="px-4 py-2 text-right space-x-2">
                  {ticket.status !== "PAID" && ticket.status !== "CANCELLED" && (
                    <>
                      <button
                        onClick={() => {
                          setAddItemId("");
                          setAddItemFor(ticket.id);
                        }}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        +{t("svc.tk.itemBtn")}
                      </button>
                      <Button variant="ghost" size="sm" loading={busyId === ticket.id} onClick={() => pay(ticket.id)} className="!px-0 text-xs text-green-600 hover:underline">{t("svc.tk.pay")}</Button>
                      <Button variant="ghost" size="sm" loading={busyId === ticket.id} onClick={() => setStatus(ticket.id, "CANCELLED")} className="!px-0 text-xs text-red-600 hover:underline">{t("common.cancel")}</Button>
                    </>
                  )}
                  {ticket.status === "OPEN" && <Button variant="ghost" size="sm" loading={busyId === ticket.id} onClick={() => setStatus(ticket.id, "IN_PROGRESS")} className="!px-0 text-xs text-amber-600 hover:underline">{t("svc.tk.start")}</Button>}
                </td>
              </tr>
            ))}
            {tickets.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">{t("svc.tk.empty")}</td></tr>}
          </tbody>
        </table>
      </div>

      {addItemFor != null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-1">{t("svc.tk.addItemTitle")}</h2>
            <p className="text-xs text-gray-400 mb-3">
              {t("svc.tk.addItemHint", { id: addItemFor })}
            </p>
            <form onSubmit={submitAddItem} className="space-y-3">
              <select
                autoFocus
                value={addItemId}
                onChange={(e) => setAddItemId(e.target.value)}
                className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
                required
              >
                <option value="">{t("svc.tk.selectService")}</option>
                {items
                  .filter((i: any) => i.active !== false)
                  .map((i: any) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
              </select>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setAddItemFor(null)} className="px-3 py-2 text-sm text-gray-600">
                  {t("common.cancel")}
                </button>
                <Button type="submit" loading={addingItem} variant="dark" className="!px-3 !text-sm">
                  {t("common.add")}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

