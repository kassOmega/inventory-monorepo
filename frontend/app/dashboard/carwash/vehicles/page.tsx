"use client";

import api from "@/lib/api";
import Button from "@/app/components/Button";
import FilterPanel, { FilterSelect } from "@/app/components/FilterPanel";
import Modal from "@/app/components/Modal";
import SearchableSelect from "@/app/components/SearchableSelect";
import { useAuth } from "@/context/AuthContext";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useState } from "react";

export default function CarWashVehiclesPage() {
  const { hasPermission } = useAuth();
  const { t } = useTranslation();
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [form, setForm] = useState({ customerId: "", plateNumber: "", vehicleType: "Car" });
  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const canCreate = hasPermission("carwash.vehicles.create");
  const canEdit = hasPermission("carwash.vehicles.edit");
  const canDelete = hasPermission("carwash.vehicles.delete");

  const load = useCallback(async () => {
    try {
      const [v, c] = await Promise.all([api.get("/carwash/vehicles"), api.get("/customers")]);
      setVehicles(v.data);
      setCustomers(Array.isArray(c.data) ? c.data : []);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("carwash.failedLoad"));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const openEdit = (v: any) => {
    setEditing(v);
    setForm({ customerId: v.customerId ? String(v.customerId) : "", plateNumber: v.plateNumber, vehicleType: v.vehicleType });
    setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    const payload: any = {
      customerId: form.customerId ? Number(form.customerId) : null,
      plateNumber: form.plateNumber.trim(),
      vehicleType: form.vehicleType.trim() || "Car",
    };
    try {
      if (editing) await api.patch(`/carwash/vehicles/${editing.id}`, payload);
      else await api.post("/carwash/vehicles", payload);
      setOpen(false);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedSave"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    if (!confirm(t("carwash.deleteConfirm"))) return;
    setError("");
    setBusyId(id);
    try {
      await api.delete(`/carwash/vehicles/${id}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedDelete"));
    } finally {
      setBusyId(null);
    }
  };

  const filtered = vehicles.filter((v) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      (v.plateNumber ?? "").toLowerCase().includes(q) ||
      (v.vehicleType ?? "").toLowerCase().includes(q);
    const matchesCustomer = !customerFilter || String(v.customerId) === customerFilter;
    return matchesSearch && matchesCustomer;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">{t("carwash.vehicles")}</h1>
        {canCreate && (
          <button onClick={() => { setEditing(null); setForm({ customerId: "", plateNumber: "", vehicleType: "Car" }); setOpen(true); }} className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium">
            + {t("carwash.addVehicle")}
          </button>
        )}
      </div>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      <FilterPanel
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("carwash.plateNumber")}
        extra={
          <FilterSelect
            value={customerFilter}
            onChange={setCustomerFilter}
            label={t("carwash.customer")}
            allLabel={t("carwash.customer")}
            options={customers.map((c: any) => ({ value: String(c.id), label: c.name }))}
          />
        }
      />

      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.plateNumber")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.type")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.customer")}</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((v) => (
              <tr key={v.id}>
                <td className="px-4 py-2 font-medium whitespace-nowrap">{v.plateNumber}</td>
                <td className="px-4 py-2 whitespace-nowrap">{v.vehicleType}</td>
                <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{v.customer?.name ?? "—"}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {canEdit && <button onClick={() => openEdit(v)} className="text-xs text-blue-600 hover:underline mr-2">{t("carwash.edit")}</button>}
                  {canDelete && <Button variant="ghost" size="sm" loading={busyId === v.id} onClick={() => remove(v.id)} className="!px-0 text-xs text-red-600 hover:underline">{t("carwash.delete")}</Button>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">{t("carwash.noVehicles")}</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal isOpen={open} onClose={() => setOpen(false)} title={editing ? t("carwash.edit") : t("carwash.addVehicle")}>
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm text-gray-600">{t("carwash.plateNumber")}
            <input value={form.plateNumber} onChange={(e) => setForm({ ...form, plateNumber: e.target.value })} placeholder={t("carwash.plateNumber")} className="border border-gray-300 rounded p-2 text-sm w-full mt-1" required />
          </label>
          <label className="block text-sm text-gray-600">{t("carwash.vehicleType")}
            <input value={form.vehicleType} onChange={(e) => setForm({ ...form, vehicleType: e.target.value })} placeholder={t("carwash.vehicleType")} className="border border-gray-300 rounded p-2 text-sm w-full mt-1" />
          </label>
          <label className="block text-sm text-gray-600">{t("carwash.customerOptional")}
            <SearchableSelect value={form.customerId} onChange={(v) => setForm({ ...form, customerId: v })} options={customers.map((c) => ({ value: String(c.id), label: c.name }))} placeholder={t("carwash.customerOptional")} />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-sm text-gray-600">{t("carwash.cancel")}</button>
            <Button type="submit" loading={saving} shape="rounded">{editing ? t("carwash.edit") : t("carwash.addVehicle")}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
