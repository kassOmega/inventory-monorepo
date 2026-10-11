"use client";

import api from "@/lib/api";
import Button from "@/app/components/Button";
import FilterPanel, { FilterSelect } from "@/app/components/FilterPanel";
import { getDateRange, type DatePreset } from "@/app/components/DateFilter";
import Modal from "@/app/components/Modal";
import CarWashBookingForm, {
  type CarWashBookingPayload,
} from "@/app/components/CarWashBookingForm";
import { useAuth } from "@/context/AuthContext";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useState } from "react";

export default function CarWashBookingsPage() {
  const { hasPermission } = useAuth();
  const { t } = useTranslation();
  const [bookings, setBookings] = useState<any[]>([]);
  const [washers, setWashers] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [washTypes, setWashTypes] = useState<any[]>([]);
  const [prices, setPrices] = useState<any[]>([]);

  const [slotMinutes, setSlotMinutes] = useState(30);
  const [open, setOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const init = getDateRange("today");
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [startDate, setStartDate] = useState(init.start);
  const [endDate, setEndDate] = useState(init.end);
  const [search, setSearch] = useState("");

  const canCreate = hasPermission("carwash.bookings.create");
  const canEdit = hasPermission("carwash.bookings.edit");
  const canDelete = hasPermission("carwash.bookings.delete");

  const load = useCallback(async () => {
    try {
      const [b, w, c, wt, pr, st] = await Promise.all([
        api.get(`/carwash/bookings?startDate=${startDate}&endDate=${endDate}`),
        api.get("/carwash/washers?activeOnly=1"),
        api.get("/customers").catch(() => ({ data: [] })),
        api.get("/carwash/wash-types").catch(() => ({ data: [] })),
        api.get("/carwash/prices").catch(() => ({ data: [] })),
        api.get("/carwash/settings").catch(() => ({ data: { slotMinutes: 30 } })),
      ]);
      setBookings(b.data);
      setWashers(w.data);
      setCustomers(Array.isArray(c.data) ? c.data : []);
      setWashTypes(Array.isArray(wt.data) ? wt.data : []);
      setPrices(Array.isArray(pr.data) ? pr.data : []);
      setSlotMinutes(Number(st.data?.slotMinutes) || 30);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("carwash.failedLoad"));
    }
  }, [t, startDate, endDate]);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = async () => {
    setError("");
    try {
      const r = await api.get("/carwash/vehicles");
      setVehicles(Array.isArray(r.data) ? r.data : []);
    } catch {
      setVehicles([]);
    }
    setOpen(true);
  };

  const checkAvailability = async (
    washerId: string,
    startsAt: string,
    slotMinutes: number,
  ) => {
    try {
      const r = await api.get(
        `/carwash/bookings/availability?washerId=${washerId}&startsAt=${encodeURIComponent(startsAt)}&slotMinutes=${slotMinutes}`,
      );
      return { available: !!r.data?.available };
    } catch {
      return { available: false };
    }
  };

  const submitBooking = async (payload: CarWashBookingPayload) => {
    setError("");
    setSaving(true);
    try {
      await api.post("/carwash/bookings", {
        customerId: payload.customerId ? Number(payload.customerId) : null,
        washerId: payload.washerId ? Number(payload.washerId) : null,
        isTimeSlotBooking: payload.isTimeSlotBooking,
        startsAt: payload.startsAt,
        notes: payload.notes,
        items: payload.items.map((it) => ({
          vehicleId: it.vehicleId ? Number(it.vehicleId) : null,
          vehicleType: it.vehicleType,
          washTypeId: it.washTypeId ? Number(it.washTypeId) : null,
          amount: Number(it.amount) || 0,
        })),
      });
      setOpen(false);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedSave"));
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (id: number, status: string) => {
    setError("");
    setBusyKey(`status-${id}`);
    try {
      await api.patch(`/carwash/bookings/${id}/status`, { status });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedSave"));
    } finally {
      setBusyKey(null);
    }
  };

  const remove = async (id: number) => {
    if (!confirm(t("carwash.deleteConfirm"))) return;
    setError("");
    setBusyKey(`del-${id}`);
    try {
      await api.delete(`/carwash/bookings/${id}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedDelete"));
    } finally {
      setBusyKey(null);
    }
  };

  const filtered = bookings.filter(
    (b) => !statusFilter || b.status === statusFilter,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">{t("carwash.bookings")}</h1>
        {canCreate && (
          <button
            onClick={openNew}
            className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium"
          >
            + {t("carwash.newBooking")}
          </button>
        )}
      </div>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      <FilterPanel
        showDateFilter
        datePreset={datePreset}
        onDatePresetChange={setDatePreset}
        startDate={startDate}
        onStartDateChange={setStartDate}
        endDate={endDate}
        onEndDateChange={setEndDate}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("carwash.bookings")}
        extra={
          <FilterSelect
            value={statusFilter}
            onChange={setStatusFilter}
            label={t("carwash.status")}
            allLabel={t("carwash.allStatus")}
            options={[
              { value: "PENDING", label: "PENDING" },
              { value: "SERVING", label: "SERVING" },
              { value: "COMPLETED", label: "COMPLETED" },
              { value: "CANCELLED", label: "CANCELLED" },
            ]}
          />
        }
      />

      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.when")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.customer")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.vehicles")}</th>
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
                <td className="px-4 py-2 whitespace-nowrap">{b.customer?.name ?? "—"}</td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {(b.items ?? []).length > 0
                    ? b.items
                        .map(
                          (it: any) =>
                            `${it.vehicle?.plateNumber ?? it.vehicleType}${it.washType?.name ? ` · ${it.washType.name}` : ""}`,
                        )
                        .join(", ")
                    : b.vehicle?.plateNumber ?? b.vehicleType}
                </td>
                <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{b.washer?.name ?? "—"}</td>
                <td className="px-4 py-2 whitespace-nowrap">{b.amount}</td>
                <td className="px-4 py-2 whitespace-nowrap">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{b.status}</span>
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {canEdit && b.status === "PENDING" && <Button variant="ghost" size="sm" loading={busyKey === `status-${b.id}`} onClick={() => setStatus(b.id, "SERVING")} className="!px-0 text-xs text-blue-600 hover:underline mr-2">{t("carwash.start")}</Button>}
                  {canEdit && b.status === "SERVING" && <Button variant="ghost" size="sm" loading={busyKey === `status-${b.id}`} onClick={() => setStatus(b.id, "COMPLETED")} className="!px-0 text-xs text-green-600 hover:underline mr-2">{t("carwash.complete")}</Button>}
                  {canEdit && (b.status === "PENDING" || b.status === "SERVING") && <Button variant="ghost" size="sm" loading={busyKey === `status-${b.id}`} onClick={() => setStatus(b.id, "CANCELLED")} className="!px-0 text-xs text-red-600 hover:underline mr-2">{t("carwash.cancel")}</Button>}
                  {canDelete && <Button variant="ghost" size="sm" loading={busyKey === `del-${b.id}`} onClick={() => remove(b.id)} className="!px-0 text-xs text-red-600 hover:underline">{t("carwash.delete")}</Button>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">{t("carwash.noBookings")}</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal isOpen={open} onClose={() => setOpen(false)} title={t("carwash.newBooking")}>
        <CarWashBookingForm
          mode="staff"
          vehicleTypes={[]}
          washTypes={washTypes.map((w: any) => ({ id: w.id, name: w.name }))}
          prices={prices}
          washers={washers.map((w: any) => ({ id: w.id, name: w.name }))}
          slotMinutes={slotMinutes}
          showPrices
          customers={customers.map((c: any) => ({ id: c.id, name: c.name }))}
          vehicles={vehicles.map((v: any) => ({
            id: v.id,
            plateNumber: v.plateNumber,
            vehicleType: v.vehicleType,
            customerId: v.customerId,
          }))}
          onCheckAvailability={checkAvailability}
          onSubmit={submitBooking}
          submitting={saving}
        />
      </Modal>
    </div>
  );
}
