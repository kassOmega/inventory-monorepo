"use client";
// AI Operations Agent dashboard — mode toggle, pending approvals, action log
// and the daily executive briefing.
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface AgentConfig {
  organizationId: number;
  mode: "ADVISORY" | "AUTONOMOUS";
  maxAutoSpend: number;
  updatedAt: string | null;
}

interface PendingReview {
  id: string;
  actionType: string;
  description: string;
  targetEntity: string | null;
  payload: unknown;
  createdAt: string;
}

interface AgentAction {
  id: string;
  actionType: string;
  description: string;
  targetEntity: string | null;
  status: string;
  createdAt: string;
}

interface Briefing {
  date: string;
  mode: string;
  maxAutoSpend: number;
  actionsToday: { byStatus: Record<string, number>; total: number };
  financial: {
    flaggedDiscrepancies: { description: string; createdAt: string }[];
    expensesToday: number;
  };
  pendingReviews: PendingReview[];
  recentActions: AgentAction[];
}

const STATUS_BADGE: Record<string, string> = {
  EXECUTED: "bg-emerald-100 text-emerald-800",
  PENDING_APPROVAL: "bg-amber-100 text-amber-800",
  REJECTED: "bg-red-100 text-red-800",
  FAILED: "bg-gray-200 text-gray-700",
};

// Backend enums (AgentAction.actionType / .status) → `agent.*` catalog keys.
// Unknown values fall back to the de-underscored raw enum.
const ACTION_KEYS: Record<string, string> = {
  APPROVE_RESTOCK: "agent.action.approveRestock",
  FLAG_DISCREPANCY: "agent.action.flagDiscrepancy",
  STAGE_HIGH_RISK: "agent.action.stageHighRisk",
  AGENT_SUMMARY: "agent.action.agentSummary",
};

const STATUS_KEYS: Record<string, string> = {
  EXECUTED: "agent.status.executed",
  PENDING_APPROVAL: "agent.status.pendingApproval",
  REJECTED: "agent.status.rejected",
  FAILED: "agent.status.failed",
};

