"use client";

import Loading from "@/app/components/Loading";
import Modal from "@/app/components/Modal";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useToast } from "@/app/components/ToastProvider";
import api from "@/lib/api";
import Button from "@/app/components/Button";
import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const inputCls = "border p-2 rounded-lg w-full bg-white";

const emptyForm = () => ({ name: "", description: "" });

export default function ManufacturingTeamsPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { t } = useTranslation();
  const [teams, setTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const canManage = hasPermission("manufacturing.manage");

  const load = useCallback(async () => {
    try {
      const r = await api.get("/manufacturing/teams");
      setTeams(r.data ?? []);
    } catch {
      toast.error(t("mfg.teams.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/manufacturing/teams/${editing.id}`, {
          name: form.name,
          description: form.description || null,
        });
        toast.success(t("mfg.teams.updated"));
      } else {
        await api.post("/manufacturing/teams", {
          name: form.name,
          description: form.description || undefined,
        });
        toast.success(t("mfg.teams.added"));
      }
      setShowForm(false);
      setEditing(null);
      setForm(emptyForm());
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.teams.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (team: any) => {
    setEditing(team);
    setForm({ name: team.name, description: team.description ?? "" });
    setShowForm(true);
  };

  const toggleActive = async (team: any) => {
    setBusyKey(`toggle-${team.id}`);
    try {
      await api.patch(`/manufacturing/teams/${team.id}`, { active: !team.active });
      toast.success(t("mfg.common.updated"));
      load();
    } catch {
      toast.error(t("mfg.common.updateFailed"));
    } finally {
      setBusyKey(null);
    }
  };

  const move = async (team: any, dir: -1 | 1) => {
    const idx = teams.findIndex((t) => t.id === team.id);
    const target = idx + dir;
    if (target < 0 || target >= teams.length) return;
    const next = teams.map((t) => t.id);
    [next[idx], next[target]] = [next[target], next[idx]];
    setBusyKey(`move-${team.id}`);
    try {
      await api.patch("/manufacturing/teams/reorder", { ids: next });
      load();
    } catch {
      toast.error(t("mfg.teams.reorderFailed"));
    } finally {
      setBusyKey(null);
    }
  };

  const remove = async (team: any) => {
    const ok = await confirm(t("mfg.teams.deleteConfirm", { name: team.name }));
    if (!ok) return;
    setBusyKey(`del-${team.id}`);
    try {
      await api.delete(`/manufacturing/teams/${team.id}`);
      toast.success(t("mfg.teams.deleted"));
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.teams.deleteFailed"));
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) return <Loading className="py-24" />;

  return (
    <div>
      <div className="flex justify-between items-center mb-1 flex-wrap gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">{t("mfg.teams.title")}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {t("mfg.teams.subtitle")}
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => { setEditing(null); setForm(emptyForm()); setShowForm(true); }}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm whitespace-nowrap"
          >
            {t("mfg.teams.addTeam")}
          </button>
        )}
      </div>

      <div className="mt-4 bg-white rounded-xl shadow-sm border overflow-x-auto">
        <table className="w-full text-left min-w-[760px] text-xs sm:text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="p-3 w-10">#</th>
              <th className="p-3">{t("common.name")}</th>
              <th className="p-3">{t("common.description")}</th>
              <th className="p-3 text-center">{t("mfg.teams.colUsedInFlows")}</th>
              <th className="p-3">{t("common.status")}</th>
              {canManage && <th className="p-3 text-right">{t("common.actions")}</th>}
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
                    {team.active ? t("status.active") : t("status.inactive")}
                  </span>
                </td>
                {canManage && (
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-2 text-xs">
                      <button onClick={() => move(team, -1)} disabled={i === 0 || busyKey === `move-${team.id}`} className="text-gray-500 hover:text-gray-800 disabled:opacity-30">{busyKey === `move-${team.id}` ? <Loading size="sm" /> : "↑"}</button>
                      <button onClick={() => move(team, 1)} disabled={i === teams.length - 1 || busyKey === `move-${team.id}`} className="text-gray-500 hover:text-gray-800 disabled:opacity-30">{busyKey === `move-${team.id}` ? <Loading size="sm" /> : "↓"}</button>
                      <button onClick={() => openEdit(team)} className="text-blue-600 hover:underline">{t("mfg.common.edit")}</button>
                      <Button variant="ghost" size="sm" loading={busyKey === `toggle-${team.id}`} onClick={() => toggleActive(team)} className="!px-0 text-gray-600 hover:underline">
                        {team.active ? t("mfg.common.deactivate") : t("mfg.common.activate")}
                      </Button>
                      <Button variant="ghost" size="sm" loading={busyKey === `del-${team.id}`} onClick={() => remove(team)} className="!px-0 text-red-600 hover:underline">{t("mfg.common.delete")}</Button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {teams.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-gray-400">
                  {t("mfg.teams.noTeams")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        title={editing ? t("mfg.teams.editTitle", { name: editing.name }) : t("mfg.teams.addTitle")}
      >
        <form onSubmit={submit} className="grid grid-cols-1 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">{t("common.name")} *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} required placeholder={t("mfg.teams.namePlaceholder")} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">{t("common.description")}</label>
            <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t("common.optional")} className={inputCls} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm">{t("mfg.common.cancel")}</button>
            <Button type="submit" loading={saving}>
              {editing ? t("mfg.teams.saveTeam") : t("mfg.teams.addTitle")}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
