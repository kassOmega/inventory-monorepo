"use client";

import Loading from "@/app/components/Loading";
import Modal from "@/app/components/Modal";
import { useToast } from "@/app/components/ToastProvider";
import { statusLabel } from "@/lib/statusLabel";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useState } from "react";

const emptyForm = () => ({ name: "", title: "", phone: "", locationId: "" });
const inputCls = "border p-2 rounded-lg w-full bg-white";

// Workers are the people employed by the business (an employee roster). They do
// not need a login or role - a Worker only becomes a User when given an account
// (every user is also provisioned as a worker).
export default function ManufacturingWorkersPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const [workers, setWorkers] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const canManage = hasPermission("manufacturing.manage");

  const load = useCallback(async () => {
    try {
      const [w, l] = await Promise.all([
        api.get("/manufacturing/workers"),
        api.get("/locations").catch(() => ({ data: [] })),
      ]);
      setWorkers(w.data ?? []);
      setLocations(l.data ?? []);
    } catch {
      toast.error("Failed to load workers");
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/manufacturing/workers", {
        name: form.name,
        title: form.title || null,
        phone: form.phone || null,
        locationId: form.locationId ? Number(form.locationId) : null,
      });
      toast.success("Worker added");
      setShowForm(false);
      setForm(emptyForm());
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to add worker");
    }
  };

  const toggleStatus = async (w: any) => {
    const next = w.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      await api.patch(`/manufacturing/workers/${w.id}/status`, { status: next });
      toast.success("Updated");
      load();
    } catch {
      toast.error("Failed to update");
    }
  };

  const locName = (id: number | null) => locations.find((l) => l.id === id)?.name ?? (id == null ? "—" : `#${id}`);

  if (loading) return <Loading className="py-24" />;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-800">Workers</h1>
        {canManage && (
          <button onClick={() => setShowForm(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">+ Add Worker</button>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
        <table className="w-full text-left min-w-[720px] text-xs sm:text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="p-3">Name</th>
              <th className="p-3">Job Title</th>
              <th className="p-3">Location</th>
              <th className="p-3">Phone</th>
              <th className="p-3">Account</th>
              <th className="p-3">Status</th>
              {canManage && <th className="p-3" />}
            </tr>
          </thead>
          <tbody>
            {workers.map((w) => (
              <tr key={w.id} className="border-b hover:bg-gray-50">
                <td className="p-3 font-medium">{w.name}</td>
                <td className="p-3 text-gray-500">{w.title ?? "—"}</td>
                <td className="p-3 text-gray-500">{locName(w.locationId ?? null)}</td>
                <td className="p-3 text-gray-500">{w.phone ?? "—"}</td>
                <td className="p-3">
                  {w.userId ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Has login</span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">No login</span>
                  )}
                </td>
                <td className="p-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${w.status === "ACTIVE" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"}`}>
                    {statusLabel(w.status)}
                  </span>
                </td>
                {canManage && (
                  <td className="p-3 text-right">
                    <button onClick={() => toggleStatus(w)} className="text-xs text-blue-600 hover:underline">
                      {w.status === "ACTIVE" ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {workers.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-gray-400">No workers registered yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="Add Worker">
        <form onSubmit={submit} className="grid grid-cols-1 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">Full name *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">Job title</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Carpenter" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">Phone</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">Location</label>
            <select value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })} className={inputCls}>
              <option value="">—</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm">Cancel</button>
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">Add Worker</button>
          </div>
        </form>
      </Modal>

    </div>
  );
}
