"use client";

import api from "@/lib/api";
import Button from "@/app/components/Button";
import CollapsibleFilterPanel from "@/app/components/CollapsibleFilterPanel";
import { FilterSelect } from "@/app/components/FilterPanel";
import { getDateRange, type DatePreset } from "@/app/components/DateFilter";
import Modal from "@/app/components/Modal";
import SearchableSelect from "@/app/components/SearchableSelect";
import CarWashBookingForm, {
  type CarWashBookingPayload,
} from "@/app/components/CarWashBookingForm";
import { useAuth } from "@/context/AuthContext";
import { fmtCurrency } from "@/lib/currency";
import { formatDateTime } from "@/lib/datetime";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useState } from "react";

const BOOKING_STATUSES = [
  "BOOKED",
  "SERVED",
  "COMPLETED",
  "CANCELLED",
] as const;

const STATUS_CLASS: Record<string, string> = {
  BOOKED: "bg-amber-100 text-amber-700",
  PENDING: "bg-amber-100 text-amber-700",
  SERVED: "bg-indigo-100 text-indigo-700",
  COMPLETED: "bg-green-100 text-green-700",
  CANCELLED: "bg-red-100 text-red-700",
};

export default function CarWashBookingsPage() {
  const { hasPermission } = useAuth();
  const { t } = useTranslation();
  const [bookings, setBookings] = useState<any[]>([]);
  const [washers, setWashers] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [washTypes, setWashTypes] = useState<any[]>([]);
  const [prices, setPrices] = useState<any[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<any[]>([]);

  const [open, setOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("BOOKED");
  const [detail, setDetail] = useState<any | null>(null);
  const [serveTarget, setServeTarget] = useState<any | null>(null);
  const [serveWasherId, setServeWasherId] = useState("");
  const [serveHelperIds, setServeHelperIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const init = getDateRange("today");
  // Default to today → +30 days so future-dated bookings stay visible without
  // manually changing the date filter.
  const in30 = new Date();
  in30.setDate(in30.getDate() + 30);
  const end30 = `${in30.getFullYear()}-${String(in30.getMonth() + 1).padStart(2, "0")}-${String(in30.getDate()).padStart(2, "0")}`;
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [startDate, setStartDate] = useState(init.start);
  const [endDate, setEndDate] = useState(end30);
  const [search, setSearch] = useState("");

  const canCreate = hasPermission("carwash.bookings.create");
  const canEdit = hasPermission("carwash.bookings.edit");
  const canDelete = hasPermission("carwash.bookings.delete");

  const load = useCallback(async () => {
    try {
      const [b, w, wt, pr, vt] = await Promise.all([
        api.get(`/carwash/bookings?startDate=${startDate}&endDate=${endDate}`),
        api.get("/carwash/washers?activeOnly=1"),
        api.get("/carwash/wash-types").catch(() => ({ data: [] })),
        api.get("/carwash/prices").catch(() => ({ data: [] })),
        api.get("/carwash/vehicle-types").catch(() => ({ data: [] })),
      ]);
      setBookings(b.data);
      setWashers(w.data);
      setWashTypes(Array.isArray(wt.data) ? wt.data : []);
      setPrices(Array.isArray(pr.data) ? pr.data : []);
      setVehicleTypes(
        Array.isArray(vt.data) ? vt.data.map((v: any) => v.name) : [],
      );
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
    vehicleType: string,
    washTypeId: string,
  ) => {
    try {
      const r = await api.get(
        `/carwash/bookings/availability?washerId=${washerId}&startsAt=${encodeURIComponent(startsAt)}&vehicleType=${encodeURIComponent(vehicleType)}&washTypeId=${washTypeId}`,
      );
      return { available: !!r.data?.available };
    } catch {
      return { available: false };
    }
  };

  const lookupCustomer = async (phone: string) => {
    try {
      const r = await api.get(
        `/customers/by-phone?phone=${encodeURIComponent(phone)}`,
      );
      return r.data ? { id: r.data.id, name: r.data.name } : null;
    } catch {
      return null;
    }
  };

  const submitBooking = async (payload: CarWashBookingPayload) => {
    setError("");
    setSaving(true);
    try {
      await api.post("/carwash/bookings", {
        customerId: payload.customerId ? Number(payload.customerId) : null,
        customerName: payload.customerName,
        customerPhone: payload.customerPhone,
        washerId: payload.washerId ? Number(payload.washerId) : null,
        isTimeSlotBooking: payload.isTimeSlotBooking,
        startsAt: payload.startsAt,
        notes: payload.notes,
        items: payload.items.map((it) => ({
          vehicleId: it.vehicleId ? Number(it.vehicleId) : null,
          vehicleType: it.vehicleType,
          washTypeId: it.washTypeId ? Number(it.washTypeId) : null,
          washerId: it.washerId ? Number(it.washerId) : null,
          amount: Number(it.amount) || 0,
          startsAt: it.startsAt,
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

  // A washer must be assigned before a booking can be served. Lines that
  // already carry their own washer are served with it; only lines without one
  // need a picker (the booking header washer is the legacy default for those).
  const unassignedServeItems = (b: any) =>
    (b?.items ?? []).filter((it: any) => !it.washerId);

  const startServe = (b: any) => {
    const unassigned = unassignedServeItems(b);
    setServeTarget(b);
    // Pre-fill the picker with the legacy header washer when any line needs one.
    setServeWasherId(
      unassigned.length > 0 && b?.washerId ? String(b.washerId) : "",
    );
    setServeHelperIds([]);
  };

  const doServe = async (
    id: number,
    washerId?: string,
    helperIds?: string[],
  ) => {
    setError("");
    setBusyKey(`serve-${id}`);
    try {
      await api.post(`/carwash/bookings/${id}/serve`, {
        ...(washerId ? { washerId: Number(washerId) } : {}),
        ...(helperIds && helperIds.length
          ? { helperWasherIds: helperIds.map(Number) }
          : {}),
      });
      setDetail((d: any) =>
        d && d.id === id ? { ...d, status: "SERVED" } : d,
      );
      setServeTarget(null);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedSave"));
    } finally {
      setBusyKey(null);
    }
  };

  const cancel = async (id: number) => {
    setError("");
    setBusyKey(`cancel-${id}`);
    try {
      await api.patch(`/carwash/bookings/${id}/status`, {
        status: "CANCELLED",
      });
      setDetail((d: any) =>
        d && d.id === id ? { ...d, status: "CANCELLED" } : d,
      );
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
      setDetail((d: any) => (d && d.id === id ? null : d));
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedDelete"));
    } finally {
      setBusyKey(null);
    }
  };

  const isBooked = (b: any) => b.status === "BOOKED" || b.status === "PENDING";
  const normStatus = (s: string) => (s === "PENDING" ? "BOOKED" : s);
  const bookingStatusLabel = (s: string) =>
    t(`carwash.bookingStatus_${normStatus(s)}`, { defaultValue: s });

  const filtered = bookings.filter((b) => {
    if (!statusFilter) return true;
    if (statusFilter === "BOOKED") return isBooked(b);
    return b.status === statusFilter;
  });

  // Serve modal: each line's booked washer is shown read-only; only lines
  // without a washer share the single picker below (matching the backend API).
  const serveItems = (serveTarget?.items ?? []) as any[];
  const serveUnassigned = serveItems.filter((it: any) => !it.washerId);
  const serveNeedsWasher = serveUnassigned.length > 0;
  const washerName = (id: any) =>
    washers.find((w: any) => String(w.id) === String(id))?.name ?? "—";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">
          {t("carwash.bookings")}
        </h1>
        {canCreate && (
          <button
            onClick={openNew}
            className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium"
          >
            + {t("carwash.newBooking")}
          </button>
        )}
      </div>
      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>
      )}

      <CollapsibleFilterPanel
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
            options={BOOKING_STATUSES.map((s) => ({
              value: s,
              label: t(`carwash.bookingStatus_${s}`),
            }))}
          />
        }
      />

      {statusFilter === "BOOKED" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((b) => (
            <div
              key={b.id}
              onClick={() => setDetail(b)}
              className="bg-white rounded-xl border border-gray-200 p-3 space-y-2 cursor-pointer hover:border-blue-300 hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-gray-800">
                    {b.customer?.name ?? b.customerName ?? "—"}
                  </p>
                  {(b.customer?.phone ?? b.customerPhone) ? (
                    <p className="text-[11px] text-gray-400">
                      {b.customer?.phone ?? b.customerPhone}
                    </p>
                  ) : null}
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${STATUS_CLASS[b.status] ?? "bg-gray-100 text-gray-600"}`}
                >
                  {bookingStatusLabel(b.status)}
                </span>
              </div>

              <ul className="text-xs text-gray-500 space-y-0.5">
                {(b.items ?? []).length > 0
                  ? (b.items as any[]).map((it: any) => (
                      <li key={it.id}>
                        · {it.vehicle?.plateNumber ?? it.vehicleType}
                        {it.washType?.name ? ` · ${it.washType.name}` : ""}
                        {it.washer?.name ? ` · ${it.washer.name}` : ""}
                      </li>
                    ))
                  : (
                    <li>· {b.vehicle?.plateNumber ?? b.vehicleType}</li>
                  )}
              </ul>

              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">
                  {fmtCurrency(b.amount)}
                </span>
                <span className="text-[11px] text-gray-400">
                  {formatDateTime(b.startsAt)}
                </span>
              </div>

              <div
                className="flex justify-end pt-1 border-t"
                onClick={(e) => e.stopPropagation()}
              >
                {canEdit && isBooked(b) && (
                  <Button
                    size="sm"
                    loading={busyKey === `serve-${b.id}`}
                    onClick={() => startServe(b)}
                  >
                    {t("carwash.serve")}
                  </Button>
                )}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="col-span-full text-center text-gray-400 py-10">
              {t("carwash.noBookings")}
            </p>
          )}
        </div>
      ) : (
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
                <tr
                  key={b.id}
                  onClick={() => setDetail(b)}
                  className="cursor-pointer hover:bg-gray-50"
                >
                  <td className="px-4 py-2 whitespace-nowrap">
                    {new Date(b.startsAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {b.customer?.name ?? b.customerName ?? "—"}
                    {(b.customer?.phone ?? b.customerPhone) ? (
                      <span className="block text-[11px] text-gray-400">
                        {b.customer?.phone ?? b.customerPhone}
                      </span>
                    ) : null}
                  </td>
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
                  <td className="px-4 py-2 text-gray-500 whitespace-nowrap">
                    {(b.items ?? []).length > 0
                      ? [
                          ...new Set(
                            (b.items as any[])
                              .map((it: any) => it.washer?.name)
                              .filter(Boolean),
                          ),
                        ].join(", ") || "—"
                      : b.washer?.name ?? "—"}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {fmtCurrency(b.amount)}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${STATUS_CLASS[b.status] ?? "bg-gray-100 text-gray-600"}`}
                    >
                      {bookingStatusLabel(b.status)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <span onClick={(e) => e.stopPropagation()}>
                      {canDelete && (
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={busyKey === `del-${b.id}`}
                          onClick={() => remove(b.id)}
                          className="!px-0 text-xs text-red-600 hover:underline"
                        >
                          {t("carwash.delete")}
                        </Button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-6 text-center text-gray-400"
                  >
                    {t("carwash.noBookings")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* New booking */}
      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title={t("carwash.newBooking")}
      >
        <CarWashBookingForm
          mode="staff"
          vehicleTypes={vehicleTypes}
          washTypes={washTypes.map((w: any) => ({ id: w.id, name: w.name }))}
          prices={prices}
          washers={washers.map((w: any) => ({ id: w.id, name: w.name }))}
          showPrices
          vehicles={vehicles.map((v: any) => ({
            id: v.id,
            plateNumber: v.plateNumber,
            vehicleType: v.vehicleType,
            customerId: v.customerId,
          }))}
          onLookupCustomer={lookupCustomer}
          onCheckAvailability={checkAvailability}
          onSubmit={submitBooking}
          submitting={saving}
        />
      </Modal>

      {/* Booking detail */}
      <Modal
        isOpen={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `${t("carwash.bookings")} #${detail.id}` : ""}
      >
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray-500">{t("carwash.status")}</span>
              <span
                className={`text-xs px-2.5 py-1 rounded-full ${STATUS_CLASS[detail.status] ?? "bg-gray-100 text-gray-600"}`}
              >
                {bookingStatusLabel(detail.status)}
              </span>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-gray-500">{t("carwash.customer")}</span>
              <span className="font-medium text-right">
                {detail.customer?.name ?? detail.customerName ?? "—"}
                {(detail.customer?.phone ?? detail.customerPhone)
                  ? ` · ${detail.customer?.phone ?? detail.customerPhone}`
                  : ""}
              </span>
            </div>

            <ul className="divide-y divide-gray-100 border rounded-lg">
              {(detail.items ?? []).length > 0 ? (
                (detail.items as any[]).map((it: any) => (
                  <li
                    key={it.id}
                    className="flex items-center justify-between px-3 py-2 gap-2"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-gray-800 truncate">
                        {it.vehicle?.plateNumber ?? it.vehicleType}
                        {it.washType?.name ? ` · ${it.washType.name}` : ""}
                      </p>
                      <p className="text-[11px] text-gray-400">
                        {it.washer?.name ?? "—"}
                        {it.startsAt
                          ? ` · ${new Date(it.startsAt).toLocaleString()}`
                          : ""}
                      </p>
                    </div>
                    <span className="text-gray-500 whitespace-nowrap">
                      {fmtCurrency(it.amount)}
                    </span>
                  </li>
                ))
              ) : (
                <li className="px-3 py-2 text-gray-400">
                  {detail.vehicle?.plateNumber ?? detail.vehicleType}
                </li>
              )}
            </ul>

            <div className="flex items-center justify-between">
              <span className="text-gray-500">{t("carwash.amount")}</span>
              <span className="font-semibold">
                {fmtCurrency(detail.amount)}
              </span>
            </div>

            {detail.notes && (
              <p className="text-xs text-gray-500">{detail.notes}</p>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              {canEdit && isBooked(detail) && (
                <>
                  <Button
                    loading={busyKey === `serve-${detail.id}`}
                    onClick={() => startServe(detail)}
                  >
                    {t("carwash.serve")}
                  </Button>
                  <Button
                    variant="danger"
                    loading={busyKey === `cancel-${detail.id}`}
                    onClick={() => cancel(detail.id)}
                  >
                    {t("carwash.cancel")}
                  </Button>
                </>
              )}
              {canDelete && (
                <Button
                  variant="ghost"
                  loading={busyKey === `del-${detail.id}`}
                  onClick={() => remove(detail.id)}
                  className="!px-0 text-red-600"
                >
                  {t("carwash.delete")}
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Serve: each booked washer is read-only; only lines without one ask for a picker. */}
      <Modal
        isOpen={!!serveTarget}
        onClose={() => setServeTarget(null)}
        title={t("carwash.assignWasherTitle")}
      >
        {serveTarget && (
          <div className="space-y-3 text-sm">
            <p className="text-xs text-gray-500">
              {t("carwash.assignWasherHint")}
            </p>
            <div className="rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
              {serveTarget.customer?.name ?? serveTarget.customerName ?? "—"}
              {serveItems.length
                ? ` · ${serveItems
                    .map((it: any) => it.vehicle?.plateNumber ?? it.vehicleType)
                    .join(", ")}`
                : ""}
            </div>

            <ul className="divide-y divide-gray-100 border rounded-lg">
              {serveItems.length > 0 ? (
                serveItems.map((it: any) => (
                  <li
                    key={it.id}
                    className="flex items-center justify-between px-3 py-2 gap-2"
                  >
                    <span className="font-medium text-gray-800">
                      {it.vehicle?.plateNumber ?? it.vehicleType}
                    </span>
                    {it.washerId ? (
                      <span className="text-xs text-gray-500">
                        {it.washer?.name ?? washerName(it.washerId)}
                      </span>
                    ) : (
                      <span className="text-xs text-amber-600">
                        {t("carwash.washerOptional")}
                      </span>
                    )}
                  </li>
                ))
              ) : (
                <li className="px-3 py-2 text-gray-400">
                  {serveTarget.vehicle?.plateNumber ?? serveTarget.vehicleType}
                </li>
              )}
            </ul>

            {serveNeedsWasher && (
              <label className="block text-gray-600">
                {t("carwash.primaryWasher")}
                <SearchableSelect
                  value={serveWasherId}
                  onChange={setServeWasherId}
                  options={washers.map((w) => ({
                    value: String(w.id),
                    label: w.name,
                  }))}
                  placeholder={t("carwash.primaryWasher")}
                />
              </label>
            )}

            <div>
              <p className="text-xs text-gray-500 mb-1">
                {t("carwash.helpers")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {washers
                  .filter((w) => String(w.id) !== serveWasherId)
                  .map((w) => {
                    const id = String(w.id);
                    const on = serveHelperIds.includes(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() =>
                          setServeHelperIds((prev) =>
                            prev.includes(id)
                              ? prev.filter((x) => x !== id)
                              : [...prev, id],
                          )
                        }
                        className={`text-xs border rounded-full px-2.5 py-0.5 ${
                          on
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-gray-600 border-gray-300"
                        }`}
                      >
                        {w.name}
                      </button>
                    );
                  })}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setServeTarget(null)}
                className="px-3 py-2 text-sm text-gray-600"
              >
                {t("common.cancel")}
              </button>
              <Button
                loading={busyKey === `serve-${serveTarget.id}`}
                disabled={serveNeedsWasher && !serveWasherId}
                onClick={() =>
                  doServe(
                    serveTarget.id,
                    serveNeedsWasher ? serveWasherId : "",
                    serveHelperIds,
                  )
                }
              >
                {t("carwash.serve")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
