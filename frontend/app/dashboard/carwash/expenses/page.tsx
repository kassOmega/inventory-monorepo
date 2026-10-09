"use client";

import api from "@/lib/api";
import Button from "@/app/components/Button";
import FilterPanel, { FilterSelect } from "@/app/components/FilterPanel";
import { getDateRange, type DatePreset } from "@/app/components/DateFilter";
import Modal from "@/app/components/Modal";
import SearchableSelect from "@/app/components/SearchableSelect";
import { useAuth } from "@/context/AuthContext";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useState } from "react";

const CATEGORIES = ["Rent", "Salaries", "Utilities", "Supplies", "Marketing", "Maintenance", "Equipment", "Other"];

export default function CarWashExpensesPage() {
  const { hasPermission } = useAuth();
  const { t } = useTranslation();
  const [expenses, setExpenses] = useState<any[]>([]);
  const [form, setForm] = useState({ category: "", amount: "", expenseDate: "", notes: "" });
  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const init = getDateRange("month");
  const [datePreset, setDatePreset] = useState<DatePreset>("month");
  const [startDate, setStartDate] = useState(init.start);
  const [endDate, setEndDate] = useState(init.end);

  const canCreate = hasPermission("carwash.expenses.create");
  const canEdit = hasPermission("carwash.expenses.edit");
  const canDelete = hasPermission("carwash.expenses.delete");

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({
        startDate,
        endDate,
        ...(category ? { category } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
      });
      const r = await api.get(`/carwash/expenses?${q.toString()}`);
      setExpenses(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("carwash.failedLoad"));
    }
  }, [t, startDate, endDate, category, search]);

  useEffect(() => {
    load();
  }, [load]);

  const openEdit = (x: any) => {
    setEditing(x);
    setForm({
      category: x.account?.name ?? x.category ?? "Other",
      amount: String(x.amount),
      expenseDate: x.expenseDate ? x.expenseDate.slice(0, 10) : "",
      notes: x.notes ?? "",
    });
    setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    const payload: any = {
      category: form.category,
      amount: Number(form.amount) || 0,
      notes: form.notes.trim() || undefined,
      expenseDate: form.expenseDate ? new Date(form.expenseDate).toISOString() : undefined,
    };
    try {
      if (editing) await api.patch(`/carwash/expenses/${editing.id}`, payload);
      else await api.post("/carwash/expenses", payload);
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
      await api.delete(`/carwash/expenses/${id}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedDelete"));
    } finally {
      setBusyId(null);
    }
  };

  const filtered = expenses;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">{t("carwash.expenses")}</h1>
        {canCreate && (
          <button onClick={() => { setEditing(null); setForm({ category: "", amount: "", expenseDate: "", notes: "" }); setOpen(true); }} className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium">
            + {t("carwash.addExpense")}
          </button>
        )}
      </div>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      <FilterPanel
        showDateFilter
        datePreset={datePreset}
        onDatePresetChange={setDatePreset}
        startDate={startDate}
        onStartDateChange={setStartDate}
        endDate={endDate}
        onEndDateChange={setEndDate}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("carwash.category")}
        extra={
          <FilterSelect
            value={category}
            onChange={setCategory}
            label={t("carwash.category")}
            allLabel={t("carwash.allCategories")}
            options={CATEGORIES.map((c) => ({ value: c, label: c }))}
          />
        }
      />

      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.date")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.category")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.amount")}</th>
              <th className="px-4 py-2 whitespace-nowrap">{t("carwash.notes")}</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((x) => (
              <tr key={x.id}>
                <td className="px-4 py-2 whitespace-nowrap">{x.expenseDate ? new Date(x.expenseDate).toLocaleDateString() : "—"}</td>
                <td className="px-4 py-2 font-medium whitespace-nowrap">{x.account?.name ?? x.category ?? "—"}</td>
                <td className="px-4 py-2 whitespace-nowrap">{x.amount}</td>
                <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{x.notes ?? "—"}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {canEdit && <button onClick={() => openEdit(x)} className="text-xs text-blue-600 hover:underline mr-2">{t("carwash.edit")}</button>}
                  {canDelete && <Button variant="ghost" size="sm" loading={busyId === x.id} onClick={() => remove(x.id)} className="!px-0 text-xs text-red-600 hover:underline">{t("carwash.delete")}</Button>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">{t("carwash.noExpenses")}</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal isOpen={open} onClose={() => setOpen(false)} title={editing ? t("carwash.edit") : t("carwash.addExpense")}>
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm text-gray-600">{t("carwash.category")}
            <SearchableSelect value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={CATEGORIES.map((c) => ({ value: c, label: c }))} placeholder={t("carwash.category")} />
          </label>
          <label className="block text-sm text-gray-600">{t("carwash.amount")}
            <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder={t("carwash.amount")} type="number" min="0" className="border border-gray-300 rounded p-2 text-sm w-full mt-1" required />
          </label>
          <label className="block text-sm text-gray-600">{t("carwash.date")}
            <input value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} type="date" className="border border-gray-300 rounded p-2 text-sm w-full mt-1" />
          </label>
          <label className="block text-sm text-gray-600">{t("carwash.notes")}
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t("carwash.notes")} className="border border-gray-300 rounded p-2 text-sm w-full mt-1" />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-sm text-gray-600">{t("carwash.cancel")}</button>
            <Button type="submit" loading={saving} shape="rounded">{editing ? t("carwash.edit") : t("carwash.addExpense")}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
