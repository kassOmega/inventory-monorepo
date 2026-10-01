"use client";

import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/app/components/ConfirmProvider";
import api from "@/lib/api";
import {
  hospitalityServiceName as serviceDisplayName,
  isMembershipCapableService as isMembershipCapable,
} from "@/lib/verticals";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export default function MembershipTypesPage() {
  const { t } = useTranslation();
  const { activeOrganizationId, hasPermission } = useAuth();
  const confirm = useConfirm();
  const canManage = hasPermission("memberships.manage");
  const [types, setTypes] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [filter, setFilter] = useState(""); // hospitalityServiceId
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<any>(null);
  const [form, setForm] = useState({ serviceId: "", name: "", durationDays: "30", price: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = filter ? `?serviceId=${filter}` : "";
      const [tRes, sRes] = await Promise.all([
        api.get(`/hospitality/memberships/types${qs}`),
        activeOrganizationId
          ? api.get(`/tenants/${activeOrganizationId}/services`)
          : Promise.resolve({ data: [] }),
      ]);
      setTypes(Array.isArray(tRes.data) ? tRes.data : []);
      setServices(
        (Array.isArray(sRes.data) ? sRes.data : []).filter((s: any) => s.isEnabled),
      );
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("hospitality.types.failedLoad"));
    } finally {
      setLoading(false);
    }
  }, [filter, activeOrganizationId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => {
    const defaultService =
      services.find((s) => isMembershipCapable(s)) ?? services[0] ?? null;
    setModal({ id: null });
    setForm({
      serviceId: defaultService?.id ?? "",
      name: "",
      durationDays: "30",
      price: "",
    });
  };
  const openEdit = (t: any) => {
    setModal({ id: t.id });
    setForm({
      serviceId: t.hospitalityServiceId ?? "",
      name: t.name,
      durationDays: String(t.durationDays),
      price: String(t.price),
    });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const payload: any = {
        name: form.name,
        durationDays: Number(form.durationDays) || 1,
        price: Number(form.price) || 0,
      };
      if (modal.id) await api.patch(`/hospitality/memberships/types/${modal.id}`, payload);
      else
        await api.post("/hospitality/memberships/types", {
          ...payload,
          hospitalityServiceId: form.serviceId,
        });
      setModal(null);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("hospitality.types.failedSave"));
    }
  };

  const remove = async (type: any) => {
    if (!(await confirm(t("hospitality.types.deleteConfirm", { name: type.name })))) return;
    try {
      await api.delete(`/hospitality/memberships/types/${type.id}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("hospitality.types.failedDelete"));
    }
  };

  const toggleActive = async (type: any) => {
    try {
      await api.patch(`/hospitality/memberships/types/${type.id}`, { isActive: !type.isActive });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("hospitality.types.failedUpdate"));
    }
  };

  const membershipServices = services.filter((s) => isMembershipCapable(s));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-800">{t("hospitality.types.title")}</h1>
        {canManage && (
          <button onClick={openNew} className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700">
            + {t("hospitality.types.newPassPlan")}
          </button>
        )}
      </div>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="border border-gray-300 rounded p-2 text-sm bg-white">
          <option value="">{t("hospitality.allServices")}</option>
          {membershipServices.map((s) => (
            <option key={s.id} value={s.id}>{serviceDisplayName(s)}</option>
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
                <th className="px-4 py-2">{t("common.name")}</th>
                <th className="px-4 py-2">{t("hospitality.service")}</th>
                <th className="px-4 py-2">{t("hospitality.duration")}</th>
                <th className="px-4 py-2">{t("common.price")}</th>
                <th className="px-4 py-2">{t("common.status")}</th>
                <th className="px-4 py-2 text-right">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {types.map((pt) => (
                <tr key={pt.id} className="border-t">
                  <td className="px-4 py-2 font-medium text-gray-800">{pt.name}</td>
                  <td className="px-4 py-2 text-gray-600">
                    {serviceDisplayName(pt.hospitalityService)}
                  </td>
                  <td className="px-4 py-2 text-gray-600">{t("hospitality.days", { days: pt.durationDays })}</td>
                  <td className="px-4 py-2 text-gray-600">{pt.price}</td>
                  <td className="px-4 py-2">
                    {canManage ? (
                      <button
                        onClick={() => toggleActive(pt)}
                        className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          pt.isActive ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"
                        }`}
                      >
                        {pt.isActive ? t("hospitality.active") : t("hospitality.inactive")}
                      </button>
                    ) : (
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          pt.isActive ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"
                        }`}
                      >
                        {pt.isActive ? t("hospitality.active") : t("hospitality.inactive")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {canManage && (
                      <>
                        <button onClick={() => openEdit(pt)} className="text-xs text-blue-600 hover:underline mr-2">{t("common.edit")}</button>
                        <button onClick={() => remove(pt)} className="text-xs text-red-600 hover:underline">{t("common.del")}</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {types.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                    {t("hospitality.types.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-3">{modal.id ? t("hospitality.types.editPassPlan") : t("hospitality.types.newPassPlan")}</h2>
            <form onSubmit={save} className="space-y-3">
              {!modal.id && (
                <select
                  value={form.serviceId}
                  onChange={(e) => setForm({ ...form, serviceId: e.target.value })}
                  className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
                  required
                >
                  <option value="">{t("hospitality.selectFacility")}</option>
                  {membershipServices.map((s) => (
                    <option key={s.id} value={s.id}>{serviceDisplayName(s)}</option>
                  ))}
                </select>
              )}
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t("hospitality.types.passNamePh")}
                className="border border-gray-300 rounded p-2 text-sm w-full"
                required
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  min={1}
                  value={form.durationDays}
                  onChange={(e) => setForm({ ...form, durationDays: e.target.value })}
                  placeholder={t("hospitality.types.durationPh")}
                  className="border border-gray-300 rounded p-2 text-sm w-full"
                  required
                />
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  placeholder={t("common.price")}
                  className="border border-gray-300 rounded p-2 text-sm w-full"
                  required
                />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setModal(null)} className="px-3 py-2 text-sm text-gray-600">
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

