"use client";

import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/app/components/ConfirmProvider";
import api from "@/lib/api";
import { hospitalityServiceName as serviceName } from "@/lib/verticals";
import { useCallback, useEffect, useState } from "react";

interface EntRow {
  // ITEM = station/menu coverage; CREDIT = service ETB allowance;
  // PASS = facility pass/voucher (optionally a specific pass plan).
  entitlementKind: string;
  stationId: string;
  menuCategoryId: string;
  menuItemId: string;
  hospitalityServiceId: string;
  membershipTypeId: string;
  allowanceValue: string;
  dailyLimit: string;
}

const emptyEntRow = (): EntRow => ({
  entitlementKind: "ITEM",
  stationId: "",
  menuCategoryId: "",
  menuItemId: "",
  hospitalityServiceId: "",
  membershipTypeId: "",
  allowanceValue: "",
  dailyLimit: "",
});

export default function PackagesPage() {
  const { activeOrganizationId, hasPermission } = useAuth();
  const confirm = useConfirm();
  const canManage = hasPermission("packages.manage");
  // Checking a guest in against a package redeems its entitlements — a package
  // desk privilege that does not imply the right to define packages.
  const canRedeem =
    hasPermission("packages.redeem") ||
    hasPermission("packages.manage") ||
    hasPermission("hotel.reception");
  // Settling a package guest is money: the folio keys (or the front desk) own it.
  const canSettle =
    hasPermission("folios.settle") ||
    hasPermission("folios.manage") ||
    hasPermission("hotel.reception");

  const [packages, setPackages] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [membershipTypes, setMembershipTypes] = useState<any[]>([]);
  const [stations, setStations] = useState<any[]>([]);
  const [menu, setMenu] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<any>(null);
  const [form, setForm] = useState<any>({
    name: "",
    price: "",
    hospitalityServiceId: "",
    entitlements: [],
  });
  const [entRows, setEntRows] = useState<EntRow[]>([]);
  // Guest check-in (billed against an active hotel reservation folio).
  const [reservations, setReservations] = useState<any[]>([]);
  const [guests, setGuests] = useState<any[]>([]);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [checkInBusy, setCheckInBusy] = useState(false);
  const [checkInForm, setCheckInForm] = useState({
    packageId: "",
    guestName: "",
    hotelReservationId: "",
    roomNumber: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [p, s, st, m, res, g, mt] = await Promise.all([
        api.get("/hospitality/packages"),
        activeOrganizationId
          ? api.get(`/tenants/${activeOrganizationId}/services`)
          : Promise.resolve({ data: [] }),
        api.get("/restaurant/stations"),
        api.get("/restaurant/menu"),
        // Reservations + active guests are optional (permission-gated) extras.
        api.get("/hotel/reservations").catch(() => ({ data: [] })),
        api.get("/hospitality/guests").catch(() => ({ data: [] })),
        // Pass plans, for PASS (voucher) entitlement targets.
        api
          .get("/hospitality/memberships/types")
          .catch(() => ({ data: [] })),
      ]);
      setPackages(Array.isArray(p.data) ? p.data : []);
      setServices(Array.isArray(s.data) ? s.data : []);
      setStations(Array.isArray(st.data) ? st.data.filter((x: any) => x.isActive) : []);
      setMenu(Array.isArray(m.data) ? m.data : []);
      setReservations(Array.isArray(res.data) ? res.data : []);
      setGuests(Array.isArray(g.data) ? g.data : []);
      setMembershipTypes(Array.isArray(mt.data) ? mt.data : []);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to load packages");
    } finally {
      setLoading(false);
    }
  }, [activeOrganizationId]);

  useEffect(() => {
    load();
  }, [load]);

  const allItems = menu.flatMap((c) =>
    (c.items ?? []).map((it: any) => ({ ...it, categoryId: c.id, categoryName: c.name })),
  );

  const openNew = () => {
    setModal({ id: null });
    setForm({
      name: "",
      price: "",
      // Empty = cross-service package (entitlements carry the services).
      hospitalityServiceId: "",
      entitlements: [],
    });
    setEntRows([emptyEntRow()]);
  };

  const openEdit = (pkg: any) => {
    setModal({ id: pkg.id });
    setForm({
      name: pkg.name,
      price: String(pkg.price),
      hospitalityServiceId: pkg.hospitalityServiceId ?? "",
      entitlements: pkg.entitlements ?? [],
    });
    setEntRows(
      (pkg.entitlements ?? []).map((e: any) => ({
        entitlementKind: e.entitlementKind ?? "ITEM",
        stationId: e.stationId != null ? String(e.stationId) : "",
        menuCategoryId: e.menuCategoryId != null ? String(e.menuCategoryId) : "",
        menuItemId: e.menuItemId != null ? String(e.menuItemId) : "",
        hospitalityServiceId: e.hospitalityServiceId ?? "",
        membershipTypeId: e.membershipTypeId ?? "",
        allowanceValue: String(e.allowanceValue ?? ""),
        dailyLimit: e.dailyLimit != null ? String(e.dailyLimit) : "",
      })),
    );
  };

  const addEnt = () => setEntRows([...entRows, emptyEntRow()]);
  const updEnt = (i: number, patch: Partial<EntRow>) =>
    setEntRows(entRows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const delEnt = (i: number) => setEntRows(entRows.filter((_, idx) => idx !== i));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const entitlements = entRows
      .filter((r) =>
        r.entitlementKind === "ITEM" ? r.stationId : r.hospitalityServiceId,
      )
      .map((r) => ({
        entitlementKind: r.entitlementKind,
        // ITEM lines target a station; CREDIT / PASS lines target a service.
        stationId:
          r.entitlementKind === "ITEM" && r.stationId
            ? Number(r.stationId)
            : undefined,
        menuCategoryId:
          r.entitlementKind === "ITEM" && r.menuCategoryId
            ? Number(r.menuCategoryId)
            : undefined,
        menuItemId:
          r.entitlementKind === "ITEM" && r.menuItemId
            ? Number(r.menuItemId)
            : undefined,
        hospitalityServiceId:
          r.entitlementKind !== "ITEM" ? r.hospitalityServiceId : undefined,
        membershipTypeId:
          r.entitlementKind === "PASS" && r.membershipTypeId
            ? r.membershipTypeId
            : undefined,
        allowanceValue: r.allowanceValue === "" ? undefined : Number(r.allowanceValue),
        dailyLimit: r.dailyLimit === "" ? undefined : Number(r.dailyLimit),
      }));
    try {
      const payload: any = {
        name: form.name,
        price: Number(form.price) || 0,
        entitlements,
      };
      if (modal.id) {
        await api.patch(`/hospitality/packages/${modal.id}`, payload);
      } else {
        await api.post("/hospitality/packages", {
          ...payload,
          hospitalityServiceId: form.hospitalityServiceId || undefined,
        });
      }
      setModal(null);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to save package");
    }
  };

  const remove = async (pkg: any) => {
    if (!(await confirm(`Delete package "${pkg.name}"?`))) return;
    try {
      await api.delete(`/hospitality/packages/${pkg.id}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to delete package");
    }
  };

  const toggleActive = async (pkg: any) => {
    try {
      await api.patch(`/hospitality/packages/${pkg.id}`, { isActive: !pkg.isActive });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to update package");
    }
  };

  // --- Guest check-in against an active hotel reservation ---
  const activeReservations = reservations.filter(
    (r) => r.status === "CONFIRMED" || r.status === "CHECKED_IN",
  );

  const money = (n: number | undefined) =>
    n == null ? "0" : Number(n).toLocaleString("en-US", { minimumFractionDigits: 2 });

  const balanceOf = (g: any) => {
    const addOns = g.folio ? g.folio.totalAddOns ?? 0 : 0;
    const paid = g.folio ? g.folio.totalPayments ?? 0 : 0;
    return Math.max(0, addOns - paid);
  };

  const openCheckIn = () => {
    setCheckInForm({
      packageId: packages.find((p) => p.isActive)?.id ?? packages[0]?.id ?? "",
      guestName: "",
      hotelReservationId: "",
      roomNumber: "",
    });
    setCheckInOpen(true);
  };

  const selectReservation = (id: string) => {
    const res = activeReservations.find((r) => String(r.id) === id);
    setCheckInForm((f) => ({
      ...f,
      hotelReservationId: id,
      // Auto-fill the room number straight from the selected stay.
      roomNumber: res?.room?.number ?? "",
      guestName: f.guestName || res?.guestName || "",
    }));
  };

  const submitCheckIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkInForm.packageId || !checkInForm.guestName.trim()) return;
    setCheckInBusy(true);
    setError("");
    try {
      await api.post("/hospitality/guests", {
        packageId: checkInForm.packageId,
        guestName: checkInForm.guestName.trim(),
        roomNumber: checkInForm.roomNumber || undefined,
        hotelReservationId: checkInForm.hotelReservationId
          ? Number(checkInForm.hotelReservationId)
          : undefined,
      });
      setCheckInOpen(false);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to check in guest");
    } finally {
      setCheckInBusy(false);
    }
  };

  const checkOutGuest = async (guestId: string) => {
    if (!(await confirm("Settle this guest folio and check the guest out?"))) return;
    setError("");
    try {
      await api.post(`/hospitality/guests/${guestId}/check-out`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to settle guest folio");
    }
  };

  // Compensation preview: e.g. allowance 300 vs a 500 ETB item -> 200 net.
  const preview = (row: EntRow) => {
    const allow = Number(row.allowanceValue);
    const item = allItems.find((i: any) => i.id === Number(row.menuItemId));
    if (!row.allowanceValue || !item) return null;
    return `Item ${item.name} (${item.price} ETB) → covered ${Math.min(allow, item.price)}, excess ${Math.max(0, item.price - allow)} ETB`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Packages &amp; Entitlements</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Bundle daily entitlement allowances per station (Kitchen, Barista…) for package guests.
          </p>
        </div>
        {(canRedeem || canManage) && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Checking a guest in is `packages.redeem`; defining packages is
                `packages.manage`. A package desk may hold only the former. */}
            {canRedeem && (
              <button onClick={openCheckIn} className="bg-emerald-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-emerald-700">
                🛎️ Check In Guest
              </button>
            )}
            {canManage && (
              <button onClick={openNew} className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700">
                + New Package
              </button>
            )}
          </div>
        )}
      </div>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      {loading ? (
        <p className="text-gray-500 text-sm py-6 text-center">Loading packages…</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2">Package</th>
                <th className="px-4 py-2">Service</th>
                <th className="px-4 py-2">Price</th>
                <th className="px-4 py-2">Entitlements</th>
                <th className="px-4 py-2">Active Guests</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {packages.map((pkg) => (
                <tr key={pkg.id} className="border-t align-top">
                  <td className="px-4 py-2 font-medium text-gray-800">{pkg.name}</td>
                  <td className="px-4 py-2 text-gray-600">
                    {pkg.hospitalityServiceId
                      ? serviceName(pkg.hospitalityService)
                      : "Cross-service"}
                  </td>
                  <td className="px-4 py-2 text-gray-600">{pkg.price}</td>
                  <td className="px-4 py-2 text-gray-600">
                    {(pkg.entitlements ?? []).map((en: any) => (
                      <div key={en.id} className="text-xs py-0.5">
                        <span className="font-medium">
                          {en.entitlementKind === "ITEM"
                            ? en.station?.name ?? "Station"
                            : serviceName(en.hospitalityService)}
                        </span>
                        {en.entitlementKind === "ITEM" &&
                          (en.menuItem
                            ? ` · ${en.menuItem.name}`
                            : en.menuCategory
                              ? ` · ${en.menuCategory.name}`
                              : "")}
                        {en.entitlementKind === "PASS" && (
                          <span className="ml-1 text-violet-600">
                            PASS{en.membershipType ? ` · ${en.membershipType.name}` : ""}
                          </span>
                        )}
                        {en.entitlementKind === "CREDIT" && (
                          <span className="ml-1 text-violet-600">CREDIT</span>
                        )}
                        {` · ${en.allowanceValue > 0 ? `${en.allowanceValue} ETB/unit` : "full coverage"}`}
                        {en.dailyLimit != null ? ` · ${en.dailyLimit}/day` : ""}
                      </div>
                    ))}
                    {(pkg.entitlements ?? []).length === 0 && <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-2 text-gray-600">{pkg._count?.guests ?? 0}</td>
                  <td className="px-4 py-2">
                    {canManage ? (
                      <button
                        onClick={() => toggleActive(pkg)}
                        className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          pkg.isActive ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"
                        }`}
                      >
                        {pkg.isActive ? "Active" : "Inactive"}
                      </button>
                    ) : (
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          pkg.isActive ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"
                        }`}
                      >
                        {pkg.isActive ? "Active" : "Inactive"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {canManage && (
                      <>
                        <button onClick={() => openEdit(pkg)} className="text-xs text-blue-600 hover:underline mr-2">Edit</button>
                        <button onClick={() => remove(pkg)} className="text-xs text-red-600 hover:underline">Del</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {packages.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                    No packages yet — add your first one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {guests.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">Active Package Guests</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Guests checked in against a package; settle each folio at checkout.
            </p>
          </div>
          <ul className="divide-y divide-gray-100">
            {guests.map((g) => (
              <li key={g.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800">
                    {g.guestName}
                    {g.roomNumber && (
                      <span className="ml-2 text-xs text-gray-500">Room {g.roomNumber}</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-400">
                    {serviceName(g.package?.hospitalityService)} · {g.package?.name}
                    {g.hotelReservation ? ` · Stay #${g.hotelReservation.id}` : ""}
                  </p>
                </div>
                <div className="text-right shrink-0 flex items-center gap-3">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                      balanceOf(g) > 0
                        ? "bg-amber-100 text-amber-700"
                        : "bg-green-100 text-green-700"
                    }`}
                  >
                    {money(balanceOf(g))} ETB
                  </span>
                  {canSettle && (
                    <button
                      onClick={() => checkOutGuest(g.id)}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Settle &amp; check out
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {checkInOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="font-semibold text-gray-800 mb-3">Check In Guest</h2>
            <form onSubmit={submitCheckIn} className="space-y-3">
              <select
                value={checkInForm.packageId}
                onChange={(e) => setCheckInForm({ ...checkInForm, packageId: e.target.value })}
                className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
                required
              >
                <option value="">Select package…</option>
                {packages
                  .filter((p) => p.isActive)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {serviceName(p.hospitalityService)}
                    </option>
                  ))}
              </select>
              <select
                value={checkInForm.hotelReservationId}
                onChange={(e) => selectReservation(e.target.value)}
                className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
              >
                <option value="">No room (standalone guest)</option>
                {activeReservations.map((r) => (
                  <option key={r.id} value={r.id}>
                    Room {r.room?.number ?? "—"} · {r.guestName} · {r.status}
                  </option>
                ))}
              </select>
              <input
                value={checkInForm.guestName}
                onChange={(e) => setCheckInForm({ ...checkInForm, guestName: e.target.value })}
                placeholder="Guest name"
                className="border border-gray-300 rounded p-2 text-sm w-full"
                required
              />
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Room number</label>
                <input
                  value={checkInForm.roomNumber}
                  onChange={(e) => setCheckInForm({ ...checkInForm, roomNumber: e.target.value })}
                  placeholder="Auto-filled from the reservation"
                  className="border border-gray-300 rounded p-2 text-sm w-full bg-gray-50"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  {checkInForm.hotelReservationId
                    ? "Auto-filled from the selected reservation."
                    : "Pick a reservation to auto-fill, or type a room for a standalone charge."}
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCheckInOpen(false)}
                  className="px-3 py-2 text-sm text-gray-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={checkInBusy}
                  className="bg-emerald-600 text-white rounded px-3 py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
                >
                  {checkInBusy ? "Checking in…" : "Check In"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-2xl shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="font-semibold text-gray-800 mb-3">{modal.id ? "Edit Package" : "New Package"}</h2>
            <form onSubmit={save} className="space-y-3">
              {!modal.id && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Primary service (optional)
                  </label>
                  <select
                    value={form.hospitalityServiceId}
                    onChange={(e) => setForm({ ...form, hospitalityServiceId: e.target.value })}
                    className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
                  >
                    <option value="">
                      Cross-service package (bundle several services)
                    </option>
                    {services
                      .filter((s) => s.serviceType !== "FOOD_AND_BEVERAGE")
                      .map((s) => (
                        <option key={s.id} value={s.id}>{serviceName(s)}</option>
                      ))}
                  </select>
                </div>
              )}
              <div className="flex gap-2">
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Package name (e.g. All-Inclusive Dine Package)"
                  className="border border-gray-300 rounded p-2 text-sm flex-1"
                  required
                />
                <input
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  placeholder="Price (ETB)"
                  type="number"
                  className="border border-gray-300 rounded p-2 text-sm w-32"
                />
              </div>

              <div className="border border-gray-200 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-gray-700">Bundled Entitlements</p>
                  <button type="button" onClick={addEnt} className="text-xs text-blue-600 hover:underline">
                    + Add entitlement
                  </button>
                </div>
                <div className="space-y-3">
                  {entRows.map((row, i) => (
                    <div key={i} className="border border-gray-100 rounded p-2 space-y-2">
                      <div className="flex flex-wrap gap-2 items-center">
                        <select
                          value={row.entitlementKind}
                          onChange={(e) =>
                            updEnt(i, {
                              entitlementKind: e.target.value,
                              // Reset the other target family when switching kind.
                              stationId: "",
                              menuCategoryId: "",
                              menuItemId: "",
                              hospitalityServiceId: "",
                              membershipTypeId: "",
                            })
                          }
                          className="border border-gray-300 rounded p-2 text-xs w-28 bg-white"
                        >
                          <option value="ITEM">Item (F&B)</option>
                          <option value="CREDIT">Credit</option>
                          <option value="PASS">Pass</option>
                        </select>

                        {row.entitlementKind === "ITEM" ? (
                          <>
                            <select
                              value={row.stationId}
                              onChange={(e) => updEnt(i, { stationId: e.target.value })}
                              className="border border-gray-300 rounded p-2 text-xs flex-1 bg-white"
                              required
                            >
                              <option value="">Station…</option>
                              {stations.map((st) => (
                                <option key={st.id} value={st.id}>{st.name}</option>
                              ))}
                            </select>
                            <select
                              value={row.menuCategoryId}
                              onChange={(e) => updEnt(i, { menuCategoryId: e.target.value, menuItemId: "" })}
                              className="border border-gray-300 rounded p-2 text-xs flex-1 bg-white"
                            >
                              <option value="">Any category</option>
                              {menu.map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                            <select
                              value={row.menuItemId}
                              onChange={(e) => updEnt(i, { menuItemId: e.target.value })}
                              className="border border-gray-300 rounded p-2 text-xs flex-1 bg-white"
                            >
                              <option value="">Any item</option>
                              {(row.menuCategoryId
                                ? allItems.filter((it: any) => String(it.categoryId) === row.menuCategoryId)
                                : allItems
                              ).map((it: any) => (
                                <option key={it.id} value={it.id}>{it.name}</option>
                              ))}
                            </select>
                          </>
                        ) : (
                          <>
                            <select
                              value={row.hospitalityServiceId}
                              onChange={(e) => updEnt(i, { hospitalityServiceId: e.target.value })}
                              className="border border-gray-300 rounded p-2 text-xs flex-1 bg-white"
                              required
                            >
                              <option value="">Service…</option>
                              {services.map((s) => (
                                <option key={s.id} value={s.id}>{serviceName(s)}</option>
                              ))}
                            </select>
                            {row.entitlementKind === "PASS" && (
                              <select
                                value={row.membershipTypeId}
                                onChange={(e) => updEnt(i, { membershipTypeId: e.target.value })}
                                className="border border-gray-300 rounded p-2 text-xs flex-1 bg-white"
                              >
                                <option value="">Any pass plan</option>
                                {membershipTypes
                                  .filter(
                                    (t) =>
                                      !row.hospitalityServiceId ||
                                      t.hospitalityServiceId === row.hospitalityServiceId,
                                  )
                                  .map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.name} ({t.durationDays}d)
                                    </option>
                                  ))}
                              </select>
                            )}
                          </>
                        )}
                        <button type="button" onClick={() => delEnt(i)} className="text-xs text-red-600 hover:underline shrink-0">
                          ×
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <input
                          value={row.allowanceValue}
                          onChange={(e) => updEnt(i, { allowanceValue: e.target.value })}
                          placeholder="Covered ETB/unit (0 = full)"
                          type="number"
                          className="border border-gray-300 rounded p-2 text-xs w-40"
                        />
                        <input
                          value={row.dailyLimit}
                          onChange={(e) => updEnt(i, { dailyLimit: e.target.value })}
                          placeholder="Daily limit (units)"
                          type="number"
                          className="border border-gray-300 rounded p-2 text-xs w-32"
                        />
                        {preview(row) && <p className="text-[11px] text-gray-500 self-center">{preview(row)}</p>}
                      </div>
                    </div>
                  ))}
                  {entRows.length === 0 && <p className="text-xs text-gray-400">No entitlements — add an item, credit or pass line.</p>}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setModal(null)} className="px-3 py-2 text-sm text-gray-600">
                  Cancel
                </button>
                <button type="submit" className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700">
                  Save Package
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}