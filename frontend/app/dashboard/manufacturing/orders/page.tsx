"use client";

import Loading from "@/app/components/Loading";
import Modal from "@/app/components/Modal";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useToast } from "@/app/components/ToastProvider";
import { fmtCurrency } from "@/lib/currency";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { statusLabel } from "@/lib/statusLabel";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

// Stages that still allow editing / cancelling / deleting. Once an order is in
// PRODUCTION it belongs to the shop floor and can only move forward/complete.
const CANCELLABLE = ["DESIGN", "PURCHASING_MATERIALS", "MATERIAL_READY"];
const LOCKED = ["PRODUCTION", "COMPLETED", "CANCELLED"];
const DELETABLE = ["DESIGN", "PURCHASING_MATERIALS", "MATERIAL_READY", "QUEUED", "CANCELLED"];

const emptyForm = () => ({
  title: "",
  flowId: "",
  customerName: "",
  designCatalogId: "",
  bomId: "",
  targetQuantity: "",
  dueDate: "",
  notes: "",
});

// Completed orders carry a COGM snapshot (producedQuantity / cogmUnitCost…);
// fall back to the linked work order when present.
const producedOf = (o: any) =>
  (o?.producedQuantity ?? o?.workOrder?.producedQuantity ?? null) as number | null;
const unitCostOf = (o: any) =>
  (o?.cogmUnitCost ?? o?.workOrder?.cogmUnitCost ?? 0) as number;

const inputCls = "border p-2 rounded-lg w-full bg-white";
const labelCls = "block text-sm font-medium text-gray-500 mb-1";

