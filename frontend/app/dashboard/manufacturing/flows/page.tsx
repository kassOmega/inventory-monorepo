"use client";

import Loading from "@/app/components/Loading";
import Modal from "@/app/components/Modal";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useToast } from "@/app/components/ToastProvider";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useState } from "react";

type StepRow = { teamId: string; isProductionStep: boolean; ops: string[] };

const inputCls = "border p-2 rounded-lg w-full bg-white";

const emptyForm = () => ({
  name: "",
  description: "",
  isDefault: false,
  active: true,
  steps: [] as StepRow[],
});

const stepName = (row: StepRow, teams: any[]) => {
  const t = teams.find((x) => String(x.id) === String(row.teamId));
  return t?.name ?? "Unassigned";
};

export default function ManufacturingFlowsPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
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
      toast.error("Failed to load flows");
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
        toast.success("Flow updated");
      } else {
        await api.post("/manufacturing/flows", payload);
        toast.success("Flow created");
      }
      setShowForm(false);
      setEditing(null);
      setForm(emptyForm());
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to save flow");
    }
  };

  const setDefault = async (flow: any) => {
    try {
      await api.post(`/manufacturing/flows/${flow.id}/default`);
      toast.success("Default flow updated");
      load();
    } catch {
      toast.error("Failed to update default");
    }
  };

  const toggleActive = async (flow: any) => {
    try {
      await api.patch(`/manufacturing/flows/${flow.id}`, { active: !flow.active });
      toast.success("Updated");
      load();
    } catch {
      toast.error("Failed to update");
    }
  };

  const remove = async (flow: any) => {
    const ok = await confirm(`Delete flow "${flow.name}"?`);
    if (!ok) return;
    try {
      await api.delete(`/manufacturing/flows/${flow.id}`);
      toast.success("Flow deleted");
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to delete flow");
    }
  };

  if (loading) return <Loading className="py-24" />;

  return (
    <div>
      <div className="flex justify-between items-center mb-1 flex-wrap gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">Production Flows / Process</h1>
          <p className="text-sm text-gray-500 mt-1">
            Each production flow is an ordered sequence of teams an order passes through. When you create an order, pick its flow — the order only follows those steps. Mark one step as the production/build step to auto-link a Work Order.
          </p>
        </div>
        {canManage && (
          <button
            onClick={openCreate}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm whitespace-nowrap"
          >
            + New Production Flow
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
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-600 text-white font-semibold">Default</span>
                    )}
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${flow.active ? "bg-green-100 text-green-800" : "bg-gray-200 text-gray-500"}`}>
                      {flow.active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  {flow.description && <p className="text-xs text-gray-500 mt-1">{flow.description}</p>}
                </div>
                {canManage && (
                  <div className="flex gap-2 text-xs shrink-0">
                    {!flow.isDefault && (
                      <button onClick={() => setDefault(flow)} className="text-blue-600 hover:underline">Set default</button>
                    )}
                    <button onClick={() => openEdit(flow)} className="text-gray-600 hover:underline">Edit</button>
                    <button onClick={() => toggleActive(flow)} className="text-gray-500 hover:underline">
                      {flow.active ? "Disable" : "Enable"}
                    </button>
                    <button onClick={() => remove(flow)} className="text-red-600 hover:underline">Delete</button>
                  </div>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {steps.length === 0 && <span className="text-xs text-gray-400">No steps — orders stop at the first team only.</span>}
                {steps.map((s: any, i: number) => (
                  <span key={s.id ?? i} className="inline-flex items-center gap-1 text-xs">
                    {i > 0 && <span className="text-gray-400">→</span>}
                    <span className={`px-2 py-0.5 rounded-md border ${s.isProductionStep ? "bg-purple-50 border-purple-200 text-purple-800 font-medium" : "bg-gray-100 border-gray-200 text-gray-700"}`}>
                      {s.team?.name ?? s.name ?? "Unassigned"}
                      {s.isProductionStep ? " ⚙" : ""}
                    </span>
                  </span>
                ))}
              </div>

              <p className="mt-3 text-[11px] text-gray-400">
                {flow._count?.orders ?? 0} order(s) routed through this flow
              </p>
            </div>
          );
        })}
        {flows.length === 0 && (
          <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-400">
            No production flows yet — create your first process (e.g. Intake → Design → Production ⚙ → QC → Delivery).
          </div>
        )}
      </div>

      <Modal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        title={editing ? `Edit Production Flow — ${editing.name}` : "New Production Flow"}
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">Name *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} required placeholder="e.g. Make-to-order pipeline" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">Description</label>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputCls} placeholder="Optional" />
            </div>
          </div>
          <div className="flex gap-6 text-sm text-gray-700">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} className="rounded" />
              Default flow
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="rounded" />
              Active
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium text-gray-500">Steps (in order)</p>
              <button
                type="button"
                onClick={() => setForm((f) => ({
                  ...f,
                  steps: [...f.steps, { teamId: teams.length ? String(teams[0].id) : "", isProductionStep: false, ops: [] }],
                }))}
                className="text-xs text-blue-600 hover:underline"
              >
                + Add team step
              </button>
            </div>
            {teams.length === 0 && (
              <p className="text-xs text-amber-600 mb-2">No teams yet — add teams on the Teams page first.</p>
            )}
            {form.steps.length === 0 ? (
              <p className="text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg p-3 text-center">
                No steps yet — pick the teams in order and mark which one performs the build (⚙).
              </p>
            ) : (
              <div className="space-y-2">
                {form.steps.map((step, i) => (
                  <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg p-2">
                    <span className="text-xs text-gray-400 w-6 text-center shrink-0">{i + 1}</span>
                    <select value={step.teamId} onChange={(e) => updateStep(i, { teamId: e.target.value })} className={inputCls}>
                      <option value="">No team</option>
                      {teams.filter((t: any) => t.active || String(t.id) === String(step.teamId)).map((t: any) => (
                        <option key={t.id} value={t.id}>{t.name}{!t.active ? " (inactive)" : ""}</option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1.5 text-xs text-gray-600 whitespace-nowrap shrink-0">
                      <input
                        type="checkbox"
                        checked={step.isProductionStep}
                        onChange={(e) => updateStep(i, { isProductionStep: e.target.checked })}
                        className="rounded"
                      />
                      Production / Build
                    </label>
                    <div className="flex-1 min-w-[190px] space-y-1">
                      <div className="flex flex-wrap items-center gap-1">
                        {step.ops.length === 0 && <span className="text-[10px] text-gray-400">No operations — one-hop step</span>}
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
                          placeholder="Add operation (e.g. Assembly)"
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
                        <button type="button" onClick={() => { const v = (opDraft[i] ?? "").trim(); if (v) { updateStep(i, { ops: [...step.ops, v] }); setOpDraft((d) => ({ ...d, [i]: "" })); } }} className="text-blue-600 text-xs whitespace-nowrap">+ Op</button>
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
            <button type="button" onClick={() => setShowForm(false)} className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm">Cancel</button>
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">
              {editing ? "Save Flow" : "Create Flow"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

