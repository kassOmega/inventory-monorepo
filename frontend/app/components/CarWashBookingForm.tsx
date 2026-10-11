"use client";

// Reusable car-wash booking form. The dashboard "New booking" modal and the
// public QR booking page both render this so the fields, price autofill and
// washer-availability check stay in sync. Staff mode adds a customer + known
// vehicle picker; public mode collects vehicle type, plate and guest contact.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "@/app/components/Button";
import SearchableSelect from "@/app/components/SearchableSelect";

export interface CarWashOption {
  id: string | number;
  name: string;
}
export interface CarWashPrice {
  vehicleType: string;
  washTypeId: string | number;
  amount: number | string;
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
  amount: number;
}

export interface CarWashBookingPayload {
  customerId?: string | null;
  washerId?: string | null;
  startsAt: string; // ISO
  notes?: string;
  isTimeSlotBooking: boolean;
  items: CarWashBookingItemPayload[];
  name?: string;
  phone?: string;
}

interface CarWashBookingFormProps {
  mode: "staff" | "public";
  vehicleTypes: string[];
  washTypes: CarWashOption[];
  prices: CarWashPrice[];
  washers: CarWashOption[];
  slotMinutes: number;
  showPrices?: boolean;
  customers?: CarWashCustomerOption[];
  vehicles?: CarWashVehicleOption[];
  onCheckAvailability?: (
    washerId: string,
    startsAt: string,
    slotMinutes: number,
  ) => Promise<{ available: boolean } | null>;
  onSubmit: (payload: CarWashBookingPayload) => Promise<void> | void;
  submitting?: boolean;
  submitLabel?: string;
}

