"use client";

import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/app/components/ConfirmProvider";
import api from "@/lib/api";
import {
  hospitalityServiceName as serviceDisplayName,
  isMembershipCapableService as isMembershipCapable,
} from "@/lib/verticals";
import { useCallback, useEffect, useState } from "react";

export default function MembershipTypesPage() {
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
      setError(e?.response?.data?.message ?? "Failed to load membership types");
    } finally {
      setLoading(false);
    }
  }, [filter, activeOrganizationId]);

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
      setError(err?.response?.data?.message ?? "Failed to save membership type");
    }
  };

  const remove = async (t: any) => {
    if (!(await confirm(`Delete pass "${t.name}"?`))) return;
    try {
      await api.delete(`/hospitality/memberships/types/${t.id}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to delete membership type");
    }
  };

  const toggleActive = async (t: any) => {
    try {
      await api.patch(`/hospitality/memberships/types/${t.id}`, { isActive: !t.isActive });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to update pass");
    }
  };

  const membershipServices = services.filter((s) => isMembershipCapable(s));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-800">Membership Types</h1>
        {canManage && (
          <button onClick={openNew} className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-blue-700">
            + New Pass Plan
          </button>
        )}
      </div>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      <div className="flex flex-wrap items-center gap-2">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="border border-gray-300 rounded p-2 text-sm bg-white">
          <option value="">All services</option>
          {membershipServices.map((s) => (
            <option key={s.id} value={s.id}>{serviceDisplayName(s)}</option>
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
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Service</th>
                <th className="px-4 py-2">Duration</th>
                <th className="px-4 py-2">Price</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="px-4 py-2 font-medium text-gray-800">{t.name}</td>
                  <td className="px-4 py-2 text-gray-600">
                    {serviceDisplayName(t.hospitalityService)}
                  </td>
                  <td className="px-4 py-2 text-gray-600">{t.durationDays} days</td>
                  <td className="px-4 py-2 text-gray-600">{t.price}</td>
                  <td className="px-4 py-2">
                    {canManage ? (
                      <button
                        onClick={() => toggleActive(t)}
                        className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          t.isActive ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"
                        }`}
                      >
                        {t.isActive ? "Active" : "Inactive"}
                      </button>
                    ) : (
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          t.isActive ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"
                        }`}
                      >
                        {t.isActive ? "Active" : "Inactive"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {canManage && (
                      <>
                        <button onClick={() => openEdit(t)} className="text-xs text-blue-600 hover:underline mr-2">Edit</button>
                        <button onClick={() => remove(t)} className="text-xs text-red-600 hover:underline">Del</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {types.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                    No pass plans yet — add your first one.
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
            <h2 className="font-semibold text-gray-800 mb-3">{modal.id ? "Edit Pass Plan" : "New Pass Plan"}</h2>
            <form onSubmit={save} className="space-y-3">
              {!modal.id && (
                <select
                  value={form.serviceId}
                  onChange={(e) => setForm({ ...form, serviceId: e.target.value })}
                  className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
                  required
                >
                  <option value="">Select facility…</option>
                  {membershipServices.map((s) => (
                    <option key={s.id} value={s.id}>{serviceDisplayName(s)}</option>
                  ))}
                </select>
              )}
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Pass name (e.g. Monthly Gym Pass)"
                className="border border-gray-300 rounded p-2 text-sm w-full"
                required
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  min={1}
                  value={form.durationDays}
                  onChange={(e) => setForm({ ...form, durationDays: e.target.value })}
                  placeholder="Duration (days)"
                  className="border border-gray-300 rounded p-2 text-sm w-full"
                  required
                />
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  placeholder="Price"
                  className="border border-gray-300 rounded p-2 text-sm w-full"
                  required
                />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setModal(null)} className="px-3 py-2 text-sm text-gray-600">
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
    </div>
  );
}

