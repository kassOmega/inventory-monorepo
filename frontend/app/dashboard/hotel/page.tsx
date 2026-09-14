"use client";

import api from "@/lib/api";
import CheckInModal from "@/app/components/CheckInModal";
import CheckoutModal from "@/app/components/CheckoutModal";
import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export default function HotelPage() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const router = useRouter();
  const { user, hasPermission } = useAuth();
  // Capability flags — mirrored 1:1 with the API's @Permissions sets so the UI
  // never offers an action the backend will reject:
  //   • room types / rooms / ID types / deleting reservations → hotel.manage
  //   • reservations, check-in, check-out, ID documents        → hotel.reception
  //   • room cleanliness (AVAILABLE / DIRTY / MAINTENANCE)     → hotel.housekeeping.update
  //   • reading a stay ledger                                  → folios.view
  const canManageRooms = hasPermission("hotel.manage");
  const canFrontDesk = canManageRooms || hasPermission("hotel.reception");
  const canHousekeep =
    canManageRooms || hasPermission("hotel.housekeeping.update");
  const canReadFolio =
    canFrontDesk || hasPermission("folios.view") || hasPermission("folios.manage");
  const roomSt = (s: string) =>
    (t(`hotel.st.${s.toLowerCase()}`, { defaultValue: s }) as string) ?? s;
  const resSt = (s: string) =>
    (t(`hotel.resSt.${s.toLowerCase()}`, { defaultValue: s }) as string) ?? s;
  const [roomTypes, setRoomTypes] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [reservations, setReservations] = useState<any[]>([]);
  const [idTypes, setIdTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Front-desk modals.
  const [checkInFor, setCheckInFor] = useState<any>(null);
  const [checkoutFor, setCheckoutFor] = useState<number | null>(null);

  const [roomTypeForm, setRoomTypeForm] = useState({ name: "", basePrice: "" });
  const [roomForm, setRoomForm] = useState({ number: "", roomTypeId: "" });
  const [resForm, setResForm] = useState({ roomId: "", guestName: "", checkIn: "", checkOut: "" });

  // Date-range availability for the reservation form (and the check-in modal).
  const [availability, setAvailability] = useState<any>(null);
  const [availLoading, setAvailLoading] = useState(false);

  // Edit modals
  const [roomTypeModal, setRoomTypeModal] = useState<any>(null);
  const [roomModal, setRoomModal] = useState<any>(null);
  const [resModal, setResModal] = useState<any>(null);

  // Active tab: Rooms | Reservations
  const [tab, setTab] = useState("Rooms");

  const load = useCallback(async () => {
    try {
      const [rt, r, res, it] = await Promise.all([
        api.get("/hotel/room-types"),
        api.get("/hotel/rooms"),
        api.get("/hotel/reservations"),
        api.get("/hotel/settings/id-types").catch(() => ({ data: [] })),
      ]);
      setRoomTypes(rt.data);
      setRooms(r.data);
      setReservations(res.data);
      setIdTypes(Array.isArray(it.data) ? it.data : []);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.message ?? t("hotel.failedLoad"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Re-resolve availability whenever the requested dates change, so the room
  // picker only ever offers rooms that are actually free for that window.
  useEffect(() => {
    const { checkIn, checkOut } = resForm;
    if (!checkIn || !checkOut || new Date(checkOut) <= new Date(checkIn)) {
      setAvailability(null);
      return;
    }
    let cancelled = false;
    setAvailLoading(true);
    api
      .get("/hotel/rooms/available", {
        params: { checkInDate: checkIn, checkOutDate: checkOut },
      })
      .then((r) => {
        if (!cancelled) setAvailability(r.data);
      })
      .catch(() => {
        if (!cancelled) setAvailability(null);
      })
      .finally(() => {
        if (!cancelled) setAvailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resForm.checkIn, resForm.checkOut]);

  /** Every room grouped by its type (used when no dates are chosen yet). */
  const allRoomGroups = () => {
    const groups: { name: string; rooms: any[] }[] = [];
    for (const type of roomTypes) {
      groups.push({
        name: type.name,
        rooms: rooms.filter((r) => r.roomTypeId === type.id),
      });
    }
    const unassigned = rooms.filter((r) => !r.roomTypeId);
    if (unassigned.length) groups.push({ name: "—", rooms: unassigned });
    return groups;
  };

  /**
   * Room options for the reservation forms. With dates chosen we only offer
   * rooms that are free for that window (grouped by room type); otherwise every
   * room is listed so the form is still usable.
   */
  const roomOptions = () => {
    if (availability) {
      return (availability.roomTypes ?? []).map((g: any) => ({
        name: g.roomTypeName,
        rooms: g.rooms,
      }));
    }
    return allRoomGroups();
  };


  const addRoomType = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/hotel/room-types", { name: roomTypeForm.name, basePrice: Number(roomTypeForm.basePrice) });
      setRoomTypeForm({ name: "", basePrice: "" });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("hotel.failedAddRoomType"));
    }
  };

  const addRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/hotel/rooms", { number: roomForm.number, roomTypeId: Number(roomForm.roomTypeId) });
      setRoomForm({ number: "", roomTypeId: "" });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("hotel.failedAddRoom"));
    }
  };

  // --- Room type CRUD ---
  const openEditRoomType = (rt: any) =>
    setRoomTypeModal({ id: rt.id, name: rt.name, description: rt.description ?? "", basePrice: String(rt.basePrice) });
  const saveRoomType = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.patch(`/hotel/room-types/${roomTypeModal.id}`, {
        name: roomTypeModal.name,
        description: roomTypeModal.description || undefined,
        basePrice: Number(roomTypeModal.basePrice),
      });
      setRoomTypeModal(null);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("hotel.failedUpdateRoomType"));
    }
  };
  const deleteRoomType = async (rt: any) => {
    if (!(await confirm(t("hotel.deleteRoomTypeConfirm", { name: rt.name })))) return;
    try {
      await api.delete(`/hotel/room-types/${rt.id}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("hotel.failedDeleteRoomType"));
    }
  };

  // --- Room CRUD ---
  const openEditRoom = (r: any) =>
    setRoomModal({ id: r.id, number: r.number, floor: r.floor ?? "", roomTypeId: String(r.roomTypeId ?? "") });
  const saveRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.patch(`/hotel/rooms/${roomModal.id}`, {
        number: roomModal.number,
        floor: roomModal.floor || undefined,
        roomTypeId: Number(roomModal.roomTypeId),
      });
      setRoomModal(null);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("hotel.failedUpdateRoom"));
    }
  };
  const deleteRoom = async (r: any) => {
    if (!(await confirm(t("hotel.deleteRoomConfirm", { number: r.number })))) return;
    try {
      await api.delete(`/hotel/rooms/${r.id}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("hotel.failedDeleteRoom"));
    }
  };
  const setRoomStatus = async (id: number, status: string) => {
    try {
      await api.patch(`/hotel/rooms/${id}/status`, { status });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("hotel.failedUpdateRoomStatus"));
    }
  };

  // --- Reservation CRUD ---
  const openEditRes = (r: any) =>
    setResModal({
      id: r.id,
      roomId: String(r.roomId ?? ""),
      guestName: r.guestName ?? "",
      phone: r.phone ?? "",
      checkIn: r.checkIn?.slice(0, 10) ?? "",
      checkOut: r.checkOut?.slice(0, 10) ?? "",
      notes: r.notes ?? "",
    });
  const saveRes = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.patch(`/hotel/reservations/${resModal.id}`, {
        roomId: Number(resModal.roomId),
        guestName: resModal.guestName,
        phone: resModal.phone || undefined,
        checkIn: resModal.checkIn,
        checkOut: resModal.checkOut,
        notes: resModal.notes || undefined,
      });
      setResModal(null);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("hotel.failedUpdateReservation"));
    }
  };
  const deleteRes = async (r: any) => {
    if (!(await confirm(t("hotel.deleteResConfirm", { name: r.guestName })))) return;
    try {
      await api.delete(`/hotel/reservations/${r.id}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("hotel.failedDeleteReservation"));
    }
  };

  const createReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/hotel/reservations", {
        roomId: Number(resForm.roomId),
        guestName: resForm.guestName,
        checkIn: resForm.checkIn,
        checkOut: resForm.checkOut,
      });
      setResForm({ roomId: "", guestName: "", checkIn: "", checkOut: "" });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("hotel.failedCreateReservation"));
    }
  };

  /** The consolidated folio/receipt lives on the unified folios surface. */
  const openFolio = (reservationId: number) =>
    router.push(`/dashboard/hospitality/folios?reservation=${reservationId}`);

  // --- Guest ID types ---
  // The registry is configured on the Hospitality Services settings page (one
  // place for every hospitality setting); this page only READS the active types
  // to populate the check-in modal.
  const manageIdTypes = () =>
    router.push("/dashboard/settings/hospitality-services");

  // --- Front desk: check-in / checkout run through their own modals ---
  const startCheckIn = (r: any) => {
    setError("");
    setCheckInFor(r);
  };

  const startCheckout = (r: any) => {
    setError("");
    setCheckoutFor(r.id);
  };

  if (loading) return <p className="text-gray-500">{t("hotel.loading")}</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">{t("hotel.title")}</h1>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      {/* Tabs */}
      <div className="flex flex-wrap rounded-lg border border-gray-200 overflow-hidden w-fit">
        <button
          onClick={() => setTab("Rooms")}
          className={`px-4 sm:px-6 py-2 text-sm font-medium transition ${
            tab === "Rooms" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
          }`}
        >
          🛏️ {t("hotel.tabs.rooms")}
        </button>
        <button
          onClick={() => setTab("Reservations")}
          className={`px-4 sm:px-6 py-2 text-sm font-medium transition ${
            tab === "Reservations" ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
          }`}
        >
          📅 {t("hotel.tabs.reservations")}
        </button>
      </div>

      {/* Rooms */}
      {tab === "Rooms" && (
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-800">{t("hotel.roomsHeading")}</h2>
            <span className="text-xs text-gray-400">
              {t(rooms.length === 1 ? "hotel.roomCountOne" : "hotel.roomCountMany", { count: rooms.length })}
            </span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold text-gray-800 text-sm mb-2">{t("hotel.allRooms")}</h3>
              <ul className="space-y-2 text-sm">
            {rooms.map((r) => (
              <li key={r.id} className="border border-gray-100 rounded p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-800">{t("hotel.roomPrefix", { number: r.number })}</span>
                  <div className="flex items-center gap-1.5">
                    {/* Housekeeping owns cleanliness; managers keep the switch. */}
                    {canHousekeep ? (
                      <select
                        value={r.status}
                        onChange={(e) => setRoomStatus(r.id, e.target.value)}
                        className="text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-gray-50"
                        aria-label={t("hotel.statusAria", { number: r.number })}
                      >
                        {["AVAILABLE", "OCCUPIED", "DIRTY", "MAINTENANCE"].map((s) => (
                          <option key={s} value={s}>{roomSt(s)}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-[11px] text-gray-500">{roomSt(r.status)}</span>
                    )}
                    {canManageRooms && (
                      <>
                        <button onClick={() => openEditRoom(r)} className="text-xs text-blue-600 hover:underline">{t("common.edit")}</button>
                        <button onClick={() => deleteRoom(r)} className="text-xs text-red-600 hover:underline">{t("common.del")}</button>
                      </>
                    )}
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">{r.roomType?.name} · {roomSt(r.status)}</p>
              </li>
            ))}
            {rooms.length === 0 && <li className="text-gray-400">{t("hotel.noRooms")}</li>}
              </ul>
            </div>

            <div>
              <h3 className="font-semibold text-gray-800 text-sm mb-2">{t("hotel.addRoomHeading")}</h3>

          {canManageRooms && (
          <form onSubmit={addRoom} className="flex gap-2 mb-3">
            <input
              placeholder={t("hotel.roomNumber")}
              value={roomForm.number}
              onChange={(e) => setRoomForm({ ...roomForm, number: e.target.value })}
              className="border border-gray-300 rounded p-2 text-sm flex-1"
              required
            />
            <select
              value={roomForm.roomTypeId}
              onChange={(e) => setRoomForm({ ...roomForm, roomTypeId: e.target.value })}
              className="border border-gray-300 rounded p-2 text-sm"
              required
            >
              <option value="">{t("hotel.typeOption")}</option>
              {roomTypes.map((rt) => (
                <option key={rt.id} value={rt.id}>{rt.name}</option>
              ))}
            </select>
            <button type="submit" className="bg-gray-800 text-white rounded px-3 text-sm">{t("common.add")}</button>
          </form>
          )}

              <h3 className="font-semibold text-gray-800 text-sm mb-2">{t("hotel.roomTypesHeading")}</h3>
            <ul className="space-y-1.5 text-sm mb-3">
              {roomTypes.map((rt) => (
                <li key={rt.id} className="flex items-center justify-between gap-2">
                  <span className="text-gray-700">
                    {rt.name}
                    <span className="text-xs text-gray-400"> · {rt.basePrice}{t("hotel.perNight")}</span>
                  </span>
                  {canManageRooms && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => openEditRoomType(rt)} className="text-xs text-blue-600 hover:underline">{t("common.edit")}</button>
                    <button onClick={() => deleteRoomType(rt)} className="text-xs text-red-600 hover:underline">{t("common.del")}</button>
                  </div>
                  )}
                </li>
              ))}
              {roomTypes.length === 0 && <li className="text-gray-400">{t("hotel.noRoomTypes")}</li>}
            </ul>

            {canManageRooms && (
            <form onSubmit={addRoomType} className="flex gap-2">
              <input
                placeholder={t("hotel.roomTypeName")}
                value={roomTypeForm.name}
                onChange={(e) => setRoomTypeForm({ ...roomTypeForm, name: e.target.value })}
                className="border border-gray-300 rounded p-2 text-sm flex-1"
                required
              />
              <input
                type="number"
                placeholder={t("hotel.priceNight")}
                value={roomTypeForm.basePrice}
                onChange={(e) => setRoomTypeForm({ ...roomTypeForm, basePrice: e.target.value })}
                className="border border-gray-300 rounded p-2 text-sm w-28"
                required
              />
              <button type="submit" className="bg-blue-600 text-white rounded px-3 text-sm">{t("hotel.addType")}</button>
              </form>
            )}
            </div>
          </div>

          {/* Guest ID Types live in Hospitality Services settings — one place for
              every hospitality setting. This page only reads the active types for
              the check-in modal, so here we just point the way. */}
          <div className="mt-6 border-t border-gray-100 pt-4">
            <h3 className="font-semibold text-gray-800 text-sm mb-1">
              {t("hotel.idTypesHeading")}
            </h3>
            <p className="text-xs text-gray-400 mb-2">
              {t("hotel.idTypesMovedHint", {
                count: idTypes.filter((x) => x.isActive).length,
              })}
            </p>
            {canManageRooms && user?.isOwnerAccount ? (
              <button
                onClick={manageIdTypes}
                className="text-xs text-blue-600 hover:underline"
              >
                {t("hotel.manageIdTypesLink")}
              </button>
            ) : (
              /* The settings page is owner-only, so a manager/receptionist gets an
                 explanation instead of a link that would bounce them back. */
              <p className="text-xs text-gray-400">
                {t("hotel.idTypesReadOnly")}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Reservations */}
      {tab === "Reservations" && (
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <h2 className="font-semibold text-gray-800 mb-3">{t("hotel.reservationsHeading")}</h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {canFrontDesk ? (
            <form onSubmit={createReservation} className="space-y-2">
              <p className="text-sm font-medium text-gray-700 mb-1">{t("hotel.newReservation")}</p>
            <select
              value={resForm.roomId}
              onChange={(e) => setResForm({ ...resForm, roomId: e.target.value })}
              className="border border-gray-300 rounded p-2 text-sm w-full"
              required
            >
              <option value="">{t("hotel.selectRoom")}</option>
              {roomOptions().map((group: any) => (
                <optgroup key={group.name} label={group.name}>
                  {group.rooms.map((r: any) => (
                    <option key={r.id} value={r.id}>
                      {r.number}
                      {r.totalForStay != null ? ` — ${r.totalForStay}` : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {availLoading && (
              <p className="text-xs text-gray-400">
                {t("hotel.checkingAvailability")}
              </p>
            )}
            {availability && !availLoading && (
              <p className="text-xs text-gray-400">
                {availability.totalAvailable > 0
                  ? t("hotel.availableHint")
                  : t("hotel.noAvailability")}
              </p>
            )}
            <input
              placeholder={t("hotel.guestName")}
              value={resForm.guestName}
              onChange={(e) => setResForm({ ...resForm, guestName: e.target.value })}
              className="border border-gray-300 rounded p-2 text-sm w-full"
              required
            />
            <input
              type="date"
              value={resForm.checkIn}
              onChange={(e) => setResForm({ ...resForm, checkIn: e.target.value })}
              className="border border-gray-300 rounded p-2 text-sm w-full"
              required
            />
            <input
              type="date"
              value={resForm.checkOut}
              onChange={(e) => setResForm({ ...resForm, checkOut: e.target.value })}
              className="border border-gray-300 rounded p-2 text-sm w-full"
              required
            />
              <button type="submit" className="bg-blue-600 text-white rounded p-2 text-sm w-full font-medium">
                {t("hotel.createReservation")}
              </button>
            </form>
            ) : (
              <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded p-2">
                {t("hotel.frontDeskOnly")}
              </p>
            )}

            <div className="lg:col-span-2">
              <p className="text-sm font-medium text-gray-700 mb-2">{t("hotel.allReservations")}</p>
              <ul className="space-y-2 text-sm">
            {reservations.map((r) => (
              <li key={r.id} className="border border-gray-200 rounded p-2">
                <div className="flex justify-between">
                  <span className="font-medium text-gray-800">{r.guestName}</span>
                  <span className="text-xs text-gray-400">{resSt(r.status)}</span>
                </div>
                <p className="text-gray-500 text-xs">{t("hotel.roomPrefix", { number: r.room?.number })} · {r.checkIn?.slice(0, 10)} → {r.checkOut?.slice(0, 10)}</p>
                <div className="flex gap-2 mt-1 flex-wrap">
                  {canReadFolio && (
                    <button onClick={() => openFolio(r.id)} className="text-blue-600 text-xs hover:underline">{t("hotel.folioLink")}</button>
                  )}
                  {canFrontDesk && (
                    <button onClick={() => openEditRes(r)} className="text-blue-600 text-xs hover:underline">{t("common.edit")}</button>
                  )}
                  {canManageRooms && (
                    <button onClick={() => deleteRes(r)} className="text-red-600 text-xs hover:underline">{t("common.del")}</button>
                  )}
                  {canFrontDesk && r.status === "CONFIRMED" && (
                    <button onClick={() => startCheckIn(r)} className="text-green-600 text-xs hover:underline">{t("hotel.checkin")}</button>
                  )}
                  {canFrontDesk && r.status === "CHECKED_IN" && (
                    <button onClick={() => startCheckout(r)} className="text-amber-600 text-xs hover:underline">{t("hotel.checkOut")}</button>
                  )}
                </div>
              </li>
            ))}
              {reservations.length === 0 && <li className="text-gray-400">{t("hotel.noReservations")}</li>}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Guest check-in (registration + room + atomic submit) */}
      {checkInFor && (
        <CheckInModal
          reservation={checkInFor}
          idTypes={idTypes.filter((x) => x.isActive)}
          onClose={() => setCheckInFor(null)}
          onDone={async () => {
            setCheckInFor(null);
            await load();
          }}
          onError={setError}
        />
      )}

      {/* Atomic checkout: summary → split payments → confirm & receipt */}
      {checkoutFor != null && (
        <CheckoutModal
          reservationId={checkoutFor}
          onClose={() => setCheckoutFor(null)}
          onDone={async () => {
            await load();
          }}
          onError={setError}
        />
      )}

      {/* Edit Room Type modal */}
      {/* Edit Room Type modal */}
      {roomTypeModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-3">{t("hotel.editRoomTypeTitle")}</h2>
            <form onSubmit={saveRoomType} className="space-y-3">
              <input
                value={roomTypeModal.name}
                onChange={(e) => setRoomTypeModal({ ...roomTypeModal, name: e.target.value })}
                placeholder={t("hotel.roomTypeName")}
                className="border border-gray-300 rounded p-2 text-sm w-full"
                required
              />
              <input
                value={roomTypeModal.description}
                onChange={(e) => setRoomTypeModal({ ...roomTypeModal, description: e.target.value })}
                placeholder={t("hotel.descriptionOptional")}
                className="border border-gray-300 rounded p-2 text-sm w-full"
              />
              <input
                type="number"
                value={roomTypeModal.basePrice}
                onChange={(e) => setRoomTypeModal({ ...roomTypeModal, basePrice: e.target.value })}
                placeholder={t("hotel.priceNight")}
                className="border border-gray-300 rounded p-2 text-sm w-full"
                required
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setRoomTypeModal(null)} className="px-3 py-2 text-sm text-gray-600">
                  {t("common.cancel")}
                </button>
                <button type="submit" className="bg-gray-800 text-white rounded px-3 py-2 text-sm font-medium">
                  {t("common.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Room modal */}
      {roomModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-3">{t("hotel.editRoomTitle")}</h2>
            <form onSubmit={saveRoom} className="space-y-3">
              <input
                value={roomModal.number}
                onChange={(e) => setRoomModal({ ...roomModal, number: e.target.value })}
                placeholder={t("hotel.roomNumber")}
                className="border border-gray-300 rounded p-2 text-sm w-full"
                required
              />
              <input
                value={roomModal.floor}
                onChange={(e) => setRoomModal({ ...roomModal, floor: e.target.value })}
                placeholder={t("hotel.floorOptional")}
                className="border border-gray-300 rounded p-2 text-sm w-full"
              />
              <select
                value={roomModal.roomTypeId}
                onChange={(e) => setRoomModal({ ...roomModal, roomTypeId: e.target.value })}
                className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
                required
              >
                <option value="">{t("hotel.selectType")}</option>
                {roomTypes.map((rt) => (
                  <option key={rt.id} value={rt.id}>{rt.name}</option>
                ))}
              </select>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setRoomModal(null)} className="px-3 py-2 text-sm text-gray-600">
                  {t("common.cancel")}
                </button>
                <button type="submit" className="bg-gray-800 text-white rounded px-3 py-2 text-sm font-medium">
                  {t("common.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Reservation modal */}
      {resModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-sm shadow-xl max-h-[92vh] overflow-y-auto">
            <h2 className="font-semibold text-gray-800 mb-3">{t("hotel.editReservationTitle")}</h2>
            <form onSubmit={saveRes} className="space-y-3">
              <select
                value={resModal.roomId}
                onChange={(e) => setResModal({ ...resModal, roomId: e.target.value })}
                className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
                required
              >
                <option value="">{t("hotel.selectRoom")}</option>
                {allRoomGroups().map((group) => (
                  <optgroup key={group.name} label={group.name}>
                    {group.rooms.map((r: any) => (
                      <option key={r.id} value={r.id}>
                        {r.number}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <input
                value={resModal.guestName}
                onChange={(e) => setResModal({ ...resModal, guestName: e.target.value })}
                placeholder={t("hotel.guestName")}
                className="border border-gray-300 rounded p-2 text-sm w-full"
                required
              />
              <input
                value={resModal.phone}
                onChange={(e) => setResModal({ ...resModal, phone: e.target.value })}
                placeholder={t("hotel.phoneOptional")}
                className="border border-gray-300 rounded p-2 text-sm w-full"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={resModal.checkIn}
                  onChange={(e) => setResModal({ ...resModal, checkIn: e.target.value })}
                  className="border border-gray-300 rounded p-2 text-sm w-full"
                  required
                />
                <input
                  type="date"
                  value={resModal.checkOut}
                  onChange={(e) => setResModal({ ...resModal, checkOut: e.target.value })}
                  className="border border-gray-300 rounded p-2 text-sm w-full"
                  required
                />
              </div>
              <input
                value={resModal.notes}
                onChange={(e) => setResModal({ ...resModal, notes: e.target.value })}
                placeholder={t("hotel.notesOptional")}
                className="border border-gray-300 rounded p-2 text-sm w-full"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setResModal(null)} className="px-3 py-2 text-sm text-gray-600">
                  {t("common.cancel")}
                </button>
                <button type="submit" className="bg-gray-800 text-white rounded px-3 py-2 text-sm font-medium">
                  {t("common.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


