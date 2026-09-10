"use client";

import Loading from "@/app/components/Loading";
import Modal from "@/app/components/Modal";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useToast } from "@/app/components/ToastProvider";
import { fmtCurrency } from "@/lib/currency";
import { statusLabel } from "@/lib/statusLabel";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const STAGES = [
  "DESIGN",
  "PURCHASING_MATERIALS",
  "MATERIAL_READY",
  "QUEUED",
  "PRODUCTION",
  "COMPLETED",
  "CANCELLED",
];

const NEXT: Record<string, string> = {
  DESIGN: "PURCHASING_MATERIALS",
  PURCHASING_MATERIALS: "MATERIAL_READY",
  MATERIAL_READY: "QUEUED",
  QUEUED: "PRODUCTION",
  PRODUCTION: "COMPLETED",
};

const emptyForm = () => ({
  title: "",
  customerName: "",
  bomId: "",
  targetQuantity: "",
  dueDate: "",
  notes: "",
});

// Completed jobs carry a COGM snapshot copied from their linked work order
// (producedQuantity / totalCogmCost / cogmUnitCost); older jobs fall back to
// the live work order when one exists.
const producedOf = (j: any) =>
  (j?.producedQuantity ?? j?.workOrder?.producedQuantity ?? null) as number | null;
const cogmUnitOf = (j: any) =>
  (j?.cogmUnitCost ?? j?.workOrder?.cogmUnitCost ?? 0) as number;
const cogmTotalOf = (j: any) =>
  (j?.totalCogmCost ?? j?.workOrder?.totalCogmCost ?? 0) as number;