export default function CarWashBookingForm({
  mode,
  vehicleTypes,
  washTypes,
  prices,
  washers,
  slotMinutes,
  showPrices = true,
  customers = [],
  vehicles = [],
  onCheckAvailability,
  onSubmit,
  submitting = false,
  submitLabel,
}: CarWashBookingFormProps) {
  const { t } = useTranslation();
  const [startsAt, setStartsAt] = useState("");
  const [washerId, setWasherId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<CarWashBookingItemPayload[]>([
    {
      vehicleId: null,
      vehicleType: vehicleTypes[0] ?? "Car",
      plateNumber: "",
      washTypeId: null,
      amount: 0,
    },
  ]);
  const [availability, setAvailability] = useState<{
    available: boolean;
  } | null>(null);
  const [checking, setChecking] = useState(false);

  // When options arrive asynchronously (public page), keep each line's vehicle
  // type pointing at a real option instead of the initial placeholder.
  useEffect(() => {
    if (mode !== "public" || vehicleTypes.length === 0) return;
    setItems((prev) =>
      prev.map((it) =>
        vehicleTypes.includes(it.vehicleType)
          ? it
          : { ...it, vehicleType: vehicleTypes[0] },
      ),
    );
  }, [vehicleTypes, mode]);

  const customerVehicles = useMemo(() => {
    if (mode !== "staff" || !customerId) return vehicles;
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

  const vehicleTypeOf = (vehicleId: string | null) =>
    vehicles.find((v) => String(v.id) === String(vehicleId))?.vehicleType ??
    vehicleTypes[0] ??
    "Car";

  const updateItem = (
    idx: number,
    patch: Partial<CarWashBookingItemPayload>,
  ) =>
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const next = { ...it, ...patch };
        const vt =
          patch.vehicleId !== undefined
            ? vehicleTypeOf(patch.vehicleId ?? null)
            : next.vehicleType;
        if (patch.vehicleId !== undefined) next.vehicleType = vt;
        if (
          patch.washTypeId !== undefined ||
          patch.vehicleId !== undefined ||
          patch.vehicleType !== undefined
        ) {
          next.amount = priceFor(vt, next.washTypeId ?? null);
        }
        return next;
      }),
    );

  const addItem = () =>
    setItems((prev) => [
      ...prev,
      {
        vehicleId: null,
        vehicleType: vehicleTypes[0] ?? "Car",
        plateNumber: "",
        washTypeId: null,
        amount: 0,
      },
    ]);

  const removeItem = (idx: number) =>
    setItems((prev) => prev.filter((_, i) => i !== idx));

  const totalAmount = items.reduce(
    (s, it) => s + (Number(it.amount) || 0),
    0,
  );

  const checkAvailability = async () => {
    if (!washerId || !startsAt || !onCheckAvailability) {
      setAvailability(null);
      return;
    }
    setChecking(true);
    try {
      const r = await onCheckAvailability(
        washerId,
        new Date(startsAt).toISOString(),
        slotMinutes,
      );
      setAvailability(r);
    } catch {
      setAvailability({ available: false });
    } finally {
      setChecking(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (items.length === 0) return;
    await onSubmit({
      customerId: mode === "staff" ? customerId || null : null,
      washerId: washerId || null,
      startsAt: startsAt
        ? new Date(startsAt).toISOString()
        : new Date().toISOString(),
      notes: notes.trim() || undefined,
      isTimeSlotBooking: true,
      items: items.map((it) => ({
        vehicleId: it.vehicleId || null,
        vehicleType: it.vehicleType || vehicleTypes[0] || "Car",
        plateNumber: it.plateNumber?.trim() || undefined,
        washTypeId: it.washTypeId || null,
        amount: Number(it.amount) || 0,
      })),
      name: mode === "public" ? name.trim() || undefined : undefined,
      phone: mode === "public" ? phone.trim() || undefined : undefined,
    });
  };

  const label =
    submitLabel ??
    (mode === "public" ? t("carwash.bookNow") : t("carwash.newBooking"));

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm text-gray-600">
        {t("carwash.when")}
        <input
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
          type="datetime-local"
          className="border border-gray-300 rounded p-2 text-sm w-full mt-1"
          required
        />
      </label>

      {mode === "staff" && (
        <label className="block text-sm text-gray-600">
          {t("carwash.customer")}
          <SearchableSelect
            value={customerId}
            onChange={(v) => {
              setCustomerId(v);
              setItems([]);
            }}
            options={customers.map((c) => ({
              value: String(c.id),
              label: c.name,
            }))}
            placeholder={t("carwash.customerOptional")}
          />
        </label>
      )}

      <label className="block text-sm text-gray-600">
        {t("carwash.washer")}
        <SearchableSelect
          value={washerId}
          onChange={(v) => {
            setWasherId(v);
            setAvailability(null);
          }}
          options={washers.map((w) => ({
            value: String(w.id),
            label: w.name,
          }))}
          placeholder={t("carwash.washerOptional")}
        />
      </label>

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
        <div className="space-y-2">
          {items.map((it, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-center">
              {mode === "staff" ? (
                <div className="col-span-5">
                  <SearchableSelect
                    value={it.vehicleId ?? ""}
                    onChange={(v) => updateItem(idx, { vehicleId: v })}
                    options={customerVehicles.map((v) => ({
                      value: String(v.id),
                      label: `${v.plateNumber} (${v.vehicleType})`,
                    }))}
                    placeholder={t("carwash.vehicles")}
                  />
                </div>
              ) : (
                <div className="col-span-5">
                  <select
                    value={it.vehicleType}
                    onChange={(e) =>
                      updateItem(idx, { vehicleType: e.target.value })
                    }
                    className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
                  >
                    {(vehicleTypes.length ? vehicleTypes : ["Car"]).map((vt) => (
                      <option key={vt} value={vt}>
                        {vt}
                      </option>
                    ))}
                  </select>
                  <input
                    value={it.plateNumber ?? ""}
                    onChange={(e) =>
                      updateItem(idx, { plateNumber: e.target.value })
                    }
                    placeholder={t("carwash.plateNumber")}
                    className="border border-gray-300 rounded p-2 text-sm w-full mt-1"
                  />
                </div>
              )}
              <div className="col-span-4">
                <select
                  value={it.washTypeId ?? ""}
                  onChange={(e) =>
                    updateItem(idx, { washTypeId: e.target.value })
                  }
                  className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
                >
                  <option value="">{t("carwash.washType")}</option>
                  {washTypes.map((w) => (
                    <option key={String(w.id)} value={String(w.id)}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <input
                  value={it.amount}
                  readOnly
                  placeholder={t("carwash.price")}
                  className="border border-gray-300 rounded p-2 text-sm w-full bg-gray-50"
                />
              </div>
              <div className="col-span-1 text-right">
                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  className="text-red-500"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
          {items.length === 0 && (
            <p className="text-xs text-gray-400">{t("carwash.needVehicle")}</p>
          )}
        </div>
        {showPrices && (
          <p className="text-sm text-gray-700 mt-2">
            {t("carwash.amount")}:{" "}
            <strong>{totalAmount.toLocaleString()}</strong>
          </p>
        )}
      </div>

      {washerId && onCheckAvailability && (
        <div className="space-y-1">
          <button
            type="button"
            onClick={checkAvailability}
            disabled={checking}
            className="text-xs text-blue-600 hover:underline disabled:opacity-60"
          >
            {t("carwash.availability")}
            {checking ? "…" : ""}
          </button>
          {availability !== null && (
            <div
              className={`text-sm px-3 py-2 rounded ${
                availability.available
                  ? "bg-green-50 text-green-700"
                  : "bg-red-50 text-red-600"
              }`}
            >
              {availability.available
                ? t("carwash.available")
                : t("carwash.notAvailable")}
            </div>
          )}
        </div>
      )}

      {mode === "public" && (
        <>
          <label className="block text-sm text-gray-600">
            {t("public.name")}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="border border-gray-300 rounded p-2 text-sm w-full mt-1"
            />
          </label>
          <label className="block text-sm text-gray-600">
            {t("public.phone")}
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              className="border border-gray-300 rounded p-2 text-sm w-full mt-1"
            />
          </label>
        </>
      )}

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