export default function ManufacturingOrdersPage() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [flow, setFlow] = useState<any | null>(null);
  const [flows, setFlows] = useState<any[]>([]);
  const [activeFlowId, setActiveFlowId] = useState<string>(""); // "" = all flows
  const [activeTab, setActiveTab] = useState<string>("unassigned"); // step tab
  const [teams, setTeams] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [allJobs, setAllJobs] = useState<any[]>([]);
  const [boms, setBoms] = useState<any[]>([]);
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [detail, setDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const canManage = hasPermission("manufacturing.manage");

  const load = useCallback(async () => {
    try {
      const [f, q, b, fl, j, d] = await Promise.all([
        api.get("/manufacturing/order-flow").catch(() => ({ data: { flow: null, teams: [] } })),
        api.get("/manufacturing/orders/queue").catch(() => ({ data: [] })),
        api.get("/manufacturing/boms").catch(() => ({ data: [] })),
        api.get("/manufacturing/flows").catch(() => ({ data: [] })),
        api.get("/manufacturing/jobs").catch(() => ({ data: [] })),
        api.get("/manufacturing/catalog/items").catch(() => ({ data: [] })),
      ]);
      setFlow(f.data?.flow ?? null);
      setTeams(f.data?.teams ?? []);
      setOrders(q.data ?? []);
      setBoms(b.data ?? []);
      setFlows(fl.data ?? []);
      setAllJobs(j.data ?? []);
      setCatalogItems(d.data ?? []);
    } catch {
      toast.error(t("mfg.orders.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [toast, t]);
  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    const defaultFlow = flow ?? (flows.length ? flows[0] : null);
    setForm({ ...emptyForm(), flowId: defaultFlow ? String(defaultFlow.id) : "" });
    setShowForm(true);
  };

  const openEdit = (order: any) => {
    setEditing(order);
    setForm({
      title: order.title ?? "",
      flowId: "",
      customerName: order.customerName ?? "",
      designCatalogId: order.designCatalogId != null ? String(order.designCatalogId) : "",
      bomId: order.bomId != null ? String(order.bomId) : "",
      targetQuantity: order.targetQuantity != null ? String(order.targetQuantity) : "",
      dueDate: order.dueDate ? String(order.dueDate).slice(0, 10) : "",
      notes: order.notes ?? "",
    });
    setShowForm(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    if (!editing && !form.flowId) {
      toast.error(t("mfg.orders.chooseFlow"));
      return;
    }
    const payload = {
      title: form.title.trim(),
      customerName: form.customerName.trim() || undefined,
      designCatalogId: form.designCatalogId ? Number(form.designCatalogId) : undefined,
      bomId: form.bomId ? Number(form.bomId) : undefined,
      targetQuantity: form.targetQuantity ? Number(form.targetQuantity) : undefined,
      dueDate: form.dueDate || undefined,
      notes: form.notes.trim() || undefined,
      ...(form.flowId ? { flowId: Number(form.flowId) } : {}),
    };
    try {
      if (editing) {
        await api.patch(`/manufacturing/jobs/${editing.id}`, payload);
        toast.success(t("mfg.orders.updated"));
      } else {
        await api.post("/manufacturing/jobs", payload);
        toast.success(t("mfg.orders.added"));
      }
      setShowForm(false);
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.orders.saveFailed"));
    }
  };

  const act = async (order: any, action: "assign" | "advance" | "complete") => {
    try {
      if (action === "assign") {
        const targetFlowId = activeFlowId ? Number(activeFlowId) : flow?.id;
        if (!targetFlowId) return;
        await api.post(`/manufacturing/orders/${order.id}/assign-flow`, { flowId: targetFlowId });
        toast.success(t("mfg.orders.pipelineStarted"));
      } else if (action === "advance") {
        await api.post(`/manufacturing/orders/${order.id}/advance`, {});
        toast.success(t("mfg.orders.advanced"));
      } else {
        await api.post(`/manufacturing/orders/${order.id}/complete-delivery`, {});
        toast.success(t("mfg.orders.completed"));
      }
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.orders.actionFailed"));
    }
  };

  const cancelOrder = async (order: any) => {
    const ok = await confirm(t("mfg.orders.cancelConfirm", { number: order.jobNumber }));
    if (!ok) return;
    try {
      await api.patch(`/manufacturing/jobs/${order.id}/stage`, { stage: "CANCELLED" });
      toast.success(t("mfg.orders.cancelled"));
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.orders.cancelFailed"));
    }
  };

  const removeOrder = async (order: any) => {
    const ok = await confirm(t("mfg.orders.deleteConfirm", { number: order.jobNumber }));
    if (!ok) return;
    try {
      await api.delete(`/manufacturing/jobs/${order.id}`);
      toast.success(t("mfg.orders.deleted"));
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.orders.deleteFailed"));
    }
  };

  const openDetail = async (order: any) => {
    setDetail(null);
    setDetailLoading(true);
    try {
      const r = await api.get(`/manufacturing/jobs/${order.id}`);
      setDetail(r.data);
    } catch {
      toast.error(t("mfg.orders.detailFailed"));
    } finally {
      setDetailLoading(false);
    }
  };

  const teamName = (id: number | null | undefined) =>
    teams.find((row) => row.id === id)?.name ?? (id == null ? "—" : t("mfg.orders.teamHash", { id }));
  const bomName = (id: number | null | undefined) =>
    boms.find((b) => b.id === id)?.finishedProduct?.baseName ?? (id == null ? "—" : t("mfg.orders.bomHash", { id }));

  if (loading) return <Loading className="py-24" />;

  const activeFlow = activeFlowId
    ? flows.find((f) => f.id === Number(activeFlowId)) ?? null
    : null;
  const flowForTrail = activeFlow ?? flow;
  const sourceFlows = activeFlow ? [activeFlow] : flows;
  const laneTeams: { teamId: number; name: string }[] = [];
  for (const fl of sourceFlows) {
    for (const s of fl?.steps ?? []) {
      if (s.teamId == null) continue;
      if (!laneTeams.some((l) => l.teamId === s.teamId)) {
        laneTeams.push({
          teamId: s.teamId,
          name: s.team?.name ?? teamName(s.teamId),
        });
      }
    }
  }
  const activeTeamId = activeTab.startsWith("team-")
    ? Number(activeTab.slice("team-".length))
    : null;
  const matchesTab = (o: any, teamId: number | null) => {
    if (o.completedAt) return false;
    if (activeFlowId && o.flowId !== Number(activeFlowId)) return false;
    if (teamId == null) return !o.currentTeamId;
    return o.currentTeamId === teamId;
  };
  const countFor = (teamId: number | null) =>
    orders.filter((o) => matchesTab(o, teamId)).length;
  const here = orders.filter((o) => matchesTab(o, activeTeamId));
  const completedJobs = allJobs.filter(
    (o) => o.stage === "COMPLETED" || o.stage === "CANCELLED",
  );

  return (
    <div>
      <div className="flex justify-between items-center mb-1 flex-wrap gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">{t("mfg.orders.title")}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {t("mfg.orders.subtitle")}
          </p>
        </div>
        {canManage && (
          <button onClick={openCreate} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm whitespace-nowrap">
            {t("mfg.orders.newOrder")}
          </button>
        )}
      </div>

      {flows.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <button
            onClick={() => { setActiveFlowId(""); setActiveTab("unassigned"); }}
            className={`px-2.5 py-1 rounded-full border ${activeFlowId === "" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"}`}
          >
            {t("mfg.orders.allFlows")}
          </button>
          {flows.map((fl) => (
            <button
              key={fl.id}
              onClick={() => { setActiveFlowId(String(fl.id)); setActiveTab("unassigned"); }}
              className={`px-2.5 py-1 rounded-full border ${activeFlowId === String(fl.id) ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"}`}
            >
              {fl.name}
              {fl.isDefault ? t("mfg.orders.defaultSuffix") : ""}
            </button>
          ))}
        </div>
      )}

      {flowForTrail && (
        <p className="text-xs text-gray-500 mb-4">
          <span className="font-medium text-gray-600">{flowForTrail.name}:</span>{" "}
          {(flowForTrail.steps ?? []).map((s: any, i: number) => `${i > 0 ? " → " : ""}${s.team?.name ?? s.name}`).join("")}
        </p>
      )}

      <div className="mb-4 border-b border-gray-200">
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <button
            onClick={() => setActiveTab("unassigned")}
            className={`px-3 py-1.5 rounded-t-lg border-b-2 font-medium ${activeTab === "unassigned" ? "border-blue-600 text-blue-700 bg-blue-50" : "border-transparent text-gray-500 hover:text-gray-700"}`}
          >
            {t("mfg.orders.unassigned")} <span className="text-xs text-gray-400">({countFor(null)})</span>
          </button>
          {laneTeams.map((lt) => (
            <button
              key={lt.teamId}
              onClick={() => setActiveTab(`team-${lt.teamId}`)}
              className={`px-3 py-1.5 rounded-t-lg border-b-2 font-medium ${activeTab === `team-${lt.teamId}` ? "border-blue-600 text-blue-700 bg-blue-50" : "border-transparent text-gray-500 hover:text-gray-700"}`}
            >
              {lt.name} <span className="text-xs text-gray-400">({countFor(lt.teamId)})</span>
            </button>
          ))}
          <button
            onClick={() => setActiveTab("completed")}
            className={`px-3 py-1.5 rounded-t-lg border-b-2 font-medium ${activeTab === "completed" ? "border-blue-600 text-blue-700 bg-blue-50" : "border-transparent text-gray-500 hover:text-gray-700"}`}
          >
            {t("mfg.orders.completedTab")} <span className="text-xs text-gray-400">({completedJobs.length})</span>
          </button>
        </div>
      </div>

      {activeTab === "completed" ? (
        <div className="space-y-2">
          {completedJobs.map((o) => {
            const produced = o.producedQuantity ?? o.workOrder?.producedQuantity ?? null;
            const unitCost = o.cogmUnitCost ?? o.workOrder?.cogmUnitCost ?? 0;
            return (
              <div key={o.id} className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-gray-800">{o.title}</p>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${o.stage === "CANCELLED" ? "bg-red-100 text-red-600" : "bg-green-100 text-green-700"}`}>{statusLabel(o.stage)}</span>
                </div>
                <p className="text-xs text-gray-400">{o.jobNumber}{o.customerName ? ` · ${o.customerName}` : ""}</p>
                <div className="mt-1 space-y-0.5 text-xs text-gray-500">
                  {o.targetQuantity ? <p>{t("mfg.orders.qtyInline", { count: o.targetQuantity })}</p> : null}
                  {o.designCatalog?.name && <p>{t("mfg.orders.designInline", { name: o.designCatalog.name })}</p>}
                  {produced != null && unitCost > 0 && <p className="text-green-700 font-medium">{t("mfg.orders.producedInline", { qty: produced, cost: fmtCurrency(unitCost) })}</p>}
                  {o.completedAt ? <p>{t("mfg.orders.completedAt", { date: formatDateTime(o.completedAt) })}</p> : null}
                </div>
                <div className="mt-2 flex gap-2 text-xs">
                  <button onClick={() => openDetail(o)} className="text-blue-600 hover:underline">{t("mfg.orders.viewHistory")}</button>
                </div>
              </div>
            );
          })}
          {completedJobs.length === 0 && <p className="text-gray-400 text-center py-10 text-sm">{t("mfg.orders.noneCompleted")}</p>}
        </div>
      ) : (
        <>
      <div className="space-y-2">
        {here.map((o) => {
          const unassigned = !o.currentTeamId;
          const ownSteps = o.flow?.steps ?? [];
          const stepIndex = o.currentStepIndex ?? -1;
          const curStep = ownSteps[stepIndex];
          const ops = curStep?.operations ?? [];
          const opIdx = o.currentOperationId != null ? ops.findIndex((x: any) => x.id === o.currentOperationId) : -1;
          const curOp = opIdx >= 0 ? ops[opIdx] : undefined;
          const nextOp = opIdx >= 0 ? ops[opIdx + 1] : (ops.length ? ops[0] : undefined);
          const nextStep = ownSteps[stepIndex + 1];
          const isFinal = !unassigned && ownSteps.length > 0 && stepIndex >= ownSteps.length - 1;
          const produced = o.producedQuantity ?? o.workOrder?.producedQuantity ?? null;
          const unitCost = o.cogmUnitCost ?? o.workOrder?.cogmUnitCost ?? 0;
          const showEdit = canManage && !LOCKED.includes(o.stage);
          const showCancel = canManage && CANCELLABLE.includes(o.stage);
          const showDelete = canManage && DELETABLE.includes(o.stage);
          const passAction = !isFinal && nextStep ? (
            <button onClick={() => act(o, "advance")} className="text-blue-600 hover:underline">
              {ops.length
                ? t("mfg.orders.passTo", { team: teamName(nextStep.teamId ?? null) })
                : t("mfg.orders.passTo", { team: teamName(nextStep.teamId ?? null) })}
            </button>
          ) : null;
          return (
            <div key={o.id} className="bg-white border border-gray-200 rounded-lg p-3 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-gray-800">{o.title}</p>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 shrink-0">{statusLabel(o.stage)}</span>
              </div>
              <p className="text-xs text-gray-400">{o.jobNumber}{o.customerName ? ` · ${o.customerName}` : ""}</p>
              <div className="mt-1 space-y-0.5 text-xs text-gray-500">
                {curStep?.operations?.length ? <p className="text-[11px] text-purple-700">{t("mfg.orders.opsInline", { list: ops.map((x: any) => x.name).join(" → ") })}{curOp ? t("mfg.orders.currentOpInline", { name: curOp.name }) : ""}</p> : null}
                {o.bomId != null && <p>{t("mfg.orders.productInline", { name: bomName(o.bomId) })}</p>}
                {o.designCatalog?.name && (
                  <p>
                    {t("mfg.orders.designInline", { name: "" })}
                    <a href="/dashboard/manufacturing/catalog" className="text-blue-600 hover:underline">
                      {o.designCatalog.name}
                    </a>
                  </p>
                )}
                {o.targetQuantity ? <p>{t("mfg.orders.qtyInline", { count: o.targetQuantity })}</p> : null}
                {o.dueDate ? <p>{t("mfg.orders.dueInline", { date: formatDate(o.dueDate) })}</p> : null}
                {produced != null && unitCost > 0 && (
                  <p className="text-green-700 font-medium">{t("mfg.orders.producedInline", { qty: produced, cost: fmtCurrency(unitCost) })}</p>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <button onClick={() => openDetail(o)} className="text-gray-600 hover:underline">{t("mfg.orders.details")}</button>
                {canManage && unassigned && flow && (
                  <button onClick={() => act(o, "assign")} className="text-blue-600 hover:underline">{t("mfg.orders.startPipeline")}</button>
                )}
                {canManage && !unassigned && ops.length && (
                  o.currentOperationId == null ? (
                    <button onClick={() => act(o, "advance")} className="text-blue-600 hover:underline">{t("mfg.orders.startOp", { name: ops[0].name })}</button>
                  ) : nextOp ? (
                    <button onClick={() => act(o, "advance")} className="text-blue-600 hover:underline">{t("mfg.orders.nextOpLabel", { name: nextOp.name })}</button>
                  ) : isFinal ? (
                    <button onClick={() => act(o, "complete")} className="text-green-600 hover:underline">{t("mfg.orders.completeSettle")}</button>
                  ) : null
                )}
                {canManage && !unassigned && !ops.length && passAction}
                {canManage && !unassigned && !ops.length && isFinal && (
                  <button onClick={() => act(o, "complete")} className="text-green-600 hover:underline">{t("mfg.orders.completeSettle")}</button>
                )}
                {showEdit && <button onClick={() => openEdit(o)} className="text-gray-700 hover:underline">{t("mfg.common.edit")}</button>}
                {showCancel && <button onClick={() => cancelOrder(o)} className="text-orange-600 hover:underline">{t("mfg.common.cancel")}</button>}
                {showDelete && <button onClick={() => removeOrder(o)} className="text-red-600 hover:underline">{t("mfg.common.delete")}</button>}
              </div>
            </div>
          );
        })}
        {here.length === 0 && <p className="text-gray-400 text-center py-10 text-sm">{t("mfg.orders.noneInStep")}</p>}
      </div>
        </>
      )}

      <Modal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); }}
        title={editing ? t("mfg.orders.editTitle", { number: editing.jobNumber ?? "" }) : t("mfg.orders.newTitle")}
      >
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className={labelCls}>{t("mfg.orders.titleLabel")}</label>
            <input className={inputCls} required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t("mfg.orders.titlePlaceholder")} />
          </div>
          {!editing && (
            <div>
              <label className={labelCls}>{t("mfg.orders.flowLabel")}</label>
              <select required className={inputCls} value={form.flowId} onChange={(e) => setForm({ ...form, flowId: e.target.value })}>
                <option value="">{t("mfg.orders.selectFlow")}</option>
                {flows.filter((fl: any) => fl.active).map((fl: any) => (
                  <option key={fl.id} value={fl.id}>{fl.name}{fl.isDefault ? t("mfg.orders.defaultSuffix") : ""}</option>
                ))}
              </select>
              <p className="text-[11px] text-gray-400 mt-1">{t("mfg.orders.flowHint")}</p>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>{t("mfg.orders.customerLabel")}</label>
              <input className={inputCls} value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} placeholder={t("mfg.common.optional")} />
            </div>
            <div>
              <label className={labelCls}>{t("mfg.orders.designCatalogLabel")}</label>
              <select
                className={inputCls}
                value={form.designCatalogId}
                onChange={(e) => {
                  const id = e.target.value;
                  const item = catalogItems.find((x) => String(x.id) === id);
                  const next: any = { ...form, designCatalogId: id };
                  if (!form.bomId && item?.defaultBomId) {
                    next.bomId = String(item.defaultBomId);
                  }
                  setForm(next);
                }}
              >
                <option value="">{t("mfg.orders.noneOption")}</option>
                {catalogItems.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.sku ? `${it.sku} · ` : ""}
                    {it.name}
                  </option>
                ))}
              </select>
              {form.designCatalogId && !form.bomId && (
                <p className="text-[11px] text-gray-400 mt-1">
                  {catalogItems.find((x) => String(x.id) === form.designCatalogId)?.defaultBomId
                    ? t("mfg.orders.defaultBomApplied")
                    : t("mfg.orders.noDefaultBom")}
                </p>
              )}
            </div>
            <div>
              <label className={labelCls}>{t("mfg.orders.bomLabel")}</label>
              <select className={inputCls} value={form.bomId} onChange={(e) => setForm({ ...form, bomId: e.target.value })}>
                <option value="">—</option>
                {boms.map((b) => (
                  <option key={b.id} value={b.id}>{b.finishedProduct?.baseName ?? `BOM #${b.id}`}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>{t("mfg.orders.targetQtyLabel")}</label>
              <input type="number" min="0.0001" step="any" className={inputCls} value={form.targetQuantity} onChange={(e) => setForm({ ...form, targetQuantity: e.target.value })} placeholder={t("mfg.common.optional")} />
            </div>
            <div>
              <label className={labelCls}>{t("mfg.orders.dueDateLabel")}</label>
              <input type="date" className={inputCls} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
            </div>
          </div>
          <div>
            <label className={labelCls}>{t("mfg.orders.notesLabel")}</label>
            <textarea rows={2} className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t("mfg.common.optional")} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm">{t("mfg.common.cancel")}</button>
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">
              {editing ? t("mfg.orders.saveOrder") : t("mfg.orders.addOrder")}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={!!detail || detailLoading}
        onClose={() => setDetail(null)}
        title={t("mfg.orders.detailTitle")}
      >
        {detailLoading && <p className="text-sm text-gray-500 py-6 text-center">{t("common.loading")}</p>}
        {detail && (
          <div className="space-y-4 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-gray-800">{detail.title}</p>
                <p className="text-xs text-gray-400">
                  {detail.jobNumber}
                  {detail.customerName ? ` · ${detail.customerName}` : ""}
                </p>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 shrink-0">{statusLabel(detail.stage)}</span>
            </div>

            {detail.designCatalog && (
              <div className="flex items-start gap-3 rounded-lg border border-blue-100 bg-blue-50/60 p-3">
                {detail.designCatalog.mediaUrls?.[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={detail.designCatalog.mediaUrls[0]}
                    alt={detail.designCatalog.name}
                    className="h-14 w-14 rounded object-cover"
                  />
                ) : null}
                <div className="text-xs text-gray-600">
                  <p className="font-medium text-gray-800">
                    {t("mfg.orders.designInline", { name: `${detail.designCatalog.name}${detail.designCatalog.sku ? ` · ${detail.designCatalog.sku}` : ""}` })}
                  </p>
                  {(detail.designCatalog.specifications?.dimensions ||
                    detail.designCatalog.specifications?.materials ||
                    detail.designCatalog.specifications?.finish) && (
                    <p className="mt-0.5">
                      {[
                        detail.designCatalog.specifications.dimensions,
                        detail.designCatalog.specifications.materials,
                        detail.designCatalog.specifications.finish,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                  <a href="/dashboard/manufacturing/catalog" className="text-blue-600 hover:underline mt-0.5 inline-block">
                    {t("mfg.orders.viewInCatalog")}
                  </a>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 bg-gray-50 rounded-lg p-3">
              <div>
                <span className="block text-xs text-gray-400">{t("mfg.orders.productLabel")}</span>
                <span className="font-medium">{detail.bom?.finishedProduct?.baseName ?? "—"}</span>
              </div>
              <div>
                <span className="block text-xs text-gray-400">{t("mfg.orders.currentTeam")}</span>
                <span className="font-medium">{detail.currentTeamId ? teamName(detail.currentTeamId) : t("mfg.orders.unassigned")}</span>
              </div>
              <div>
                <span className="block text-xs text-gray-400">{t("mfg.orders.targetQtyLabel")}</span>
                <span className="font-medium">{detail.targetQuantity ?? "—"}</span>
              </div>
              <div>
                <span className="block text-xs text-gray-400">{t("mfg.orders.dueDateLabel")}</span>
                <span className="font-medium">{detail.dueDate ? formatDate(detail.dueDate) : "—"}</span>
              </div>
              {producedOf(detail) != null && (
                <>
                  <div>
                    <span className="block text-xs text-gray-400">{t("mfg.orders.producedLabel")}</span>
                    <span className="font-medium text-green-700">{producedOf(detail)}</span>
                  </div>
                  <div>
                    <span className="block text-xs text-gray-400">{t("mfg.orders.cogmUnit")}</span>
                    <span className="font-medium">{fmtCurrency(unitCostOf(detail))}</span>
                  </div>
                </>
              )}
              <div>
                <span className="block text-xs text-gray-400">{t("mfg.orders.pipelineLabel")}</span>
                <span className="font-medium">{detail.flow?.name ?? t("mfg.orders.notOnFlow")}</span>
              </div>
              {detail.notes && <p className="col-span-2 text-gray-600">{detail.notes}</p>}
            </div>

            {detail.flow && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {(detail.flow.steps ?? []).map((s: any, i: number) => (
                  <span key={s.id ?? i} className="inline-flex items-center gap-1">
                    {i > 0 && <span className="text-gray-400">→</span>}
                    <span className={`px-2 py-0.5 rounded-md ${s.teamId === detail.currentTeamId ? "bg-blue-100 text-blue-800 font-semibold" : "bg-gray-100 text-gray-600"}`}>
                      {s.team?.name ?? s.name ?? t("mfg.orders.stepN", { n: i + 1 })}
                    </span>
                  </span>
                ))}
              </div>
            )}

            <div className="border-t pt-3">
              <p className="text-xs font-semibold text-gray-400 uppercase mb-2">{t("mfg.orders.stageHistory")}</p>
              {detail.history?.length ? (
                <ul className="space-y-1.5">
                  {detail.history.map((h: any) => (
                    <li key={h.id} className="text-xs text-gray-600">
                      {h.fromStage ? statusLabel(h.fromStage) : "—"} → {statusLabel(h.toStage)}
                      <span className="text-gray-400"> · {formatDateTime(h.createdAt)}{h.actorName ? ` · ${h.actorName}` : ""}</span>
                      {h.note && <p className="text-gray-400 pl-2">{h.note}</p>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-gray-400">{t("mfg.orders.noStageHistory")}</p>
              )}
            </div>

            {detail.handovers?.length ? (
              <div className="border-t pt-3">
                <p className="text-xs font-semibold text-gray-400 uppercase mb-2">{t("mfg.orders.handovers")}</p>
                <ul className="space-y-1.5">
                  {detail.handovers.map((hv: any) => (
                    <li key={hv.id} className="text-xs text-gray-600">
                      {hv.fromTeamId ? teamName(hv.fromTeamId) : t("mfg.orders.unassigned")} → {hv.toTeamId ? teamName(hv.toTeamId) : t("mfg.orders.delivered")}
                      <span className="text-gray-400"> · {formatDateTime(hv.createdAt)}{hv.actorName ? ` · ${hv.actorName}` : ""}</span>
                      {hv.note && <p className="text-gray-400 pl-2">{hv.note}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </Modal>
    </div>
  );
}