export default function ManufacturingJobsPage() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [jobs, setJobs] = useState<any[]>([]);
  const [boms, setBoms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [detail, setDetail] = useState<any | null>(null);

  const canManage = hasPermission("manufacturing.manage");

  const load = useCallback(async () => {
    try {
      const [j, b] = await Promise.all([
        api.get("/manufacturing/jobs"),
        api.get("/manufacturing/boms").catch(() => ({ data: [] })),
      ]);
      setJobs(j.data ?? []);
      setBoms(b.data ?? []);
    } catch {
      toast.error(t("mfg.jobs.failedLoad"));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs.filter((j) => {
      if (stageFilter && j.stage !== stageFilter) return false;
      if (!q) return true;
      const hay = `${j.jobNumber} ${j.title} ${j.customerName ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [jobs, search, stageFilter]);

  const openDetail = async (job: any) => {
    try {
      const r = await api.get(`/manufacturing/jobs/${job.id}`);
      setDetail(r.data);
    } catch {
      toast.error(t("mfg.jobs.failedLoad"));
    }
  };

  const advance = async (job: any) => {
    const next = NEXT[job.stage];
    if (!next) return;
    try {
      await api.patch(`/manufacturing/jobs/${job.id}/stage`, { stage: next });
      toast.success(t("mfg.jobs.stageUpdated"));
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.jobs.failedSave"));
    }
  };

  const cancelJob = async (job: any) => {
    const ok = await confirm(t("mfg.jobs.cancelConfirm", { job: job.jobNumber }));
    if (!ok) return;
    try {
      await api.patch(`/manufacturing/jobs/${job.id}/stage`, { stage: "CANCELLED" });
      toast.success(t("mfg.jobs.stageUpdated"));
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.jobs.failedSave"));
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title) return;
    try {
      await api.post("/manufacturing/jobs", {
        title: form.title,
        customerName: form.customerName || undefined,
        bomId: form.bomId ? Number(form.bomId) : undefined,
        targetQuantity: form.targetQuantity ? Number(form.targetQuantity) : undefined,
        dueDate: form.dueDate || undefined,
        notes: form.notes || undefined,
      });
      toast.success(t("mfg.jobs.created"));
      setShowCreate(false);
      setForm(emptyForm());
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.jobs.failedSave"));
    }
  };

  const label = (text: string, required?: boolean) => (
    <label className="block text-sm font-medium text-gray-500 mb-1">
      {text}
      {required && <span className="text-red-500"> *</span>}
    </label>
  );

  if (loading) return <Loading className="py-24" />;

  return (
    <div>
      <div className="flex justify-between items-start md:items-center mb-6 gap-3">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">{t("mfg.jobs.title")}</h1>
        {canManage && (
          <button onClick={() => setShowCreate(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg whitespace-nowrap text-sm">
            {t("mfg.jobs.newJob")}
          </button>
        )}
      </div>
      <div className="flex flex-col sm:flex-row gap-2 mb-6">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("mfg.jobs.searchPlaceholder")}
          aria-label={t("mfg.jobs.searchPlaceholder")}
          className="border p-2 rounded-lg flex-1 text-sm"
        />
        <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="border p-2 rounded-lg bg-white text-sm">
          <option value="">{t("mfg.jobs.allStages")}</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>{statusLabel(s)}</option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[820px] text-xs sm:text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="p-2 sm:p-3 md:p-4">{t("mfg.jobs.colJob")}</th>
                <th className="p-2 sm:p-3 md:p-4">{t("mfg.jobs.colCustomer")}</th>
                <th className="p-2 sm:p-3 md:p-4">{t("mfg.jobs.colProduct")}</th>
                <th className="p-2 sm:p-3 md:p-4 text-center">{t("mfg.jobs.colQuantity")}</th>
                <th className="p-2 sm:p-3 md:p-4 text-center">{t("mfg.jobs.colProduced")}</th>
                <th className="p-2 sm:p-3 md:p-4 text-right">{t("mfg.jobs.colCogmUnit")}</th>
                <th className="p-2 sm:p-3 md:p-4">{t("mfg.jobs.colDue")}</th>
                <th className="p-2 sm:p-3 md:p-4">{t("mfg.jobs.colStage")}</th>
                <th className="p-2 sm:p-3 md:p-4">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((j) => {
                const next = NEXT[j.stage];
                const cancellable = !["COMPLETED", "CANCELLED"].includes(j.stage);
                const produced = producedOf(j);
                const unitCost = cogmUnitOf(j);
                return (
                  <tr key={j.id} onClick={() => openDetail(j)} className="border-b hover:bg-gray-50 cursor-pointer">
                    <td className="p-2 sm:p-3 md:p-4 font-medium">{j.jobNumber}</td>
                    <td className="p-2 sm:p-3 md:p-4">{j.customerName ?? "—"}</td>
                    <td className="p-2 sm:p-3 md:p-4 text-gray-600">{j.bom?.finishedProduct?.baseName ?? "—"}</td>
                    <td className="p-2 sm:p-3 md:p-4 text-center">{j.targetQuantity ?? "—"}</td>
                    <td className="p-2 sm:p-3 md:p-4 text-center">
                      {produced != null ? (
                        <span className="font-medium text-green-700">{produced}</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="p-2 sm:p-3 md:p-4 text-right">
                      {produced != null && unitCost > 0 ? (
                        <span className="text-gray-600">{fmtCurrency(unitCost)}</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="p-2 sm:p-3 md:p-4 text-gray-500">
                      {j.dueDate ? new Date(j.dueDate).toLocaleDateString() : "—"}
                    </td>
                    <td className="p-2 sm:p-3 md:p-4">
                      <span className="bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded text-[10px] sm:text-xs font-semibold">
                        {statusLabel(j.stage)}
                      </span>
                    </td>
                    <td className="p-2 sm:p-3 md:p-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-2 items-center">
                        {canManage && next && (
                          <button onClick={() => advance(j)} className="text-xs text-blue-600 hover:underline">
                            {t("mfg.jobs.advance")}
                          </button>
                        )}
                        {canManage && cancellable && (
                          <button onClick={() => cancelJob(j)} className="text-xs text-red-600 hover:underline">
                            {t("mfg.jobs.cancelJob")}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-gray-400">{t("mfg.jobs.noJobs")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New job modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title={t("mfg.jobs.createTitle")}>
        <form onSubmit={create} className="grid grid-cols-1 gap-4">
          <div>
            {label(t("mfg.jobs.titleLabel"), true)}
            <input id="job-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="border p-2 rounded-lg w-full" required />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              {label(t("mfg.jobs.customerLabel"))}
              <input id="job-customer" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} className="border p-2 rounded-lg w-full" />
            </div>
            <div>
              {label(t("mfg.jobs.dueDateLabel"))}
              <input id="job-due" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="border p-2 rounded-lg w-full" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              {label(t("mfg.jobs.bomLabel"))}
              <select id="job-bom" value={form.bomId} onChange={(e) => setForm({ ...form, bomId: e.target.value })} className="border p-2 rounded-lg w-full bg-white">
                <option value="">—</option>
                {boms.map((b) => (
                  <option key={b.id} value={b.id}>{b.finishedProduct?.baseName ?? `BOM #${b.id}`}</option>
                ))}
              </select>
            </div>
            <div>
              {label(t("mfg.jobs.targetQuantityLabel"))}
              <input id="job-qty" type="number" min="1" step="any" value={form.targetQuantity} onChange={(e) => setForm({ ...form, targetQuantity: e.target.value })} className="border p-2 rounded-lg w-full" />
            </div>
          </div>
          <div>
            {label(t("mfg.jobs.notesLabel"))}
            <textarea id="job-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="border p-2 rounded-lg w-full" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowCreate(false)} className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm">{t("mfg.common.cancel")}</button>
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">{t("mfg.common.save")}</button>
          </div>
        </form>
      </Modal>

      {/* Detail modal */}
      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title={t("mfg.jobs.detailTitle", { job: detail?.jobNumber ?? "" })}>
        {detail && (
          <div className="space-y-3 text-sm">
            <p className="font-medium text-gray-800">{detail.title}</p>
            <p className="text-gray-500">
              {detail.customerName ? `${detail.customerName} · ` : ""}{statusLabel(detail.stage)}
            </p>
            {producedOf(detail) != null && (
              <div className="grid grid-cols-3 gap-2 rounded-lg bg-gray-50 p-3 text-sm">
                <div>
                  <span className="block text-xs text-gray-400">{t("mfg.jobs.colProduced")}</span>
                  <span className="font-semibold text-green-700">{producedOf(detail)}</span>
                </div>
                <div>
                  <span className="block text-xs text-gray-400">{t("mfg.jobs.colCogmUnit")}</span>
                  <span className="font-semibold text-gray-800">{fmtCurrency(cogmUnitOf(detail))}</span>
                </div>
                <div>
                  <span className="block text-xs text-gray-400">{t("mfg.jobs.colCogmTotal")}</span>
                  <span className="font-semibold text-gray-800">{fmtCurrency(cogmTotalOf(detail))}</span>
                </div>
              </div>
            )}
            <div className="border-t pt-3">
              <p className="text-xs font-semibold text-gray-400 uppercase mb-2">{t("mfg.jobs.history")}</p>
              <ul className="space-y-1">
                {(detail.history ?? []).map((h: any) => (
                  <li key={h.id} className="text-xs text-gray-600">
                    {h.fromStage ? statusLabel(h.fromStage) : "—"} → {statusLabel(h.toStage)}
                    <span className="text-gray-400"> · {new Date(h.createdAt).toLocaleString()}</span>
                    {h.note && <p className="text-gray-400 pl-2">{h.note}</p>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
