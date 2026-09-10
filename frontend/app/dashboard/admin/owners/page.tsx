"use client";

import api from "@/lib/api";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useCallback, useEffect, useState } from "react";

const addDays = (days: number) => {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

export default function AdminOwnersPage() {
  const confirm = useConfirm();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", email: "", password: "", aiTrialEndsAt: addDays(15), dailyAiQuota: "" });
  const [idFile, setIdFile] = useState<File | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", password: "", aiTrialEndsAt: "", dailyAiQuota: "" });

  const load = useCallback(async () => {
    try {
      const res = await api.get("/admin/users");
      setUsers(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to load owner accounts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createOwner = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const payload: any = {
        name: form.name,
        email: form.email,
        password: form.password,
        aiTrialEndsAt: form.aiTrialEndsAt || undefined,
      };
      if (form.dailyAiQuota !== "") payload.dailyAiQuota = Number(form.dailyAiQuota);
      const res = await api.post("/admin/users", payload);
      const userId = res.data.id;

      // Optionally attach the owner's national ID so verification starts now.
      if (idFile) {
        const fd = new FormData();
        fd.append("documentType", "NATIONAL_ID");
        fd.append("file", idFile);
        await api.post(`/admin/verification/user/${userId}/documents`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }

      setForm({ name: "", email: "", password: "", aiTrialEndsAt: addDays(15), dailyAiQuota: "" });
      setIdFile(null);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create owner account");
    }
  };

  const toggleStatus = async (id: number, status: string) => {
    await api.patch(`/admin/users/${id}/status`, {
      status: status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
    });
    await load();
  };

  const startEdit = (u: any) => {
    setEditing(u);
    setEditForm({
      name: u.name,
      email: u.email,
      password: "",
      aiTrialEndsAt: u.aiTrialEndsAt ? String(u.aiTrialEndsAt).slice(0, 10) : "",
      dailyAiQuota: u.dailyAiQuota != null ? String(u.dailyAiQuota) : "",
    });
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const payload: any = { name: editForm.name, email: editForm.email };
      if (editForm.password) payload.password = editForm.password;
      if (editForm.aiTrialEndsAt) {
        payload.aiTrialEndsAt = editForm.aiTrialEndsAt;
      } else {
        payload.aiTrialEndsAt = null; // clear -> unlimited / paid
      }
      if (editForm.dailyAiQuota !== "") {
        payload.dailyAiQuota = Number(editForm.dailyAiQuota);
      } else {
        payload.dailyAiQuota = null; // fall back to the global default
      }
      await api.patch(`/admin/users/${editing.id}`, payload);
      setEditing(null);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to update user");
    }
  };

  const deleteUser = async (id: number, name: string) => {
    if (!(await confirm(`Delete "${name}"? This cannot be undone.`))) return;
    setError("");
    try {
      await api.delete(`/admin/users/${id}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to delete user");
    }
  };

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Users</h1>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      <div className="bg-white p-4 rounded-lg border border-gray-200">
        <h2 className="font-semibold text-gray-800 mb-3">Create Owner Account</h2>
        <form onSubmit={createOwner} className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            placeholder="Full name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="border border-gray-300 rounded p-2 text-sm"
            required
          />
          <input
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="border border-gray-300 rounded p-2 text-sm"
            required
          />
          <input
            type="password"
            placeholder="Password (min 8 chars)"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="border border-gray-300 rounded p-2 text-sm"
            required
          />
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <span className="whitespace-nowrap">AI trial ends:</span>
            <input
              type="date"
              value={form.aiTrialEndsAt}
              onChange={(e) => setForm({ ...form, aiTrialEndsAt: e.target.value })}
              className="border border-gray-300 rounded p-2 text-sm w-full"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <span className="whitespace-nowrap">AI daily limit:</span>
            <input
              type="number"
              min="0"
              placeholder="default"
              value={form.dailyAiQuota}
              onChange={(e) => setForm({ ...form, dailyAiQuota: e.target.value })}
              className="border border-gray-300 rounded p-2 text-sm w-full"
            />
          </label>
          <label className="md:col-span-2 border border-dashed border-gray-300 rounded p-2 bg-gray-50 cursor-pointer">
            <span className="text-xs font-medium text-gray-600">
              National ID (optional — attach to start verification)
            </span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
              className="block text-xs text-gray-500 mt-1 w-full"
              onChange={(e) => setIdFile(e.target.files?.[0] ?? null)}
            />
            {idFile && <span className="text-[11px] text-green-600 mt-1 block">✓ {idFile.name}</span>}
          </label>
          <button type="submit" className="bg-blue-600 text-white rounded p-2 text-sm font-medium md:col-span-2">
            Create User Account
          </button>
        </form>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <ul className="divide-y divide-gray-100">
          {users.map((u) => (
            <li key={u.id} className="px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-800">{u.name}</p>
                <p className="text-xs text-gray-400">
                  {u.email} · {u.memberships?.length ?? 0} business(es) · AI trial{" "}
                  {u.aiTrialEndsAt ? `ends ${String(u.aiTrialEndsAt).slice(0, 10)}` : "unlimited"}
                  · AI {u.dailyAiQuota != null ? `${u.dailyAiQuota}/day` : "default quota"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => startEdit(u)} className="text-xs text-blue-600 hover:underline">
                  Edit
                </button>
                <button onClick={() => deleteUser(u.id, u.name)} className="text-xs text-red-600 hover:underline">
                  Delete
                </button>
                <button
                  onClick={() => toggleStatus(u.id, u.status)}
                  className={`text-xs px-2 py-1 rounded-full ${
                    u.status === "ACTIVE" ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"
                  }`}
                >
                  {u.status === "ACTIVE" ? "Active" : "Inactive"}
                </button>
              </div>
            </li>
          ))}
          {users.length === 0 && <li className="px-4 py-3 text-gray-400 text-sm">No owner accounts yet.</li>}
        </ul>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-4">Edit User</h2>
            <form onSubmit={saveEdit} className="space-y-3">
              <input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                placeholder="Full name"
                className="border border-gray-300 rounded p-2 text-sm w-full"
                required
              />
              <input
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                placeholder="Email"
                className="border border-gray-300 rounded p-2 text-sm w-full"
                required
              />
              <input
                type="password"
                value={editForm.password}
                onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                placeholder="New password (leave blank to keep current)"
                className="border border-gray-300 rounded p-2 text-sm w-full"
              />
              <div>
                <label className="block text-xs text-gray-500 mb-1">AI trial end date</label>
                <input
                  type="date"
                  value={editForm.aiTrialEndsAt}
                  onChange={(e) => setEditForm({ ...editForm, aiTrialEndsAt: e.target.value })}
                  className="border border-gray-300 rounded p-2 text-sm w-full"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  Leave empty to grant unlimited AI access (paid).
                </p>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Daily AI query limit
                </label>
                <input
                  type="number"
                  min="0"
                  placeholder="Default (global)"
                  value={editForm.dailyAiQuota}
                  onChange={(e) =>
                    setEditForm({ ...editForm, dailyAiQuota: e.target.value })
                  }
                  className="border border-gray-300 rounded p-2 text-sm w-full"
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  Leave empty to use the global default quota.
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setEditing(null)} className="px-3 py-2 text-sm text-gray-600">
                  Cancel
                </button>
                <button type="submit" className="bg-blue-600 text-white rounded px-3 py-2 text-sm font-medium">
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
