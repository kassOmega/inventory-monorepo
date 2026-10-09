"use client";

// Employee loans & penalties panel. Shows a person's open/paid deductions with a
// running balance, lets an authorized user add a LOAN or PENALTY (with a due
// date) and record a recovery (capped at the tenant's configured % of the period
// pay). Works for a staff user and/or a car-wash washer.
import api from "@/lib/api";
import Button from "@/app/components/Button";
import Modal from "@/app/components/Modal";
import Loading from "@/app/components/Loading";
import { useToast } from "@/app/components/ToastProvider";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { fmtCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/datetime";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface Deduction {
  id: number;
  kind: "LOAN" | "PENALTY";
  source: "SALARY" | "COMMISSION";
  reason: string;
  amount: number;
  recoveredAmount: number;
  status: "OPEN" | "PARTIAL" | "PAID" | "CANCELLED";
  dueAt: string | null;
  issuedAt: string;
  recoveries?: Array<{ id: number; amount: number; recoveredAt: string; note: string | null }>;
}

const STATUS_CLASS: Record<string, string> = {
  OPEN: "bg-amber-100 text-amber-700",
  PARTIAL: "bg-blue-100 text-blue-700",
  PAID: "bg-green-100 text-green-700",
  CANCELLED: "bg-gray-200 text-gray-500",
};

