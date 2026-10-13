"use client";

// Common reservation form used by BOTH the public room-booking QR flow and the
// staff hotel dashboard (new + edit reservation). Check-in/check-out sit at the
// top and drive an availability lookup so only rooms free for the chosen window
// are offered.
import { useEffect, useMemo, useState } from "react";
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
export interface RoomOption {
  id: string | number;
  number: string;
  totalForStay?: number;
}
export interface RoomGroupOption {
  name: string;
  rooms: RoomOption[];
}
export interface ReservationPayload {
  roomTypeRef?: string; // public
  roomId?: string; // staff
  checkIn: string;
  checkOut: string;
  guestName?: string;
  phone?: string;
  notes?: string;
}
export interface ReservationAvailability {
  totalAvailable?: number;
  roomTypes?: RoomTypeOption[]; // public
  roomGroups?: RoomGroupOption[]; // staff
}

interface ReservationFormProps {
  mode: "public" | "staff";
  /** Public: initial room types (before a date filter). */
  roomTypes?: RoomTypeOption[];
  /** Staff: all rooms grouped by type (used before dates are chosen). */
  fallbackRoomGroups?: RoomGroupOption[];
  onFetchAvailability?: (
    checkIn: string,
    checkOut: string,
  ) => Promise<ReservationAvailability | null>;
  initialValues?: Partial<ReservationPayload>;
  onSubmit: (payload: ReservationPayload) => Promise<void> | void;
  submitting?: boolean;
  submitLabel?: string;
  showPrices?: boolean;
}

export default function ReservationForm({
  mode,
  roomTypes = [],
  fallbackRoomGroups = [],
  onFetchAvailability,
  initialValues,
  onSubmit,
  submitting = false,
  submitLabel,
  showPrices = true,
}: ReservationFormProps) {
  const { t } = useTranslation();

  const [checkIn, setCheckIn] = useState(initialValues?.checkIn ?? "");
  const [checkOut, setCheckOut] = useState(initialValues?.checkOut ?? "");
  const [guestName, setGuestName] = useState(initialValues?.guestName ?? "");
  const [phone, setPhone] = useState(initialValues?.phone ?? "");
  const [notes, setNotes] = useState(initialValues?.notes ?? "");
  const [roomTypeRef, setRoomTypeRef] = useState(
    initialValues?.roomTypeRef ?? "",
  );
  const [roomId, setRoomId] = useState(initialValues?.roomId ?? "");
  const [error, setError] = useState("");
  const [availability, setAvailability] =
    useState<ReservationAvailability | null>(null);
  const [availLoading, setAvailLoading] = useState(false);

  // Dates live at the top and drive the availability lookup.
  useEffect(() => {
    if (!onFetchAvailability) return;
    if (!checkIn || !checkOut || checkOut <= checkIn) {
      setAvailability(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setAvailLoading(true);
      try {
        const r = await onFetchAvailability(checkIn, checkOut);
        if (!cancelled) setAvailability(r);
      } catch {
        if (!cancelled) setAvailability(null);
      } finally {
        if (!cancelled) setAvailLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [checkIn, checkOut, onFetchAvailability]);

  const displayRoomTypes = useMemo(
    () => availability?.roomTypes ?? roomTypes,
    [availability, roomTypes],
  );
  const displayRoomGroups = useMemo(
    () => availability?.roomGroups ?? fallbackRoomGroups,
    [availability, fallbackRoomGroups],
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (checkIn && checkOut && checkOut <= checkIn) {
      setError(t("public.checkoutAfterCheckin"));
      return;
    }
    if (mode === "public" && !roomTypeRef) return;
    if (mode === "staff" && !roomId) return;
    await onSubmit({
      roomTypeRef: mode === "public" ? roomTypeRef : undefined,
      roomId: mode === "staff" ? roomId : undefined,
      checkIn,
      checkOut,
      guestName: guestName.trim() || undefined,
      phone: phone.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  };

  const label =
    submitLabel ??
    (mode === "public" ? t("public.bookingSubmit") : t("hotel.createReservation"));

  return (
    <form onSubmit={submit} className="space-y-3">
      {/* Check-in / check-out at the top */}
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
            min={checkIn || undefined}
            className="border border-gray-300 rounded p-2 text-sm w-full mt-1"
            required
          />
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {availLoading && (
        <p className="text-xs text-gray-400">{t("hotel.checkingAvailability")}</p>
      )}
      {availability && !availLoading && (
        <p className="text-xs text-gray-500">
          {availability.totalAvailable
            ? t("hotel.availableRoomsCount", {
                count: availability.totalAvailable,
              })
            : t("hotel.noAvailability")}
        </p>
      )}

      {/* Room selection */}
      {mode === "public" ? (
        <div>
          <p className="text-sm text-gray-600 mb-1">{t("public.roomType")}</p>
          {displayRoomTypes.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">
              {t("public.empty")}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {displayRoomTypes.map((rt) => {
                const selected = rt.ref === roomTypeRef;
                const availableCount = rt.meta?.availableCount as
                  | number
                  | undefined;
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
                      {showPrices && rt.price != null && (
                        <p className="text-xs text-gray-600">
                          {rt.price.toLocaleString()}
                          {t("hotel.perNight")}
                        </p>
                      )}
                      {availableCount != null && (
                        <p className="text-[11px] text-gray-400">
                          {t("hotel.roomsAvailableCount", {
                            count: availableCount,
                          })}
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
      ) : (
        <label className="block text-sm text-gray-600">
          {t("hotel.selectRoom")}
          <select
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="border border-gray-300 rounded p-2 text-sm w-full mt-1 bg-white"
            required
          >
            <option value="">{t("hotel.selectRoom")}</option>
            {displayRoomGroups.map((group) => (
              <optgroup key={group.name} label={group.name}>
                {group.rooms.map((r) => (
                  <option key={String(r.id)} value={String(r.id)}>
                    {r.number}
                    {r.totalForStay != null ? ` — ${r.totalForStay}` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      )}

      {/* Guest details */}
      <label className="block text-sm text-gray-600">
        {t("public.name")}
        <input
          value={guestName}
          onChange={(e) => setGuestName(e.target.value)}
          className="border border-gray-300 rounded p-2 text-sm w-full mt-1"
          required
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
          disabled={mode === "public" ? !roomTypeRef : !roomId}
          shape="rounded"
        >
          {label}
        </Button>
      </div>
    </form>
  );
}
