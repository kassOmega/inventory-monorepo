"use client";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

/**
 * Pro "Account Mappings" page — remap the auto-posting engine's operational
 * actions to custom Chart of Accounts entries. Simple for everyone (defaults
 * seeded automatically), flexible for accountants. SALE is reserved and read
 * only until the controlled multi-leg override lands.
 */
export default function AccountMappingsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("finance.manage");
  const [mappings, setMappings] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { debit: string; credit: string }>>({});
  const [savingType, setSavingType] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(""), 2000);
  };

  const load = useCallback(async () => {
    try {
      const [mRes, aRes] = await Promise.all([
        api.get("/finance/account-mappings"),
        api.get("/finance/accounts"),
      ]);
      const rows = mRes.data ?? [];
      setMappings(rows);
      setAccounts(aRes.data ?? []);
      const next: Record<string, { debit: string; credit: string }> = {};
      for (const r of rows) {
        next[r.transactionType] = {
          debit: r.mapping?.debitAccountId ? String(r.mapping.debitAccountId) : "",
          credit: r.mapping?.creditAccountId ? String(r.mapping.creditAccountId) : "",
        };
      }
      setDrafts(next);
      setError("");
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to load account mappings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const accountOptions = (types: string[]) =>
    accounts
      .filter((a: any) => !types.length || types.includes(a.type))
      .map((a: any) => ({
        value: String(a.id),
        label: a.code ? `${a.code} · ${a.name}` : a.name,
      }));

  const saveRow = async (m: any) => {
    if (m.managedBySystem) return;
    const d = drafts[m.transactionType] ?? { debit: "", credit: "" };
    setSavingType(m.transactionType);
    setError("");
    try {
      await api.put(`/finance/account-mappings/${m.transactionType}`, {
        debitAccountId: d.debit ? Number(d.debit) : null,
        creditAccountId: d.credit ? Number(d.credit) : null,
      });
      flash(`${m.label} mapping saved`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to save mapping");
    } finally {
      setSavingType("");
    }
  };

  const resetRow = async (m: any) => {
    if (m.managedBySystem) return;
    setSavingType(m.transactionType);
    setError("");
    try {
      await api.delete(`/finance/account-mappings/${m.transactionType}`);
      flash(`${m.label} reset to defaults`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to reset mapping");
    } finally {
      setSavingType("");
    }
  };

  const setSide = (type: string, side: "debit" | "credit", value: string) =>
    setDrafts((d) => ({
      ...d,
      [type]: { ...(d[type] ?? { debit: "", credit: "" }), [side]: value },
    }));

  if (loading)
    return <p className="text-gray-500 p-6">Loading account mappings…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Account Mappings</h1>
          <p className="text-sm text-gray-400">
            Every operational action posts automatically. Defaults are seeded for
            your chart of accounts — remap any action to your own accounts below.
          </p>
        </div>
        <Link href="/dashboard/accounts" className="text-sm text-blue-600 hover:underline font-medium">
          Chart of Accounts →
        </Link>
      </div>

      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}
      {msg && <div className="bg-green-50 text-green-700 p-3 rounded text-sm">{msg}</div>}
      {!canManage && (
        <div className="bg-amber-50 text-amber-700 p-3 rounded text-sm">
          You can view mappings. Ask an organization owner with finance.manage to make changes.
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-100 bg-gray-50/60">
                <th className="px-4 py-2.5">Operational action</th>
                <th className="px-4 py-2.5">Debit account</th>
                <th className="px-4 py-2.5">Credit account</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((m: any) => {
                const d = drafts[m.transactionType] ?? { debit: "", credit: "" };
                const isManaged = !!m.managedBySystem;
                const isSale = m.transactionType === "SALE";
                return (
                  <tr key={m.transactionType} className="align-top">
                    <td className="px-4 py-3 max-w-[260px]">
                      <p className="font-medium text-gray-800">{m.label}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">{m.description}</p>
                      {(isManaged || isSale) && (
                        <span className="inline-block mt-1 text-[10px] font-semibold uppercase tracking-wide bg-blue-50 text-blue-700 rounded px-1.5 py-0.5">
                          {isManaged
                            ? "Managed by the system"
                            : "Payment-account override · other legs auto"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isManaged ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        <select
                          value={d.debit}
                          onChange={(e) => setSide(m.transactionType, "debit", e.target.value)}
                          disabled={!canManage}
                          className="border border-gray-300 rounded p-2 text-sm w-full disabled:bg-gray-50 disabled:text-gray-400"
                        >
                          <option value="">(default)</option>
                          {accountOptions(m.debitTypes ?? []).map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isManaged ? (
                        <span className="text-gray-400">—</span>
                      ) : isSale ? (
                        <span className="text-xs text-gray-400 leading-6">
                          Auto — Revenue / COGS / VAT legs are engine-managed.
                        </span>
                      ) : (
                        <select
                          value={d.credit}
                          onChange={(e) => setSide(m.transactionType, "credit", e.target.value)}
                          disabled={!canManage}
                          className="border border-gray-300 rounded p-2 text-sm w-full disabled:bg-gray-50 disabled:text-gray-400"
                        >
                          <option value="">(default)</option>
                          {accountOptions(m.creditTypes ?? []).map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {isManaged ? (
                        <span className="text-xs text-gray-300">Reserved</span>
                      ) : canManage ? (
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => resetRow(m)}
                            disabled={savingType === m.transactionType}
                            className="px-2.5 py-1.5 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40"
                          >
                            Reset
                          </button>
                          <button
                            onClick={() => saveRow(m)}
                            disabled={savingType === m.transactionType}
                            className="px-2.5 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-40"
                          >
                            {savingType === m.transactionType ? "Saving…" : "Save"}
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">View only</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-gray-400">
        Defaults are resolved from your chart of accounts at setup. Manual expenses credit your
        configured payment account; purchases debit Inventory and credit Accounts Payable (or Cash);
        credit notes, scrap and adjustments reverse stock value. POS sales remain fully auto-posted
        by the sales engine.
      </p>
    </div>
  );
}
