"use client";
import Modal from "@/app/components/Modal";
import api from "@/lib/api";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export default function VendorsPanel({ vendors, canManage, onSaved }: any) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const submit = async () => {
    if (!form.name?.trim()) return setError(t("mfg.vendors.nameRequired"));
    setSaving(true);
    setError("");
    try {
      await api.post("/manufacturing/vendors", {
        name: form.name.trim(),
        contactPerson: form.contactPerson || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        address: form.address || undefined,
        taxId: form.taxId || undefined,
        paymentTermsDays: form.paymentTermsDays ? Number(form.paymentTermsDays) : undefined,
      });
      setOpen(false);
      setForm({});
      onSaved?.();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("mfg.vendors.createFailed"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">{t("mfg.vendors.title")}</h3>
        {canManage && (
          <button onClick={() => { setForm({}); setError(""); setOpen(true); }} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-1.5 text-xs font-medium">{t("mfg.vendors.newVendor")}</button>
        )}
      </div>
      {vendors.length === 0 ? (
        <p className="text-gray-400 text-sm py-6 text-center">{t("mfg.vendors.none")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-400 border-b bg-gray-50/60">
                <th className="px-3 py-2">{t("mfg.vendors.colName")}</th>
                <th className="px-3 py-2">{t("mfg.vendors.colContact")}</th>
                <th className="px-3 py-2">{t("mfg.vendors.colEmailPhone")}</th>
                <th className="px-3 py-2">{t("mfg.vendors.colTaxId")}</th>
                <th className="px-3 py-2 text-right">{t("mfg.vendors.colTerms")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {vendors.map((v: any) => (
                <tr key={v.id}>
                  <td className="px-3 py-2 font-medium text-gray-800">{v.name}</td>
                  <td className="px-3 py-2 text-gray-500">{v.contactPerson ?? "—"}</td>
                  <td className="px-3 py-2 text-gray-500">{[v.email, v.phone].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-3 py-2 text-gray-500">{v.taxId ?? "—"}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{v.paymentTermsDays ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal isOpen={open} onClose={() => setOpen(false)} title={t("mfg.vendors.newVendorTitle")}>
        <div className="space-y-3">
          {error && <p className="bg-red-50 text-red-600 p-2 rounded text-sm">{error}</p>}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t("mfg.vendors.nameLabel")}</label>
            <input value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} className="border border-gray-300 rounded p-2 text-sm w-full" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input value={form.contactPerson ?? ""} onChange={(e) => set("contactPerson", e.target.value)} placeholder={t("mfg.vendors.contactPersonPlaceholder")} className="border border-gray-300 rounded p-2 text-sm w-full" />
            <input value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} placeholder={t("mfg.vendors.emailPlaceholder")} className="border border-gray-300 rounded p-2 text-sm w-full" />
            <input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} placeholder={t("mfg.vendors.phonePlaceholder")} className="border border-gray-300 rounded p-2 text-sm w-full" />
            <input value={form.address ?? ""} onChange={(e) => set("address", e.target.value)} placeholder={t("mfg.vendors.addressPlaceholder")} className="border border-gray-300 rounded p-2 text-sm w-full" />
            <input value={form.taxId ?? ""} onChange={(e) => set("taxId", e.target.value)} placeholder={t("mfg.vendors.taxIdPlaceholder")} className="border border-gray-300 rounded p-2 text-sm w-full" />
            <input type="number" min="0" value={form.paymentTermsDays ?? ""} onChange={(e) => set("paymentTermsDays", e.target.value)} placeholder={t("mfg.vendors.termsPlaceholder")} className="border border-gray-300 rounded p-2 text-sm w-full" />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="px-3 py-2 text-sm text-gray-600">{t("mfg.common.cancel")}</button>
            <button onClick={submit} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-2 text-sm font-medium">{saving ? t("mfg.vendors.saving") : t("mfg.vendors.saveVendor")}</button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
