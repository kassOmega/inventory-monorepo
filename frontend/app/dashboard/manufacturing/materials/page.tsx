"use client";

import Loading from "@/app/components/Loading";
import Modal from "@/app/components/Modal";
import { useToast } from "@/app/components/ToastProvider";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useState } from "react";

const STATUS_COLOR: Record<string, string> = {
  OPEN: "bg-amber-100 text-amber-800",
  PARTIAL: "bg-blue-100 text-blue-800",
  RETURNED: "bg-green-100 text-green-800",
  CLOSED: "bg-gray-100 text-gray-600",
};
const emptyIssue = () => ({ productId: "", quantity: "1", locationId: "", workOrderId: "", jobId: "", issuedToId: "" });

export default function ManufacturingMaterialsPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const [issues, setIssues] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showIssue, setShowIssue] = useState(false);
  const [showReturn, setShowReturn] = useState<any>(null);
  const [returnQty, setReturnQty] = useState("1");
  const [form, setForm] = useState(emptyIssue());
  const canManage = hasPermission("manufacturing.manage");

  const load = useCallback(async () => {
    try {
      const [i, p, l, u] = await Promise.all([
        api.get("/manufacturing/issues"),
        api.get("/products").catch(() => ({ data: [] })),
        api.get("/locations").catch(() => ({ data: [] })),
        api.get("/users?page=1&pageSize=100").catch(() => ({ data: [] })),
      ]);
      setIssues(i.data ?? []);
      setProducts(p.data ?? []);
      setLocations(l.data ?? []);
      setStaff(Array.isArray(u.data) ? u.data : (u.data?.data ?? []));
    } catch {
      toast.error("Failed to load materials");
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const submitIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/manufacturing/issues", {
        productId: Number(form.productId),
        quantity: Number(form.quantity),
        locationId: Number(form.locationId),
        workOrderId: form.workOrderId ? Number(form.workOrderId) : undefined,
        jobId: form.jobId ? Number(form.jobId) : undefined,
        issuedToId: form.issuedToId ? Number(form.issuedToId) : undefined,
      });
      toast.success("Material issued");
      setShowIssue(false);
      setForm(emptyIssue());
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to issue material");
    }
  };

  const submitReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showReturn) return;
    try {
      await api.post("/manufacturing/returns", { issueId: showReturn.id, quantity: Number(returnQty) || 1 });
      toast.success("Return recorded");
      setShowReturn(null);
      setReturnQty("1");
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to record return");
    }
  };

  const pName = (id: number) => { const p = products.find((x) => x.id === id); return p ? `${p.brand} ${p.baseName}`.trim() : `#${id}`; };
  const lName = (id: number) => locations.find((x) => x.id === id)?.name ?? `#${id}`;
  const workerName = (id: number | null) => staff.find((x) => x.id === id)?.name ?? (id == null ? "—" : `#${id}`);

  if (loading) return <Loading className="py-24" />;

  const field = (label: string, el: React.ReactNode) => (
    <div>
      <label className="block text-sm font-medium text-gray-500 mb-1">{label}</label>
      {el}
    </div>
  );
  const inputCls = "border p-2 rounded-lg w-full bg-white";

  return (
    <div>
      <div className="flex justify-between items-center mb-6 gap-3 flex-wrap">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-800">Materials & Issues</h1>
        <p className="text-sm text-gray-500 mt-1 w-full">Bulk materials handed to workers by amount — what's issued, what came back unused, and what was used.</p>
        {canManage && (
          <button onClick={() => setShowIssue(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">+ Issue Material</button>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
        <table className="w-full text-left min-w-[760px] text-xs sm:text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="p-3">Product</th>
              <th className="p-3">Worker</th>
              <th className="p-3 text-center">Issued / Returned</th>
              <th className="p-3 text-center">Used</th>
              <th className="p-3">Location</th>
              <th className="p-3">Status</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {issues.map((i) => (
              <tr key={i.id} className="border-b hover:bg-gray-50">
                <td className="p-3 font-medium">{pName(i.productId)}</td>
                <td className="p-3">{workerName(i.issuedToId ?? null)}</td>
                <td className="p-3 text-center">{i.issuedQty} / {i.returnedQty}</td>
                <td className="p-3 text-center font-semibold">{i.usedQty}</td>
                <td className="p-3 text-gray-500">{lName(i.locationId)}</td>
                <td className="p-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[i.status] ?? "bg-gray-100"}`}>{i.status}</span>
                </td>
                <td className="p-3">
                  {canManage && i.status !== "RETURNED" && i.status !== "CLOSED" && (
                    <button onClick={() => { setShowReturn(i); setReturnQty("1"); }} className="text-xs text-green-600 hover:underline">Return</button>
                  )}
                </td>
              </tr>
            ))}
            {issues.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-gray-400">No material issues yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal isOpen={showIssue} onClose={() => setShowIssue(false)} title="Issue Material">
        <form onSubmit={submitIssue} className="grid grid-cols-1 gap-4">
          {field("Product *", (
            <select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} className={inputCls} required>
              <option value="">Select product</option>
              {products.map((p) => <option key={p.id} value={p.id}>{`${p.brand} ${p.baseName}`.trim()}</option>)}
            </select>
          ))}
          <div className="grid grid-cols-2 gap-4">
            {field("Quantity *", <input type="number" min="0.0001" step="any" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="border p-2 rounded-lg w-full" required />)}
            {field("Location *", (
              <select value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })} className={inputCls} required>
                <option value="">Select location</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-4">
            {field("Work order", <input value={form.workOrderId} onChange={(e) => setForm({ ...form, workOrderId: e.target.value })} placeholder="Optional" className="border p-2 rounded-lg w-full" />)}
            {field("Job", <input value={form.jobId} onChange={(e) => setForm({ ...form, jobId: e.target.value })} placeholder="Optional" className="border p-2 rounded-lg w-full" />)}
            {field("Issued to (team member)", (
              <select value={form.issuedToId} onChange={(e) => setForm({ ...form, issuedToId: e.target.value })} className={inputCls}>
                <option value="">— None —</option>
                {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowIssue(false)} className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm">Cancel</button>
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">Issue</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!showReturn} onClose={() => setShowReturn(null)} title={`Return from issue #${showReturn?.id ?? ""}`}>
        <form onSubmit={submitReturn} className="grid grid-cols-1 gap-4">
          {field("Quantity (leftover/offcut)", <input type="number" min="0.0001" step="any" value={returnQty} onChange={(e) => setReturnQty(e.target.value)} className="border p-2 rounded-lg w-full" required />)}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowReturn(null)} className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm">Cancel</button>
            <button type="submit" className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm">Return</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}