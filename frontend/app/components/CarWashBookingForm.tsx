"use client";

// Reusable car-wash booking form. Used by the dashboard "New booking" modal and
// the public QR booking page. Customer info lives at the top: phone (required)
// autofills the name and, for staff, loads the customer's registered vehicles
// so several can be selected in one booking. Each vehicle line carries its own
// wash type (next to the vehicle), washer, date and 45-minute time slot.
// Availability is checked automatically per line.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "@/app/components/Button";
import SearchableSelect from "@/app/components/SearchableSelect";
import { fmtCurrency } from "@/lib/currency";

export interface CarWashOption {
  id: string | number;
  name: string;
}
export interface CarWashPrice {
  vehicleType: string;
  washTypeId: string | number;
  amount: number | string;
  durationMinutes?: number | null;
}
export interface CarWashVehicleOption {
  id: string | number;
  plateNumber: string;
  vehicleType: string;
  customerId?: string | number;
}
export interface CarWashCustomerOption {
  id: string | number;
  name: string;
}

export interface CarWashBookingItemPayload {
  vehicleId?: string | null;
  vehicleType: string;
  plateNumber?: string;
  washTypeId?: string | null;
  washerId?: string | null;
  amount: number;
  date?: string; // YYYY-MM-DD
  time?: string; // HH:mm (45-min slot)
}

export interface CarWashBookingPayload {
  customerId?: string | null;
  customerName?: string;
  customerPhone?: string;
  washerId?: string | null;
  startsAt: string; // ISO — earliest vehicle time
  notes?: string;
  isTimeSlotBooking: boolean;
  items: Array<{
    vehicleId?: string | null;
    vehicleType: string;
    plateNumber?: string;
    washTypeId?: string | null;
    washerId?: string | null;
    amount: number;
    startsAt: string;
  }>;
  name?: string;
  phone?: string;
}

interface CarWashBookingFormProps {
  mode: "staff" | "public";
  vehicleTypes: string[];
  washTypes: CarWashOption[];
  prices: CarWashPrice[];
  washers: CarWashOption[];
  showPrices?: boolean;
  customers?: CarWashCustomerOption[];
  vehicles?: CarWashVehicleOption[];
  onLookupCustomer?: (
    phone: string,
  ) => Promise<{ id: string | number; name: string } | null>;
  onCreateCustomer?: (
    name: string,
    phone: string,
  ) => Promise<{ id: string | number; name: string }>;
  onCheckAvailability?: (
    washerId: string,
    startsAt: string,
    vehicleType: string,
    washTypeId: string,
  ) => Promise<{ available: boolean } | null>;
  onSubmit: (payload: CarWashBookingPayload) => Promise<void> | void;
  submitting?: boolean;
  submitLabel?: string;
}

