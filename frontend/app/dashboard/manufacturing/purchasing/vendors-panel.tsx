"use client";
import Modal from "@/app/components/Modal";
import api from "@/lib/api";
import { useState } from "react";

export default function VendorsPanel({ vendors, canManage, onSaved }: any) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const submit = async () => {
    if (!form.name?.trim()) return setError("Vendor name is required");
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
      setError(e?.response?.data?.message ?? "Failed to create vendor");
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">Vendors</h3>
        {canManage && (
          <button onClick={() => { setForm({}); setError(""); setOpen(true); }} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-1.5 text-xs font-medium">+ New Vendor</button>
        )}
      </div>
      {vendors.length === 0 ? (
        <p className="text-gray-400 text-sm py-6 text-center">No vendors yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-400 border-b bg-gray-50/60">
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Contact</th>
                <th className="px-3 py-2">Email / Phone</th>
                <th className="px-3 py-2">Tax ID</th>
                <th className="px-3 py-2 text-right">Terms (days)</th>
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
      <Modal isOpen={open} onClose={() => setOpen(false)} title="New Vendor">
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
            <button onClick={() => setOpen(false)} className="px-3 py-2 text-sm text-gray-600">Cancel</button>
            <button onClick={submit} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-2 text-sm font-medium">{saving ? "Saving…" : "Save vendor"}</button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
