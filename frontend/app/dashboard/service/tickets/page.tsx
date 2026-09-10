"use client";

import api from "@/lib/api";
import { newClientRef } from "@/lib/clientRef";
import { useCallback, useEffect, useState } from "react";

export default function ServiceTicketsPage() {
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
      setError(e?.response?.data?.message ?? "Failed to load tickets");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api.post("/service/tickets", {
        clientId: form.clientId ? Number(form.clientId) : null,
        items: [{ serviceItemId: Number(form.serviceItemId), quantity: Number(form.quantity) || 1 }],
      });
      setForm({ clientId: "", serviceItemId: "", quantity: "1" });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create ticket");
    }
  };

  const submitAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (addItemFor == null || !addItemId) return;
    setError("");
    try {
      await api.post(`/service/tickets/${addItemFor}/items`, {
        serviceItemId: Number(addItemId),
        quantity: 1,
      });
      setAddItemFor(null);
      setAddItemId("");
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to add item");
    }
  };

  const pay = async (ticketId: number) => {
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
      setError(err?.response?.data?.message ?? "Failed to pay");
    }
  };

  const setStatus = async (ticketId: number, status: string) => {
    try {
      await api.patch(`/service/tickets/${ticketId}/status`, { status });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to update ticket");
    }
  };

  const paid = (t: any) => t.payments?.reduce((s: number, p: any) => s + p.amount, 0) ?? 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Tickets</h1>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      <form onSubmit={create} className="bg-white p-4 rounded-lg border border-gray-200 grid grid-cols-1 md:grid-cols-4 gap-3">
        <select value={form.serviceItemId} onChange={(e) => setForm({ ...form, serviceItemId: e.target.value })} className="border border-gray-300 rounded p-2 text-sm" required>
          <option value="">Service…</option>
          {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <input value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} type="number" min="1" className="border border-gray-300 rounded p-2 text-sm" />
        <select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} className="border border-gray-300 rounded p-2 text-sm">
          <option value="">No client</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button type="submit" className="bg-blue-600 text-white rounded p-2 text-sm font-medium">Open Ticket</button>
      </form>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2">#</th>
              <th className="px-4 py-2">Client</th>
              <th className="px-4 py-2">Items</th>
              <th className="px-4 py-2">Total</th>
              <th className="px-4 py-2">Paid</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {tickets.map((t) => (
              <tr key={t.id}>
                <td className="px-4 py-2 text-gray-400">#{t.id}</td>
                <td className="px-4 py-2">{t.client?.name ?? "—"}</td>
                <td className="px-4 py-2 text-xs text-gray-500">{t.items?.map((i: any) => i.serviceItem?.name).join(", ") || "—"}</td>
                <td className="px-4 py-2">{t.totalAmount}</td>
                <td className="px-4 py-2">{paid(t)}</td>
                <td className="px-4 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${t.status === "PAID" ? "bg-green-100 text-green-700" : t.status === "CANCELLED" ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>{t.status}</span>
                </td>
                <td className="px-4 py-2 text-right space-x-2">
                  {t.status !== "PAID" && t.status !== "CANCELLED" && (
                    <>
                      <button
                        onClick={() => {
                          setAddItemId("");
                          setAddItemFor(t.id);
                        }}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        +Item
                      </button>
                      <button onClick={() => pay(t.id)} className="text-xs text-green-600 hover:underline">Pay</button>
                      <button onClick={() => setStatus(t.id, "CANCELLED")} className="text-xs text-red-600 hover:underline">Cancel</button>
                    </>
                  )}
                  {t.status === "OPEN" && <button onClick={() => setStatus(t.id, "IN_PROGRESS")} className="text-xs text-amber-600 hover:underline">Start</button>}
                </td>
              </tr>
            ))}
            {tickets.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">No tickets.</td></tr>}
          </tbody>
        </table>
      </div>

      {addItemFor != null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-1">Add Item</h2>
            <p className="text-xs text-gray-400 mb-3">
              Pick a service to add to ticket #{addItemFor}.
            </p>
            <form onSubmit={submitAddItem} className="space-y-3">
              <select
                autoFocus
                value={addItemId}
                onChange={(e) => setAddItemId(e.target.value)}
                className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
                required
              >
                <option value="">Select service…</option>
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
                  Cancel
                </button>
                <button type="submit" className="bg-gray-800 text-white rounded px-3 py-2 text-sm font-medium">
                  Add
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