/** 24h day split into 45-minute slots. */
const TIME_SLOTS = (() => {
  const slots: string[] = [];
  for (let mins = 0; mins < 24 * 60; mins += 45) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    slots.push(
      `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
    );
  }
  return slots;
})();

const emptyItem = (vehicleTypes: string[]): CarWashBookingItemPayload => ({
  vehicleId: null,
  vehicleType: vehicleTypes[0] ?? "Car",
  plateNumber: "",
  washTypeId: null,
  washerId: null,
  amount: 0,
  date: "",
  time: "",
});

export default function CarWashBookingForm({
  mode,
  vehicleTypes,
  washTypes,
  prices,
  washers,
  showPrices = true,
  customers = [],
  vehicles = [],
  onLookupCustomer,
  onCreateCustomer,
  onCheckAvailability,
  onSubmit,
  submitting = false,
  submitLabel,
}: CarWashBookingFormProps) {
  const { t } = useTranslation();

  // --- Customer (top of form) ------------------------------------------
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [customerState, setCustomerState] = useState<"none" | "found" | "new">(
    "none",
  );

  // --- Booking lines ---------------------------------------------------
  const [items, setItems] = useState<CarWashBookingItemPayload[]>([
    emptyItem(vehicleTypes),
  ]);
  const [notes, setNotes] = useState("");
  const [availability, setAvailability] = useState<Record<number, string>>({});

  // Keep each line's vehicle type pointing at a real option once the async
  // vehicleTypes arrive (public page).
  useEffect(() => {
    if (vehicleTypes.length === 0) return;
    setItems((prev) =>
      prev.map((it) =>
        vehicleTypes.includes(it.vehicleType)
          ? it
          : { ...it, vehicleType: vehicleTypes[0] },
      ),
    );
  }, [vehicleTypes]);

  // The selected customer's registered vehicles (staff mode).
  const customerVehicles = useMemo(() => {
    if (mode !== "staff" || !customerId) return [];
    return vehicles.filter((v) => String(v.customerId ?? "") === customerId);
  }, [mode, customerId, vehicles]);

  const priceFor = (vehicleType: string, washTypeId: string | null) => {
    const p = prices.find(
      (x) =>
        String(x.vehicleType ?? "").toLowerCase() ===
          vehicleType.toLowerCase() &&
        String(x.washTypeId ?? "") === String(washTypeId ?? ""),
    );
    return p ? Number(p.amount) : 0;
  };

  const startsAtOf = (it: CarWashBookingItemPayload): string => {
    const d = it.date || "";
    const tm = it.time || "";
    if (d && tm) return new Date(`${d}T${tm}`).toISOString();
    return new Date().toISOString();
  };

  const lookupCustomer = async (rawPhone: string) => {
    const p = rawPhone.trim();
    if (p.length < 7 || !onLookupCustomer) return;
    setLookingUp(true);
    try {
      const c = await onLookupCustomer(p);
      if (c) {
        setCustomerId(String(c.id));
        setName(c.name);
        setCustomerState("found");
      } else {
        setCustomerState("new");
      }
    } catch {
      setCustomerState("new");
    } finally {
      setLookingUp(false);
    }
  };

  const updateItem = (
    idx: number,
    patch: Partial<CarWashBookingItemPayload>,
  ) => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const next = { ...it, ...patch };
        if (
          patch.washTypeId !== undefined ||
          patch.vehicleType !== undefined ||
          patch.vehicleId !== undefined
        ) {
          next.amount = priceFor(next.vehicleType, next.washTypeId ?? null);
        }
        return next;
      }),
    );
  };

  const addItem = () => setItems((prev) => [...prev, emptyItem(vehicleTypes)]);
  const removeItem = (idx: number) =>
    setItems((prev) => prev.filter((_, i) => i !== idx));

  const toggleRegisteredVehicle = (v: CarWashVehicleOption) => {
    const exists = items.findIndex((it) => String(it.vehicleId) === String(v.id));
    if (exists >= 0) {
      removeItem(exists);
    } else {
      setItems((prev) => [
        ...prev,
        {
          vehicleId: String(v.id),
          vehicleType: v.vehicleType,
          plateNumber: v.plateNumber,
          washTypeId: null,
          washerId: null,
          amount: 0,
          date: "",
          time: "",
        },
      ]);
    }
  };

  const totalAmount = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);

  // Auto-check availability whenever a line's washer/date/time change.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    items.forEach((it, idx) => {
      if (!onCheckAvailability || !it.washerId || !it.date || !it.time) {
        setAvailability((prev) => (prev[idx] ? { ...prev, [idx]: "" } : prev));
        return;
      }
      const run = async () => {
        setAvailability((prev) => ({ ...prev, [idx]: "checking" }));
        try {
          const r = await onCheckAvailability(
            String(it.washerId),
            startsAtOf(it),
            it.vehicleType,
            String(it.washTypeId ?? ""),
          );
          setAvailability((prev) => ({
            ...prev,
            [idx]: r?.available ? "available" : "unavailable",
          }));
        } catch {
          setAvailability((prev) => ({ ...prev, [idx]: "unavailable" }));
        }
      };
      timers.push(setTimeout(run, 400));
    });
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, onCheckAvailability]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (items.length === 0) return;

    // Resolve the customer id: autofill found one, or create a new one when a
    // name was typed for an unknown phone (staff mode).
    let cid = customerId || null;
    if (!cid && name.trim() && phone.trim() && onCreateCustomer) {
      try {
        const created = await onCreateCustomer(name.trim(), phone.trim());
        cid = String(created.id);
      } catch {
        // Let the parent decide how to surface the error; still submit so the
        // booking can proceed with a name/phone only.
      }
    }

    await onSubmit({
      customerId: mode === "staff" ? cid : null,
      customerName: name.trim() || undefined,
      customerPhone: phone.trim() || undefined,
      washerId: items[0]?.washerId ?? null,
      startsAt: items.length ? startsAtOf(items[0]) : new Date().toISOString(),
      notes: notes.trim() || undefined,
      isTimeSlotBooking: true,
      items: items.map((it) => ({
        vehicleId: it.vehicleId || null,
        vehicleType: it.vehicleType || vehicleTypes[0] || "Car",
        plateNumber: it.plateNumber?.trim() || undefined,
        washTypeId: it.washTypeId || null,
        washerId: it.washerId || null,
        amount: Number(it.amount) || 0,
        startsAt: startsAtOf(it),
      })),
      name: mode === "public" ? name.trim() || undefined : undefined,
      phone: mode === "public" ? phone.trim() || undefined : undefined,
    });
  };

  const label =
    submitLabel ??
    (mode === "public" ? t("carwash.bookNow") : t("carwash.newBooking"));

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* --- Customer information (top) -------------------------------- */}
      <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {t("carwash.customerInfo")}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-sm text-gray-600">
            {t("carwash.phone")} <span className="text-red-500">*</span>
            <input
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setCustomerId("");
                setCustomerState("none");
              }}
              onBlur={() => lookupCustomer(phone)}
              inputMode="tel"
              placeholder={t("carwash.phonePlaceholder")}
              className="border border-gray-300 rounded p-2 text-sm w-full mt-1"
              required
            />
            {lookingUp && (
              <span className="text-xs text-gray-400">{t("carwash.lookingUp")}</span>
            )}
            {customerState === "found" && (
              <span className="text-xs text-emerald-600">{t("carwash.customerFound")}</span>
            )}
            {customerState === "new" && (
              <span className="text-xs text-amber-600">{t("carwash.newCustomer")}</span>
            )}
          </label>
          <label className="block text-sm text-gray-600">
            {t("carwash.customerName")}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("carwash.customerNamePlaceholder")}
              className="border border-gray-300 rounded p-2 text-sm w-full mt-1"
              required
            />
          </label>
        </div>

        {/* Registered vehicles for the selected customer (staff). */}
        {mode === "staff" && customerVehicles.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 mb-1">{t("carwash.registeredVehicles")}</p>
            <div className="flex flex-wrap gap-2">
              {customerVehicles.map((v) => {
                const selected = items.some(
                  (it) => String(it.vehicleId) === String(v.id),
                );
                return (
                  <button
                    key={String(v.id)}
                    type="button"
                    onClick={() => toggleRegisteredVehicle(v)}
                    className={`text-xs border rounded-full px-3 py-1 ${
                      selected
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-gray-600 border-gray-300"
                    }`}
                  >
                    {v.plateNumber} · {v.vehicleType}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* --- Vehicle lines ---------------------------------------------- */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm text-gray-600">{t("carwash.vehicles")}</span>
          <button
            type="button"
            onClick={addItem}
            className="text-xs text-blue-600 hover:underline"
          >
            + {t("carwash.addVehicle")}
          </button>
        </div>
        <div className="space-y-3">
          {items.map((it, idx) => (
            <div
              key={idx}
              className="rounded-lg border border-gray-200 p-3 space-y-2"
            >
              {/* Vehicle + wash type side by side. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {mode === "staff" && customerVehicles.length > 0 ? (
                  <SearchableSelect
                    value={it.vehicleId ?? ""}
                    onChange={(v) => {
                      const veh = customerVehicles.find(
                        (x) => String(x.id) === v,
                      );
                      updateItem(idx, {
                        vehicleId: v,
                        vehicleType: veh?.vehicleType ?? it.vehicleType,
                        plateNumber: veh?.plateNumber ?? it.plateNumber,
                      });
                    }}
                    options={customerVehicles.map((v) => ({
                      value: String(v.id),
                      label: `${v.plateNumber} (${v.vehicleType})`,
                    }))}
                    placeholder={t("carwash.vehicles")}
                  />
                ) : (
                  <div className="space-y-2">
                    <label className="block text-sm text-gray-600">
                      {t("carwash.vehicleType")}
                      <select
                        value={it.vehicleType}
                        onChange={(e) =>
                          updateItem(idx, { vehicleType: e.target.value })
                        }
                        className="border border-gray-300 rounded p-2 text-sm w-full mt-1 bg-white"
                      >
                        {(vehicleTypes.length ? vehicleTypes : ["Car"]).map(
                          (vt) => (
                            <option key={vt} value={vt}>
                              {vt}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <label className="block text-sm text-gray-600">
                      {t("carwash.plateNumber")}
                      <input
                        value={it.plateNumber ?? ""}
                        onChange={(e) =>
                          updateItem(idx, { plateNumber: e.target.value })
                        }
                        placeholder={t("carwash.plateNumber")}
                        className="border border-gray-300 rounded p-2 text-sm w-full mt-1"
                      />
                    </label>
                  </div>
                )}

                <label className="block text-sm text-gray-600">
                  {t("carwash.washType")}
                  <select
                    value={it.washTypeId ?? ""}
                    onChange={(e) =>
                      updateItem(idx, { washTypeId: e.target.value })
                    }
                    className="border border-gray-300 rounded p-2 text-sm w-full mt-1 bg-white"
                  >
                    <option value="">{t("carwash.washType")}</option>
                    {washTypes.map((w) => (
                      <option key={String(w.id)} value={String(w.id)}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Washer + date. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="block text-sm text-gray-600">
                  {t("carwash.washer")}
                  <select
                    value={it.washerId ?? ""}
                    onChange={(e) => {
                      updateItem(idx, { washerId: e.target.value });
                      setAvailability((prev) => ({ ...prev, [idx]: "" }));
                    }}
                    className="border border-gray-300 rounded p-2 text-sm w-full mt-1 bg-white"
                  >
                    <option value="">{t("carwash.washerOptional")}</option>
                    {washers.map((w) => (
                      <option key={String(w.id)} value={String(w.id)}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-gray-600">
                  {t("carwash.date")}
                  <input
                    type="date"
                    value={it.date ?? ""}
                    onChange={(e) => updateItem(idx, { date: e.target.value })}
                    className="border border-gray-300 rounded p-2 text-sm w-full mt-1"
                    required
                  />
                </label>
              </div>

              {/* Time (45-min slot) + price. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="block text-sm text-gray-600">
                  {t("carwash.time")}
                  <select
                    value={it.time ?? ""}
                    onChange={(e) => updateItem(idx, { time: e.target.value })}
                    className="border border-gray-300 rounded p-2 text-sm w-full mt-1 bg-white"
                    required
                  >
                    <option value="">{t("carwash.timeSlot")}</option>
                    {TIME_SLOTS.map((slot) => (
                      <option key={slot} value={slot}>
                        {slot}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-end justify-between pb-1">
                  <span className="text-sm text-gray-500">
                    {t("carwash.price")}:{" "}
                    <strong>{fmtCurrency(Number(it.amount || 0))}</strong>
                  </span>
                </div>
              </div>

              {/* Availability (auto) + remove. */}
              <div className="flex items-center justify-between">
                <span className="text-xs">
                  {availability[idx] === "checking" && (
                    <span className="text-gray-400">{t("carwash.lookingUp")}</span>
                  )}
                  {availability[idx] === "available" && (
                    <span className="text-emerald-600">{t("carwash.available")}</span>
                  )}
                  {availability[idx] === "unavailable" && (
                    <span className="text-red-600">{t("carwash.notAvailable")}</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  disabled={items.length === 1}
                  className="text-red-500 text-sm disabled:opacity-30"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
        {showPrices && (
          <p className="text-sm text-gray-700 mt-2">
            {t("carwash.amount")}:{" "}
            <strong>{fmtCurrency(totalAmount)}</strong>
          </p>
        )}
      </div>

      <label className="block text-sm text-gray-600">
        {t("carwash.notes")}
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t("carwash.notes")}
          className="border border-gray-300 rounded p-2 text-sm w-full mt-1"
        />
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" loading={submitting} shape="rounded">
          {label}
        </Button>
      </div>
    </form>
  );
}
