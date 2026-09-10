"use client";

import Loading from "@/app/components/Loading";
import Modal from "@/app/components/Modal";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useToast } from "@/app/components/ToastProvider";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useState } from "react";

const inputCls = "border p-2 rounded-lg w-full bg-white";

const emptyForm = () => ({ name: "", description: "" });

export default function ManufacturingTeamsPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [teams, setTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState(emptyForm());
  const canManage = hasPermission("manufacturing.manage");

  const load = useCallback(async () => {
    try {
      const r = await api.get("/manufacturing/teams");
      setTeams(r.data ?? []);
    } catch {
      toast.error("Failed to load teams");
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    try {
      if (editing) {
        await api.patch(`/manufacturing/teams/${editing.id}`, {
          name: form.name,
          description: form.description || null,
        });
        toast.success("Team updated");
      } else {
        await api.post("/manufacturing/teams", {
          name: form.name,
          description: form.description || undefined,
        });
        toast.success("Team added");
      }
      setShowForm(false);
      setEditing(null);
      setForm(emptyForm());
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to save team");
    }
  };

  const openEdit = (team: any) => {
    setEditing(team);
    setForm({ name: team.name, description: team.description ?? "" });
    setShowForm(true);
  };

  const toggleActive = async (team: any) => {
    try {
      await api.patch(`/manufacturing/teams/${team.id}`, { active: !team.active });
      toast.success("Updated");
      load();
    } catch {
      toast.error("Failed to update");
    }
  };

  const move = async (team: any, dir: -1 | 1) => {
    const idx = teams.findIndex((t) => t.id === team.id);
    const target = idx + dir;
    if (target < 0 || target >= teams.length) return;
    const next = teams.map((t) => t.id);
    [next[idx], next[target]] = [next[target], next[idx]];
    try {
      await api.patch("/manufacturing/teams/reorder", { ids: next });
      load();
    } catch {
      toast.error("Failed to reorder teams");
    }
  };

  const remove = async (team: any) => {
    const ok = await confirm(`Delete team "${team.name}"?`);
    if (!ok) return;
    try {
      await api.delete(`/manufacturing/teams/${team.id}`);
      toast.success("Team deleted");
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to delete team");
    }
  };

  if (loading) return <Loading className="py-24" />;

  return (
    <div>
      <div className="flex justify-between items-center mb-1 flex-wrap gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">Teams</h1>
          <p className="text-sm text-gray-500 mt-1">
            Teams own the steps of your order pipeline. Create them first, then arrange them into a flow.
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => { setEditing(null); setForm(emptyForm()); setShowForm(true); }}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm whitespace-nowrap"
          >
            + Add Team
          </button>
        )}
      </div>

      <div className="mt-4 bg-white rounded-xl shadow-sm border overflow-x-auto">
        <table className="w-full text-left min-w-[760px] text-xs sm:text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="p-3 w-10">#</th>
              <th className="p-3">Name</th>
              <th className="p-3">Description</th>
              <th className="p-3 text-center">Used in flows</th>
              <th className="p-3">Status</th>
              {canManage && <th className="p-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {teams.map((team, i) => (
              <tr key={team.id} className="border-b hover:bg-gray-50">
                <td className="p-3 text-gray-400">{i + 1}</td>
                <td className="p-3 font-medium">{team.name}</td>
                <td className="p-3 text-gray-500">{team.description ?? "—"}</td>
                <td className="p-3 text-center">{team._count?.steps ?? 0}</td>
                <td className="p-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${team.active ? "bg-green-100 text-green-800" : "bg-gray-200 text-gray-500"}`}>
                    {team.active ? "Active" : "Inactive"}
                  </span>
                </td>
                {canManage && (
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-2 text-xs">
                      <button onClick={() => move(team, -1)} disabled={i === 0} className="text-gray-500 hover:text-gray-800 disabled:opacity-30">↑</button>
                      <button onClick={() => move(team, 1)} disabled={i === teams.length - 1} className="text-gray-500 hover:text-gray-800 disabled:opacity-30">↓</button>
                      <button onClick={() => openEdit(team)} className="text-blue-600 hover:underline">Edit</button>
                      <button onClick={() => toggleActive(team)} className="text-gray-600 hover:underline">
                        {team.active ? "Deactivate" : "Activate"}
                      </button>
                      <button onClick={() => remove(team)} className="text-red-600 hover:underline">Delete</button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {teams.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-gray-400">
                  No teams yet — add your first team (e.g. Intake, Production) to start routing orders.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        title={editing ? `Edit Team — ${editing.name}` : "Add Team"}
      >
        <form onSubmit={submit} className="grid grid-cols-1 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">Name *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} required placeholder="e.g. Production" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">Description</label>
            <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional" className={inputCls} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm">Cancel</button>
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">
              {editing ? "Save Team" : "Add Team"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
