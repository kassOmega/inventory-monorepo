"use client";

import api from "@/lib/api";
import { ListFilters, SelectField } from "@/app/components/ListFilters";
import Modal from "@/app/components/Modal";
import SearchableSelect from "@/app/components/SearchableSelect";
import { useAuth } from "@/context/AuthContext";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useState } from "react";

export default function CarWashBookingsPage() {
  const { hasPermission } = useAuth();
  const { t } = useTranslation();
  const [bookings, setBookings] = useState<any[]>([]);
  const [washers, setWashers] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [form, setForm] = useState({ vehicleId: "", washerId: "", vehicleType: "Car", amount: "", isTimeSlotBooking: true, startsAt: "", positionInQueue: "", notes: "" });
  const [availability, setAvailability] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState("");

  const canCreate = hasPermission("carwash.bookings.create");
  const canEdit = hasPermission("carwash.bookings.edit");
  const canDelete = hasPermission("carwash.bookings.delete");

  const load = useCallback(async () => {
    try {
      const [b, w, v] = await Promise.all([api.get("/carwash/bookings"), api.get("/carwash/washers"), api.get("/carwash/vehicles")]);
      setBookings(b.data);
      setWashers(w.data);
      setVehicles(v.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("carwash.failedLoad"));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const checkAvailability = async () => {
    if (!form.washerId || !form.startsAt) {
      setAvailability(null);
      return;
    }
    try {
      const r = await api.get(`/carwash/bookings/availability?washerId=${form.washerId}&startsAt=${new Date(form.startsAt).toISOString()}`);
      setAvailability(r.data.available);
    } catch {
      setAvailability(null);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api.post("/carwash/bookings", {
        vehicleId: form.vehicleId ? Number(form.vehicleId) : null,
        washerId: form.washerId ? Number(form.washerId) : null,
        vehicleType: form.vehicleType.trim() || "Car",
        amount: Number(form.amount) || 0,
        isTimeSlotBooking: form.isTimeSlotBooking,
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : new Date().toISOString(),
        positionInQueue: form.positionInQueue ? Number(form.positionInQueue) : undefined,
        notes: form.notes.trim() || undefined,
      });
      setOpen(false);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedSave"));
    }
  };

  const setStatus = async (id: number, status: string) => {
    setError("");
    try {
      await api.patch(`/carwash/bookings/${id}/status`, { status });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedSave"));
    }
  };

  const remove = async (id: number) => {
    if (!confirm(t("carwash.deleteConfirm"))) return;
    setError("");
    try {
      await api.delete(`/carwash/bookings/${id}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedDelete"));
    }
  };

  const filtered = bookings.filter((b) => !statusFilter || b.status === statusFilter);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">{t("carwash.bookings")}</h1>
        {canCreate && (
          <button onClick={() => { setForm({ vehicleId: "", washerId: "", vehicleType: "Car", amount: "", isTimeSlotBooking: true, startsAt: "", positionInQueue: "", notes: "" }); setAvailability(null); setOpen(true); }} className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium">
            + {t("carwash.newBooking")}
          </button>
        )}
      </div>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      <ListFilters>
        <SelectField
          value={statusFilter}
          onChange={setStatusFilter}
          allLabel={t("carwash.status")}
          options={[
            { value: "PENDING", label: "PENDING" },
            { value: "SERVING", label: "SERVING" },
            { value: "COMPLETED", label: "COMPLETED" },
            { value: "CANCELLED", label: "CANCELLED" },
          ]}
        />
      </ListFilters>

      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.when")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.type")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.washer")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.amount")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.status")}</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((b) => (
              <tr key={b.id}>
                <td className="px-4 py-2 whitespace-nowrap">{new Date(b.startsAt).toLocaleString()}</td>
                <td className="px-4 py-2 whitespace-nowrap">{b.isTimeSlotBooking ? t("carwash.timeSlot") : t("carwash.walkIn")}</td>
                <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{b.washer?.name ?? "—"}</td>
                <td className="px-4 py-2 whitespace-nowrap">{b.amount}</td>
                <td className="px-4 py-2 whitespace-nowrap"><span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{b.status}</span></td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {canEdit && b.status === "PENDING" && <button onClick={() => setStatus(b.id, "SERVING")} className="text-xs text-blue-600 hover:underline mr-2">{t("carwash.start")}</button>}
                  {canEdit && b.status === "SERVING" && <button onClick={() => setStatus(b.id, "COMPLETED")} className="text-xs text-green-600 hover:underline mr-2">{t("carwash.complete")}</button>}
                  {canEdit && (b.status === "PENDING" || b.status === "SERVING") && <button onClick={() => setStatus(b.id, "CANCELLED")} className="text-xs text-red-600 hover:underline mr-2">{t("carwash.cancel")}</button>}
                  {canDelete && <button onClick={() => remove(b.id)} className="text-xs text-red-600 hover:underline">{t("carwash.delete")}</button>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">{t("carwash.noBookings")}</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal isOpen={open} onClose={() => setOpen(false)} title={t("carwash.newBooking")}>
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm text-gray-600">{t("carwash.when")}
            <input value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} type="datetime-local" className="border border-gray-300 rounded p-2 text-sm w-full mt-1" required />
          </label>
          <label className="block text-sm text-gray-600">{t("carwash.washer")}
            <SearchableSelect value={form.washerId} onChange={(v) => setForm({ ...form, washerId: v })} options={washers.map((w) => ({ value: String(w.id), label: w.name }))} placeholder={t("carwash.washer")} />
          </label>
          <label className="block text-sm text-gray-600">{t("carwash.vehicles")}
            <SearchableSelect value={form.vehicleId} onChange={(v) => setForm({ ...form, vehicleId: v })} options={vehicles.map((v) => ({ value: String(v.id), label: v.plateNumber }))} placeholder={t("carwash.vehicles")} />
          </label>
          <label className="block text-sm text-gray-600">{t("carwash.vehicleType")}
            <input value={form.vehicleType} onChange={(e) => setForm({ ...form, vehicleType: e.target.value })} placeholder={t("carwash.vehicleType")} className="border border-gray-300 rounded p-2 text-sm w-full mt-1" />
          </label>
          <label className="block text-sm text-gray-600">{t("carwash.amount")}
            <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder={t("carwash.amount")} type="number" min="0" className="border border-gray-300 rounded p-2 text-sm w-full mt-1" />
          </label>
          {availability !== null && (
            <div className={`text-sm px-3 py-2 rounded ${availability ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
              {availability ? t("carwash.available") : t("carwash.notAvailable")}
            </div>
          )}
          <button type="button" onClick={checkAvailability} className="text-xs text-blue-600 hover:underline">{t("carwash.availability")}</button>
          <label className="block text-sm text-gray-600">{t("carwash.queuePosition")}
            <input value={form.positionInQueue} onChange={(e) => setForm({ ...form, positionInQueue: e.target.value })} placeholder={t("carwash.queuePosition")} type="number" min="1" className="border border-gray-300 rounded p-2 text-sm w-full mt-1" />
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={form.isTimeSlotBooking} onChange={(e) => setForm({ ...form, isTimeSlotBooking: e.target.checked })} />
            {t("carwash.timeSlotBooking")}
          </label>
          <label className="block text-sm text-gray-600">{t("carwash.notes")}
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t("carwash.notes")} className="border border-gray-300 rounded p-2 text-sm w-full mt-1" />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-sm text-gray-600">{t("carwash.cancel")}</button>
            <button type="submit" className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium">{t("carwash.newBooking")}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
