"use client";

import api from "@/lib/api";
import { CheckboxField, ListFilters, SearchField } from "@/app/components/ListFilters";
import Modal from "@/app/components/Modal";
import { useAuth } from "@/context/AuthContext";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useState } from "react";

export default function CarWashStoreItemsPage() {
  const { hasPermission } = useAuth();
  const { t } = useTranslation();
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", sellingPrice: "", stock: "", minimumStock: "" });
  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [error, setError] = useState("");

  const canWrite = hasPermission("carwash.equipment.issue");
  const canDelete = hasPermission("carwash.equipment.delete");

  const stockOf = (p: any) => (p.inventory ?? []).reduce((s: number, i: any) => s + (i.quantity ?? 0), 0);

  const load = useCallback(async () => {
    try {
      const r = await api.get("/carwash/store-items");
      setItems(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("carwash.failedLoad"));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const openEdit = (p: any) => {
    setEditing(p);
    setForm({
      name: p.baseName,
      sellingPrice: String(p.currentSellPrice ?? 0),
      stock: String(stockOf(p)),
      minimumStock: String(p.reorderLevel ?? 0),
    });
    setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const payload: any = {
      name: form.name.trim(),
      sellingPrice: Number(form.sellingPrice) || 0,
      stock: form.stock === "" ? undefined : Number(form.stock) || 0,
      minimumStock: form.minimumStock === "" ? undefined : Number(form.minimumStock) || 0,
    };
    try {
      if (editing) await api.patch(`/carwash/store-items/${editing.id}`, payload);
      else await api.post("/carwash/store-items", payload);
      setOpen(false);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedSave"));
    }
  };

  const remove = async (id: number) => {
    if (!confirm(t("carwash.deleteConfirm"))) return;
    setError("");
    try {
      await api.delete(`/carwash/store-items/${id}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedDelete"));
    }
  };

  const filtered = items.filter((p) => {
    const stock = stockOf(p);
    const q = search.toLowerCase();
    const matchesSearch = !q || (p.baseName ?? "").toLowerCase().includes(q);
    const matchesLow = !lowOnly || stock <= (p.reorderLevel ?? 0);
    return matchesSearch && matchesLow;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">{t("carwash.storeItems")}</h1>
        {canWrite && (
          <button onClick={() => { setEditing(null); setForm({ name: "", sellingPrice: "", stock: "", minimumStock: "" }); setOpen(true); }} className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium">
            + {t("carwash.addStoreItem")}
          </button>
        )}
      </div>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      <ListFilters>
        <SearchField value={search} onChange={setSearch} placeholder={t("carwash.name")} />
        <CheckboxField checked={lowOnly} onChange={setLowOnly} label={t("carwash.minimumStock")} />
      </ListFilters>

      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.name")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.sellingPrice")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.stock")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.minimumStock")}</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((p) => {
              const stock = stockOf(p);
              const low = stock <= (p.reorderLevel ?? 0);
              return (
                <tr key={p.id}>
                  <td className="px-4 py-2 font-medium whitespace-nowrap">{p.baseName}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{p.currentSellPrice}</td>
                  <td className={`px-4 py-2 whitespace-nowrap ${low ? "text-red-600 font-semibold" : ""}`}>{stock}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{p.reorderLevel ?? 0}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {canWrite && <button onClick={() => openEdit(p)} className="text-xs text-blue-600 hover:underline mr-2">{t("carwash.edit")}</button>}
                    {canDelete && <button onClick={() => remove(p.id)} className="text-xs text-red-600 hover:underline">{t("carwash.delete")}</button>}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">{t("carwash.noEquipment")}</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal isOpen={open} onClose={() => setOpen(false)} title={editing ? t("carwash.edit") : t("carwash.addStoreItem")}>
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm text-gray-600">{t("carwash.name")}
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="border border-gray-300 rounded p-2 text-sm w-full mt-1" required />
          </label>
          <label className="block text-sm text-gray-600">{t("carwash.sellingPrice")}
            <input value={form.sellingPrice} onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })} type="number" min="0" className="border border-gray-300 rounded p-2 text-sm w-full mt-1" />
          </label>
          <label className="block text-sm text-gray-600">{t("carwash.stock")}
            <input value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} type="number" min="0" className="border border-gray-300 rounded p-2 text-sm w-full mt-1" />
          </label>
          <label className="block text-sm text-gray-600">{t("carwash.minimumStock")}
            <input value={form.minimumStock} onChange={(e) => setForm({ ...form, minimumStock: e.target.value })} type="number" min="0" className="border border-gray-300 rounded p-2 text-sm w-full mt-1" />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-sm text-gray-600">{t("carwash.cancel")}</button>
            <button type="submit" className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium">{editing ? t("carwash.edit") : t("carwash.addStoreItem")}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
