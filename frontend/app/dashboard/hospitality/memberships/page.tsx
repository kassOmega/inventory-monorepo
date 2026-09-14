"use client";

import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/app/components/ConfirmProvider";
import api from "@/lib/api";
import {
  hospitalityServiceName as serviceDisplayName,
  isMembershipCapableService as isMembershipCapable,
  HOSPITALITY_SERVICE_LABELS,
} from "@/lib/verticals";
import { useCallback, useEffect, useState } from "react";

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700",
  EXPIRED: "bg-gray-200 text-gray-500",
  SUSPENDED: "bg-amber-100 text-amber-700",
  CANCELLED: "bg-red-100 text-red-700",
};

export default function CustomerMembershipsPage() {
  const { activeOrganizationId, hasPermission } = useAuth();
  const confirm = useConfirm();
  const canManage = hasPermission("memberships.manage");
  const [memberships, setMemberships] = useState<any[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [serviceFilter, setServiceFilter] = useState(""); // hospitalityServiceId
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignForm, setAssignForm] = useState({
    customerName: "",
    phone: "",
    email: "",
    membershipTypeId: "",
    startDate: "",
  });
  const [extendFor, setExtendFor] = useState<any>(null);
  const [extendDate, setExtendDate] = useState("");
  // Walk-in day pass + check-in search
  const [facilities, setFacilities] = useState<any[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [dayPassOpen, setDayPassOpen] = useState(false);
  const [dayPassForm, setDayPassForm] = useState({
    serviceId: "",
    typeId: "",
    guestName: "",
    guestPhone: "",
    paymentMethodId: "",
  });
  const [checkInSearch, setCheckInSearch] = useState("");
  const [checkInResults, setCheckInResults] = useState<any[]>([]);
  const [checkInSearching, setCheckInSearching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (serviceFilter) params.set("serviceId", serviceFilter);
      if (statusFilter) params.set("status", statusFilter);
      const qs = params.toString();
      const [mRes, tRes, sRes, pmRes] = await Promise.all([
        api.get(`/hospitality/memberships${qs ? `?${qs}` : ""}`),
        api.get("/hospitality/memberships/types"),
        activeOrganizationId
          ? api.get(`/tenants/${activeOrganizationId}/services`)
          : Promise.resolve({ data: [] }),
        api.get("/payment-methods"),
      ]);
      setMemberships(Array.isArray(mRes.data) ? mRes.data : []);
      setTypes(Array.isArray(tRes.data) ? tRes.data : []);
      const svcList = Array.isArray(sRes.data) ? sRes.data : [];
      setFacilities(svcList.filter((s: any) => s.isEnabled && isMembershipCapable(s)));
      setPaymentMethods(Array.isArray(pmRes.data) ? pmRes.data : []);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to load memberships");
    } finally {
      setLoading(false);
    }
  }, [serviceFilter, statusFilter, activeOrganizationId]);

  useEffect(() => {
    load();
  }, [load]);


  const openAssign = () => {
    const defaultService = facilities.find((f) => isMembershipCapable(f))?.id ?? "";
    const firstType = types.find(
      (t) => t.hospitalityService?.serviceType === defaultService,
    );
    setAssignForm({
      customerName: "",
      phone: "",
      email: "",
      membershipTypeId: firstType?.id ?? "",
      startDate: "",
    });
    setAssignOpen(true);
  };

  const assign = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api.post("/hospitality/memberships", {
        membershipTypeId: assignForm.membershipTypeId,
        customerName: assignForm.customerName,
        phone: assignForm.phone || undefined,
        email: assignForm.email || undefined,
        startDate: assignForm.startDate || undefined,
      });
      setAssignOpen(false);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to assign membership");
    }
  };

  const openExtend = (m: any) => {
    setExtendFor(m);
    setExtendDate(m.endDate?.slice(0, 10) ?? "");
  };

  const extend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extendFor) return;
    setError("");
    try {
      await api.patch(`/hospitality/memberships/${extendFor.id}`, {
        endDate: extendDate,
        status: extendFor.status === "EXPIRED" ? "ACTIVE" : extendFor.status,
      });
      setExtendFor(null);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to update membership");
    }
  };

  const changeStatus = async (m: any, status: string) => {
    if (status === "CANCELLED" && !(await confirm(`Cancel membership for "${m.customer?.name}"?`))) return;
    setError("");
    try {
      await api.patch(`/hospitality/memberships/${m.id}`, { status });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to update membership");
    }
  };

  const facilityName = (s: any) =>
    s?.customName ??
    (HOSPITALITY_SERVICE_LABELS[s.serviceType] ?? s.serviceType ?? "Facility");

  const openDayPass = () => {
    const first = facilities[0];
    const firstType = types.find(
      (t) => first && t.hospitalityServiceId === first.id && t.isActive && t.durationDays <= 1,
    );
    setDayPassForm({
      serviceId: first?.id ?? "",
      typeId: firstType?.id ?? "",
      guestName: "",
      guestPhone: "",
      paymentMethodId: "",
    });
    setDayPassOpen(true);
  };

  const sellDayPass = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api.post(`/hospitality/facilities/${dayPassForm.serviceId}/check-in`, {
        type: "WALK_IN",
        guestName: dayPassForm.guestName,
        guestPhone: dayPassForm.guestPhone || undefined,
        dayPassTypeId: dayPassForm.typeId,
        paymentMethodId: dayPassForm.paymentMethodId
          ? Number(dayPassForm.paymentMethodId)
          : undefined,
      });
      setDayPassOpen(false);
      setDayPassForm({
        serviceId: "",
        typeId: "",
        guestName: "",
        guestPhone: "",
        paymentMethodId: "",
      });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to sell day pass");
    }
  };

  const searchCheckIn = async () => {
    const fac = facilities.find((f) => f.id === dayPassForm.serviceId) ?? facilities[0];
    if (!fac) return;
    setCheckInSearching(true);
    setError("");
    try {
      const q = checkInSearch.trim();
      const r = await api.get(
        `/hospitality/facilities/${fac.id}/members${q ? `?search=${encodeURIComponent(q)}` : ""}`,
      );
      setCheckInResults(Array.isArray(r.data) ? r.data : []);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to search members");
    } finally {
      setCheckInSearching(false);
    }
  };

  const checkInMember = async (m: any) => {
    const fac = facilities.find((f) => f.id === dayPassForm.serviceId) ?? facilities[0];
    if (!fac) return;
    setError("");
    try {
      await api.post(`/hospitality/facilities/${fac.id}/check-in`, {
        type: "MEMBER",
        membershipId: m.id,
      });
      setCheckInResults([]);
      setCheckInSearch("");
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Check-in failed");
    }
  };

  const availableTypes = types.filter(
    (t: any) => !serviceFilter || t.hospitalityServiceId === serviceFilter,
  );
  const fmt = (d: string) => (d ? d.slice(0, 10) : "-");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-800">Customer Memberships</h1>
        <div className="flex items-center gap-2">
          {canManage && (
            <button
              onClick={openDayPass}
              className="bg-emerald-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-emerald-700"
            >
              Sell Day Pass / Walk-in
            </button>
          )}
          {canManage && (
            <button onClick={openAssign} className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700">
              + Assign Membership
            </button>
          )}
        </div>
      </div>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      {/* Check-in member search */}
      {facilities.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h2 className="font-semibold text-gray-800 mb-2">Check-in Member</h2>
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              value={dayPassForm.serviceId}
              onChange={(e) => {
                const sid = e.target.value;
                const fac = facilities.find((f) => f.id === sid);
                const firstType = types.find(
                  (t) => t.hospitalityServiceId === sid && t.isActive && t.durationDays <= 1,
                );
                setDayPassForm((prev) => ({
                  ...prev,
                  serviceId: sid,
                  typeId: firstType?.id ?? (fac ? prev.typeId : ""),
                }));
              }}
              className="border border-gray-300 rounded p-2 text-sm bg-white"
            >
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>{facilityName(f)}</option>
              ))}
            </select>
            <input
              value={checkInSearch}
              onChange={(e) => setCheckInSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchCheckIn()}
              placeholder="Search member by name or phone…"
              className="border border-gray-300 rounded p-2 text-sm flex-1"
            />
            <button
              onClick={searchCheckIn}
              disabled={checkInSearching}
              className="bg-gray-800 text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-60"
            >
              {checkInSearching ? "Searching…" : "Search"}
            </button>
          </div>
          {checkInResults.length > 0 && (
            <ul className="divide-y divide-gray-100 mt-3 border border-gray-100 rounded-lg max-h-52 overflow-y-auto">
              {checkInResults.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{m.customer?.name}</p>
                    <p className="text-xs text-gray-400">
                      {m.customer?.phone || ""} · {m.membershipType?.name} · ends {fmt(m.endDate)}
                    </p>
                  </div>
                  {canManage && (
                    <button
                      onClick={() => checkInMember(m)}
                      className="bg-green-600 text-white rounded px-3 py-1.5 text-xs font-medium hover:bg-green-700 shrink-0"
                    >
                      Check in
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {checkInResults.length === 0 && checkInSearch.trim() && !checkInSearching && (
            <p className="text-sm text-gray-400 mt-2">No active members found.</p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)} className="border border-gray-300 rounded p-2 text-sm bg-white">
          <option value="">All services</option>
          {facilities.map((s) => (
            <option key={s.id} value={s.id}>{serviceDisplayName(s)}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-gray-300 rounded p-2 text-sm bg-white">
          <option value="">All statuses</option>
          {["ACTIVE", "EXPIRED", "SUSPENDED", "CANCELLED"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm py-6 text-center">Loading…</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2">Customer</th>
                <th className="px-4 py-2">Pass</th>
                <th className="px-4 py-2">Service</th>
                <th className="px-4 py-2">Start</th>
                <th className="px-4 py-2">End</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {memberships.map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="px-4 py-2">
                    <p className="font-medium text-gray-800">{m.customer?.name}</p>
                    <p className="text-xs text-gray-400">{m.customer?.phone || m.customer?.email || ""}</p>
                  </td>
                  <td className="px-4 py-2 text-gray-600">{m.membershipType?.name}</td>
                  <td className="px-4 py-2 text-gray-600">
                    {serviceDisplayName(m.membershipType?.hospitalityService)}
                  </td>
                  <td className="px-4 py-2 text-gray-600">{fmt(m.startDate)}</td>
                  <td className="px-4 py-2 text-gray-600">{fmt(m.endDate)}</td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_STYLES[m.status] ?? "bg-gray-100 text-gray-700"}`}>
                      {m.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {canManage && (
                      <>
                        <button onClick={() => openExtend(m)} className="text-xs text-blue-600 hover:underline mr-2">Extend</button>
                        {m.status !== "SUSPENDED" && (
                          <button onClick={() => changeStatus(m, "SUSPENDED")} className="text-xs text-amber-600 hover:underline mr-2">Suspend</button>
                        )}
                        {m.status === "SUSPENDED" && (
                          <button onClick={() => changeStatus(m, "ACTIVE")} className="text-xs text-green-600 hover:underline mr-2">Reactivate</button>
                        )}
                        <button onClick={() => changeStatus(m, "CANCELLED")} className="text-xs text-red-600 hover:underline">Cancel</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {memberships.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                    No memberships yet — assign your first one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}


      {assignOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-3">Assign Membership</h2>
            <form onSubmit={assign} className="space-y-3">
              <select
                value={assignForm.membershipTypeId}
                onChange={(e) => setAssignForm({ ...assignForm, membershipTypeId: e.target.value })}
                className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
                required
              >
                <option value="">Select pass plan…</option>
                {availableTypes.filter((t: any) => t.isActive).map((t: any) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({serviceDisplayName(t.hospitalityService)})
                  </option>
                ))}
              </select>
              <input
                value={assignForm.customerName}
                onChange={(e) => setAssignForm({ ...assignForm, customerName: e.target.value })}
                placeholder="Customer full name"
                className="border border-gray-300 rounded p-2 text-sm w-full"
                required
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={assignForm.phone}
                  onChange={(e) => setAssignForm({ ...assignForm, phone: e.target.value })}
                  placeholder="Phone"
                  className="border border-gray-300 rounded p-2 text-sm w-full"
                />
                <input
                  value={assignForm.email}
                  onChange={(e) => setAssignForm({ ...assignForm, email: e.target.value })}
                  placeholder="Email"
                  className="border border-gray-300 rounded p-2 text-sm w-full"
                />
              </div>
              <input
                type="date"
                value={assignForm.startDate}
                onChange={(e) => setAssignForm({ ...assignForm, startDate: e.target.value })}
                className="border border-gray-300 rounded p-2 text-sm w-full"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setAssignOpen(false)} className="px-3 py-2 text-sm text-gray-600">
                  Cancel
                </button>
                <button type="submit" className="bg-blue-600 text-white rounded px-3 py-2 text-sm font-medium">
                  Assign
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {extendFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-1">Extend Membership</h2>
            <p className="text-xs text-gray-400 mb-3">
              {extendFor.customer?.name} · {extendFor.membershipType?.name}
            </p>
            <form onSubmit={extend} className="space-y-3">
              <input
                type="date"
                value={extendDate}
                onChange={(e) => setExtendDate(e.target.value)}
                className="border border-gray-300 rounded p-2 text-sm w-full"
                required
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setExtendFor(null)} className="px-3 py-2 text-sm text-gray-600">
                  Cancel
                </button>
                <button type="submit" className="bg-gray-800 text-white rounded px-3 py-2 text-sm font-medium">
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {dayPassOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-1">Sell Day Pass / Register Walk-In</h2>
            <p className="text-xs text-gray-400 mb-3">
              Captures the guest and queues the payment for the cashier to confirm.
            </p>
            <form onSubmit={sellDayPass} className="space-y-3">
              <select
                value={dayPassForm.serviceId}
                onChange={(e) => {
                  const sid = e.target.value;
                  const firstType = types.find(
                    (t) => t.hospitalityServiceId === sid && t.isActive && t.durationDays <= 1,
                  );
                  setDayPassForm((prev) => ({ ...prev, serviceId: sid, typeId: firstType?.id ?? "" }));
                }}
                className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
                required
              >
                <option value="">Select facility…</option>
                {facilities.map((f) => (
                  <option key={f.id} value={f.id}>{facilityName(f)}</option>
                ))}
              </select>
              <input
                value={dayPassForm.guestName}
                onChange={(e) => setDayPassForm({ ...dayPassForm, guestName: e.target.value })}
                placeholder="Guest name"
                className="border border-gray-300 rounded p-2 text-sm w-full"
                required
              />
              <input
                value={dayPassForm.guestPhone}
                onChange={(e) => setDayPassForm({ ...dayPassForm, guestPhone: e.target.value })}
                placeholder="Phone (optional)"
                className="border border-gray-300 rounded p-2 text-sm w-full"
              />
              <select
                value={dayPassForm.typeId}
                onChange={(e) => setDayPassForm({ ...dayPassForm, typeId: e.target.value })}
                className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
                required
              >
                <option value="">Select day pass…</option>
                {types
                  .filter(
                    (t: any) =>
                      t.hospitalityServiceId === dayPassForm.serviceId &&
                      t.isActive &&
                      t.durationDays <= 1,
                  )
                  .map((t: any) => (
                    <option key={t.id} value={t.id}>{t.name} — {t.price}</option>
                  ))}
              </select>
              <select
                value={dayPassForm.paymentMethodId}
                onChange={(e) => setDayPassForm({ ...dayPassForm, paymentMethodId: e.target.value })}
                className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
              >
                <option value="">Payment method…</option>
                {paymentMethods.map((pm) => (
                  <option key={pm.id} value={pm.id}>{pm.name}</option>
                ))}
              </select>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setDayPassOpen(false)} className="px-3 py-2 text-sm text-gray-600">
                  Cancel
                </button>
                <button type="submit" className="bg-emerald-600 text-white rounded px-3 py-2 text-sm font-medium">
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

