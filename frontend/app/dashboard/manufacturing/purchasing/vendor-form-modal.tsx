"use client";
import Modal from "@/app/components/Modal";
import api from "@/lib/api";
import { useState } from "react";

export default function VendorFormModal({ open, onClose, onCreated }: any) {
  const [form, setForm] = useState<any>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const submit = async () => {
    if (!form.name?.trim()) return setError("Vendor name is required");
    setSaving(true);
    setError("");
    try {
      const res = await api.post("/manufacturing/vendors", {
        name: form.name.trim(),
        contactPerson: form.contactPerson || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        address: form.address || undefined,
        taxId: form.taxId || undefined,
        paymentTermsDays: form.paymentTermsDays ? Number(form.paymentTermsDays) : undefined,
      });
      setForm({});
      onCreated?.(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to create vendor");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal isOpen={open} onClose={onClose} title="New Vendor">
      <div className="space-y-3">
        {error && <p className="bg-red-50 text-red-600 p-2 rounded text-sm">{error}</p>}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Name *</label>
          <input value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} className="border border-gray-300 rounded p-2 text-sm w-full" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input value={form.contactPerson ?? ""} onChange={(e) => set("contactPerson", e.target.value)} placeholder="Contact person" className="border border-gray-300 rounded p-2 text-sm w-full" />
          <input value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} placeholder="Email" className="border border-gray-300 rounded p-2 text-sm w-full" />
          <input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} placeholder="Phone" className="border border-gray-300 rounded p-2 text-sm w-full" />
          <input value={form.address ?? ""} onChange={(e) => set("address", e.target.value)} placeholder="Address" className="border border-gray-300 rounded p-2 text-sm w-full" />
          <input value={form.taxId ?? ""} onChange={(e) => set("taxId", e.target.value)} placeholder="Tax ID (optional)" className="border border-gray-300 rounded p-2 text-sm w-full" />
          <input type="number" min="0" value={form.paymentTermsDays ?? ""} onChange={(e) => set("paymentTermsDays", e.target.value)} placeholder="Payment terms (days)" className="border border-gray-300 rounded p-2 text-sm w-full" />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-sm text-gray-600">Cancel</button>
          <button onClick={submit} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-2 text-sm font-medium">{saving ? "Saving…" : "Save vendor"}</button>
        </div>
      </div>
    </Modal>
  );
}
