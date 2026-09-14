"use client";

// Unified folio surface for the front desk. One screen, two ledgers:
//   • In-house stays   — the room charge, POS charge-to-room lines and linked
//                        package guests, merged into one consolidated bill.
//   • Package guests   — their itemized add-on ledger on its own.
// Selecting either shows the same ledger table (with a Staff / Billed-by column),
// the Add Charge form for a stay, and a single-modal checkout for stays.
// Deep-linkable from the hotel page: ?reservation=<id>.

import api from "@/lib/api";
import CheckoutModal from "@/app/components/CheckoutModal";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useAuth } from "@/context/AuthContext";
import {
  hospitalityServiceName as serviceName,
  HOSPITALITY_SERVICE_LABELS,
} from "@/lib/verticals";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

const money = (n: number | undefined | null) =>
  n == null
    ? "0.00"
    : Number(n).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

const fmtDate = (d: string) => (d ? new Date(d).toLocaleString() : "—");

// `sourceService` is a HospitalityServiceType value (or a custom service key).
const sourceLabel = (s?: string | null) =>
  s ? (HOSPITALITY_SERVICE_LABELS[s] ?? s) : "—";

/** Net balance due on a stay: its folio balance + every linked guest's add-ons. */
const stayBalance = (r: any) => {
  const folio = r.folios?.[0];
  const entries: any[] = folio?.entries ?? [];
  const charges = entries
    .filter((e) => e.type === "CHARGE")
    .reduce((s, e) => s + e.amount, 0);
  const payments = entries
    .filter((e) => e.type === "PAYMENT")
    .reduce((s, e) => s + e.amount, 0);
  const guestAddOns = (r.packageGuests ?? [])
    .filter((g: any) => g.status === "CHECKED_IN")
    .reduce(
      (s: number, g: any) =>
        s +
        Math.max(
          0,
          (g.folio?.totalAddOns ?? 0) - (g.folio?.totalPayments ?? 0),
        ),
      0,
    );
  return Math.max(0, charges - payments) + guestAddOns;
};

