"use client";

import api from "@/lib/api";
import { useCallback, useEffect, useState } from "react";

export default function ServiceBookingsPage() {
  const [bookings, setBookings] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [form, setForm] = useState({ startsAt: "", clientId: "", serviceItemId: "" });
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [b, i, c] = await Promise.all([
        api.get(`/service/bookings${date ? `?date=${date}` : ""}`),
        api.get("/service/items"),
        api.get("/service/clients"),
      ]);
      setBookings(b.data);
      setItems(i.data);
      setClients(c.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to load bookings");
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api.post("/service/bookings", {
        startsAt: new Date(form.startsAt).toISOString(),
        clientId: form.clientId ? Number(form.clientId) : null,
        serviceItemId: form.serviceItemId ? Number(form.serviceItemId) : null,
      });
      setForm({ startsAt: "", clientId: "", serviceItemId: "" });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create booking");
    }
  };

  const setStatus = async (id: number, status: string) => {
    try {
      await api.patch(`/service/bookings/${id}/status`, { status });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to update booking");
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Bookings / Appointments</h1>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      <div className="flex items-center gap-3">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-gray-300 rounded p-2 text-sm" />
      </div>

      <form onSubmit={create} className="bg-white p-4 rounded-lg border border-gray-200 grid grid-cols-1 md:grid-cols-4 gap-3">
        <input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} className="border border-gray-300 rounded p-2 text-sm" required />
        <select value={form.serviceItemId} onChange={(e) => setForm({ ...form, serviceItemId: e.target.value })} className="border border-gray-300 rounded p-2 text-sm">
          <option value="">Service (any)</option>
          {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} className="border border-gray-300 rounded p-2 text-sm">
          <option value="">No client</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button type="submit" className="bg-blue-600 text-white rounded p-2 text-sm font-medium">Add Booking</button>
      </form>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2">Time</th>
              <th className="px-4 py-2">Client</th>
              <th className="px-4 py-2">Service</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {bookings.map((b) => (
              <tr key={b.id}>
                <td className="px-4 py-2">{new Date(b.startsAt).toLocaleString()}</td>
                <td className="px-4 py-2">{b.client?.name ?? "—"}</td>
                <td className="px-4 py-2">{b.serviceItem?.name ?? "—"}</td>
                <td className="px-4 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${b.status === "CANCELLED" ? "bg-red-100 text-red-700" : b.status === "CONFIRMED" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                    {b.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-right space-x-2">
                  <button onClick={() => setStatus(b.id, "CONFIRMED")} className="text-xs text-blue-600 hover:underline">Confirm</button>
                  <button onClick={() => setStatus(b.id, "COMPLETED")} className="text-xs text-green-600 hover:underline">Complete</button>
                  <button onClick={() => setStatus(b.id, "NO_SHOW")} className="text-xs text-amber-600 hover:underline">No-show</button>
                  <button onClick={() => setStatus(b.id, "CANCELLED")} className="text-xs text-red-600 hover:underline">Cancel</button>
                </td>
              </tr>
            ))}
            {bookings.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">No bookings.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
