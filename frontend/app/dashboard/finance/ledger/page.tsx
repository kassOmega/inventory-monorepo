"use client";
import api from "@/lib/api";
import DateFilter, { getDateRange } from "@/app/components/DateFilter";
import Modal from "@/app/components/Modal";
import { useAuth } from "@/context/AuthContext";
import { statusLabel } from "@/lib/statusLabel";
import { Fragment, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

type Tab = "journal" | "trial" | "account" | "coverage";

const SOURCE_LABELS: Record<string, string> = {
  SALE: "Retail sales / POS",
  RTRN: "Returns",
  EXP: "Expenses",
  INC: "Income",
  MGI: "Mfg services",
  ORD: "Orders",
  FOL: "Folios",
  PO: "Purchase orders",
  PUR: "Purchases",
  RST: "Restock",
  PRDV: "Initial stock",
  ADJ: "Adjustments",
  WST: "Wastage",
  MANUAL: "Manual / custom",
};
const SOURCE_ORDER = ["SALE","RTRN","EXP","INC","MGI","ORD","FOL","PO","PUR","RST","PRDV","ADJ","WST","MANUAL"];
const MODULE_OPTIONS = [
  { key: "ALL", label: "All modules" },
  { key: "retail", label: "Retail / POS" },
  { key: "hospitality", label: "Orders & Folios" },
  { key: "manufacturing", label: "Manufacturing" },
  { key: "procurement", label: "Procurement" },
  { key: "manual", label: "Manual & adjustments" },
];
const STATUS_OPTIONS = [
  { key: "ALL", label: "All statuses" },
  { key: "POSTED", label: "Posted" },
  { key: "REVERSED", label: "Reversed" },
  { key: "VOIDED", label: "Voided" },
];
const STATUS_BADGES: Record<string, string> = {
  POSTED: "bg-green-50 text-green-700",
  REVERSED: "bg-amber-50 text-amber-700",
  VOIDED: "bg-red-50 text-red-700",
};
const statusBadge = (s?: string | null) =>
  s && s !== "POSTED" ? (
    <span className={`text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 ${STATUS_BADGES[s] ?? "bg-gray-100 text-gray-600"}`}>{s}</span>
  ) : null;
const locName = (locations: any[], id?: number | null) =>
  id ? locations.find((l) => l.id === id)?.name ?? `#${id}` : "All";

function downloadCsv(filename: string, columns: string[], rows: (string | number)[][]) {
  const esc = (v: any) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [columns.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function PrintReport({ title, meta, columns, rows }: any) {
  const report = (
    <div id="print-root" className="bg-white text-gray-900 p-6">
      <div className="flex items-end justify-between border-b border-gray-300 pb-3 mb-4">
        <div>
          <h1 className="text-xl font-bold">{title}</h1>
          {meta?.length ? <p className="text-xs text-gray-500 mt-1">{meta.join(" · ")}</p> : null}
        </div>
        <p className="text-xs text-gray-400">{new Date().toLocaleString()}</p>
      </div>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            {columns.map((c: string) => (
              <th key={c} className="border-b border-gray-300 px-2 py-1.5 text-left font-semibold text-gray-700">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r: any[], i: number) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} className={`border-b border-gray-100 px-2 py-1 ${j > columns.length - 4 ? "text-right tabular-nums" : ""}`}>{cell ?? ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return typeof document !== "undefined" ? createPortal(report, document.body) : null;
}
const money = (n: any) =>
  Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shortDate = (d: any) => (d ? new Date(d).toLocaleDateString() : "—");
const srcBadge = (s: string) =>
  s === "MANUAL" ? "bg-gray-100 text-gray-600" : "bg-indigo-50 text-indigo-700";
const TYPE_STYLES: Record<string, string> = {
  ASSET: "bg-blue-50 text-blue-700",
  LIABILITY: "bg-amber-50 text-amber-700",
  EQUITY: "bg-purple-50 text-purple-700",
  INCOME: "bg-green-50 text-green-700",
  EXPENSE: "bg-red-50 text-red-700",
};
const STATUS_STYLES: Record<string, string> = {
  ok: "bg-green-100 text-green-700",
  partial: "bg-amber-100 text-amber-700",
  missing: "bg-red-100 text-red-700",
  idle: "bg-gray-100 text-gray-500",
};

function EntryModal({ open, onClose, accounts, onSaved }: any) {
  const empty = () => ({ accountId: "", debit: "", credit: "" });
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<any[]>([empty()]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const update = (i: number, patch: any) =>
    setLines((ls) => ls.map((l, x) => (x === i ? { ...l, ...patch } : l)));
  const submit = async (e: any) => {
    e.preventDefault();
    setError("");
    const totalDebit = lines.reduce((s: number, l: any) => s + (Number(l.debit) || 0), 0);
    const totalCredit = lines.reduce((s: number, l: any) => s + (Number(l.credit) || 0), 0);
    const clean = lines.filter(
      (l: any) => l.accountId && ((Number(l.debit) || 0) > 0 || (Number(l.credit) || 0) > 0),
    );
    if (!clean.length) return setError("Add at least one line with an account and an amount.");
    if (Math.abs(totalDebit - totalCredit) > 0.001)
      return setError("Journal must balance - debits must equal credits.");
    setSaving(true);
    try {
      await api.post("/finance/journal", {
        reference: reference || undefined,
        description: description || undefined,
        entryDate: entryDate || undefined,
        lines: clean.map((l: any) => ({
          accountId: Number(l.accountId),
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
        })),
      });
      setLines([empty()]);
      setReference("");
      setDescription("");
      onSaved();
    } catch (ex: any) {
      setError(ex?.response?.data?.message ?? "Failed to save the journal entry.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal isOpen={open} onClose={onClose} title="New Journal Entry">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
            <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className="border border-gray-300 rounded p-2 text-sm w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Reference (optional)</label>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. ADJ-1" className="border border-gray-300 rounded p-2 text-sm w-full" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this entry for?" className="border border-gray-300 rounded p-2 text-sm w-full" />
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-500">Lines</p>
          {lines.map((l: any, i: number) => (
            <div key={i} className="border border-gray-200 rounded p-2 space-y-2">
              <div className="flex items-center gap-2">
                <select value={l.accountId} onChange={(e) => update(i, { accountId: e.target.value })} className="border border-gray-300 rounded p-2 text-sm flex-1">
                  <option value="">Account…</option>
                  {accounts.map((a: any) => (
                    <option key={a.id} value={a.id}>{a.code ? `${a.code} · ` : ""}{a.name}</option>
                  ))}
                </select>
                <button type="button" onClick={() => setLines((ls) => ls.filter((_, x) => x !== i))} className="text-red-500 hover:text-red-700 text-lg leading-none">×</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" step="0.01" value={l.debit} onChange={(e) => update(i, { debit: e.target.value })} placeholder="Debit" className="border border-gray-300 rounded p-2 text-sm w-full" />
                <input type="number" step="0.01" value={l.credit} onChange={(e) => update(i, { credit: e.target.value })} placeholder="Credit" className="border border-gray-300 rounded p-2 text-sm w-full" />
              </div>
            </div>
          ))}
          <button type="button" onClick={() => setLines((ls) => [...ls, empty()])} className="text-sm text-blue-600 hover:underline">+ Add line</button>
        </div>
        {error && <div className="bg-red-50 text-red-600 p-2 rounded text-sm">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={saving} className="px-3 py-2 text-sm text-gray-600">Cancel</button>
          <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-2 text-sm font-medium">{saving ? "Saving…" : "Save Entry"}</button>
        </div>
      </form>
    </Modal>
  );
}

function JournalTab({ startDate, endDate, accounts, canManage, locations, filters }: any) {
  const [accountId, setAccountId] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [showModal, setShowModal] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [printDoc, setPrintDoc] = useState<any>(null);
  const extraQs = `${
    filters.locationId ? `&locationId=${encodeURIComponent(filters.locationId)}` : ""
  }${
    filters.moduleSource !== "ALL" ? `&moduleSource=${encodeURIComponent(filters.moduleSource)}` : ""
  }${
    filters.status !== "ALL" ? `&status=${encodeURIComponent(filters.status)}` : ""
  }${
    filters.search ? `&search=${encodeURIComponent(filters.search)}` : ""
  }`;
  const load = useCallback(async () => {
    try {
      const params = `startDate=${startDate}&endDate=${endDate}&page=${page}&pageSize=25${extraQs}`;
      const q = `/finance/gl/journal?${params}${accountId ? `&accountId=${accountId}` : ""}`;
      const r = await api.get(q);
      setData(r.data);
      setError("");
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to load the journal.");
    }
  }, [startDate, endDate, accountId, page, extraQs]);
  useEffect(() => {
    setPage(1);
  }, [accountId, startDate, endDate, extraQs]);
  useEffect(() => {
    load();
  }, [load]);
  const toggle = (id: number) => setExpanded((m) => ({ ...m, [id]: !m[id] }));
  const entries = data?.data ?? [];
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 25)));
  return (
    <div className="space-y-3">
      {savedMsg && <div className="bg-green-50 text-green-700 p-2 rounded text-sm">{savedMsg}</div>}
      {error && <div className="bg-red-50 text-red-600 p-2 rounded text-sm">{error}</div>}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="border border-gray-300 rounded p-2 text-sm">
            <option value="">All accounts</option>
            {accounts.map((a: any) => (
              <option key={a.id} value={a.id}>{a.code ? `${a.code} · ` : ""}{a.name}</option>
            ))}
          </select>
          {(filters.moduleSource !== "ALL" || filters.status !== "ALL" || filters.locationId) && (
            <span className="text-xs text-gray-500 bg-gray-100 rounded px-2 py-1">
              {MODULE_OPTIONS.find((m) => m.key === filters.moduleSource)?.label ?? "All modules"} ·{" "}
              {STATUS_OPTIONS.find((s) => s.key === filters.status)?.label ?? "All statuses"} · {locName(locations, filters.locationId ? Number(filters.locationId) : undefined)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const cols = ["Date", "Reference", "Description", "Source", "Status", "Location", "Debit", "Credit"];
              const rows = (data?.data ?? []).map((e: any) => [
                shortDate(e.entryDate), e.reference ?? "", e.description ?? "",
                SOURCE_LABELS[e.source] ?? e.source ?? "", e.postingStatus ?? "POSTED",
                locName(locations, e.locationId), e.totalDebit ?? 0, e.totalCredit ?? 0,
              ]);
              downloadCsv("general-ledger-journal.csv", cols, rows);
            }}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            CSV
          </button>
          <button
            onClick={() => {
              setPrintDoc({
                title: "General Ledger — Journal",
                meta: [
                  `${startDate} → ${endDate}`,
                  MODULE_OPTIONS.find((m) => m.key === filters.moduleSource)?.label ?? "All modules",
                  locName(locations, filters.locationId ? Number(filters.locationId) : undefined),
                ],
                columns: ["Date", "Reference", "Description", "Source", "Status", "Location", "Debit", "Credit"],
                rows: (data?.data ?? []).map((e: any) => [
                  shortDate(e.entryDate), e.reference ?? "", e.description ?? "",
                  SOURCE_LABELS[e.source] ?? e.source ?? "", e.postingStatus ?? "POSTED",
                  locName(locations, e.locationId), e.totalDebit ?? 0, e.totalCredit ?? 0,
                ]),
              });
              setTimeout(() => window.print(), 120);
            }}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Print / PDF
          </button>
          {canManage && (
            <button onClick={() => setShowModal(true)} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-2 text-sm font-medium">+ New Journal Entry</button>
          )}
        </div>
      </div>
      {!data ? (
        <p className="text-gray-400 text-sm py-8 text-center">Loading journal…</p>
      ) : entries.length === 0 ? (
        <p className="text-gray-400 text-sm py-8 text-center">No journal entries in this period.</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap min-w-[1000px]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-100 bg-gray-50/60">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Reference</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Location</th>
                  <th className="px-3 py-2 text-right">Debit</th>
                  <th className="px-3 py-2 text-right">Credit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries.map((e: any) => (
                  <Fragment key={e.id}>
                    <tr onClick={() => toggle(e.id)} className="cursor-pointer hover:bg-gray-50">
                      <td className="px-3 py-2">{shortDate(e.entryDate)}</td>
                      <td className="px-3 py-2 font-medium text-gray-800">{e.reference ?? "—"}</td>
                      <td className="px-3 py-2 text-gray-500">{e.description ?? ""}</td>
                      <td className="px-3 py-2"><span className={`text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 ${srcBadge(e.source)}`}>{SOURCE_LABELS[e.source] ?? e.source}</span></td>
                      <td className="px-3 py-2">{statusBadge(e.postingStatus) ?? <span className="text-[10px] text-gray-300 font-semibold uppercase tracking-wide">Posted</span>}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{locName(locations, e.locationId)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(e.totalDebit)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(e.totalCredit)}</td>
                    </tr>
                    {expanded[e.id] &&
                      (e.lines ?? []).map((l: any) => (
                        <tr key={`l${l.id}`} className="bg-gray-50/60 text-xs">
                          <td className="px-3 py-1.5 pl-6 text-gray-400">↳ line</td>
                          <td className="px-3 py-1.5">{l.account?.code ? `${l.account.code} · ` : ""}{l.account?.name ?? `#${l.accountId}`}</td>
                          <td className="px-3 py-1.5" colSpan={4}>{l.account?.type ? statusLabel(l.account.type) : ""}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{money(l.debit)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{money(l.credit)}</td>
                        </tr>
                      ))}
                  </Fragment>
                ))}
              </tbody>
              </table>
          </div>
          <div className="px-4 py-2 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2 text-sm bg-gray-50/60">
            <span className="text-gray-500">{data?.total ?? 0} entries · {money(data?.totals?.debit)} debit / {money(data?.totals?.credit)} credit</span>
            <div className="flex items-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="px-2 py-1 text-xs border border-gray-200 rounded disabled:opacity-40">Previous</button>
              <span className="text-xs text-gray-400">Page {page} / {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="px-2 py-1 text-xs border border-gray-200 rounded disabled:opacity-40">Next</button>
            </div>
          </div>
        </div>
      )}
      {printDoc && <PrintReport {...printDoc} />}
      <EntryModal
        open={showModal}
        onClose={() => setShowModal(false)}
        accounts={accounts}
        onSaved={() => {
          setShowModal(false);
          setSavedMsg("Journal entry saved");
          setTimeout(() => setSavedMsg(""), 2500);
          load();
        }}
      />
    </div>
  );
}

function TrialTab({ startDate, endDate, locations, filters }: any) {
  const [rows, setRows] = useState<any[]>([]);
  const [totals, setTotals] = useState<any>(null);
  const [balanced, setBalanced] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [printDoc, setPrintDoc] = useState<any>(null);
  const extraQs = `${
    filters.locationId ? `&locationId=${encodeURIComponent(filters.locationId)}` : ""
  }${
    filters.moduleSource !== "ALL" ? `&moduleSource=${encodeURIComponent(filters.moduleSource)}` : ""
  }${
    filters.status !== "ALL" ? `&status=${encodeURIComponent(filters.status)}` : ""
  }${
    filters.search ? `&search=${encodeURIComponent(filters.search)}` : ""
  }`;
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(`/finance/gl/trial-balance?startDate=${startDate}&endDate=${endDate}${extraQs}`);
      setRows(r.data.rows ?? []);
      setTotals(r.data.totals ?? null);
      setBalanced(r.data.balanced ?? true);
      setError("");
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to load the trial balance.");
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, extraQs]);
  useEffect(() => {
    load();
  }, [load]);
  if (loading) return <p className="text-gray-400 text-sm py-8 text-center">Loading trial balance…</p>;
  return (
    <div className="space-y-3">
      {error && <div className="bg-red-50 text-red-600 p-2 rounded text-sm">{error}</div>}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-xs font-semibold rounded px-2 py-1 ${balanced ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
          {balanced ? "✓ Balanced" : "Out of balance"}
        </span>
        <span className="text-xs text-gray-400">Totals · Debit {money(totals?.debit)} · Credit {money(totals?.credit)}</span>
        <span className="flex-1" />
        <button
          onClick={() => {
            const cols = ["Code", "Account", "Type", "Debit", "Credit", "Balance"];
            const body = rows.map((r: any) => [r.code ?? "", r.name, r.type ?? "", r.debit ?? 0, r.credit ?? 0, r.balance ?? 0]);
            const withTotals = [...body, ["", "TOTALS", "", totals?.debit ?? 0, totals?.credit ?? 0, totals?.difference ?? 0]];
            downloadCsv("trial-balance.csv", cols, withTotals);
          }}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          CSV
        </button>
        <button
          onClick={() => {
            setPrintDoc({
              title: "Trial Balance",
              meta: [
                `${startDate} → ${endDate}`,
                MODULE_OPTIONS.find((m) => m.key === filters.moduleSource)?.label ?? "All modules",
                locName(locations, filters.locationId ? Number(filters.locationId) : undefined),
              ],
              columns: ["Code", "Account", "Type", "Debit", "Credit", "Balance"],
              rows: [...rows.map((r: any) => [r.code ?? "", r.name, r.type ?? "", r.debit ?? 0, r.credit ?? 0, r.balance ?? 0]), ["", "TOTALS", "", totals?.debit ?? 0, totals?.credit ?? 0, totals?.difference ?? 0]],
            });
            setTimeout(() => window.print(), 120);
          }}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Print / PDF
        </button>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap min-w-[800px]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-100 bg-gray-50/60">
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Account</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2 text-right">Debit</th>
                <th className="px-3 py-2 text-right">Credit</th>
                <th className="px-3 py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r: any) => (
                <tr key={r.accountId} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-400">{r.code ?? "—"}</td>
                  <td className="px-3 py-2 font-medium text-gray-800">{r.name}</td>
                  <td className="px-3 py-2">{r.type ? <span className={`text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 ${TYPE_STYLES[r.type] ?? ""}`}>{statusLabel(r.type)}</span> : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(r.debit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(r.credit)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{money(r.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50/60 font-semibold">
                <td className="px-3 py-2 text-gray-500" colSpan={3}>Totals</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(totals?.debit)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(totals?.credit)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(totals?.difference)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {rows.length === 0 && <p className="text-gray-400 text-sm py-8 text-center">No journal activity in this period.</p>}
      </div>
      {printDoc && <PrintReport {...printDoc} />}
    </div>
  );
}

function AccountTab({ startDate, endDate, accounts, locations, filters }: any) {
  const [accountId, setAccountId] = useState("");
  const [ledger, setLedger] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [printDoc, setPrintDoc] = useState<any>(null);
  const extraQs = `${
    filters.locationId ? `&locationId=${encodeURIComponent(filters.locationId)}` : ""
  }${
    filters.moduleSource !== "ALL" ? `&moduleSource=${encodeURIComponent(filters.moduleSource)}` : ""
  }${
    filters.status !== "ALL" ? `&status=${encodeURIComponent(filters.status)}` : ""
  }${
    filters.search ? `&search=${encodeURIComponent(filters.search)}` : ""
  }`;
  const load = useCallback(async () => {
    if (!accountId) {
      setLedger(null);
      return;
    }
    setLoading(true);
    try {
      const r = await api.get(`/finance/gl/accounts/${accountId}?startDate=${startDate}&endDate=${endDate}${extraQs}`);
      setLedger(r.data);
      setError("");
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to load the account ledger.");
    } finally {
      setLoading(false);
    }
  }, [accountId, startDate, endDate, extraQs]);
  useEffect(() => {
    load();
  }, [load]);
  const normal = ledger?.normal === "DEBIT" ? "Debit-normal" : "Credit-normal";
  const rows = ledger?.rows ?? [];
  return (
    <div className="space-y-3">
      {error && <div className="bg-red-50 text-red-600 p-2 rounded text-sm">{error}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="border border-gray-300 rounded p-2 text-sm">
          <option value="">Select account…</option>
          {accounts.map((a: any) => (
            <option key={a.id} value={a.id}>{a.code ? `${a.code} · ` : ""}{a.name}</option>
          ))}
        </select>
        {ledger && (
          <span className="text-xs text-gray-400">
            {ledger.account?.name} · {normal} · Opening {money(ledger.openingBalance)} · Closing {money(ledger.closingBalance)}
          </span>
        )}
        <span className="flex-1" />
        <button
          onClick={() => {
            const cols = ["Date", "Reference", "Description", "Debit", "Credit", "Balance"];
            const body = rows.map((r: any) => [shortDate(r.date), r.reference ?? "", r.description ?? "", r.debit ?? 0, r.credit ?? 0, r.balance ?? 0]);
            downloadCsv(`account-ledger-${accountId}.csv`, cols, body);
          }}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          CSV
        </button>
        <button
          onClick={() => {
            setPrintDoc({
              title: `Account Ledger — ${ledger?.account?.name ?? ""}`,
              meta: [
                `${startDate} → ${endDate}`,
                MODULE_OPTIONS.find((m) => m.key === filters.moduleSource)?.label ?? "All modules",
                locName(locations, filters.locationId ? Number(filters.locationId) : undefined),
                `Opening ${money(ledger?.openingBalance)} · Closing ${money(ledger?.closingBalance)}`,
              ],
              columns: ["Date", "Reference", "Description", "Debit", "Credit", "Balance"],
              rows: rows.map((r: any) => [shortDate(r.date), r.reference ?? "", r.description ?? "", r.debit ?? 0, r.credit ?? 0, r.balance ?? 0]),
            });
            setTimeout(() => window.print(), 120);
          }}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Print / PDF
        </button>
      </div>
      {loading ? (
        <p className="text-gray-400 text-sm py-8 text-center">Loading account ledger…</p>
      ) : !ledger ? (
        <p className="text-gray-400 text-sm py-8 text-center">Select an account to see its ledger.</p>
      ) : rows.length === 0 ? (
        <p className="text-gray-400 text-sm py-8 text-center">No activity for this account in the period.</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap min-w-[900px]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-100 bg-gray-50/60">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Reference</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2 text-right">Debit</th>
                  <th className="px-3 py-2 text-right">Credit</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r: any) => (
                  <tr key={r.journalEntryId} className="hover:bg-gray-50">
                    <td className="px-3 py-2">{shortDate(r.date)}</td>
                    <td className="px-3 py-2 font-medium text-gray-800">{r.reference ?? "—"}</td>
                    <td className="px-3 py-2 text-gray-500">{r.description ?? ""}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.debit ? money(r.debit) : ""}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.credit ? money(r.credit) : ""}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{money(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {printDoc && <PrintReport {...printDoc} />}
    </div>
  );
}

function CoverageTab({ startDate, endDate }: any) {
  const [cov, setCov] = useState<any>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await api.get(`/finance/gl/coverage?startDate=${startDate}&endDate=${endDate}`);
      setCov(r.data);
      setError("");
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to load coverage.");
    }
  }, [startDate, endDate]);
  useEffect(() => {
    load();
  }, [load]);
  if (!cov && !error) return <p className="text-gray-400 text-sm py-8 text-center">Loading coverage…</p>;
  const total = cov?.totals;
  const statusText = (s: string) =>
    s === "ok" ? "OK" : s === "partial" ? "Partial" : s === "missing" ? "Missing" : "No activity";
  return (
    <div className="space-y-4">
      {error && <div className="bg-red-50 text-red-600 p-2 rounded text-sm">{error}</div>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Journal entries</p>
          <p className="text-xl font-bold text-gray-800 tabular-nums">{total?.journalEntries ?? 0}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Journal lines</p>
          <p className="text-xl font-bold text-gray-800 tabular-nums">{total?.journalLines ?? 0}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Total debit</p>
          <p className="text-xl font-bold text-gray-800 tabular-nums">{money(total?.debit)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Total credit</p>
          <p className="text-xl font-bold text-gray-800 tabular-nums">{money(total?.credit)}</p>
        </div>
      </div>
      <span className={`inline-block text-xs font-semibold rounded px-2 py-1 ${total?.balanced ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
        {total?.balanced ? "✓ Ledger balanced" : `Out of balance · difference ${money(total?.difference)}`}
      </span>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap min-w-[900px]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-100 bg-gray-50/60">
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2 text-right">Expected</th>
              <th className="px-3 py-2 text-right">Journal</th>
              <th className="px-3 py-2 text-right">Income</th>
              <th className="px-3 py-2 text-right">COGS</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(cov?.sources ?? []).map((s: any) => (
              <tr key={s.key} className="align-top">
                <td className="px-3 py-2">
                  <p className="font-medium text-gray-800">{s.label}</p>
                  {s.note ? <p className="text-[11px] text-gray-400 mt-0.5">{s.note}</p> : null}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{s.expectedCount}<span className="text-gray-400 text-xs"> · {money(s.expectedAmount)}</span></td>
                <td className="px-3 py-2 text-right tabular-nums">{s.journalCount}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.incomeCount}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.cogsCount}</td>
                <td className="px-3 py-2"><span className={`text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 ${STATUS_STYLES[s.status] ?? ""}`}>{statusText(s.status)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-xs font-semibold text-gray-500 mb-2">Postings by reference</p>
        <div className="flex flex-wrap gap-2">
          {(cov?.byReference ?? []).map((b: any) => (
            <span key={b.key} className={`text-xs rounded px-2 py-1 ${srcBadge(b.key)}`}>{SOURCE_LABELS[b.key] ?? b.key} · {b.count}</span>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-gray-400">
        Retail/POS coverage: sales post Income + COGS (plus VAT when an Output VAT Payable account exists) and returns post automatic reversals on return/delete. A missing or partial status exposes chart-of-account gaps instead of a silent ledger skip.
      </p>
    </div>
  );
}

export default function LedgerPage() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("finance.manage");
  const [tab, setTab] = useState<Tab>("journal");
  const [preset, setPreset] = useState<"today" | "week" | "month" | "year">("month");
  const [startDate, setStartDate] = useState(() => getDateRange("month").start);
  const [endDate, setEndDate] = useState(() => getDateRange("month").end);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [filters, setFilters] = useState({
    locationId: "",
    moduleSource: "ALL",
    status: "ALL",
    search: "",
  });
  useEffect(() => {
    api
      .get("/finance/accounts")
      .then((r) => setAccounts(r.data))
      .catch(() => undefined);
    api
      .get("/locations")
      .then((r) => setLocations(r.data ?? []))
      .catch(() => undefined);
  }, []);
  const TABS: { key: Tab; label: string }[] = [
    { key: "journal", label: t("ledger.tabs.journal") },
    { key: "trial", label: t("ledger.tabs.trial") },
    { key: "account", label: t("ledger.tabs.account") },
    { key: "coverage", label: t("ledger.tabs.coverage") },
  ];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">{t("ledger.title")}</h1>
        <p className="text-sm text-gray-400">{t("ledger.subtitle")}</p>
      </div>
      <DateFilter
        preset={preset}
        onPresetChange={(p) => {
          setPreset(p);
          const r = getDateRange(p);
          setStartDate(r.start);
          setEndDate(r.end);
        }}
        startDate={startDate}
        onStartDateChange={setStartDate}
        endDate={endDate}
        onEndDateChange={setEndDate}
      />
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filters.locationId}
            onChange={(e) => setFilters((f) => ({ ...f, locationId: e.target.value }))}
            className="border border-gray-300 rounded p-2 text-sm"
          >
            <option value="">All locations</option>
            {locations.map((l: any) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <select
            value={filters.moduleSource}
            onChange={(e) => setFilters((f) => ({ ...f, moduleSource: e.target.value }))}
            className="border border-gray-300 rounded p-2 text-sm"
          >
            {MODULE_OPTIONS.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
          <select
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            className="border border-gray-300 rounded p-2 text-sm"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
          <input
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            placeholder="Search reference or description…"
            className="border border-gray-300 rounded p-2 text-sm flex-1 min-w-[180px]"
          />
          {(filters.locationId || filters.moduleSource !== "ALL" || filters.status !== "ALL" || filters.search) && (
            <button
              onClick={() => setFilters({ locationId: "", moduleSource: "ALL", status: "ALL", search: "" })}
              className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
              Reset filters
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {TABS.map((x) => (
          <button
            key={x.key}
            onClick={() => setTab(x.key)}
            className={`px-3 py-2 text-sm border-b-2 ${tab === x.key ? "border-blue-600 text-blue-600 font-medium" : "border-transparent text-slate-500 hover:text-slate-700"}`}
          >
            {x.label}
          </button>
        ))}
      </div>
      {tab === "journal" && <JournalTab startDate={startDate} endDate={endDate} accounts={accounts} canManage={canManage} locations={locations} filters={filters} />}
      {tab === "trial" && <TrialTab startDate={startDate} endDate={endDate} locations={locations} filters={filters} />}
      {tab === "account" && <AccountTab startDate={startDate} endDate={endDate} accounts={accounts} locations={locations} filters={filters} />}
      {tab === "coverage" && <CoverageTab startDate={startDate} endDate={endDate} />}
    </div>
  );
}