export default function AgentPage() {
  const { hasPermission, user } = useAuth();
  const { t } = useTranslation();
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [showBriefing, setShowBriefing] = useState(false);
  const [maxSpend, setMaxSpend] = useState<string>("0");

  const canManage = user?.isSuperuser || hasPermission("agent.manage");
  const canView = user?.isSuperuser || hasPermission("agent.view");

  // Enum → localized label, falling back to the raw value ("PENDING_APPROVAL" →
  // "PENDING APPROVAL") so an enum the catalog has not caught up with still reads.
  const actionLabel = (v: string) =>
    ACTION_KEYS[v] ? t(ACTION_KEYS[v]) : v.replace(/_/g, " ");
  const statusText = (v: string) =>
    STATUS_KEYS[v] ? t(STATUS_KEYS[v]) : v.replace(/_/g, " ");

  const load = useCallback(async () => {
    setError("");
    try {
      const [c, b] = await Promise.all([
        api.get("/agent/config"),
        api.get("/agent/briefing"),
      ]);
      setConfig(c.data);
      setMaxSpend(String(c.data.maxAutoSpend ?? 0));
      setBriefing(b.data);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("agent.loadFail"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (canView) load();
  }, [canView, load]);

  const loadActions = useCallback(async (status = "") => {
    try {
      const res = await api.get(`/agent/actions${status ? `?status=${status}` : ""}`);
      setActions(res.data ?? []);
    } catch {
      /* actions are secondary */
    }
  }, []);

  useEffect(() => {
    if (canView) loadActions(statusFilter);
  }, [canView, statusFilter, loadActions]);

  const setMode = async (mode: string) => {
    setBusy(mode);
    setError("");
    try {
      await api.patch("/agent/config", { mode });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("agent.modeFail"));
    } finally {
      setBusy("");
    }
  };

  const saveBudget = async () => {
    setBusy("budget");
    setError("");
    try {
      const value = Number(maxSpend);
      if (Number.isNaN(value) || value < 0) throw new Error(t("agent.budgetInvalid"));
      await api.patch("/agent/config", { maxAutoSpend: value });
      await load();
    } catch (err: any) {
      // A locally thrown Error (invalid budget) carries the message we want.
      setError(
        err?.response?.data?.message ?? err?.message ?? t("agent.budgetFail"),
      );
    } finally {
      setBusy("");
    }
  };

  const runNow = async () => {
    setBusy("run");
    setError("");
    try {
      await api.post("/agent/run");
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("agent.runFail"));
    } finally {
      setBusy("");
    }
  };

  const decide = async (id: string, action: "approve" | "reject") => {
    setBusy(`${action}-${id}`);
    setError("");
    try {
      await api.post(`/agent/actions/${id}/${action}`);
      await Promise.all([load(), loadActions(statusFilter)]);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("agent.actionFail"));
    } finally {
      setBusy("");
    }
  };

  if (!canView) {
    return (
      <div className="max-w-lg mx-auto mt-10 bg-white border rounded-xl p-8 text-center">
        <p className="text-gray-600">{t("agent.noAccess")}</p>
      </div>
    );
  }

  if (loading) {
    return <div className="p-8 text-gray-400">{t("common.loading")}</div>;
  }

  const pending = briefing?.pendingReviews ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">
            {t("agent.title")}
          </h1>
          <p className="text-gray-500 text-xs sm:text-sm mt-1">
            {t("agent.subtitlePre")}
            <b>{t("agent.autonomous")}</b>
            {t("agent.subtitlePost")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBriefing(true)}
            className="bg-gray-800 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-gray-700"
          >
            {t("agent.briefingBtn")}
          </button>
          {canManage && (
            <button
              onClick={runNow}
              disabled={busy === "run"}
              className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {busy === "run" ? t("agent.running") : t("agent.runNow")}
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          {error}
        </p>
      )}

      {/* Mode + budget */}
      <div className="bg-white rounded-xl border shadow-sm p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">{t("agent.modeTitle")}</h2>
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden w-fit">
            <button
              onClick={() => canManage && setMode("ADVISORY")}
              disabled={!canManage || busy === "ADVISORY"}
              className={`px-4 py-2 text-sm font-medium transition ${
                config?.mode === "ADVISORY"
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {t("agent.modeAdvisory")}
            </button>
            <button
              onClick={() => canManage && setMode("AUTONOMOUS")}
              disabled={!canManage || busy === "AUTONOMOUS"}
              className={`px-4 py-2 text-sm font-medium transition ${
                config?.mode === "AUTONOMOUS"
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {t("agent.modeAutonomous")}
            </button>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {t("agent.maxSpendLabel")}
              </label>
              <input
                type="number"
                min={0}
                step="any"
                value={maxSpend}
                disabled={!canManage}
                onChange={(e) => setMaxSpend(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-36 disabled:bg-gray-100"
              />
            </div>
            {canManage && (
              <button
                onClick={saveBudget}
                disabled={busy === "budget"}
                className="bg-gray-800 text-white rounded-lg px-3 py-2 text-sm disabled:opacity-50"
              >
                {t("common.save")}
              </button>
            )}
          </div>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">
          {config?.maxAutoSpend === 0
            ? t("agent.budgetZero")
            : t("agent.budgetPositive", { amount: config?.maxAutoSpend })}
        </p>
      </div>

      {/* Pending approvals */}
      <div className="bg-white rounded-xl border shadow-sm p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">
          {t("agent.pendingTitle", { count: pending.length })}
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-gray-400">
            {t("agent.pendingEmpty")}
          </p>
        ) : (
          <ul className="space-y-3">
            {pending.map((p) => (
              <li
                key={p.id}
                className="border border-amber-200 bg-amber-50/50 rounded-lg p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                    {actionLabel(p.actionType)}
                  </span>
                  <span className="text-[11px] text-gray-400">
                    {new Date(p.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-gray-700 mt-1.5">{p.description}</p>
                {canManage && (
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => decide(p.id, "approve")}
                      disabled={busy === `approve-${p.id}`}
                      className="bg-emerald-600 text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {t("agent.approve")}
                    </button>
                    <button
                      onClick={() => decide(p.id, "reject")}
                      disabled={busy === `reject-${p.id}`}
                      className="bg-red-600 text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-red-700 disabled:opacity-50"
                    >
                      {t("agent.reject")}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>


      {/* Action log */}
      <div className="bg-white rounded-xl border shadow-sm p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="text-sm font-semibold text-gray-800">
            {t("agent.logTitle")}
          </h2>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
          >
            <option value="">{t("agent.filterAll")}</option>
            <option value="EXECUTED">{t("agent.status.executed")}</option>
            <option value="PENDING_APPROVAL">{t("agent.status.pendingApproval")}</option>
            <option value="REJECTED">{t("agent.status.rejected")}</option>
            <option value="FAILED">{t("agent.status.failed")}</option>
          </select>
        </div>
        {actions.length === 0 ? (
          <p className="text-sm text-gray-400">{t("agent.logEmpty")}</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {actions.slice(0, 30).map((a) => (
              <li key={a.id} className="py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                    {actionLabel(a.actionType)}
                  </span>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[a.status] ?? "bg-gray-100 text-gray-700"}`}
                  >
                    {statusText(a.status)}
                  </span>
                  <span className="text-[11px] text-gray-400">
                    {new Date(a.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-gray-600 mt-1">{a.description}</p>
              </li>
            ))}
          </ul>
        )}
      </div>


      {/* Daily briefing modal */}
      {showBriefing && briefing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">
                {t("agent.briefingTitle", { date: briefing.date })}
              </h2>
              <button
                onClick={() => setShowBriefing(false)}
                className="text-gray-400 hover:text-gray-700"
                aria-label={t("common.close")}
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-[11px] text-gray-500">{t("agent.kpiMode")}</p>
                  <p className="text-sm font-bold text-gray-800">
                    {briefing.mode === "AUTONOMOUS"
                      ? t("agent.badgeAutonomous")
                      : t("agent.badgeAdvisory")}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-[11px] text-gray-500">{t("agent.kpiActionsToday")}</p>
                  <p className="text-sm font-bold text-gray-800">
                    {briefing.actionsToday.total}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-[11px] text-gray-500">{t("agent.kpiAutoSpend")}</p>
                  <p className="text-sm font-bold text-gray-800">
                    {briefing.maxAutoSpend} ETB
                  </p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-[11px] text-gray-500">{t("agent.kpiExpensesToday")}</p>
                  <p className="text-sm font-bold text-gray-800">
                    {briefing.financial.expensesToday} ETB
                  </p>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1">
                  {t("agent.actionsTaken")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(briefing.actionsToday.byStatus).length === 0 ? (
                    <p className="text-sm text-gray-400">{t("agent.noneYet")}</p>
                  ) : (
                    Object.entries(briefing.actionsToday.byStatus).map(
                      ([status, count]) => (
                        <span
                          key={status}
                          className="text-[11px] px-2 py-1 rounded-full bg-gray-100 text-gray-700"
                        >
                          {statusText(status)}: {count}
                        </span>
                      ),
                    )
                  )}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1">
                  {t("agent.flaggedTitle")}
                </p>
                {briefing.financial.flaggedDiscrepancies.length === 0 ? (
                  <p className="text-sm text-gray-400">{t("agent.noDiscrepancies")}</p>
                ) : (
                  <ul className="space-y-1">
                    {briefing.financial.flaggedDiscrepancies.map((d, i) => (
                      <li key={i} className="text-sm text-gray-600">
                        ⚠️ {d.description}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1">
                  {t("agent.decisionsTitle", {
                    count: briefing.pendingReviews.length,
                  })}
                </p>
                {briefing.pendingReviews.length === 0 ? (
                  <p className="text-sm text-gray-400">{t("agent.nothingPending")}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {briefing.pendingReviews.map((p) => (
                      <li
                        key={p.id}
                        className="text-sm text-gray-600 border-l-2 border-amber-300 pl-2"
                      >
                        {p.description}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setShowBriefing(false)}
                className="bg-gray-800 text-white rounded-lg px-4 py-2 text-sm"
              >
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

