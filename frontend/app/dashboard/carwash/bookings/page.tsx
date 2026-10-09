"use client";

import api from "@/lib/api";
import Button from "@/app/components/Button";
import FilterPanel, { FilterSelect } from "@/app/components/FilterPanel";
import { getDateRange, type DatePreset } from "@/app/components/DateFilter";
import Modal from "@/app/components/Modal";
import SearchableSelect from "@/app/components/SearchableSelect";
import { useAuth } from "@/context/AuthContext";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useMemo, useState } from "react";

interface BookingItem {
  vehicleId: string;
  washTypeId: string;
  amount: string;
}

export default function CarWashBookingsPage() {
  const { hasPermission } = useAuth();
  const { t } = useTranslation();
  const [bookings, setBookings] = useState<any[]>([]);
  const [washers, setWashers] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [washTypes, setWashTypes] = useState<any[]>([]);
  const [prices, setPrices] = useState<any[]>([]);

  const [form, setForm] = useState({
    customerId: "",
    washerId: "",
    isTimeSlotBooking: true,
    startsAt: "",
    notes: "",
  });
  const [items, setItems] = useState<BookingItem[]>([]);
  const [availability, setAvailability] = useState<boolean | null>(null);
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
      const [b, w, c, wt, pr] = await Promise.all([
        api.get(`/carwash/bookings?startDate=${startDate}&endDate=${endDate}`),
        api.get("/carwash/washers?activeOnly=1"),
        api.get("/customers").catch(() => ({ data: [] })),
        api.get("/carwash/wash-types").catch(() => ({ data: [] })),
        api.get("/carwash/prices").catch(() => ({ data: [] })),
      ]);
      setBookings(b.data);
      setWashers(w.data);
      setCustomers(Array.isArray(c.data) ? c.data : []);
      setWashTypes(Array.isArray(wt.data) ? wt.data : []);
      setPrices(Array.isArray(pr.data) ? pr.data : []);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("carwash.failedLoad"));
    }
  }, [t, startDate, endDate]);

  useEffect(() => {
    load();
  }, [load]);

  // The customer's vehicles drive the per-vehicle picker. With no customer
  // selected, all vehicles are selectable.
  const customerVehicles = useMemo(() => {
    if (!form.customerId) return vehicles;
    return vehicles.filter((v) => String(v.customerId) === form.customerId);
  }, [vehicles, form.customerId]);

  const loadVehiclesForCustomer = async (customerId: string) => {
    try {
      const r = await api.get(
        `/carwash/vehicles${customerId ? `?customerId=${customerId}` : ""}`,
      );
      setVehicles(Array.isArray(r.data) ? r.data : []);
    } catch {
      setVehicles([]);
    }
  };

  const priceFor = (vehicleType: string, washTypeId: string) => {
    const p = prices.find(
      (x) =>
        String(x.vehicleType ?? "").toLowerCase() === vehicleType.toLowerCase() &&
        String(x.washTypeId ?? "") === washTypeId,
    );
    return p ? String(p.amount) : "";
  };

  const vehicleTypeOf = (vehicleId: string) =>
    vehicles.find((v) => String(v.id) === vehicleId)?.vehicleType ?? "Car";

  const openNew = async () => {
    setForm({ customerId: "", washerId: "", isTimeSlotBooking: true, startsAt: "", notes: "" });
    setItems([]);
    setAvailability(null);
    try {
      const r = await api.get("/carwash/vehicles");
      setVehicles(Array.isArray(r.data) ? r.data : []);
    } catch {
      /* keep current list */
    }
    setOpen(true);
  };

  const addItem = () =>
    setItems((prev) => [
      ...prev,
      { vehicleId: "", washTypeId: "", amount: "" },
    ]);

  const removeItem = (idx: number) =>
    setItems((prev) => prev.filter((_, i) => i !== idx));

  const updateItem = (idx: number, patch: Partial<BookingItem>) =>
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const next = { ...it, ...patch };
        // Price autofills from the price list (vehicle type + wash type).
        const vt = vehicleTypeOf(next.vehicleId);
        if (patch.washTypeId !== undefined || patch.vehicleId !== undefined) {
          const p = priceFor(vt, next.washTypeId);
          if (p !== "") next.amount = p;
        }
        return next;
      }),
    );

  const totalAmount = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);

  const checkAvailability = async () => {
    if (!form.washerId || !form.startsAt) {
      setAvailability(null);
      return;
    }
    try {
      const r = await api.get(
        `/carwash/bookings/availability?washerId=${form.washerId}&startsAt=${new Date(form.startsAt).toISOString()}`,
      );
      setAvailability(r.data.available);
    } catch {
      setAvailability(null);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (items.length === 0) {
      setError(t("carwash.needVehicle"));
      return;
    }
    setSaving(true);
    try {
      await api.post("/carwash/bookings", {
        customerId: form.customerId ? Number(form.customerId) : null,
        washerId: form.washerId ? Number(form.washerId) : null,
        isTimeSlotBooking: form.isTimeSlotBooking,
        startsAt: form.startsAt
          ? new Date(form.startsAt).toISOString()
          : new Date().toISOString(),
        notes: form.notes.trim() || undefined,
        items: items.map((it) => ({
          vehicleId: it.vehicleId ? Number(it.vehicleId) : null,
          vehicleType: vehicleTypeOf(it.vehicleId),
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

  const customerOptions = useMemo(
    () =>
      customers.map((c: any) => ({
        value: String(c.id),
        label: c.name,
        searchText: `${c.name ?? ""} ${c.phone ?? ""}`,
      })),
    [customers],
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
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm text-gray-600">{t("carwash.when")}
            <input value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} type="datetime-local" className="border border-gray-300 rounded p-2 text-sm w-full mt-1" required />
          </label>
          <label className="block text-sm text-gray-600">{t("carwash.customer")}
            <SearchableSelect
              value={form.customerId}
              onChange={(v) => {
                setForm({ ...form, customerId: v });
                setItems([]);
                loadVehiclesForCustomer(v);
              }}
              options={customerOptions}
              placeholder={t("carwash.customerOptional")}
            />
          </label>
          <label className="block text-sm text-gray-600">{t("carwash.washer")}
            <SearchableSelect value={form.washerId} onChange={(v) => setForm({ ...form, washerId: v })} options={washers.map((w) => ({ value: String(w.id), label: w.name }))} placeholder={t("carwash.washer")} />
          </label>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-gray-600">{t("carwash.vehicles")}</span>
              <button type="button" onClick={addItem} className="text-xs text-blue-600 hover:underline">
                + {t("carwash.addVehicle")}
              </button>
            </div>
            <div className="space-y-2">
              {items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-5">
                    <SearchableSelect
                      value={it.vehicleId}
                      onChange={(v) => updateItem(idx, { vehicleId: v })}
                      options={customerVehicles.map((v) => ({ value: String(v.id), label: `${v.plateNumber} (${v.vehicleType})` }))}
                      placeholder={t("carwash.vehicles")}
                    />
                  </div>
                  <div className="col-span-4">
                    <select
                      value={it.washTypeId}
                      onChange={(e) => updateItem(idx, { washTypeId: e.target.value })}
                      className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
                    >
                      <option value="">{t("carwash.washType")}</option>
                      {washTypes.map((w: any) => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <input value={it.amount} readOnly placeholder={t("carwash.price")} className="border border-gray-300 rounded p-2 text-sm w-full bg-gray-50" />
                  </div>
                  <div className="col-span-1 text-right">
                    <button type="button" onClick={() => removeItem(idx)} className="text-red-500">✕</button>
                  </div>
                </div>
              ))}
              {items.length === 0 && (
                <p className="text-xs text-gray-400">{t("carwash.needVehicle")}</p>
              )}
            </div>
            <p className="text-sm text-gray-700 mt-2">
              {t("carwash.amount")}: <strong>{totalAmount.toLocaleString()}</strong>
            </p>
          </div>

          {availability !== null && (
            <div className={`text-sm px-3 py-2 rounded ${availability ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
              {availability ? t("carwash.available") : t("carwash.notAvailable")}
            </div>
          )}
          <button type="button" onClick={checkAvailability} className="text-xs text-blue-600 hover:underline">{t("carwash.availability")}</button>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={form.isTimeSlotBooking} onChange={(e) => setForm({ ...form, isTimeSlotBooking: e.target.checked })} />
            {t("carwash.timeSlotBooking")}
          </label>
          <label className="block text-sm text-gray-600">{t("carwash.notes")}
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t("carwash.notes")} className="border border-gray-300 rounded p-2 text-sm w-full mt-1" />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-sm text-gray-600">{t("carwash.cancel")}</button>
            <Button type="submit" loading={saving} shape="rounded">{t("carwash.newBooking")}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
