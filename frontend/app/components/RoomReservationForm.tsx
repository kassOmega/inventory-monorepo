"use client";

// Reusable room-reservation form for the accommodation (hotel/rooms) public QR
// flow and (later) dashboard reservation pages. Renders each room type as a
// selectable card with its catalogue image so guests can see what they book.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "@/app/components/Button";

export interface RoomTypeOption {
  ref: string;
  name: string;
  price?: number;
  description?: string | null;
  image?: string | null;
  meta?: Record<string, unknown>;
}

export interface RoomReservationPayload {
  roomTypeRef: string;
  checkIn: string; // ISO date
  checkOut: string; // ISO date
  guestName?: string;
  phone?: string;
  notes?: string;
}

interface RoomReservationFormProps {
  roomTypes: RoomTypeOption[];
  onSubmit: (payload: RoomReservationPayload) => Promise<void> | void;
  submitting?: boolean;
  submitLabel?: string;
}

export default function RoomReservationForm({
  roomTypes,
  onSubmit,
  submitting = false,
  submitLabel,
}: RoomReservationFormProps) {
  const { t } = useTranslation();
  const [roomTypeRef, setRoomTypeRef] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [guestName, setGuestName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomTypeRef) return;
    await onSubmit({
      roomTypeRef,
      checkIn: checkIn ? new Date(checkIn).toISOString() : new Date().toISOString(),
      checkOut: checkOut
        ? new Date(checkOut).toISOString()
        : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      guestName: guestName.trim() || undefined,
      phone: phone.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  };

  const label = submitLabel ?? t("public.bookingSubmit");

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <p className="text-sm text-gray-600 mb-1">{t("public.roomType")}</p>
        {roomTypes.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">
            {t("public.empty")}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {roomTypes.map((rt) => {
              const selected = rt.ref === roomTypeRef;
              return (
                <button
                  type="button"
                  key={rt.ref}
                  onClick={() => setRoomTypeRef(rt.ref)}
                  className={`text-left border rounded-lg overflow-hidden transition ${
                    selected
                      ? "border-blue-600 ring-2 ring-blue-100"
                      : "border-gray-200 hover:border-blue-300"
                  }`}
                >
                  <div className="h-24 w-full bg-gray-100 flex items-center justify-center">
                    {rt.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={rt.image}
                        alt={rt.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-gray-300 text-2xl">🛏️</span>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {rt.name}
                    </p>
                    {rt.price != null && (
                      <p className="text-xs text-gray-600">
                        {rt.price.toLocaleString()}
                        {t("hotel.perNight")}
                      </p>
                    )}
                    {rt.description && (
                      <p className="text-[11px] text-gray-400 line-clamp-2 mt-0.5">
                        {rt.description}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm text-gray-600">
          {t("public.checkIn")}
          <input
            value={checkIn}
            onChange={(e) => setCheckIn(e.target.value)}
            type="date"
            className="border border-gray-300 rounded p-2 text-sm w-full mt-1"
            required
          />
        </label>
        <label className="block text-sm text-gray-600">
          {t("public.checkOut")}
          <input
            value={checkOut}
            onChange={(e) => setCheckOut(e.target.value)}
            type="date"
            className="border border-gray-300 rounded p-2 text-sm w-full mt-1"
            required
          />
        </label>
      </div>

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
        <Button
          type="submit"
          loading={submitting}
          disabled={!roomTypeRef}
          shape="rounded"
        >
          {label}
        </Button>
      </div>
    </form>
  );
}
