"use client";

import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export default function PaymentMethodsPage() {
  const { hasPermission } = useAuth();
  const confirm = useConfirm();
  const { t } = useTranslation();
  const canManage = hasPermission("finance.manage");
  const [methods, setMethods] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get("/payment-methods");
      setMethods(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("paymentMethods.loadFail"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => setForm({ id: null, name: "", isDigital: false, account: "" });
  const openEdit = (m: any) => setForm({ id: m.id, name: m.name, isDigital: m.isDigital, account: m.account ?? "" });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const payload = { name: form.name, isDigital: form.isDigital, account: form.account || undefined };
      if (form.id) await api.patch(`/payment-methods/${form.id}`, payload);
      else await api.post("/payment-methods", payload);
      setForm(null);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("paymentMethods.saveFail"));
    }
  };
  const remove = async (m: any) => {
    if (!(await confirm(t("paymentMethods.deleteConfirm", { name: m.name })))) return;
    try {
      await api.delete(`/payment-methods/${m.id}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("paymentMethods.deleteFail"));
    }
  };

  if (loading) return <p className="text-gray-500 p-6">{t("paymentMethods.loading")}</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">{t("nav.paymentMethods")}</h1>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-800">{t("paymentMethods.subtitle")}</h2>
          {canManage && (
            <button onClick={openNew} className="text-sm text-blue-600 hover:underline">
              {t("paymentMethods.addBank")}
            </button>
          )}
        </div>
        <ul className="divide-y divide-gray-100 text-sm">
          {methods.map((m) => (
            <li key={m.id} className="py-2.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-gray-800 font-medium">
                  {m.name}
                  <span className={`ml-2 text-xs px-2 py-0.5 rounded ${m.isDigital ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>
                    {m.isDigital ? t("paymentMethods.digital") : t("paymentMethods.cash")}
                  </span>
                </p>
                {m.account && (
                  <p className="text-xs text-gray-500">
                    {t("paymentMethods.payTo", { account: m.account })}
                  </p>
                )}
              </div>
              {canManage && (
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => openEdit(m)} className="text-xs text-blue-600 hover:underline">{t("common.edit")}</button>
                  <button onClick={() => remove(m)} className="text-xs text-red-600 hover:underline">{t("common.delete")}</button>
                </div>
              )}
            </li>
          ))}
          {methods.length === 0 && <li className="text-gray-400 py-2">{t("paymentMethods.empty")}</li>}
        </ul>
      </div>

      {form && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-3">{form.id ? t("paymentMethods.editTitle") : t("paymentMethods.addTitle")}</h2>
            <form onSubmit={save} className="space-y-3">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("paymentMethods.namePh")} className="border border-gray-300 rounded p-2 text-sm w-full" required />
              <input value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })} placeholder={t("paymentMethods.accountPh")} className="border border-gray-300 rounded p-2 text-sm w-full" />
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.isDigital} onChange={(e) => setForm({ ...form, isDigital: e.target.checked })} className="rounded" />
                {t("paymentMethods.digitalLabel")}
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setForm(null)} className="px-3 py-2 text-sm text-gray-600">{t("common.cancel")}</button>
                <button type="submit" className="bg-gray-800 text-white rounded px-3 py-2 text-sm font-medium">{t("common.save")}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
