"use client";

import Loading from "@/app/components/Loading";
import Modal from "@/app/components/Modal";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useToast } from "@/app/components/ToastProvider";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type StepRow = { teamId: string; isProductionStep: boolean; ops: string[] };

const inputCls = "border p-2 rounded-lg w-full bg-white";

const emptyForm = () => ({
  name: "",
  description: "",
  isDefault: false,
  active: true,
  steps: [] as StepRow[],
});

export default function ManufacturingFlowsPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { t } = useTranslation();
  const [flows, setFlows] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [opDraft, setOpDraft] = useState<Record<number, string>>({});
  const canManage = hasPermission("manufacturing.manage");

  const load = useCallback(async () => {
    try {
      const [f, t] = await Promise.all([
        api.get("/manufacturing/flows"),
        api.get("/manufacturing/teams").catch(() => ({ data: [] })),
      ]);
      setFlows(f.data ?? []);
      setTeams(t.data ?? []);
    } catch {
      toast.error(t("mfg.flows.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setShowForm(true);
  };

  const openEdit = (flow: any) => {
    setEditing(flow);
    setForm({
      name: flow.name,
      description: flow.description ?? "",
      isDefault: flow.isDefault,
      active: flow.active,
      steps: (flow.steps ?? []).map((s: any) => ({
        teamId: s.teamId != null ? String(s.teamId) : "",
        isProductionStep: s.isProductionStep === true,
        ops: (s.operations ?? []).map((o: any) => o.name),
      })),
    });
    setShowForm(true);
  };

  const updateStep = (index: number, patch: Partial<StepRow>) => {
    setForm((f) => ({
      ...f,
      steps: f.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
  };
  const moveStep = (index: number, dir: -1 | 1) => {
    setForm((f) => {
      const steps = [...f.steps];
      const target = index + dir;
      if (target < 0 || target >= steps.length) return f;
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...f, steps };
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const payload = {
      name: form.name,
      description: form.description || null,
      isDefault: form.isDefault,
      active: form.active,
      steps: form.steps
        .filter((s) => s.teamId !== "")
        .map((s) => ({
          teamId: Number(s.teamId),
          isProductionStep: s.isProductionStep,
          operations: s.ops,
        })),
    };
    try {
      if (editing) {
        await api.patch(`/manufacturing/flows/${editing.id}`, payload);
        toast.success(t("mfg.flows.updated"));
      } else {
        await api.post("/manufacturing/flows", payload);
        toast.success(t("mfg.flows.created"));
      }
      setShowForm(false);
      setEditing(null);
      setForm(emptyForm());
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.flows.saveFailed"));
    }
  };

  const setDefault = async (flow: any) => {
    try {
      await api.post(`/manufacturing/flows/${flow.id}/default`);
      toast.success(t("mfg.flows.defaultUpdated"));
      load();
    } catch {
      toast.error(t("mfg.flows.defaultFailed"));
    }
  };

  const toggleActive = async (flow: any) => {
    try {
      await api.patch(`/manufacturing/flows/${flow.id}`, { active: !flow.active });
      toast.success(t("mfg.common.updated"));
      load();
    } catch {
      toast.error(t("mfg.common.updateFailed"));
    }
  };

  const remove = async (flow: any) => {
    const ok = await confirm(t("mfg.flows.deleteConfirm", { name: flow.name }));
    if (!ok) return;
    try {
      await api.delete(`/manufacturing/flows/${flow.id}`);
      toast.success(t("mfg.flows.deleted"));
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.flows.deleteFailed"));
    }
  };

  if (loading) return <Loading className="py-24" />;

  return (
    <div>
      <div className="flex justify-between items-center mb-1 flex-wrap gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">{t("mfg.flows.title")}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {t("mfg.flows.subtitle")}
          </p>
        </div>
        {canManage && (
          <button
            onClick={openCreate}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm whitespace-nowrap"
          >
            {t("mfg.flows.addFlow")}
          </button>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {flows.map((flow) => {
          const steps = flow.steps ?? [];
          return (
            <div key={flow.id} className={`bg-white border rounded-xl p-4 shadow-sm ${flow.isDefault ? "border-blue-300 ring-1 ring-blue-100" : "border-gray-200"}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-semibold text-gray-800">{flow.name}</h2>
                    {flow.isDefault && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-600 text-white font-semibold">{t("mfg.flows.badgeDefault")}</span>
                    )}
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${flow.active ? "bg-green-100 text-green-800" : "bg-gray-200 text-gray-500"}`}>
                      {flow.active ? t("status.active") : t("status.inactive")}
                    </span>
                  </div>
                  {flow.description && <p className="text-xs text-gray-500 mt-1">{flow.description}</p>}
                </div>
                {canManage && (
                  <div className="flex gap-2 text-xs shrink-0">
                    {!flow.isDefault && (
                      <button onClick={() => setDefault(flow)} className="text-blue-600 hover:underline">{t("mfg.flows.setDefault")}</button>
                    )}
                    <button onClick={() => openEdit(flow)} className="text-gray-600 hover:underline">{t("mfg.common.edit")}</button>
                    <button onClick={() => toggleActive(flow)} className="text-gray-500 hover:underline">
                      {flow.active ? t("mfg.flows.disable") : t("mfg.flows.enable")}
                    </button>
                    <button onClick={() => remove(flow)} className="text-red-600 hover:underline">{t("mfg.common.delete")}</button>
                  </div>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {steps.length === 0 && <span className="text-xs text-gray-400">{t("mfg.flows.noSteps")}</span>}
                {steps.map((s: any, i: number) => (
                  <span key={s.id ?? i} className="inline-flex items-center gap-1 text-xs">
                    {i > 0 && <span className="text-gray-400">→</span>}
                    <span className={`px-2 py-0.5 rounded-md border ${s.isProductionStep ? "bg-purple-50 border-purple-200 text-purple-800 font-medium" : "bg-gray-100 border-gray-200 text-gray-700"}`}>
                      {s.team?.name ?? s.name ?? t("mfg.flows.unassigned")}
                      {s.isProductionStep ? " ⚙" : ""}
                    </span>
                  </span>
                ))}
              </div>

              <p className="mt-3 text-[11px] text-gray-400">
                {t("mfg.flows.ordersRouted", { count: flow._count?.orders ?? 0 })}
              </p>
            </div>
          );
        })}
        {flows.length === 0 && (
          <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-400">
            {t("mfg.flows.none")}
          </div>
        )}
      </div>

      <Modal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        title={editing ? t("mfg.flows.editTitle", { name: editing.name }) : t("mfg.flows.addTitle")}
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">{t("mfg.flows.nameLabel")}</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} required placeholder={t("mfg.flows.namePlaceholder")} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">{t("mfg.flows.descriptionLabel")}</label>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputCls} placeholder={t("mfg.common.optional")} />
            </div>
          </div>
          <div className="flex gap-6 text-sm text-gray-700">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} className="rounded" />
              {t("mfg.flows.defaultFlowLabel")}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="rounded" />
              {t("mfg.flows.activeLabel")}
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium text-gray-500">{t("mfg.flows.stepsLabel")}</p>
              <button
                type="button"
                onClick={() => setForm((f) => ({
                  ...f,
                  steps: [...f.steps, { teamId: teams.length ? String(teams[0].id) : "", isProductionStep: false, ops: [] }],
                }))}
                className="text-xs text-blue-600 hover:underline"
              >
                {t("mfg.flows.addTeamStep")}
              </button>
            </div>
            {teams.length === 0 && (
              <p className="text-xs text-amber-600 mb-2">{t("mfg.flows.noTeams")}</p>
            )}
            {form.steps.length === 0 ? (
              <p className="text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg p-3 text-center">
                {t("mfg.flows.noStepsHint")}
              </p>
            ) : (
              <div className="space-y-2">
                {form.steps.map((step, i) => (
                  <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg p-2">
                    <span className="text-xs text-gray-400 w-6 text-center shrink-0">{i + 1}</span>
                    <select value={step.teamId} onChange={(e) => updateStep(i, { teamId: e.target.value })} className={inputCls}>
                      <option value="">{t("mfg.flows.noTeam")}</option>
                      {teams.filter((tm: any) => tm.active || String(tm.id) === String(step.teamId)).map((tm: any) => (
                        <option key={tm.id} value={tm.id}>{tm.name}{!tm.active ? t("mfg.flows.inactiveSuffix") : ""}</option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1.5 text-xs text-gray-600 whitespace-nowrap shrink-0">
                      <input
                        type="checkbox"
                        checked={step.isProductionStep}
                        onChange={(e) => updateStep(i, { isProductionStep: e.target.checked })}
                        className="rounded"
                      />
                      {t("mfg.flows.productionStepLabel")}
                    </label>
                    <div className="flex-1 min-w-[190px] space-y-1">
                      <div className="flex flex-wrap items-center gap-1">
                        {step.ops.length === 0 && <span className="text-[10px] text-gray-400">{t("mfg.flows.noOperations")}</span>}
                        {step.ops.map((op, oi) => (
                          <span key={oi} className="inline-flex items-center gap-1 bg-purple-50 border border-purple-200 text-purple-800 text-[11px] px-2 py-0.5 rounded-full">
                            {op}
                            <button type="button" onClick={() => updateStep(i, { ops: step.ops.filter((_, x) => x !== oi) })} className="hover:text-red-600">✕</button>
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-1">
                        <input
                          className="border p-1 rounded text-xs flex-1"
                          placeholder={t("mfg.flows.addOperationPlaceholder")}
                          value={opDraft[i] ?? ""}
                          onChange={(e) => setOpDraft((d) => ({ ...d, [i]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              const v = (opDraft[i] ?? "").trim();
                              if (v) { updateStep(i, { ops: [...step.ops, v] }); setOpDraft((d) => ({ ...d, [i]: "" })); }
                            }
                          }}
                        />
                        <button type="button" onClick={() => { const v = (opDraft[i] ?? "").trim(); if (v) { updateStep(i, { ops: [...step.ops, v] }); setOpDraft((d) => ({ ...d, [i]: "" })); } }} className="text-blue-600 text-xs whitespace-nowrap">{t("mfg.flows.addOp")}</button>
                      </div>
                    </div>
                    <div className="flex gap-1 text-xs shrink-0">
                      <button type="button" onClick={() => moveStep(i, -1)} disabled={i === 0} className="text-gray-500 disabled:opacity-30">↑</button>
                      <button type="button" onClick={() => moveStep(i, 1)} disabled={i === form.steps.length - 1} className="text-gray-500 disabled:opacity-30">↓</button>
                      <button type="button" onClick={() => setForm((f) => ({ ...f, steps: f.steps.filter((_, x) => x !== i) }))} className="text-red-500 hover:underline">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm">{t("mfg.common.cancel")}</button>
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">
              {editing ? t("mfg.flows.saveFlow") : t("mfg.flows.createFlow")}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

