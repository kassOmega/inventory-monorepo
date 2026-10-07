"use client";

import api from "@/lib/api";
import { ListFilters, SelectField } from "@/app/components/ListFilters";
import Modal from "@/app/components/Modal";
import SearchableSelect from "@/app/components/SearchableSelect";
import { useAuth } from "@/context/AuthContext";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useState } from "react";

export default function CarWashEquipmentPage() {
  const { hasPermission } = useAuth();
  const { t } = useTranslation();
  const [issues, setIssues] = useState<any[]>([]);
  const [washers, setWashers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [form, setForm] = useState({ washerId: "", productId: "", quantity: "", unitPrice: "" });
  const [open, setOpen] = useState(false);
  const [paidFilter, setPaidFilter] = useState("");
  const [error, setError] = useState("");

  const canIssue = hasPermission("carwash.equipment.issue");
  const canEdit = hasPermission("carwash.equipment.edit");
  const canDelete = hasPermission("carwash.equipment.delete");

  const load = useCallback(async () => {
    try {
      const [i, w] = await Promise.all([api.get("/carwash/equipment-issues"), api.get("/carwash/washers")]);
      setIssues(i.data);
      setWashers(w.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("carwash.failedLoad"));
    }
    try {
      const p = await api.get("/carwash/products");
      setProducts(Array.isArray(p.data) ? p.data : []);
    } catch {
      setProducts([]);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api.post("/carwash/equipment-issues", {
        washerId: form.washerId ? Number(form.washerId) : null,
        productId: form.productId ? Number(form.productId) : null,
        quantity: Number(form.quantity) || 0,
        unitPrice: Number(form.unitPrice) || 0,
      });
      setOpen(false);
      setForm({ washerId: "", productId: "", quantity: "", unitPrice: "" });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedSave"));
    }
  };

  const markPaid = async (id: number, isPaid: boolean) => {
    setError("");
    try {
      await api.patch(`/carwash/equipment-issues/${id}/pay`, { isPaid });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedSave"));
    }
  };

  const remove = async (id: number) => {
    if (!confirm(t("carwash.deleteConfirm"))) return;
    setError("");
    try {
      await api.delete(`/carwash/equipment-issues/${id}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedDelete"));
    }
  };

  const filtered = issues.filter((i) => {
    if (paidFilter === "paid") return i.isPaid;
    if (paidFilter === "unpaid") return !i.isPaid;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">{t("carwash.equipment")}</h1>
        {canIssue && (
          <button onClick={() => { setForm({ washerId: "", productId: "", quantity: "", unitPrice: "" }); setOpen(true); }} className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium">
            + {t("carwash.issueItem")}
          </button>
        )}
      </div>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      <ListFilters>
        <SelectField
          value={paidFilter}
          onChange={setPaidFilter}
          allLabel={t("carwash.paid") + " / " + t("carwash.unpaid")}
          options={[
            { value: "paid", label: t("carwash.paid") },
            { value: "unpaid", label: t("carwash.unpaid") },
          ]}
        />
      </ListFilters>

      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.washer")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.item")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.qty")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.total")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.paid")}</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((i) => (
              <tr key={i.id}>
                <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{i.washer?.name ?? "—"}</td>
                <td className="px-4 py-2 font-medium whitespace-nowrap">{i.product?.baseName ?? i.product?.name ?? "—"}</td>
                <td className="px-4 py-2 whitespace-nowrap">{i.quantity}</td>
                <td className="px-4 py-2 whitespace-nowrap">{i.totalAmount}</td>
                <td className="px-4 py-2 whitespace-nowrap"><span className={`text-xs px-2 py-0.5 rounded-full ${i.isPaid ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{i.isPaid ? t("carwash.paid") : t("carwash.unpaid")}</span></td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {canEdit && !i.isPaid && <button onClick={() => markPaid(i.id, true)} className="text-xs text-green-600 hover:underline mr-2">{t("carwash.markPaid")}</button>}
                  {canDelete && <button onClick={() => remove(i.id)} className="text-xs text-red-600 hover:underline">{t("carwash.delete")}</button>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">{t("carwash.noEquipment")}</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal isOpen={open} onClose={() => setOpen(false)} title={t("carwash.issueItem")}>
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm text-gray-600">{t("carwash.washer")}
            <SearchableSelect value={form.washerId} onChange={(v) => setForm({ ...form, washerId: v })} options={washers.map((w) => ({ value: String(w.id), label: w.name }))} placeholder={t("carwash.washer")} />
          </label>
          <label className="block text-sm text-gray-600">{t("carwash.itemProduct")}
            <SearchableSelect value={form.productId} onChange={(v) => setForm({ ...form, productId: v })} options={products.map((p) => ({ value: String(p.id), label: p.baseName ?? p.name }))} placeholder={t("carwash.itemProduct")} />
          </label>
          <label className="block text-sm text-gray-600">{t("carwash.quantity")}
            <input value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder={t("carwash.quantity")} type="number" min="1" className="border border-gray-300 rounded p-2 text-sm w-full mt-1" required />
          </label>
          <label className="block text-sm text-gray-600">{t("carwash.unitPrice")}
            <input value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} placeholder={t("carwash.unitPrice")} type="number" min="0" className="border border-gray-300 rounded p-2 text-sm w-full mt-1" />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-sm text-gray-600">{t("carwash.cancel")}</button>
            <button type="submit" className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium">{t("carwash.issueItem")}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