export default function DeductionsPanel({
  userId,
  washerId,
  personName,
  canManage,
}: {
  userId?: number;
  washerId?: number;
  personName?: string;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<Deduction[]>([]);
  const [summary, setSummary] = useState<{ outstanding: number; loans: number; penalties: number } | null>(null);
  const [capPercent, setCapPercent] = useState(30);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Deduction | null>(null);
  const [form, setForm] = useState({
    kind: "LOAN" as "LOAN" | "PENALTY",
    source: "SALARY" as "SALARY" | "COMMISSION",
    reason: "",
    amount: "",
    dueAt: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  const [recovering, setRecovering] = useState<Deduction | null>(null);
  const [recoverAmount, setRecoverAmount] = useState("");
  const [periodPay, setPeriodPay] = useState("");
  const [recoverNote, setRecoverNote] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const qs = `${userId ? `userId=${userId}` : ""}${washerId ? `${userId ? "&" : ""}washerId=${washerId}` : ""}`;

  const load = useCallback(async () => {
    try {
      const [list, sum, cap] = await Promise.all([
        api.get(`/employee-deductions?${qs}`),
        api.get(`/employee-deductions/summary?${qs}`),
        api.get(`/employee-deductions/cap`),
      ]);
      setRows(list.data);
      setSummary(sum.data);
      setCapPercent(cap.data.deductionCapPercent ?? 30);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? t("deductions.loadFail"));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = (kind: "LOAN" | "PENALTY") => {
    setEditing(null);
    setForm({ kind, source: "SALARY", reason: "", amount: "", dueAt: "", notes: "" });
    setFormOpen(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        ...(userId ? { userId } : {}),
        ...(washerId ? { washerId } : {}),
        kind: form.kind,
        source: form.source,
        reason: form.reason.trim(),
        amount: Number(form.amount) || 0,
        dueAt: form.dueAt || null,
        notes: form.notes.trim() || null,
      };
      if (editing) await api.patch(`/employee-deductions/${editing.id}`, body);
      else await api.post("/employee-deductions", body);
      toast.success(t("common.success"));
      setFormOpen(false);
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? t("deductions.saveFail"));
    } finally {
      setSaving(false);
    }
  };

  const openRecover = (d: Deduction) => {
    setRecovering(d);
    const remaining = Math.max(0, d.amount - d.recoveredAmount);
    setRecoverAmount(String(remaining));
    setPeriodPay("");
    setRecoverNote("");
  };

  const recover = async () => {
    if (!recovering) return;
    setBusyId(recovering.id);
    try {
      await api.post(`/employee-deductions/${recovering.id}/recover`, {
        amount: Number(recoverAmount) || 0,
        note: recoverNote || undefined,
        periodPay: periodPay ? Number(periodPay) : undefined,
      });
      toast.success(t("deductions.recovered"));
      setRecovering(null);
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? t("deductions.saveFail"));
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (d: Deduction) => {
    if (!(await confirm(t("deductions.cancelConfirm")))) return;
    setBusyId(d.id);
    try {
      await api.post(`/employee-deductions/${d.id}/cancel`);
      toast.success(t("common.success"));
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? t("deductions.saveFail"));
    } finally {
      setBusyId(null);
    }
  };

  const remainingOf = (d: Deduction) => Math.max(0, d.amount - d.recoveredAmount);

  if (loading) return <Loading className="py-8" />;

  return (
    <div className="space-y-3">
      {personName && (
        <p className="text-sm text-gray-500">
          {t("deductions.forEmployee", { name: personName })}
        </p>
      )}

      {summary && (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-gray-200 p-2.5">
            <p className="text-[10px] uppercase text-gray-400">{t("deductions.outstanding")}</p>
            <p className="text-sm font-semibold text-gray-800">{fmtCurrency(summary.outstanding)}</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-2.5">
            <p className="text-[10px] uppercase text-gray-400">{t("deductions.kind.LOAN")}</p>
            <p className="text-sm font-semibold text-gray-800">{fmtCurrency(summary.loans)}</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-2.5">
            <p className="text-[10px] uppercase text-gray-400">{t("deductions.kind.PENALTY")}</p>
            <p className="text-sm font-semibold text-gray-800">{fmtCurrency(summary.penalties)}</p>
          </div>
        </div>
      )}

      {canManage && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => openNew("LOAN")}>+ {t("deductions.addLoan")}</Button>
          <Button size="sm" variant="secondary" onClick={() => openNew("PENALTY")}>
            + {t("deductions.addPenalty")}
          </Button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[620px]">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2">{t("deductions.kindLabel")}</th>
              <th className="px-3 py-2">{t("deductions.reason")}</th>
              <th className="px-3 py-2 text-right">{t("deductions.amount")}</th>
              <th className="px-3 py-2 text-right">{t("deductions.remaining")}</th>
              <th className="px-3 py-2">{t("deductions.due")}</th>
              <th className="px-3 py-2">{t("deductions.statusLabel")}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((d) => (
              <tr key={d.id}>
                <td className="px-3 py-2">
                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      d.kind === "LOAN" ? "bg-indigo-100 text-indigo-700" : "bg-red-100 text-red-700"
                    }`}
                  >
                    {t(`deductions.kind.${d.kind}`)}
                  </span>
                  <span className="block text-[10px] text-gray-400">
                    {t(`deductions.source.${d.source}`)}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-700">{d.reason}</td>
                <td className="px-3 py-2 text-right">{fmtCurrency(d.amount)}</td>
                <td className="px-3 py-2 text-right font-medium">{fmtCurrency(remainingOf(d))}</td>
                <td className="px-3 py-2 text-gray-500 text-xs">
                  {d.dueAt ? formatDate(d.dueAt) : "—"}
                </td>
                <td className="px-3 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_CLASS[d.status]}`}>
                    {t(`deductions.status.${d.status}`)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {canManage && (d.status === "OPEN" || d.status === "PARTIAL") && (
                    <>
                      <Button
                        size="sm"
                        loading={busyId === d.id}
                        onClick={() => openRecover(d)}
                        className="mr-2 !px-2 !text-xs"
                      >
                        {t("deductions.recover")}
                      </Button>
                      <button
                        onClick={() => cancel(d)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        {t("deductions.cancel")}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-gray-400">
                  {t("deductions.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add / edit */}
      <Modal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={form.kind === "LOAN" ? t("deductions.addLoan") : t("deductions.addPenalty")}
      >
        <form onSubmit={save} className="space-y-3 text-sm">
          <label className="block text-gray-600">
            {t("deductions.reason")}
            <input
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              className="border border-gray-300 rounded-lg p-2 text-sm w-full mt-1"
              required
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-gray-600">
              {t("deductions.amount")}
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="border border-gray-300 rounded-lg p-2 text-sm w-full mt-1"
                required
              />
            </label>
            <label className="block text-gray-600">
              {t("deductions.sourceLabel")}
              <select
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value as any })}
                className="border border-gray-300 rounded-lg p-2 text-sm w-full mt-1 bg-white"
              >
                <option value="SALARY">{t("deductions.source.SALARY")}</option>
                <option value="COMMISSION">{t("deductions.source.COMMISSION")}</option>
              </select>
            </label>
          </div>
          <label className="block text-gray-600">
            {t("deductions.due")}
            <input
              type="date"
              value={form.dueAt}
              onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
              className="border border-gray-300 rounded-lg p-2 text-sm w-full mt-1"
            />
          </label>
          <label className="block text-gray-600">
            {t("deductions.notes")}
            <input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="border border-gray-300 rounded-lg p-2 text-sm w-full mt-1"
            />
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setFormOpen(false)} className="px-3 py-2 text-sm text-gray-600">
              {t("common.cancel")}
            </button>
            <Button type="submit" loading={saving}>{t("common.save")}</Button>
          </div>
        </form>
      </Modal>

      {/* Recover */}
      <Modal
        isOpen={!!recovering}
        onClose={() => setRecovering(null)}
        title={t("deductions.recover")}
      >
        {recovering && (
          <div className="space-y-3 text-sm">
            <p className="text-xs text-gray-500">
              {t("deductions.remaining")}: {fmtCurrency(remainingOf(recovering))} ·{" "}
              {t("deductions.capHint", { percent: capPercent })}
            </p>
            <label className="block text-gray-600">
              {t("deductions.amount")}
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={recoverAmount}
                onChange={(e) => setRecoverAmount(e.target.value)}
                className="border border-gray-300 rounded-lg p-2 text-sm w-full mt-1"
              />
            </label>
            <label className="block text-gray-600">
              {t("deductions.periodPay")}
              <input
                type="number"
                min="0"
                step="0.01"
                value={periodPay}
                onChange={(e) => setPeriodPay(e.target.value)}
                placeholder={t("deductions.periodPayHint", { percent: capPercent })}
                className="border border-gray-300 rounded-lg p-2 text-sm w-full mt-1"
              />
            </label>
            <label className="block text-gray-600">
              {t("deductions.notes")}
              <input
                value={recoverNote}
                onChange={(e) => setRecoverNote(e.target.value)}
                className="border border-gray-300 rounded-lg p-2 text-sm w-full mt-1"
              />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setRecovering(null)} className="px-3 py-2 text-sm text-gray-600">
                {t("common.cancel")}
              </button>
              <Button loading={busyId === recovering.id} onClick={recover}>
                {t("deductions.recover")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
