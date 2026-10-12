"use client";

// Interactive check-in (front desk), three steps:
//   1. Guest & ID  — contact details + the guest's identification (types come
//                    from the tenant's GuestIdType registry; an ID scan can be
//                    attached and is stored privately behind the API).
//   2. Room        — the room the stay will occupy, picked from the date-range
//                    availability list (the reservation's own booking is
//                    excluded so the booked room stays selectable).
//   3. Review      — one POST that records the registration, posts the room
//                    charge to the stay folio and marks the guest in-house.

import api from "@/lib/api";
import Modal from "@/app/components/Modal";
import AiAutofillCapture from "@/app/components/AiAutofillCapture";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const money = (n: number | undefined | null) =>
  n == null
    ? "0.00"
    : Number(n).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

const inputClass = "border border-gray-300 rounded p-2 text-sm w-full";
const labelClass = "block text-xs text-gray-500 mb-1";

/** Convert an AI-captured data URL into a File for the ID-document upload. */
function dataUrlToFile(dataUrl: string, name = "guest-id.jpg"): File {
  const [header, base64] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(header)?.[1] ?? "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

export default function CheckInModal({
  reservation,
  idTypes,
  canUseAi = false,
  onClose,
  onDone,
  onError,
}: {
  reservation: any;
  /** Active ID types from GET /hotel/settings/id-types?active=true. */
  idTypes: any[];
  canUseAi?: boolean;
  onClose: () => void;
  onDone?: (result: any) => void;
  onError?: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [form, setForm] = useState({
    guestName: reservation?.guestName ?? "",
    phone: reservation?.phone ?? "",
    email: reservation?.email ?? "",
    address: reservation?.address ?? "",
    nationality: reservation?.nationality ?? "",
    idTypeId: reservation?.idTypeId ? String(reservation.idTypeId) : "",
    idNumber: reservation?.idNumber ?? "",
    idExpiryDate: reservation?.idExpiryDate?.slice(0, 10) ?? "",
    emergencyContactName: reservation?.emergencyContactName ?? "",
    emergencyContactPhone: reservation?.emergencyContactPhone ?? "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string>(
    String(reservation?.roomId ?? ""),
  );
  const [available, setAvailable] = useState<any>(null);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (patch: Partial<typeof form>) =>
    setForm((f) => ({ ...f, ...patch }));

  const selectedType = useMemo(
    () => idTypes.find((x) => String(x.id) === form.idTypeId),
    [idTypes, form.idTypeId],
  );

  // Preview the selected / AI-captured ID document. Revoke object URLs so the
  // preview never leaks memory while the modal is open.
  useEffect(() => {
    if (!file) {
      setFilePreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const loadRooms = useCallback(async () => {
    if (!reservation?.checkIn || !reservation?.checkOut) return;
    setLoadingRooms(true);
    try {
      const r = await api.get("/hotel/rooms/available", {
        params: {
          checkInDate: reservation.checkIn,
          checkOutDate: reservation.checkOut,
          // Keep the stay's own room in the list even though it is booked.
          excludeReservationId: reservation.id,
        },
      });
      setAvailable(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("hotel.failedLoadAvailability"));
    } finally {
      setLoadingRooms(false);
    }
  }, [reservation?.checkIn, reservation?.checkOut, reservation?.id, t]);

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  const selectedRoom = useMemo(() => {
    const rooms: any[] = available?.rooms ?? [];
    return rooms.find((r) => String(r.id) === roomId) ?? null;
  }, [available, roomId]);

  const totalForStay =
    selectedRoom?.totalForStay ?? reservation?.totalAmount ?? 0;

  const goToRooms = () => {
    setError("");
    if (!form.guestName.trim()) {
      setError(t("hotel.checkinGuestRequired"));
      return;
    }
    if (selectedType?.requiresExpiry && !form.idExpiryDate) {
      setError(t("hotel.checkinExpiryRequired", { name: selectedType.name }));
      return;
    }
    setStep(2);
  };

  /** Apply the AI-extracted guest-ID fields to the check-in form. */
  const applyIdSuggestion = (data: any) => {
    setForm((f) => ({
      ...f,
      ...(data.guestName ? { guestName: data.guestName } : {}),
      ...(data.phone ? { phone: data.phone } : {}),
      ...(data.email ? { email: data.email } : {}),
      ...(data.address ? { address: data.address } : {}),
      ...(data.nationality ? { nationality: data.nationality } : {}),
      ...(data.idTypeId ? { idTypeId: String(data.idTypeId) } : {}),
      ...(data.idNumber ? { idNumber: data.idNumber } : {}),
      ...(data.idExpiryDate
        ? { idExpiryDate: String(data.idExpiryDate).slice(0, 10) }
        : {}),
      ...(data.emergencyContactName
        ? { emergencyContactName: data.emergencyContactName }
        : {}),
      ...(data.emergencyContactPhone
        ? { emergencyContactPhone: data.emergencyContactPhone }
        : {}),
    }));
  };

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api.post(
        `/hotel/reservations/${reservation.id}/check-in`,
        {
          guestName: form.guestName,
          phone: form.phone || undefined,
          email: form.email || undefined,
          address: form.address || undefined,
          nationality: form.nationality || undefined,
          idTypeId: form.idTypeId ? Number(form.idTypeId) : undefined,
          idNumber: form.idNumber || undefined,
          idExpiryDate: form.idExpiryDate || undefined,
          emergencyContactName: form.emergencyContactName || undefined,
          emergencyContactPhone: form.emergencyContactPhone || undefined,
          roomId: roomId ? Number(roomId) : undefined,
        },
      );
      if (file) {
        const body = new FormData();
        body.append("file", file);
        await api.post(
          `/hotel/reservations/${reservation.id}/id-document`,
          body,
          { headers: { "Content-Type": "multipart/form-data" } },
        );
      }
      onDone?.(r.data);
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? t("hotel.failedCheckIn");
      setError(msg);
      onError?.(msg);
    } finally {
      setBusy(false);
    }
  };

  const steps = [
    t("hotel.checkinStepGuest"),
    t("hotel.checkinStepRoom"),
    t("hotel.checkinStepReview"),
  ];

  return (
    <Modal isOpen onClose={onClose} title={t("hotel.checkinTitle")}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {steps.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full font-semibold ${
                  step === i + 1
                    ? "bg-blue-600 text-white"
                    : step > i + 1
                      ? "bg-green-100 text-green-700"
                      : "bg-gray-100 text-gray-500"
                }`}
              >
                {i + 1}
              </span>
              <span
                className={
                  step === i + 1 ? "text-gray-800 font-medium" : "text-gray-400"
                }
              >
                {label}
              </span>
              {i < steps.length - 1 && <span className="text-gray-300">›</span>}
            </div>
          ))}
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded text-sm">
            {error}
          </div>
        )}

        <div className="border border-gray-100 rounded p-3 text-sm">
          <p className="font-semibold text-gray-800">
            {reservation?.guestName}
          </p>
          <p className="text-xs text-gray-500">
            {reservation?.checkIn?.slice(0, 10)} →{" "}
            {reservation?.checkOut?.slice(0, 10)}
          </p>
        </div>

        {step === 1 && (
          <div className="space-y-3">
            {canUseAi && (
              <AiAutofillCapture
                analyze={async (images) => {
                  // Keep the captured ID picture for the upload on submit.
                  if (images[0]) setFile(dataUrlToFile(images[0]));
                  const res = await api.post(
                    "/ai/hotel/analyze-guest-id",
                    {
                      base64Image: images[0],
                      ...(images[1] ? { base64Image2: images[1] } : {}),
                    },
                    { timeout: 60000 },
                  );
                  return res.data;
                }}
                onResult={applyIdSuggestion}
                buttonLabel={t("hotel.aiScanId")}
                banner={t("hotel.aiScanIdHint")}
                errorMessage={t("hotel.aiScanIdError")}
              />
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>{t("hotel.guestName")}</label>
                <input
                  value={form.guestName}
                  onChange={(e) => set({ guestName: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>{t("hotel.phoneOptional")}</label>
                <input
                  value={form.phone}
                  onChange={(e) => set({ phone: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>{t("hotel.emailOptional")}</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => set({ email: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>{t("hotel.nationality")}</label>
                <input
                  value={form.nationality}
                  onChange={(e) => set({ nationality: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass}>
                  {t("hotel.addressOptional")}
                </label>
                <input
                  value={form.address}
                  onChange={(e) => set({ address: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-gray-100 pt-3">
              <div>
                <label className={labelClass}>{t("hotel.idType")}</label>
                <select
                  value={form.idTypeId}
                  onChange={(e) => set({ idTypeId: e.target.value })}
                  className={`${inputClass} bg-white`}
                >
                  <option value="">{t("hotel.idTypeNone")}</option>
                  {idTypes.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
                {idTypes.length === 0 && (
                  <p className="text-[11px] text-amber-600 mt-1">
                    {t("hotel.noIdTypes")}
                  </p>
                )}
              </div>
              <div>
                <label className={labelClass}>{t("hotel.idNumber")}</label>
                <input
                  value={form.idNumber}
                  onChange={(e) => set({ idNumber: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>
                  {t("hotel.idExpiry")}
                  {selectedType?.requiresExpiry ? " *" : ""}
                </label>
                <input
                  type="date"
                  value={form.idExpiryDate}
                  onChange={(e) => set({ idExpiryDate: e.target.value })}
                  className={inputClass}
                  disabled={Boolean(
                    selectedType && !selectedType.requiresExpiry,
                  )}
                />
              </div>
              <div className="sm:col-span-3">
                <label className={labelClass}>{t("hotel.idScan")}</label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="text-sm"
                />
                {file && (
                  <div className="mt-2 flex items-start gap-2">
                    {filePreview && file.type.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={filePreview}
                        alt={file.name}
                        className="h-20 w-28 rounded-lg border object-cover"
                      />
                    ) : (
                      <div className="h-20 w-28 rounded-lg border bg-gray-50 flex items-center justify-center text-[11px] text-gray-500 px-1 text-center">
                        {file.name}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setFile(null)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      {t("common.remove")}
                    </button>
                  </div>
                )}
                <p className="text-[11px] text-gray-400 mt-1">
                  {t("hotel.idScanHint")}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-gray-100 pt-3">
              <div>
                <label className={labelClass}>
                  {t("hotel.emergencyContact")}
                </label>
                <input
                  value={form.emergencyContactName}
                  onChange={(e) =>
                    set({ emergencyContactName: e.target.value })
                  }
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>
                  {t("hotel.emergencyPhone")}
                </label>
                <input
                  value={form.emergencyContactPhone}
                  onChange={(e) =>
                    set({ emergencyContactPhone: e.target.value })
                  }
                  className={inputClass}
                />
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">
                {t("hotel.availableRoomsFor", {
                  nights: available?.nights ?? 0,
                })}
              </span>
              <button
                type="button"
                onClick={loadRooms}
                className="text-blue-600 hover:underline"
              >
                {t("hotel.refresh")}
              </button>
            </div>

            {loadingRooms ? (
              <p className="text-gray-500 text-sm py-6 text-center">
                {t("hotel.checkingAvailability")}
              </p>
            ) : (available?.rooms ?? []).length === 0 ? (
              <p className="text-amber-600 text-sm py-6 text-center">
                {t("hotel.noAvailableRooms")}
              </p>
            ) : (
              <div className="space-y-3">
                {(available?.roomTypes ?? []).map((group: any) => (
                  <div key={group.roomTypeId}>
                    <p className="text-xs font-medium text-gray-500 mb-1">
                      {group.roomTypeName} · {money(group.basePrice)}
                      {t("hotel.perNight")} ·{" "}
                      {t("hotel.roomsAvailableCount", {
                        count: group.availableCount,
                      })}
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {group.rooms.map((room: any) => (
                        <button
                          type="button"
                          key={room.id}
                          onClick={() => setRoomId(String(room.id))}
                          className={`text-left border rounded p-2 text-sm transition ${
                            String(room.id) === roomId
                              ? "border-blue-600 bg-blue-50"
                              : "border-gray-200 hover:border-blue-300"
                          }`}
                        >
                          <span className="font-medium text-gray-800">
                            {t("hotel.roomPrefix", { number: room.number })}
                          </span>
                          <span className="block text-[11px] text-gray-400">
                            {money(room.totalForStay)} · {available?.nights}{" "}
                            {t("hotel.nightsShort")}
                          </span>
                          {String(room.id) === String(reservation?.roomId) && (
                            <span className="block text-[11px] text-blue-600">
                              {t("hotel.bookedRoom")}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3 text-sm">
            <div className="bg-gray-50 rounded p-3 space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">{t("hotel.guestName")}</span>
                <span className="font-medium text-gray-800">
                  {form.guestName}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{t("hotel.idType")}</span>
                <span className="text-gray-800">
                  {selectedType?.name ?? "—"}
                  {form.idNumber ? ` · ${form.idNumber}` : ""}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">{t("hotel.assignedRoom")}</span>
                <span className="text-gray-800">
                  {selectedRoom
                    ? t("hotel.roomPrefix", { number: selectedRoom.number })
                    : t("hotel.keepBookedRoom")}
                </span>
              </div>
              <div className="flex justify-between border-t border-gray-200 pt-1">
                <span className="font-semibold text-gray-600">
                  {t("hotel.roomCharge")}
                </span>
                <span className="font-bold text-gray-800">
                  {money(totalForStay)}
                </span>
              </div>
            </div>
            <ul className="text-gray-600 space-y-1">
              <li>• {t("hotel.checkinWillPostRoom")}</li>
              {file && <li>• {t("hotel.checkinWillAttachId")}</li>}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm text-gray-600"
          >
            {t("common.cancel")}
          </button>
          {step > 1 && (
            <button
              type="button"
              onClick={() => {
                setError("");
                setStep((s) => (s === 3 ? 2 : 1));
              }}
              className="px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded"
            >
              {t("common.back")}
            </button>
          )}
          {step === 1 && (
            <button
              type="button"
              onClick={goToRooms}
              className="bg-blue-600 text-white rounded px-3 py-2 text-sm font-medium hover:bg-blue-700"
            >
              {t("hotel.continueToRoom")}
            </button>
          )}
          {step === 2 && (
            <button
              type="button"
              disabled={!roomId}
              onClick={() => {
                setError("");
                setStep(3);
              }}
              className="bg-blue-600 text-white rounded px-3 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
            >
              {t("hotel.continueToConfirm")}
            </button>
          )}
          {step === 3 && (
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="bg-emerald-600 text-white rounded px-3 py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
            >
              {busy ? t("hotel.checkingIn") : t("hotel.confirmCheckIn")}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
