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
import { useTranslation } from "react-i18next";

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700",
  EXPIRED: "bg-gray-200 text-gray-500",
  SUSPENDED: "bg-amber-100 text-amber-700",
  CANCELLED: "bg-red-100 text-red-700",
};

const MEMBERSHIP_STATUSES = ["ACTIVE", "EXPIRED", "SUSPENDED", "CANCELLED"] as const;

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "status.active",
  EXPIRED: "status.expired",
  SUSPENDED: "status.suspended",
  CANCELLED: "status.cancelled",
};

export default function CustomerMembershipsPage() {
  const { t } = useTranslation();
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
      setError(e?.response?.data?.message ?? t("hospitality.mem.failedLoad"));
    } finally {
      setLoading(false);
    }
  }, [serviceFilter, statusFilter, activeOrganizationId, t]);

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
      setError(err?.response?.data?.message ?? t("hospitality.mem.failedAssign"));
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
      setError(err?.response?.data?.message ?? t("hospitality.mem.failedUpdate"));
    }
  };

  const changeStatus = async (m: any, status: string) => {
    if (
      status === "CANCELLED" &&
      !(await confirm(t("hospitality.mem.cancelConfirm", { name: m.customer?.name })))
    )
      return;
    setError("");
    try {
      await api.patch(`/hospitality/memberships/${m.id}`, { status });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("hospitality.mem.failedUpdate"));
    }
  };

  const facilityName = (s: any) =>
    s?.customName ??
    (HOSPITALITY_SERVICE_LABELS[s.serviceType] ?? s.serviceType ?? t("hospitality.mem.facility"));

  const statusLabel = (s: string) => (STATUS_LABELS[s] ? t(STATUS_LABELS[s]) : s);

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
      setError(err?.response?.data?.message ?? t("facility.failedSellDayPass"));
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
      setError(e?.response?.data?.message ?? t("facility.failedSearchMembers"));
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
      setError(e?.response?.data?.message ?? t("facility.failedCheckIn"));
    }
  };

  const availableTypes = types.filter(
    (t: any) => !serviceFilter || t.hospitalityServiceId === serviceFilter,
  );
  const fmt = (d: string) => (d ? d.slice(0, 10) : "-");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-800">{t("hospitality.mem.title")}</h1>
        <div className="flex items-center gap-2">
          {canManage && (
            <button
              onClick={openDayPass}
              className="bg-emerald-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-emerald-700"
            >
              {t("facility.sellDayPassTitle")}
            </button>
          )}
          {canManage && (
            <button onClick={openAssign} className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700">
              + {t("hospitality.mem.newBtn")}
            </button>
          )}
        </div>
      </div>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      {/* Check-in member search */}
      {facilities.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h2 className="font-semibold text-gray-800 mb-2">{t("facility.checkInMember")}</h2>
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
              placeholder={t("facility.searchMembersPh")}
              className="border border-gray-300 rounded p-2 text-sm flex-1"
            />
            <button
              onClick={searchCheckIn}
              disabled={checkInSearching}
              className="bg-gray-800 text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-60"
            >
              {checkInSearching ? t("facility.searching") : t("filters.search")}
            </button>
          </div>
          {checkInResults.length > 0 && (
            <ul className="divide-y divide-gray-100 mt-3 border border-gray-100 rounded-lg max-h-52 overflow-y-auto">
              {checkInResults.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{m.customer?.name}</p>
                    <p className="text-xs text-gray-400">
                      {m.customer?.phone || ""} · {m.membershipType?.name}
                      {t("facility.endsOn", { date: fmt(m.endDate) })}
                    </p>
                  </div>
                  {canManage && (
                    <button
                      onClick={() => checkInMember(m)}
                      className="bg-green-600 text-white rounded px-3 py-1.5 text-xs font-medium hover:bg-green-700 shrink-0"
                    >
                      {t("facility.checkIn")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {checkInResults.length === 0 && checkInSearch.trim() && !checkInSearching && (
            <p className="text-sm text-gray-400 mt-2">{t("facility.noActiveMembers")}</p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)} className="border border-gray-300 rounded p-2 text-sm bg-white">
          <option value="">{t("hospitality.allServices")}</option>
          {facilities.map((s) => (
            <option key={s.id} value={s.id}>{serviceDisplayName(s)}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-gray-300 rounded p-2 text-sm bg-white">
          <option value="">{t("orders.allStatuses")}</option>
          {MEMBERSHIP_STATUSES.map((s) => (
            <option key={s} value={s}>{statusLabel(s)}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm py-6 text-center">{t("common.loading")}</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2">{t("common.customer")}</th>
                <th className="px-4 py-2">{t("hospitality.pass")}</th>
                <th className="px-4 py-2">{t("hospitality.service")}</th>
                <th className="px-4 py-2">{t("hospitality.start")}</th>
                <th className="px-4 py-2">{t("hospitality.end")}</th>
                <th className="px-4 py-2">{t("common.status")}</th>
                <th className="px-4 py-2 text-right">{t("common.actions")}</th>
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
                      {statusLabel(m.status)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {canManage && (
                      <>
                        <button onClick={() => openExtend(m)} className="text-xs text-blue-600 hover:underline mr-2">{t("hospitality.mem.extend")}</button>
                        {m.status !== "SUSPENDED" && (
                          <button onClick={() => changeStatus(m, "SUSPENDED")} className="text-xs text-amber-600 hover:underline mr-2">{t("hospitality.mem.suspend")}</button>
                        )}
                        {m.status === "SUSPENDED" && (
                          <button onClick={() => changeStatus(m, "ACTIVE")} className="text-xs text-green-600 hover:underline mr-2">{t("hospitality.mem.reactivate")}</button>
                        )}
                        <button onClick={() => changeStatus(m, "CANCELLED")} className="text-xs text-red-600 hover:underline">{t("common.cancel")}</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {memberships.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                    {t("hospitality.mem.empty")}
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
            <h2 className="font-semibold text-gray-800 mb-3">{t("hospitality.mem.assignTitle")}</h2>
            <form onSubmit={assign} className="space-y-3">
              <select
                value={assignForm.membershipTypeId}
                onChange={(e) => setAssignForm({ ...assignForm, membershipTypeId: e.target.value })}
                className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
                required
              >
                <option value="">{t("hospitality.mem.selectPassPlan")}</option>
                {availableTypes.filter((tp: any) => tp.isActive).map((tp: any) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.name} ({serviceDisplayName(tp.hospitalityService)})
                  </option>
                ))}
              </select>
              <input
                value={assignForm.customerName}
                onChange={(e) => setAssignForm({ ...assignForm, customerName: e.target.value })}
                placeholder={t("hospitality.mem.customerNamePh")}
                className="border border-gray-300 rounded p-2 text-sm w-full"
                required
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={assignForm.phone}
                  onChange={(e) => setAssignForm({ ...assignForm, phone: e.target.value })}
                  placeholder={t("common.phone")}
                  className="border border-gray-300 rounded p-2 text-sm w-full"
                />
                <input
                  value={assignForm.email}
                  onChange={(e) => setAssignForm({ ...assignForm, email: e.target.value })}
                  placeholder={t("common.email")}
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
                  {t("common.cancel")}
                </button>
                <button type="submit" className="bg-blue-600 text-white rounded px-3 py-2 text-sm font-medium">
                  {t("menu.assign")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {extendFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-1">{t("hospitality.mem.extendTitle")}</h2>
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

      {dayPassOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-1">{t("hospitality.mem.dayPassTitle")}</h2>
            <p className="text-xs text-gray-400 mb-3">
              {t("hospitality.mem.dayPassHint")}
            </p>
            <form onSubmit={sellDayPass} className="space-y-3">
              <select
                value={dayPassForm.serviceId}
                onChange={(e) => {
                  const sid = e.target.value;
                  const firstType = types.find(
                    (tp) => tp.hospitalityServiceId === sid && tp.isActive && tp.durationDays <= 1,
                  );
                  setDayPassForm((prev) => ({ ...prev, serviceId: sid, typeId: firstType?.id ?? "" }));
                }}
                className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
                required
              >
                <option value="">{t("hospitality.selectFacility")}</option>
                {facilities.map((f) => (
                  <option key={f.id} value={f.id}>{facilityName(f)}</option>
                ))}
              </select>
              <input
                value={dayPassForm.guestName}
                onChange={(e) => setDayPassForm({ ...dayPassForm, guestName: e.target.value })}
                placeholder={t("hotel.guestName")}
                className="border border-gray-300 rounded p-2 text-sm w-full"
                required
              />
              <input
                value={dayPassForm.guestPhone}
                onChange={(e) => setDayPassForm({ ...dayPassForm, guestPhone: e.target.value })}
                placeholder={t("hotel.phoneOptional")}
                className="border border-gray-300 rounded p-2 text-sm w-full"
              />
              <select
                value={dayPassForm.typeId}
                onChange={(e) => setDayPassForm({ ...dayPassForm, typeId: e.target.value })}
                className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
                required
              >
                <option value="">{t("facility.selectDayPass")}</option>
                {types
                  .filter(
                    (tp: any) =>
                      tp.hospitalityServiceId === dayPassForm.serviceId &&
                      tp.isActive &&
                      tp.durationDays <= 1,
                  )
                  .map((tp: any) => (
                    <option key={tp.id} value={tp.id}>{tp.name} — {tp.price}</option>
                  ))}
              </select>
              <select
                value={dayPassForm.paymentMethodId}
                onChange={(e) => setDayPassForm({ ...dayPassForm, paymentMethodId: e.target.value })}
                className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
              >
                <option value="">{t("facility.paymentMethodPh")}</option>
                {paymentMethods.map((pm) => (
                  <option key={pm.id} value={pm.id}>{pm.name}</option>
                ))}
              </select>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setDayPassOpen(false)} className="px-3 py-2 text-sm text-gray-600">
                  {t("common.cancel")}
                </button>
                <button type="submit" className="bg-emerald-600 text-white rounded px-3 py-2 text-sm font-medium">
                  {t("facility.sellAndCheckIn")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

