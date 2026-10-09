"use client";

import api from "@/lib/api";
import Button from "@/app/components/Button";
import FilterPanel, { FilterSelect } from "@/app/components/FilterPanel";
import Modal from "@/app/components/Modal";
import { useAuth } from "@/context/AuthContext";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useState } from "react";

const EMPTY = { name: "", email: "", phone: "", password: "", commissionRate: "50", isActive: true };

export default function CarWashWashersPage() {
  const { hasPermission } = useAuth();
  const { t } = useTranslation();
  const [washers, setWashers] = useState<any[]>([]);
  const [form, setForm] = useState({ ...EMPTY });
  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const canCreate = hasPermission("carwash.washers.create");
  const canEdit = hasPermission("carwash.washers.edit");
  const canDelete = hasPermission("carwash.washers.delete");

  const load = useCallback(async () => {
    try {
      const r = await api.get("/carwash/washers");
      setWashers(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("carwash.failedLoad"));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY });
    setOpen(true);
  };

  const openEdit = (w: any) => {
    setEditing(w);
    setForm({
      name: w.name,
      email: w.user?.email ?? "",
      phone: w.phone ?? "",
      password: "",
      commissionRate: String(w.commissionRate),
      isActive: w.isActive,
    });
    setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const payload: any = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || undefined,
      commissionRate: Number(form.commissionRate) || 0,
      isActive: form.isActive,
    };
    if (form.password.trim()) payload.password = form.password.trim();
    setSaving(true);
    try {
      if (editing) await api.patch(`/carwash/washers/${editing.id}`, payload);
      else await api.post("/carwash/washers", payload);
      setOpen(false);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedSave"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm(t("carwash.deleteWasherConfirm"))) return;
    setError("");
    setBusyId(id);
    try {
      await api.delete(`/carwash/washers/${id}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedDelete"));
    } finally {
      setBusyId(null);
    }
  };

  const filtered = washers.filter((w) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      (w.name ?? "").toLowerCase().includes(q) ||
      (w.user?.email ?? "").toLowerCase().includes(q);
    const matchesStatus =
      !statusFilter ||
      (statusFilter === "active" ? w.isActive !== false : w.isActive === false);
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">{t("carwash.washers")}</h1>
        {canCreate && (
          <button onClick={openCreate} className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium">
            + {t("carwash.addWasher")}
          </button>
        )}
      </div>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      <FilterPanel
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("carwash.name")}
        extra={
          <FilterSelect
            value={statusFilter}
            onChange={setStatusFilter}
            label={t("carwash.status")}
            allLabel={t("carwash.allStatus")}
            options={[
              { value: "active", label: t("carwash.active") },
              { value: "inactive", label: t("carwash.inactive") },
            ]}
          />
        }
      />

      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.name")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.loginEmail")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.phone")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.commission")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.status")}</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((w) => (
              <tr key={w.id}>
                <td className="px-4 py-2 font-medium whitespace-nowrap">{w.name}</td>
                <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{w.user?.email ?? "—"}</td>
                <td className="px-4 py-2 whitespace-nowrap">{w.phone ?? "—"}</td>
                <td className="px-4 py-2 whitespace-nowrap">{w.commissionRate}%</td>
                <td className="px-4 py-2 whitespace-nowrap">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${w.isActive ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"}`}>
                    {w.isActive ? t("carwash.active") : t("carwash.inactive")}
                  </span>
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {canEdit && <button onClick={() => openEdit(w)} className="text-xs text-blue-600 hover:underline mr-2">{t("carwash.edit")}</button>}
                  {canDelete && <Button variant="ghost" size="sm" loading={busyId === w.id} onClick={() => remove(w.id)} className="!px-0 text-xs text-red-600 hover:underline">{t("carwash.delete")}</Button>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">{t("carwash.noWashers")}</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal isOpen={open} onClose={() => setOpen(false)} title={editing ? t("carwash.edit") : t("carwash.addWasher")}>
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm text-gray-600">{t("carwash.fullName")}
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("carwash.fullName")} className="border border-gray-300 rounded p-2 text-sm w-full mt-1" required />
          </label>
          <label className="block text-sm text-gray-600">{t("carwash.loginEmail")}
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder={t("carwash.loginEmail")} type="email" className="border border-gray-300 rounded p-2 text-sm w-full mt-1" required />
          </label>
          <label className="block text-sm text-gray-600">{t("carwash.phone")}
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder={t("carwash.phone")} className="border border-gray-300 rounded p-2 text-sm w-full mt-1" />
          </label>
          <label className="block text-sm text-gray-600">{t("carwash.password")}
            <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={t("carwash.password")} type="text" className="border border-gray-300 rounded p-2 text-sm w-full mt-1" />
          </label>
          <label className="block text-sm text-gray-600">{t("carwash.commission")}
            <input value={form.commissionRate} onChange={(e) => setForm({ ...form, commissionRate: e.target.value })} placeholder={t("carwash.commission")} type="number" min="0" className="border border-gray-300 rounded p-2 text-sm w-full mt-1" />
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            {t("carwash.active")}
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-sm text-gray-600">{t("carwash.cancel")}</button>
            <Button type="submit" loading={saving} shape="rounded">{editing ? t("carwash.edit") : t("carwash.addWasher")}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
