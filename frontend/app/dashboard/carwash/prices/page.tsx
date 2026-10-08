"use client";

import api from "@/lib/api";
import FilterPanel, { FilterSelect } from "@/app/components/FilterPanel";
import Modal from "@/app/components/Modal";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useAuth } from "@/context/AuthContext";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useState } from "react";

export default function CarWashPricesPage() {
  const { hasPermission } = useAuth();
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [washTypeOpen, setWashTypeOpen] = useState(false);
  const [editingWashType, setEditingWashType] = useState<any | null>(null);
  const [prices, setPrices] = useState<any[]>([]);
  const [washTypes, setWashTypes] = useState<any[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<any[]>([]);
  const [form, setForm] = useState({ vehicleType: "", washTypeId: "", amount: "" });
  const [washTypeForm, setWashTypeForm] = useState("");
  const [vehicleTypeOpen, setVehicleTypeOpen] = useState(false);
  const [editingVehicleType, setEditingVehicleType] = useState<any | null>(null);
  const [vehicleTypeForm, setVehicleTypeForm] = useState("");
  const [newWashType, setNewWashType] = useState("");
  const [showNewWashType, setShowNewWashType] = useState(false);
  const [newVehicleType, setNewVehicleType] = useState("");
  const [showNewVehicleType, setShowNewVehicleType] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [vehicleTypeFilter, setVehicleTypeFilter] = useState("");
  const [washTypeFilter, setWashTypeFilter] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"prices" | "washTypes" | "vehicleTypes">("prices");

  const canWrite = hasPermission("carwash.prices.create") || hasPermission("carwash.prices.edit");
  const canDelete = hasPermission("carwash.prices.delete");

  const load = useCallback(async () => {
    try {
      const [p, w, v] = await Promise.all([
        api.get("/carwash/prices"),
        api.get("/carwash/wash-types"),
        api.get("/carwash/vehicle-types"),
      ]);
      setPrices(p.data);
      setWashTypes(w.data);
      setVehicleTypes(v.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("carwash.failedLoad"));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const openEdit = (p: any) => {
    setEditing(p);
    setForm({ vehicleType: p.vehicleType, washTypeId: p.washTypeId ? String(p.washTypeId) : "", amount: String(p.amount) });
    setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api.post("/carwash/prices", {
        vehicleType: form.vehicleType,
        washTypeId: form.washTypeId ? Number(form.washTypeId) : null,
        amount: Number(form.amount) || 0,
      });
      setOpen(false);
      setForm({ vehicleType: "", washTypeId: "", amount: "" });
      setEditing(null);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedSave"));
    }
  };

  const remove = async (id: number) => {
    if (!(await confirm(t("carwash.deleteConfirm")))) return;
    setError("");
    try {
      await api.delete(`/carwash/prices/${id}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedDelete"));
    }
  };

  const openWashTypeModal = (w: any | null) => {
    setEditingWashType(w);
    setWashTypeForm(w ? w.name : "");
    setWashTypeOpen(true);
  };

  const submitWashType = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      if (editingWashType) {
        await api.patch(`/carwash/wash-types/${editingWashType.id}`, { name: washTypeForm.trim() });
      } else {
        await api.post("/carwash/wash-types", { name: washTypeForm.trim() });
      }
      setWashTypeOpen(false);
      setEditingWashType(null);
      setWashTypeForm("");
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedSave"));
    }
  };

  const removeWashType = async (w: any) => {
    if (!(await confirm(t("carwash.deleteConfirm")))) return;
    setError("");
    try {
      await api.delete(`/carwash/wash-types/${w.id}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedDelete"));
    }
  };

  const openVehicleTypeModal = (v: any | null) => {
    setEditingVehicleType(v);
    setVehicleTypeForm(v ? v.name : "");
    setVehicleTypeOpen(true);
  };

  const submitVehicleType = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      if (editingVehicleType) {
        await api.patch(`/carwash/vehicle-types/${editingVehicleType.id}`, { name: vehicleTypeForm.trim() });
      } else {
        await api.post("/carwash/vehicle-types", { name: vehicleTypeForm.trim() });
      }
      setVehicleTypeOpen(false);
      setEditingVehicleType(null);
      setVehicleTypeForm("");
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedSave"));
    }
  };

  const removeVehicleType = async (v: any) => {
    if (!(await confirm(t("carwash.deleteConfirm")))) return;
    setError("");
    try {
      await api.delete(`/carwash/vehicle-types/${v.id}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedDelete"));
    }
  };

  const createVehicleTypeInline = async () => {
    const name = newVehicleType.trim();
    if (!name) return;
    setError("");
    try {
      await api.post("/carwash/vehicle-types", { name });
      setForm((f) => ({ ...f, vehicleType: name }));
      setNewVehicleType("");
      setShowNewVehicleType(false);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedSave"));
    }
  };

  const createWashTypeInline = async () => {
    const name = newWashType.trim();
    if (!name) return;
    setError("");
    try {
      const r = await api.post("/carwash/wash-types", { name });
      setForm((f) => ({ ...f, washTypeId: String(r.data.id) }));
      setNewWashType("");
      setShowNewWashType(false);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedSave"));
    }
  };

  const filtered = prices.filter((p) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      (p.vehicleType ?? "").toLowerCase().includes(q) ||
      (p.washType?.name ?? "").toLowerCase().includes(q);
    const matchesVehicleType =
      !vehicleTypeFilter || (p.vehicleType ?? "") === vehicleTypeFilter;
    const matchesWashType =
      !washTypeFilter || String(p.washTypeId) === washTypeFilter;
    return matchesSearch && matchesVehicleType && matchesWashType;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">{t("carwash.prices")}</h1>
        {canWrite && (
          <button onClick={() => { setEditing(null); setForm({ vehicleType: vehicleTypes[0] ? vehicleTypes[0].name : "", washTypeId: washTypes[0] ? String(washTypes[0].id) : "", amount: "" }); setOpen(true); }} className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium">
            + {t("carwash.addPrice")}
          </button>
        )}
      </div>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      <div className="flex gap-1 border-b border-gray-200">
        <button type="button" onClick={() => setTab("prices")} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === "prices" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>{t("carwash.prices")}</button>
        <button type="button" onClick={() => setTab("washTypes")} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === "washTypes" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>{t("carwash.washTypes")}</button>
        <button type="button" onClick={() => setTab("vehicleTypes")} className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === "vehicleTypes" ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>{t("carwash.vehicleTypes")}</button>
      </div>

      {tab === "washTypes" && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-800">{t("carwash.washTypes")}</h2>
            {canWrite && (
              <button onClick={() => openWashTypeModal(null)} className="bg-blue-600 text-white rounded px-3 py-2 text-sm font-medium">
                + {t("carwash.addWashType")}
              </button>
            )}
          </div>
          {washTypes.length === 0 ? (
            <p className="text-sm text-gray-400">{t("carwash.noWashTypes")}</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {washTypes.map((w) => (
                <li key={w.id} className="flex items-center justify-between py-2.5">
                  <span className="text-sm font-medium text-gray-700">{w.name}</span>
                  <div className="flex gap-3">
                    {canWrite && <button onClick={() => openWashTypeModal(w)} className="text-xs text-blue-600 hover:underline">{t("carwash.edit")}</button>}
                    {canDelete && <button onClick={() => removeWashType(w)} className="text-xs text-red-600 hover:underline">{t("carwash.delete")}</button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "vehicleTypes" && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-800">{t("carwash.vehicleTypes")}</h2>
            {canWrite && (
              <button onClick={() => openVehicleTypeModal(null)} className="bg-blue-600 text-white rounded px-3 py-2 text-sm font-medium">
                + {t("carwash.addVehicleType")}
              </button>
            )}
          </div>
          {vehicleTypes.length === 0 ? (
            <p className="text-sm text-gray-400">{t("carwash.noVehicleTypes")}</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {vehicleTypes.map((v) => (
                <li key={v.id} className="flex items-center justify-between py-2.5">
                  <span className="text-sm font-medium text-gray-700">{v.name}</span>
                  <div className="flex gap-3">
                    {canWrite && <button onClick={() => openVehicleTypeModal(v)} className="text-xs text-blue-600 hover:underline">{t("carwash.edit")}</button>}
                    {canDelete && <button onClick={() => removeVehicleType(v)} className="text-xs text-red-600 hover:underline">{t("carwash.delete")}</button>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "prices" && (
        <>
          <FilterPanel
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder={t("carwash.vehicleType")}
            extra={
              <>
                <FilterSelect
                  value={vehicleTypeFilter}
                  onChange={setVehicleTypeFilter}
                  label={t("carwash.vehicleType")}
                  allLabel={t("carwash.allVehicleTypes")}
                  options={vehicleTypes.map((v: any) => ({ value: v.name, label: v.name }))}
                />
                <FilterSelect
                  value={washTypeFilter}
                  onChange={setWashTypeFilter}
                  label={t("carwash.washType")}
                  allLabel={t("carwash.allWashTypes")}
                  options={washTypes.map((w: any) => ({ value: String(w.id), label: w.name }))}
                />
              </>
            }
          />

          <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.vehicleType")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.washType")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.amount")}</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2 font-medium whitespace-nowrap">{p.vehicleType}</td>
                <td className="px-4 py-2 whitespace-nowrap">{p.washType?.name ?? "—"}</td>
                <td className="px-4 py-2 whitespace-nowrap">{p.amount}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {canWrite && <button onClick={() => openEdit(p)} className="text-xs text-blue-600 hover:underline mr-2">{t("carwash.edit")}</button>}
                  {canDelete && <button onClick={() => remove(p.id)} className="text-xs text-red-600 hover:underline">{t("carwash.delete")}</button>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">{t("carwash.noPrices")}</td></tr>}
          </tbody>
        </table>
          </div>
        </>
      )}

      <Modal isOpen={open} onClose={() => setOpen(false)} title={editing ? t("carwash.edit") : t("carwash.addPrice")}>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <div className="flex gap-2">
              <select value={form.vehicleType} onChange={(e) => setForm({ ...form, vehicleType: e.target.value })} className="border border-gray-300 rounded p-2 text-sm flex-1 bg-white" required>
                <option value="">{t("carwash.vehicleType")}</option>
                {vehicleTypes.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
              </select>
              <button type="button" onClick={() => setShowNewVehicleType(!showNewVehicleType)} className="border border-gray-300 rounded px-3 text-gray-600 font-bold">+</button>
            </div>
            {showNewVehicleType && (
              <div className="flex gap-2 mt-1">
                <input value={newVehicleType} onChange={(e) => setNewVehicleType(e.target.value)} placeholder={t("carwash.addVehicleType")} className="border border-gray-300 rounded p-2 text-sm flex-1" autoFocus />
                <button type="button" onClick={createVehicleTypeInline} className="bg-gray-800 text-white rounded px-3 text-sm">✓</button>
              </div>
            )}
          </div>

          <div>
            <div className="flex gap-2">
              <select value={form.washTypeId} onChange={(e) => setForm({ ...form, washTypeId: e.target.value })} className="border border-gray-300 rounded p-2 text-sm flex-1 bg-white">
                <option value="">{t("carwash.washType")}</option>
                {washTypes.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <button type="button" onClick={() => setShowNewWashType(!showNewWashType)} className="border border-gray-300 rounded px-3 text-gray-600 font-bold">+</button>
            </div>
            {showNewWashType && (
              <div className="flex gap-2 mt-1">
                <input value={newWashType} onChange={(e) => setNewWashType(e.target.value)} placeholder={t("carwash.addWashType")} className="border border-gray-300 rounded p-2 text-sm flex-1" autoFocus />
                <button type="button" onClick={createWashTypeInline} className="bg-gray-800 text-white rounded px-3 text-sm">✓</button>
              </div>
            )}
          </div>
          <label className="block text-sm text-gray-600">{t("carwash.amount")}
            <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder={t("carwash.amount")} type="number" min="0" className="border border-gray-300 rounded p-2 text-sm w-full mt-1" required />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-sm text-gray-600">{t("carwash.cancel")}</button>
            <button type="submit" className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium">{t("carwash.saveSettings")}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={washTypeOpen} onClose={() => setWashTypeOpen(false)} title={editingWashType ? t("carwash.edit") : t("carwash.addWashType")}>
        <form onSubmit={submitWashType} className="space-y-3">
          <label className="block text-sm text-gray-600">{t("carwash.washType")}
            <input value={washTypeForm} onChange={(e) => setWashTypeForm(e.target.value)} className="border border-gray-300 rounded p-2 text-sm w-full mt-1" required autoFocus />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setWashTypeOpen(false)} className="px-3 py-2 text-sm text-gray-600">{t("carwash.cancel")}</button>
            <button type="submit" className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium">{t("carwash.saveSettings")}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={vehicleTypeOpen} onClose={() => setVehicleTypeOpen(false)} title={editingVehicleType ? t("carwash.edit") : t("carwash.addVehicleType")}>
        <form onSubmit={submitVehicleType} className="space-y-3">
          <label className="block text-sm text-gray-600">{t("carwash.vehicleType")}
            <input value={vehicleTypeForm} onChange={(e) => setVehicleTypeForm(e.target.value)} className="border border-gray-300 rounded p-2 text-sm w-full mt-1" required autoFocus />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setVehicleTypeOpen(false)} className="px-3 py-2 text-sm text-gray-600">{t("carwash.cancel")}</button>
            <button type="submit" className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium">{t("carwash.saveSettings")}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
