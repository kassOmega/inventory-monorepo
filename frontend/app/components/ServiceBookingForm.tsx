"use client";

// Reusable service booking form for hospitality service lines (spa/gym/pool/
// events/custom) and the SERVICE vertical. The public QR booking page renders
// this; dashboard staff flows can reuse it with `mode="staff"`.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "@/app/components/Button";

export interface ServiceBookingItem {
  ref: string;
  name: string;
  price?: number;
  description?: string | null;
}

export interface ServiceBookingPayload {
  serviceItemRef: string;
  startsAt: string; // ISO
  guestName?: string;
  phone?: string;
  notes?: string;
}

interface ServiceBookingFormProps {
  mode: "public" | "staff";
  items: ServiceBookingItem[];
  onSubmit: (payload: ServiceBookingPayload) => Promise<void> | void;
  submitting?: boolean;
  submitLabel?: string;
}

export default function ServiceBookingForm({
  mode,
  items,
  onSubmit,
  submitting = false,
  submitLabel,
}: ServiceBookingFormProps) {
  const { t } = useTranslation();
  const [serviceItemRef, setServiceItemRef] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [guestName, setGuestName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serviceItemRef) return;
    await onSubmit({
      serviceItemRef,
      startsAt: startsAt
        ? new Date(startsAt).toISOString()
        : new Date().toISOString(),
      guestName: guestName.trim() || undefined,
      phone: phone.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  };

  const label =
    submitLabel ??
    (mode === "public" ? t("public.bookingSubmit") : t("public.bookingSubmit"));

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm text-gray-600">
        {t("public.bookingService")}
        <select
          value={serviceItemRef}
          onChange={(e) => setServiceItemRef(e.target.value)}
          className="border border-gray-300 rounded p-2 text-sm w-full mt-1 bg-white"
          required
        >
          <option value="">{t("public.bookingSelectService")}</option>
          {items.map((it) => (
            <option key={it.ref} value={it.ref}>
              {it.name}
              {it.price != null ? ` — ${it.price.toLocaleString()}` : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm text-gray-600">
        {t("public.bookingWhen")}
        <input
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
          type="datetime-local"
          className="border border-gray-300 rounded p-2 text-sm w-full mt-1"
          required
        />
      </label>

      <label className="block text-sm text-gray-600">
        {t("public.name")}
        <input
          value={guestName}
          onChange={(e) => setGuestName(e.target.value)}
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

      <label className="block text-sm text-gray-600">
        {t("public.note")}
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t("public.note")}
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
