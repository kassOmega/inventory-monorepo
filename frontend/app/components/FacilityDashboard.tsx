"use client";

import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { hospitalityServiceName } from "@/lib/verticals";
import { useCallback, useEffect, useState } from "react";

const fmtTime = (d: string) =>
  d ? new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-";
const fmtDate = (d: string) => (d ? d.slice(0, 10) : "-");

export default function FacilityDashboard({
  serviceType,
  customKey,
}: {
  serviceType?: string;
  customKey?: string;
}) {
  const { activeOrganizationId, hasPermission } = useAuth();
  // Check-in / check-out is its own privilege (`facility.check-in`); the legacy
  // `facility.manage` key still grants it. Configuration-only actions stay gated
  // on facility.manage elsewhere — nothing in this dashboard edits config.
  const canCheckIn =
    hasPermission("facility.check-in") || hasPermission("facility.manage");
  const [service, setService] = useState<any>(null);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [members, setMembers] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [walkinOpen, setWalkinOpen] = useState(false);
  const [walkinForm, setWalkinForm] = useState({
    guestName: "",
    guestPhone: "",
    dayPassTypeId: "",
    paymentMethodId: "",
  });
  const [busy, setBusy] = useState(false);
  // Package-guest check-in: consume a PASS/CREDIT entitlement at $0, route any
  // overage to PAY_NOW or DEFER_TO_FOLIO.
  const [pkgOpen, setPkgOpen] = useState(false);
  const [pkgQuery, setPkgQuery] = useState("");
  const [pkgResults, setPkgResults] = useState<any[]>([]);
  const [pkgGuest, setPkgGuest] = useState<any>(null);
  const [pkgForm, setPkgForm] = useState({
    dayPassTypeId: "",
    amount: "",
    settlementMode: "DEFER_TO_FOLIO" as "DEFER_TO_FOLIO" | "PAY_NOW",
    paymentMethodId: "",
  });
  const [notice, setNotice] = useState("");

  const loadService = useCallback(async () => {
    if (!activeOrganizationId) return;
    try {
      const r = await api.get(`/tenants/${activeOrganizationId}/services`);
      const list = Array.isArray(r.data) ? r.data : [];
      const found = serviceType
        ? list.find((s) => s.serviceType === serviceType)
        : list.find((s) => s.serviceType === "CUSTOM" && s.customKey === customKey);
      setService(found ?? null);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to load facility");
    }
  }, [activeOrganizationId, serviceType, customKey]);

  const loadDashboard = useCallback(async (serviceId: string) => {
    setLoading(true);
    setError("");
    try {
      const [d, pm] = await Promise.all([
        api.get(`/hospitality/facilities/${serviceId}/dashboard`),
        api.get("/payment-methods"),
      ]);
      setData(d.data);
      setPaymentMethods(Array.isArray(pm.data) ? pm.data : []);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to load facility dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadService();
  }, [loadService]);

  useEffect(() => {
    if (service) loadDashboard(service.id);
  }, [service, loadDashboard]);

  const searchMembers = async () => {
    if (!service) return;
    setSearching(true);
    setError("");
    try {
      const q = search.trim();
      const r = await api.get(
        `/hospitality/facilities/${service.id}/members${q ? `?search=${encodeURIComponent(q)}` : ""}`,
      );
      setMembers(Array.isArray(r.data) ? r.data : []);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to search members");
    } finally {
      setSearching(false);
    }
  };

  const checkInMember = async (m: any) => {
    if (!service) return;
    setBusy(true);
    setError("");
    try {
      await api.post(`/hospitality/facilities/${service.id}/check-in`, {
        type: "MEMBER",
        membershipId: m.id,
      });
      await loadDashboard(service.id);
      setMembers([]);
      setSearch("");
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Check-in failed");
    } finally {
      setBusy(false);
    }
  };

  const sellDayPass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!service) return;
    setBusy(true);
    setError("");
    try {
      await api.post(`/hospitality/facilities/${service.id}/check-in`, {
        type: "WALK_IN",
        guestName: walkinForm.guestName,
        guestPhone: walkinForm.guestPhone || undefined,
        dayPassTypeId: walkinForm.dayPassTypeId,
        paymentMethodId: walkinForm.paymentMethodId
          ? Number(walkinForm.paymentMethodId)
          : undefined,
      });
      setWalkinOpen(false);
      setWalkinForm({ guestName: "", guestPhone: "", dayPassTypeId: "", paymentMethodId: "" });
      await loadDashboard(service.id);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to sell day pass");
    } finally {
      setBusy(false);
    }
  };

  const checkOut = async (visitId: string) => {
    if (!service) return;
    try {
      await api.post(`/hospitality/facilities/${service.id}/check-out/${visitId}`);
      await loadDashboard(service.id);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Check-out failed");
    }
  };

  // --- Package guest check-in (entitlement-covered at $0) ---
  const searchPackageGuests = async (q: string) => {
    setPkgQuery(q);
    if (!q.trim()) {
      setPkgResults([]);
      return;
    }
    try {
      const r = await api.get(
        `/hospitality/packages/lookup?q=${encodeURIComponent(q)}`,
      );
      setPkgResults(Array.isArray(r.data) ? r.data : []);
    } catch {
      setPkgResults([]);
    }
  };

  const selectPkgGuest = (g: any) => {
    setPkgGuest(g);
    setPkgResults([]);
    setPkgQuery(g.roomNumber ? `Room ${g.roomNumber} · ${g.guestName}` : g.guestName);
  };

  const openPackageCheckIn = () => {
    const firstPass = data?.dayPassTypes?.[0];
    setPkgGuest(null);
    setPkgQuery("");
    setPkgResults([]);
    setPkgForm({
      dayPassTypeId: firstPass?.id ?? "",
      amount: firstPass?.price != null ? String(firstPass.price) : "",
      settlementMode: "DEFER_TO_FOLIO",
      paymentMethodId: "",
    });
    setNotice("");
    setPkgOpen(true);
  };

  const submitPackageCheckIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!service || !pkgGuest) return;
    setBusy(true);
    setError("");
    try {
      const res = await api.post(`/hospitality/facilities/${service.id}/check-in`, {
        type: "PACKAGE",
        packageGuestId: pkgGuest.id,
        guestName: pkgGuest.guestName,
        dayPassTypeId: pkgForm.dayPassTypeId || undefined,
        amount: pkgForm.amount === "" ? undefined : Number(pkgForm.amount),
        settlementMode: pkgForm.settlementMode,
        paymentMethodId: pkgForm.paymentMethodId
          ? Number(pkgForm.paymentMethodId)
          : undefined,
      });
      const d = res.data ?? {};
      setNotice(
        d.netCharge > 0
          ? `Checked in ${pkgGuest.guestName} — package covered ${d.packageDiscount}, ${
              d.settlementMode === "DEFER_TO_FOLIO"
                ? "deferred to the room folio"
                : "collected now (PAY_NOW)"
            }: ${d.netCharge}`
          : `Checked in ${pkgGuest.guestName} — fully covered by the package ($0).`,
      );
      setPkgOpen(false);
      await loadDashboard(service.id);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Package check-in failed");
    } finally {
      setBusy(false);
    }
  };

  const displayName = hospitalityServiceName(service);

  if (loading && !data) {
    return <p className="text-gray-500 text-sm py-6 text-center">Loading {displayName}…</p>;
  }
  if (!service) {
    return (
      <div className="bg-red-50 text-red-600 p-3 rounded text-sm">
        This facility service is not available. Enable it from Business Settings.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-800">{displayName}</h1>
        {canCheckIn && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={openPackageCheckIn}
              disabled={busy}
              className="bg-violet-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-violet-700 disabled:opacity-60"
            >
              🎫 Package Guest
            </button>
            <button
              onClick={() => {
                setWalkinForm({
                  guestName: "",
                  guestPhone: "",
                  dayPassTypeId: data?.dayPassTypes?.[0]?.id ?? "",
                  paymentMethodId: "",
                });
                setWalkinOpen(true);
              }}
              disabled={busy}
              className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
            >
              + Walk-in / Day Pass
            </button>
          </div>
        )}
      </div>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}
      {notice && <div className="bg-green-50 text-green-700 p-3 rounded text-sm">{notice}</div>}

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <p className="text-xs text-gray-400 uppercase tracking-wide">Occupancy</p>
          <p className="text-3xl font-bold text-gray-800 mt-1">{data?.occupancyCount ?? 0}</p>
          <p className="text-xs text-gray-400 mt-1">Currently checked in</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <p className="text-xs text-gray-400 uppercase tracking-wide">Active Members</p>
          <p className="text-3xl font-bold text-gray-800 mt-1">{data?.activeMembershipCount ?? 0}</p>
          <p className="text-xs text-gray-400 mt-1">Valid memberships</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <p className="text-xs text-gray-400 uppercase tracking-wide">Revenue Today</p>
          <p className="text-3xl font-bold text-green-600 mt-1">
            {Number(data?.revenueToday ?? 0).toLocaleString()}
          </p>
          <p className="text-xs text-gray-400 mt-1">Confirmed day-pass sales</p>
        </div>
      </div>

      {/* Quick check-in / member search */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <h2 className="font-semibold text-gray-800 mb-2">Check-in Member</h2>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && searchMembers()}
            placeholder="Search by name or phone…"
            className="border border-gray-300 rounded-lg p-2 text-sm flex-1"
          />
          <button
            onClick={searchMembers}
            disabled={searching || busy}
            className="bg-gray-800 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </div>
        {members.length > 0 && (
          <ul className="divide-y divide-gray-100 mt-3 border border-gray-100 rounded-lg max-h-56 overflow-y-auto">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{m.customer?.name}</p>
                  <p className="text-xs text-gray-400">
                    {m.customer?.phone || m.customer?.email || ""} · {m.membershipType?.name} · ends {fmtDate(m.endDate)}
                  </p>
                </div>
                {canCheckIn && (
                  <button
                    onClick={() => checkInMember(m)}
                    disabled={busy}
                    className="bg-green-600 text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-green-700 disabled:opacity-60 shrink-0"
                  >
                    Check in
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {members.length === 0 && search.trim() && !searching && (
          <p className="text-sm text-gray-400 mt-2">No active members found.</p>
        )}
      </div>


      {/* Live occupancy */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-gray-800">Live Occupancy</h2>
          <span className="text-xs text-gray-400">{data?.occupancyCount ?? 0} checked in</span>
        </div>
        {data?.occupancy?.length ? (
          <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg max-h-64 overflow-y-auto">
            {data.occupancy.map((v: any) => (
              <li key={v.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {v.guestName || v.customer?.name || "Guest"}
                  </p>
                  <p className="text-xs text-gray-400">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium mr-1 ${
                        v.type === "MEMBER"
                          ? "bg-green-100 text-green-700"
                          : v.type === "PACKAGE"
                            ? "bg-violet-100 text-violet-700"
                            : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {v.type === "MEMBER"
                        ? "Member"
                        : v.type === "PACKAGE"
                          ? "Package"
                          : "Walk-in"}
                    </span>
                    {v.customerMembership?.membershipType?.name ?? v.guestPhone ?? ""} · in {fmtTime(v.checkInAt)}
                  </p>
                </div>
                {canCheckIn && (
                  <button
                    onClick={() => checkOut(v.id)}
                    className="bg-gray-100 text-gray-700 rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-gray-200 shrink-0"
                  >
                    Check out
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-400 text-sm py-4 text-center">No one is checked in right now.</p>
        )}
      </div>

      {/* Active memberships */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-gray-800">Active Memberships</h2>
          <span className="text-xs text-gray-400">{data?.activeMembershipCount ?? 0} active</span>
        </div>
        {data?.activeMemberships?.length ? (
          <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg max-h-64 overflow-y-auto">
            {data.activeMemberships.map((m: any) => (
              <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{m.customer?.name}</p>
                  <p className="text-xs text-gray-400">
                    {m.customer?.phone || ""} · {m.membershipType?.name} · ends {fmtDate(m.endDate)}
                  </p>
                </div>
                {canCheckIn && (
                  <button
                    onClick={() => checkInMember(m)}
                    disabled={busy}
                    className="bg-green-600 text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-green-700 disabled:opacity-60 shrink-0"
                  >
                    Check in
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-400 text-sm py-4 text-center">No active memberships.</p>
        )}
      </div>


      {/* Package guest check-in modal */}
      {pkgOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-md shadow-xl max-h-[92vh] overflow-y-auto">
            <h2 className="font-semibold text-gray-800 mb-1">Package Guest Check-in</h2>
            <p className="text-xs text-gray-400 mb-3">
              The guest&apos;s package pass/credit is consumed at $0; any overage is
              routed by the settlement mode below.
            </p>
            <form onSubmit={submitPackageCheckIn} className="space-y-3">
              <div>
                <input
                  value={pkgQuery}
                  onChange={(e) => searchPackageGuests(e.target.value)}
                  placeholder="Room # or guest name…"
                  className="border border-gray-300 rounded p-2 text-sm w-full"
                  required={!pkgGuest}
                />
                {pkgResults.length > 0 && (
                  <ul className="border border-gray-200 rounded mt-1 max-h-32 overflow-y-auto bg-white">
                    {pkgResults.map((g) => (
                      <li key={g.id}>
                        <button
                          type="button"
                          onClick={() => selectPkgGuest(g)}
                          className="w-full text-left px-2 py-1.5 hover:bg-gray-50 text-xs text-gray-700"
                        >
                          {g.guestName}
                          {g.roomNumber ? ` · Room ${g.roomNumber}` : ""} ·{" "}
                          {g.package?.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {pkgGuest && (
                  <p className="text-[11px] text-violet-600 mt-1">
                    Selected: {pkgGuest.guestName}
                    {pkgGuest.roomNumber ? ` · Room ${pkgGuest.roomNumber}` : ""} ·{" "}
                    {pkgGuest.package?.name}
                  </p>
                )}
              </div>
              <select
                value={pkgForm.dayPassTypeId}
                onChange={(e) => {
                  const t = (data?.dayPassTypes ?? []).find(
                    (x: any) => x.id === e.target.value,
                  );
                  setPkgForm({
                    ...pkgForm,
                    dayPassTypeId: e.target.value,
                    amount: t?.price != null ? String(t.price) : pkgForm.amount,
                  });
                }}
                className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
              >
                <option value="">Charge amount (manual)</option>
                {(data?.dayPassTypes ?? []).map((t: any) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {t.price}
                  </option>
                ))}
              </select>
              <input
                type="number"
                value={pkgForm.amount}
                onChange={(e) => setPkgForm({ ...pkgForm, amount: e.target.value })}
                placeholder="Visit charge (ETB)"
                className="border border-gray-300 rounded p-2 text-sm w-full"
              />
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">
                  Settlement mode for the overage
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setPkgForm({ ...pkgForm, settlementMode: "DEFER_TO_FOLIO" })
                    }
                    className={`flex-1 rounded p-2 text-xs font-medium border ${
                      pkgForm.settlementMode === "DEFER_TO_FOLIO"
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-gray-200 text-gray-600"
                    }`}
                  >
                    DEFER_TO_FOLIO
                  </button>
                  <button
                    type="button"
                    onClick={() => setPkgForm({ ...pkgForm, settlementMode: "PAY_NOW" })}
                    className={`flex-1 rounded p-2 text-xs font-medium border ${
                      pkgForm.settlementMode === "PAY_NOW"
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-gray-200 text-gray-600"
                    }`}
                  >
                    PAY_NOW
                  </button>
                </div>
                <p className="text-[11px] text-gray-400 mt-1">
                  {pkgForm.settlementMode === "DEFER_TO_FOLIO"
                    ? "Uncovered amount is posted to the guest's room folio."
                    : "Uncovered amount is collected at the terminal now."}
                </p>
              </div>
              {pkgForm.settlementMode === "PAY_NOW" && (
                <select
                  value={pkgForm.paymentMethodId}
                  onChange={(e) =>
                    setPkgForm({ ...pkgForm, paymentMethodId: e.target.value })
                  }
                  className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
                >
                  <option value="">Payment method…</option>
                  {paymentMethods.map((pm) => (
                    <option key={pm.id} value={pm.id}>
                      {pm.name}
                    </option>
                  ))}
                </select>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPkgOpen(false)}
                  className="px-3 py-2 text-sm text-gray-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy || !pkgGuest}
                  className="bg-violet-600 text-white rounded px-3 py-2 text-sm font-medium hover:bg-violet-700 disabled:opacity-60"
                >
                  {busy ? "Checking in…" : "Check in"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Walk-in / day pass modal */}
      {walkinOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-1">Sell Day Pass / Walk-in</h2>
            <p className="text-xs text-gray-400 mb-3">
              The payment is queued for the cashier to confirm and posts to the ledger.
            </p>
            <form onSubmit={sellDayPass} className="space-y-3">
              <input
                value={walkinForm.guestName}
                onChange={(e) => setWalkinForm({ ...walkinForm, guestName: e.target.value })}
                placeholder="Guest name"
                className="border border-gray-300 rounded p-2 text-sm w-full"
                required
              />
              <input
                value={walkinForm.guestPhone}
                onChange={(e) => setWalkinForm({ ...walkinForm, guestPhone: e.target.value })}
                placeholder="Phone (optional)"
                className="border border-gray-300 rounded p-2 text-sm w-full"
              />
              <select
                value={walkinForm.dayPassTypeId}
                onChange={(e) => setWalkinForm({ ...walkinForm, dayPassTypeId: e.target.value })}
                className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
                required
              >
                <option value="">Select day pass…</option>
                {(data?.dayPassTypes ?? []).map((t: any) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {t.price}
                  </option>
                ))}
              </select>
              <select
                value={walkinForm.paymentMethodId}
                onChange={(e) => setWalkinForm({ ...walkinForm, paymentMethodId: e.target.value })}
                className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
              >
                <option value="">Payment method…</option>
                {paymentMethods.map((pm) => (
                  <option key={pm.id} value={pm.id}>{pm.name}</option>
                ))}
              </select>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setWalkinOpen(false)} className="px-3 py-2 text-sm text-gray-600">
                  Cancel
                </button>
                <button type="submit" disabled={busy} className="bg-blue-600 text-white rounded px-3 py-2 text-sm font-medium disabled:opacity-60">
                  Sell &amp; Check in
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