export default function FoliosPanel() {
  const confirm = useConfirm();
  const searchParams = useSearchParams();
  const requestedStay = searchParams.get("reservation");
  const { hasPermission } = useAuth();
  // Mirrors the API gates: reading a ledger needs folios.view (the route guard),
  // posting a line needs folios.charge, and money (settle/check-out) needs
  // folios.settle. `folios.manage` is the legacy umbrella over both, and the
  // hotel front-desk keys keep working for anyone who already had them.
  const canCharge =
    hasPermission("folios.charge") ||
    hasPermission("folios.manage") ||
    hasPermission("hotel.manage") ||
    hasPermission("hotel.reception");
  const canSettle =
    hasPermission("folios.settle") ||
    hasPermission("folios.manage") ||
    hasPermission("hotel.manage") ||
    hasPermission("hotel.reception");

  const [stays, setStays] = useState<any[]>([]);
  const [guests, setGuests] = useState<any[]>([]);
  const [settled, setSettled] = useState<any[]>([]);
  const [showSettled, setShowSettled] = useState(false);

  const [selection, setSelection] = useState<{
    type: "STAY" | "GUEST";
    id: number | string;
  } | null>(null);
  const [ledger, setLedger] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Add-charge form (stay folios).
  const [chargeForm, setChargeForm] = useState({
    description: "",
    amount: "",
    type: "CHARGE",
  });
  const [saving, setSaving] = useState(false);

  const [checkoutFor, setCheckoutFor] = useState<number | null>(null);
  const [guestReceipt, setGuestReceipt] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // The stay list needs hotel.view; a folio-only user still sees guests.
      const [stayRes, guestRes] = await Promise.all([
        api
          .get("/hotel/reservations", { params: { status: "CHECKED_IN" } })
          .catch(() => ({ data: [] })),
        api.get("/hospitality/guests"),
      ]);
      setStays(Array.isArray(stayRes.data) ? stayRes.data : []);
      setGuests(Array.isArray(guestRes.data) ? guestRes.data : []);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to load guest folios");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSettled = useCallback(async () => {
    try {
      const r = await api.get("/hospitality/guests", {
        params: { status: "CHECKED_OUT" },
      });
      setSettled(Array.isArray(r.data) ? r.data : []);
    } catch {
      setSettled([]);
    }
  }, []);

  useEffect(() => {
    load();
    loadSettled();
  }, [load, loadSettled]);

  const openStay = useCallback(async (id: number) => {
    setSelection({ type: "STAY", id });
    setLedger(null);
    setLedgerLoading(true);
    setError("");
    try {
      // Consolidated bill: room folio + every linked package guest, per line.
      const r = await api.get(
        `/hospitality/folios/reservation/${id}/itemized-bill`,
      );
      setLedger(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to load folio");
    } finally {
      setLedgerLoading(false);
    }
  }, []);

  const openGuest = useCallback(async (id: string) => {
    setSelection({ type: "GUEST", id });
    setLedger(null);
    setLedgerLoading(true);
    setError("");
    try {
      const r = await api.get(`/hospitality/folios/${id}/itemized-bill`);
      setLedger(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to load folio");
    } finally {
      setLedgerLoading(false);
    }
  }, []);

  // Deep link from the hotel page (?reservation=<id>): open that stay directly.
  useEffect(() => {
    if (!requestedStay || loading) return;
    const id = Number(requestedStay);
    if (stays.some((s) => s.id === id)) openStay(id);
    else openGuest(requestedStay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedStay, loading, stays]);

  const addCharge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selection?.type !== "STAY") return;
    setSaving(true);
    setError("");
    try {
      await api.post(`/hotel/reservations/${selection.id}/folio`, {
        description: chargeForm.description,
        amount: Number(chargeForm.amount),
        type: chargeForm.type,
      });
      setChargeForm({ description: "", amount: "", type: "CHARGE" });
      await openStay(Number(selection.id));
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to add folio entry");
    } finally {
      setSaving(false);
    }
  };

  const settleGuest = async (guestId: string) => {
    if (
      !(await confirm(
        "Settle this folio and check the guest out? This generates the final receipt.",
      ))
    )
      return;
    setSaving(true);
    setError("");
    try {
      const r = await api.post(`/hospitality/guests/${guestId}/check-out`);
      setGuestReceipt(r.data);
      setSelection(null);
      setLedger(null);
      await load();
      await loadSettled();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to settle folio");
    } finally {
      setSaving(false);
    }
  };

  // Normalize both bill shapes (unified stay bill vs. package itemized bill)
  // into the same ledger rows so one table serves the whole surface.
  const rows = useMemo(() => {
    if (!ledger) return [];
    if (Array.isArray(ledger.lines)) {
      return ledger.lines.map((l: any) => ({
        id: l.id,
        date: fmtDate(l.date),
        serviceLabel: l.serviceLabel,
        description: l.description,
        guestName: l.source === "PACKAGE" ? l.guestName : null,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: l.packageDiscount ?? 0,
        amount: l.amount,
        type: l.type,
        staffName: l.staffName,
        staffRole: l.staffRole,
      }));
    }
    return (ledger.items ?? []).map((e: any) => ({
      id: e.id,
      date: e.date ?? fmtDate(e.createdAt),
      serviceLabel: sourceLabel(e.sourceService),
      description: e.itemName,
      guestName: null,
      quantity: e.quantity,
      unitPrice: e.unitPrice,
      discount: e.packageDiscount ?? 0,
      amount: e.netCharge,
      type: "CHARGE",
      staffName: e.staffName ?? e.servedByName,
      staffRole: e.staffRole,
    }));
  }, [ledger]);

  const totals = useMemo(() => {
    if (!ledger) return { charges: 0, payments: 0, balance: 0 };
    if (ledger.totals) {
      return {
        charges: ledger.totals.charges ?? 0,
        payments: ledger.totals.payments ?? 0,
        balance: ledger.totals.balanceDue ?? 0,
      };
    }
    return {
      charges: ledger.summary?.totalAddOns ?? 0,
      payments: ledger.summary?.totalPayments ?? 0,
      balance: ledger.summary?.netBalanceDue ?? 0,
    };
  }, [ledger]);

  const balanceOf = (g: any) => {
    const addOns = g.folio ? (g.folio.totalAddOns ?? 0) : 0;
    const paid = g.folio ? (g.folio.totalPayments ?? 0) : 0;
    return Math.max(0, addOns - paid);
  };

  const badge = (value: number) =>
    value > 0 ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Guest Folios</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            One ledger for every in-house stay and package guest — room charges,
            station orders and add-ons with the staff member who posted each
            line.
          </p>
        </div>
        <button
          onClick={() => {
            load();
            loadSettled();
            setNotice("");
          }}
          className="text-sm text-blue-600 hover:underline"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded text-sm">
          {error}
        </div>
      )}
      {notice && (
        <div className="bg-green-50 text-green-700 p-3 rounded text-sm">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Left rail: in-house stays, package guests, settled history */}
        <div className="lg:col-span-2 space-y-4">
          {/* In-house stays (room + linked package guests on one bill) */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">In-house Stays</h2>
              <span className="text-xs text-gray-400">{stays.length}</span>
            </div>
            {loading ? (
              <p className="text-gray-500 text-sm py-6 text-center">Loading…</p>
            ) : (
              <ul className="divide-y divide-gray-100 max-h-[45vh] overflow-y-auto">
                {stays.map((s) => {
                  const due = stayBalance(s);
                  const linked = (s.packageGuests ?? []).filter(
                    (g: any) => g.status === "CHECKED_IN",
                  ).length;
                  return (
                    <li key={s.id}>
                      <button
                        onClick={() => openStay(s.id)}
                        className={`w-full text-left px-4 py-3 hover:bg-gray-50 ${
                          selection?.type === "STAY" && selection.id === s.id
                            ? "bg-blue-50"
                            : ""
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-800">
                              {s.guestName}
                              {s.room?.number && (
                                <span className="ml-2 text-xs text-gray-500">
                                  Room {s.room.number}
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-gray-400">
                              {s.checkIn?.slice(0, 10)} →{" "}
                              {s.checkOut?.slice(0, 10)}
                              {linked > 0
                                ? ` · ${linked} package guest${
                                    linked === 1 ? "" : "s"
                                  }`
                                : ""}
                            </p>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${badge(
                              due,
                            )}`}
                          >
                            {money(due)} ETB
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
                {stays.length === 0 && (
                  <li className="px-4 py-8 text-center text-sm text-gray-400">
                    No in-house stays right now.
                  </li>
                )}
              </ul>
            )}
          </div>

          {/* Package guests with an open tab */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">Package Guests</h2>
              <span className="text-xs text-gray-400">{guests.length}</span>
            </div>
            {loading ? (
              <p className="text-gray-500 text-sm py-6 text-center">Loading…</p>
            ) : (
              <ul className="divide-y divide-gray-100 max-h-[45vh] overflow-y-auto">
                {guests.map((g) => (
                  <li key={g.id}>
                    <button
                      onClick={() => openGuest(g.id)}
                      className={`w-full text-left px-4 py-3 hover:bg-gray-50 ${
                        selection?.type === "GUEST" && selection.id === g.id
                          ? "bg-blue-50"
                          : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-800">
                            {g.guestName}
                            {g.roomNumber && (
                              <span className="ml-2 text-xs text-gray-500">
                                Room {g.roomNumber}
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-gray-400">
                            {serviceName(g.package?.hospitalityService)} ·{" "}
                            {g.package?.name}
                          </p>
                          <p className="text-xs text-gray-400">
                            Check-in {fmtDate(g.checkInAt)}
                          </p>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${badge(
                            balanceOf(g),
                          )}`}
                        >
                          {money(balanceOf(g))} ETB
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
                {guests.length === 0 && (
                  <li className="px-4 py-8 text-center text-sm text-gray-400">
                    No open guest tabs.
                  </li>
                )}
              </ul>
            )}
          </div>

          {/* Settled history (lazy) */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <button
              onClick={() => setShowSettled((v) => !v)}
              className="w-full px-4 py-3 flex items-center justify-between text-left"
            >
              <span className="font-semibold text-gray-800">
                Settled Guests
              </span>
              <span className="text-xs text-gray-400">
                {showSettled ? "Hide" : `Show (${settled.length})`}
              </span>
            </button>
            {showSettled && (
              <ul className="divide-y divide-gray-100 max-h-[40vh] overflow-y-auto">
                {settled.map((g) => (
                  <li key={g.id} className="px-4 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm text-gray-700">
                          {g.guestName}
                          {g.roomNumber && (
                            <span className="ml-2 text-xs text-gray-400">
                              Room {g.roomNumber}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-400">
                          {g.package?.name} · {fmtDate(g.checkOutAt)}
                        </p>
                      </div>
                      <button
                        onClick={() => openGuest(g.id)}
                        className="text-xs text-blue-600 hover:underline shrink-0"
                      >
                        Ledger
                      </button>
                    </div>
                  </li>
                ))}
                {settled.length === 0 && (
                  <li className="px-4 py-6 text-center text-sm text-gray-400">
                    No settled guests yet.
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>

        {/* Consolidated ledger */}
        <div className="lg:col-span-3 bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-gray-800">
              {ledger
                ? selection?.type === "STAY"
                  ? `Consolidated Bill — ${ledger.reservation?.guestName}${
                      ledger.reservation?.roomNumber
                        ? ` (Room ${ledger.reservation.roomNumber})`
                        : ""
                    }`
                  : `Ledger — ${ledger.guestName}${
                      ledger.roomNumber ? ` (Room ${ledger.roomNumber})` : ""
                    }`
                : "Consolidated Ledger"}
            </h2>
            {selection?.type === "STAY" && ledger && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openStay(Number(selection.id))}
                  className="text-xs text-gray-600 hover:underline"
                >
                  Refresh
                </button>
                {canSettle && (
                  <button
                    onClick={() => setCheckoutFor(Number(selection.id))}
                    className="bg-emerald-600 text-white rounded px-3 py-1.5 text-sm font-medium hover:bg-emerald-700"
                  >
                    Check out
                  </button>
                )}
              </div>
            )}
            {selection?.type === "GUEST" && ledger && canSettle && (
              <button
                onClick={() => settleGuest(String(selection.id))}
                disabled={saving}
                className="bg-blue-600 text-white rounded px-3 py-1.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
              >
                {saving ? "Settling…" : "Settle & check out"}
              </button>
            )}
          </div>

          {ledgerLoading ? (
            <p className="text-gray-500 text-sm py-8 text-center">
              Loading ledger…
            </p>
          ) : !ledger ? (
            <p className="text-gray-400 text-sm py-8 text-center">
              Select an in-house stay or a package guest to open its ledger.
            </p>
          ) : (
            <div>
              {/* Stay header: guest registration summary */}
              {selection?.type === "STAY" && ledger.guest && (
                <div className="px-4 py-3 border-b border-gray-100 text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
                  <span>
                    {ledger.reservation.checkIn?.slice(0, 10)} →{" "}
                    {ledger.reservation.checkOut?.slice(0, 10)}
                  </span>
                  <span>
                    {ledger.reservation.nights} night
                    {ledger.reservation.nights === 1 ? "" : "s"}
                  </span>
                  {ledger.guest.phone && <span>📞 {ledger.guest.phone}</span>}
                  {ledger.guest.idTypeName && (
                    <span>
                      🪪 {ledger.guest.idTypeName}
                      {ledger.guest.idNumber
                        ? ` · ${ledger.guest.idNumber}`
                        : ""}
                      {ledger.guest.hasIdDocument ? " · scan on file" : ""}
                    </span>
                  )}
                  {ledger.guest.checkedInBy && (
                    <span>Checked in by {ledger.guest.checkedInBy}</span>
                  )}
                </div>
              )}

              {/* Service breakdown */}
              {Array.isArray(ledger.byService) &&
                ledger.byService.length > 0 && (
                  <div className="px-4 py-2 border-b border-gray-100 flex flex-wrap gap-2">
                    {ledger.byService.map((s: any) => (
                      <span
                        key={s.service ?? s.label}
                        className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[11px]"
                      >
                        {s.label}: {money(s.amount)}
                      </span>
                    ))}
                  </div>
                )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-left text-xs text-gray-500">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Service</th>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2">Billed by</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Unit</th>
                      <th className="px-3 py-2 text-right">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((e: any) => (
                      <tr key={e.id} className="border-t">
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                          {e.date}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {e.serviceLabel}
                        </td>
                        <td className="px-3 py-2 text-gray-800">
                          {e.description}
                          {e.guestName && (
                            <span className="text-xs text-gray-400">
                              {" "}
                              · {e.guestName}
                            </span>
                          )}
                          {e.type === "PAYMENT" && (
                            <span className="ml-2 text-[11px] text-green-600">
                              payment
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {e.staffName ?? "—"}
                          {e.staffRole && (
                            <span className="text-xs text-gray-400">
                              {" "}
                              ({e.staffRole})
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600">
                          {e.quantity ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600">
                          {money(e.unitPrice)}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-gray-800">
                          {e.type === "PAYMENT" ? "-" : ""}
                          {money(e.amount)}
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-4 py-6 text-center text-gray-400"
                        >
                          No charges on this folio yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 px-4 py-3 border-t border-gray-100 bg-gray-50">
                <div>
                  <p className="text-xs text-gray-400">Total Charges</p>
                  <p className="text-lg font-bold text-gray-800">
                    {money(totals.charges)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Payments</p>
                  <p className="text-lg font-bold text-gray-800">
                    {money(totals.payments)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Net Balance Due</p>
                  <p className="text-lg font-bold text-amber-600">
                    {money(totals.balance)}
                  </p>
                </div>
              </div>

              {/* Add a charge / payment to the stay folio */}
              {selection?.type === "STAY" && canCharge && (
                <form
                  onSubmit={addCharge}
                  className="grid grid-cols-1 sm:grid-cols-4 gap-2 px-4 py-3 border-t border-gray-100"
                >
                  <input
                    placeholder="Description"
                    value={chargeForm.description}
                    onChange={(e) =>
                      setChargeForm({
                        ...chargeForm,
                        description: e.target.value,
                      })
                    }
                    className="border border-gray-300 rounded p-2 text-sm sm:col-span-2"
                    required
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Amount"
                    value={chargeForm.amount}
                    onChange={(e) =>
                      setChargeForm({ ...chargeForm, amount: e.target.value })
                    }
                    className="border border-gray-300 rounded p-2 text-sm"
                    required
                  />
                  <div className="flex gap-2">
                    <select
                      value={chargeForm.type}
                      onChange={(e) =>
                        setChargeForm({ ...chargeForm, type: e.target.value })
                      }
                      className="border border-gray-300 rounded p-2 text-sm flex-1 bg-white"
                    >
                      <option value="CHARGE">Charge</option>
                      <option value="PAYMENT">Payment</option>
                    </select>
                    <button
                      type="submit"
                      disabled={saving}
                      className="bg-gray-800 text-white rounded px-3 py-2 text-sm font-medium disabled:opacity-60"
                    >
                      Add
                    </button>
                  </div>
                </form>
              )}
              {/* View-only role: explain the missing controls instead of hiding them silently. */}
              {selection?.type === "STAY" && !canCharge && (
                <p className="px-4 py-3 border-t border-gray-100 text-xs text-gray-500 bg-gray-50">
                  Read-only — your role can view this ledger but not post charges
                  or take payment.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Single-modal checkout for a whole stay (settles every linked folio) */}
      {checkoutFor != null && (
        <CheckoutModal
          reservationId={checkoutFor}
          onClose={() => setCheckoutFor(null)}
          onDone={async () => {
            setNotice("Guest checked out. The room is now marked dirty.");
            await load();
            await loadSettled();
          }}
          onError={setError}
        />
      )}

      {/* Package-guest receipt (settled on its own, without a stay) */}
      {guestReceipt && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-1">
              Guest Receipt — Settled
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              {guestReceipt.guestName}
              {guestReceipt.roomNumber
                ? ` · Room ${guestReceipt.roomNumber}`
                : ""}{" "}
              · {guestReceipt.packageName}
            </p>
            <div className="space-y-2 text-sm border-t border-gray-100 pt-3">
              <div className="flex justify-between">
                <span className="text-gray-500">Total Package Value Paid</span>
                <span className="font-medium">
                  {money(guestReceipt.packageValuePaid)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">
                  Entitlements Used (discount)
                </span>
                <span className="font-medium text-green-600">
                  -{money(guestReceipt.totalPackageDiscount)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Total Add-on Charges</span>
                <span className="font-medium">
                  {money(guestReceipt.totalAddOns)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Collected at POS</span>
                <span className="font-medium">
                  {money(guestReceipt.totalPayments)}
                </span>
              </div>
              <div className="flex justify-between border-t border-gray-200 pt-2">
                <span className="font-semibold">Net Balance Due</span>
                <span className="font-bold text-amber-600">
                  {money(guestReceipt.netBalanceDue)}
                </span>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => window.print()}
                className="bg-gray-800 text-white rounded px-3 py-2 text-sm font-medium hover:bg-gray-700"
              >
                Print Receipt
              </button>
              <button
                onClick={() => setGuestReceipt(null)}
                className="bg-gray-100 text-gray-700 rounded px-3 py-2 text-sm font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
