"use client";
// AI Operations Agent dashboard — mode toggle, pending approvals, action log
// and the daily executive briefing.
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { useCallback, useEffect, useState } from "react";

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

export default function AgentPage() {
  const { hasPermission, user } = useAuth();
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
      setError(err?.response?.data?.message ?? "Failed to load the agent dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

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
      setError(err?.response?.data?.message ?? "Failed to update agent mode");
    } finally {
      setBusy("");
    }
  };

  const saveBudget = async () => {
    setBusy("budget");
    setError("");
    try {
      const value = Number(maxSpend);
      if (Number.isNaN(value) || value < 0) throw new Error("Invalid budget");
      await api.patch("/agent/config", { maxAutoSpend: value });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to update budget");
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
      setError(err?.response?.data?.message ?? "Agent run failed");
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
      setError(err?.response?.data?.message ?? "Action failed");
    } finally {
      setBusy("");
    }
  };

  if (!canView) {
    return (
      <div className="max-w-lg mx-auto mt-10 bg-white border rounded-xl p-8 text-center">
        <p className="text-gray-600">
          You don&apos;t have access to the AI Operations Agent. Ask the owner
          to grant you the &quot;View Agent Dashboard&quot; permission.
        </p>
      </div>
    );
  }

  if (loading) {
    return <div className="p-8 text-gray-400">Loading…</div>;
  }

  const pending = briefing?.pendingReviews ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">
            🤖 AI Operations Agent
          </h1>
          <p className="text-gray-500 text-xs sm:text-sm mt-1">
            Runs the business on demand in <b>Autonomous</b> mode. High-risk
            actions always wait for your approval.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBriefing(true)}
            className="bg-gray-800 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-gray-700"
          >
            📊 Daily Briefing
          </button>
          {canManage && (
            <button
              onClick={runNow}
              disabled={busy === "run"}
              className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {busy === "run" ? "Running…" : "▶ Run agent now"}
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
        <h2 className="text-sm font-semibold text-gray-800 mb-3">Agent mode</h2>
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
              💬 Advisory (advice only)
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
              ⚡ Autonomous (on demand)
            </button>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Max auto-spend (ETB)
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
                Save
              </button>
            )}
          </div>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">
          {config?.maxAutoSpend === 0
            ? "Budget is 0 — the agent never spends automatically; every financial action is staged for your approval."
            : `The agent may auto-approve restocks costing up to ${config?.maxAutoSpend} ETB; anything above is staged for your approval.`}
        </p>
      </div>

      {/* Pending approvals */}
      <div className="bg-white rounded-xl border shadow-sm p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">
          🛑 Pending approvals ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-gray-400">
            Nothing waiting for your review. 🎉
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
                    {p.actionType.replace(/_/g, " ")}
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
                      Approve
                    </button>
                    <button
                      onClick={() => decide(p.id, "reject")}
                      disabled={busy === `reject-${p.id}`}
                      className="bg-red-600 text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-red-700 disabled:opacity-50"
                    >
                      Reject
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
            🧾 Agent action log
          </h2>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
          >
            <option value="">All statuses</option>
            <option value="EXECUTED">Executed</option>
            <option value="PENDING_APPROVAL">Pending approval</option>
            <option value="REJECTED">Rejected</option>
            <option value="FAILED">Failed</option>
          </select>
        </div>
        {actions.length === 0 ? (
          <p className="text-sm text-gray-400">No agent actions yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {actions.slice(0, 30).map((a) => (
              <li key={a.id} className="py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                    {a.actionType.replace(/_/g, " ")}
                  </span>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[a.status] ?? "bg-gray-100 text-gray-700"}`}
                  >
                    {a.status.replace(/_/g, " ")}
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
                📊 Daily Executive Briefing — {briefing.date}
              </h2>
              <button
                onClick={() => setShowBriefing(false)}
                className="text-gray-400 hover:text-gray-700"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-[11px] text-gray-500">Mode</p>
                  <p className="text-sm font-bold text-gray-800">
                    {briefing.mode === "AUTONOMOUS" ? "⚡ Autonomous" : "💬 Advisory"}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-[11px] text-gray-500">Actions today</p>
                  <p className="text-sm font-bold text-gray-800">
                    {briefing.actionsToday.total}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-[11px] text-gray-500">Auto-spend</p>
                  <p className="text-sm font-bold text-gray-800">
                    {briefing.maxAutoSpend} ETB
                  </p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-[11px] text-gray-500">Expenses today</p>
                  <p className="text-sm font-bold text-gray-800">
                    {briefing.financial.expensesToday} ETB
                  </p>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1">
                  ✅ Actions taken automatically today
                </p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(briefing.actionsToday.byStatus).length === 0 ? (
                    <p className="text-sm text-gray-400">None yet.</p>
                  ) : (
                    Object.entries(briefing.actionsToday.byStatus).map(
                      ([status, count]) => (
                        <span
                          key={status}
                          className="text-[11px] px-2 py-1 rounded-full bg-gray-100 text-gray-700"
                        >
                          {status.replace(/_/g, " ")}: {count}
                        </span>
                      ),
                    )
                  )}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-500 mb-1">
                  💰 Financial — flagged discrepancies
                </p>
                {briefing.financial.flaggedDiscrepancies.length === 0 ? (
                  <p className="text-sm text-gray-400">No discrepancies.</p>
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
                  ⚠️ Decisions requiring your review ({briefing.pendingReviews.length})
                </p>
                {briefing.pendingReviews.length === 0 ? (
                  <p className="text-sm text-gray-400">Nothing pending.</p>
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
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

