"use client";

import api from "@/lib/api";
import Button from "@/app/components/Button";
import { formatDateTime } from "@/lib/datetime";
import { statusLabel } from "@/lib/statusLabel";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export default function ServiceBookingsPage() {
  const { t } = useTranslation();
  const [bookings, setBookings] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [form, setForm] = useState({ startsAt: "", clientId: "", serviceItemId: "" });
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

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
      setError(e?.response?.data?.message ?? t("svc.bk.failedLoad"));
    }
  }, [date, t]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setCreating(true);
    try {
      await api.post("/service/bookings", {
        startsAt: new Date(form.startsAt).toISOString(),
        clientId: form.clientId ? Number(form.clientId) : null,
        serviceItemId: form.serviceItemId ? Number(form.serviceItemId) : null,
      });
      setForm({ startsAt: "", clientId: "", serviceItemId: "" });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("svc.bk.failedCreate"));
    } finally {
      setCreating(false);
    }
  };

  const setStatus = async (id: number, status: string) => {
    setBusyId(id);
    try {
      await api.patch(`/service/bookings/${id}/status`, { status });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("svc.bk.failedUpdate"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">{t("svc.bk.title")}</h1>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      <div className="flex items-center gap-3">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-gray-300 rounded p-2 text-sm" />
      </div>

      <form onSubmit={create} className="bg-white p-4 rounded-lg border border-gray-200 grid grid-cols-1 md:grid-cols-4 gap-3">
        <input type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} className="border border-gray-300 rounded p-2 text-sm" required />
        <select value={form.serviceItemId} onChange={(e) => setForm({ ...form, serviceItemId: e.target.value })} className="border border-gray-300 rounded p-2 text-sm">
          <option value="">{t("svc.bk.serviceAny")}</option>
          {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} className="border border-gray-300 rounded p-2 text-sm">
          <option value="">{t("svc.noClient")}</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <Button type="submit" loading={creating} className="!p-2 !text-sm">{t("svc.bk.add")}</Button>
      </form>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2">{t("svc.bk.colTime")}</th>
              <th className="px-4 py-2">{t("terms.svc.customer")}</th>
              <th className="px-4 py-2">{t("terms.svc.service")}</th>
              <th className="px-4 py-2">{t("common.status")}</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {bookings.map((b) => (
              <tr key={b.id}>
                <td className="px-4 py-2">{formatDateTime(b.startsAt)}</td>
                <td className="px-4 py-2">{b.client?.name ?? "—"}</td>
                <td className="px-4 py-2">{b.serviceItem?.name ?? "—"}</td>
                <td className="px-4 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${b.status === "CANCELLED" ? "bg-red-100 text-red-700" : b.status === "CONFIRMED" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                    {statusLabel(b.status)}
                  </span>
                </td>
                <td className="px-4 py-2 text-right space-x-2">
                  <Button variant="ghost" size="sm" loading={busyId === b.id} onClick={() => setStatus(b.id, "CONFIRMED")} className="!px-0 text-xs text-blue-600 hover:underline">{t("svc.bk.confirm")}</Button>
                  <Button variant="ghost" size="sm" loading={busyId === b.id} onClick={() => setStatus(b.id, "COMPLETED")} className="!px-0 text-xs text-green-600 hover:underline">{t("svc.bk.complete")}</Button>
                  <Button variant="ghost" size="sm" loading={busyId === b.id} onClick={() => setStatus(b.id, "NO_SHOW")} className="!px-0 text-xs text-amber-600 hover:underline">{t("status.noShow")}</Button>
                  <Button variant="ghost" size="sm" loading={busyId === b.id} onClick={() => setStatus(b.id, "CANCELLED")} className="!px-0 text-xs text-red-600 hover:underline">{t("common.cancel")}</Button>
                </td>
              </tr>
            ))}
            {bookings.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">{t("svc.bk.empty")}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
