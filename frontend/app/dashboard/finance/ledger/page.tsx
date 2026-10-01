"use client";
import api from "@/lib/api";
import DateFilter, { getDateRange } from "@/app/components/DateFilter";
import Modal from "@/app/components/Modal";
import { useAuth } from "@/context/AuthContext";
import { statusLabel } from "@/lib/statusLabel";
import {
  JOURNAL_EXPORT_COLUMNS,
  buildJournalExport,
  toCsvRows,
  type JournalEntryLike,
  type JournalLineLike,
} from "@/lib/glExport";
import { downloadApiFile } from "@/lib/downloadFile";
import i18n from "@/lib/i18n";
import { Fragment, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

type Tab = "journal" | "trial" | "account" | "coverage";

// Source code -> catalog key. Resolved through `sourceLabel()` so the journal
// table, the coverage cards and the exports all read the same wording.
const SOURCE_KEYS: Record<string, string> = {
  SALE: "ledger.srcSale",
  RTRN: "ledger.srcReturns",
  EXP: "ledger.srcExpenses",
  INC: "ledger.srcIncome",
  MGI: "ledger.srcMfgServices",
  ORD: "ledger.srcOrders",
  FOL: "ledger.srcFolios",
  PO: "ledger.srcPurchaseOrders",
  PUR: "ledger.srcPurchases",
  RST: "ledger.srcRestock",
  PRDV: "ledger.srcInitialStock",
  ADJ: "ledger.srcAdjustments",
  WST: "ledger.srcWastage",
  MANUAL: "ledger.srcManual",
};
const sourceLabel = (s?: string | null) =>
  s && SOURCE_KEYS[s] ? i18n.t(SOURCE_KEYS[s]) : s ?? "";
const SOURCE_ORDER = ["SALE","RTRN","EXP","INC","MGI","ORD","FOL","PO","PUR","RST","PRDV","ADJ","WST","MANUAL"];
const MODULE_OPTIONS = [
  { key: "ALL", labelKey: "ledger.modAll" },
  { key: "retail", labelKey: "ledger.modRetail" },
  { key: "hospitality", labelKey: "ledger.modHospitality" },
  { key: "manufacturing", labelKey: "ledger.modManufacturing" },
  { key: "procurement", labelKey: "ledger.modProcurement" },
  { key: "manual", labelKey: "ledger.modManual" },
];
const STATUS_OPTIONS = [
  { key: "ALL", labelKey: "ledger.statusAll" },
  { key: "POSTED", labelKey: "ledger.statusPosted" },
  { key: "REVERSED", labelKey: "ledger.statusReversed" },
  { key: "VOIDED", labelKey: "ledger.statusVoided" },
];
const STATUS_BADGES: Record<string, string> = {
  POSTED: "bg-green-50 text-green-700",
  REVERSED: "bg-amber-50 text-amber-700",
  VOIDED: "bg-red-50 text-red-700",
};
const statusBadge = (s?: string | null) =>
  s && s !== "POSTED" ? (
    <span className={`text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 ${STATUS_BADGES[s] ?? "bg-gray-100 text-gray-600"}`}>{statusLabel(s)}</span>
  ) : null;
const locName = (locations: any[], id?: number | null) =>
  id ? locations.find((l) => l.id === id)?.name ?? `#${id}` : i18n.t("common.all");

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

/** Message from an API failure (axios-shaped), for the export error banner. */
const exportErrorMessage = (e: unknown): string =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
  i18n.t("ledger.exportFailed");

/**
 * Printable report. Rows may be plain arrays (as before) or
 * `{ cells, detail?, bold? }` so a report can nest detail lines under a header
 * row. `rightFrom` is the first right-aligned column (defaults to the last 3,
 * the previous behaviour, so existing reports are unchanged).
 */
function PrintReport({ title, meta, columns, rows, rightFrom }: any) {
  const alignFrom =
    typeof rightFrom === "number" ? rightFrom : Math.max(0, columns.length - 3);
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
          {rows.map((r: any, i: number) => {
            const row = Array.isArray(r) ? { cells: r } : r;
            return (
              <tr key={i} className={row.bold ? "font-semibold" : ""}>
                {(row.cells ?? []).map((cell: any, j: number) => (
                  <td
                    key={j}
                    className={`border-b border-gray-100 px-2 py-1 ${j >= alignFrom ? "text-right tabular-nums" : ""} ${row.detail ? "text-gray-500 italic" : ""}`}
                  >
                    {row.detail && j === 0 ? "↳ " : ""}
                    {cell ?? ""}
                  </td>
                ))}
              </tr>
            );
          })}
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
  const { t } = useTranslation();
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
    if (!clean.length) return setError(t("ledger.lineRequired"));
    if (Math.abs(totalDebit - totalCredit) > 0.001)
      return setError(t("ledger.mustBalance"));
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
      setError(ex?.response?.data?.message ?? t("ledger.entrySaveFailed"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal isOpen={open} onClose={onClose} title={t("ledger.newEntry")}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t("common.date")}</label>
            <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className="border border-gray-300 rounded p-2 text-sm w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">{t("hotel.referenceOptional")}</label>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t("ledger.referencePh")} className="border border-gray-300 rounded p-2 text-sm w-full" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t("common.description")}</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("ledger.descriptionPh")} className="border border-gray-300 rounded p-2 text-sm w-full" />
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-500">{t("ledger.lines")}</p>
          {lines.map((l: any, i: number) => (
            <div key={i} className="border border-gray-200 rounded p-2 space-y-2">
              <div className="flex items-center gap-2">
                <select value={l.accountId} onChange={(e) => update(i, { accountId: e.target.value })} className="border border-gray-300 rounded p-2 text-sm flex-1">
                  <option value="">{t("ledger.selectAccount")}</option>
                  {accounts.map((a: any) => (
                    <option key={a.id} value={a.id}>{a.code ? `${a.code} · ` : ""}{a.name}</option>
                  ))}
                </select>
                <button type="button" onClick={() => setLines((ls) => ls.filter((_, x) => x !== i))} className="text-red-500 hover:text-red-700 text-lg leading-none">×</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" step="0.01" value={l.debit} onChange={(e) => update(i, { debit: e.target.value })} placeholder={t("fin.colDebit")} className="border border-gray-300 rounded p-2 text-sm w-full" />
                <input type="number" step="0.01" value={l.credit} onChange={(e) => update(i, { credit: e.target.value })} placeholder={t("fin.colCredit")} className="border border-gray-300 rounded p-2 text-sm w-full" />
              </div>
            </div>
          ))}
          <button type="button" onClick={() => setLines((ls) => [...ls, empty()])} className="text-sm text-blue-600 hover:underline">{t("ledger.addLine")}</button>
        </div>
        {error && <div className="bg-red-50 text-red-600 p-2 rounded text-sm">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={saving} className="px-3 py-2 text-sm text-gray-600">{t("common.cancel")}</button>
          <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-2 text-sm font-medium">{saving ? t("common.saving") : t("ledger.saveEntry")}</button>
        </div>
      </form>
    </Modal>
  );
}

function JournalTab({ startDate, endDate, accounts, canManage, locations, filters }: any) {
  const { t } = useTranslation();
  const [accountId, setAccountId] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [showModal, setShowModal] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [exporting, setExporting] = useState<"" | "csv" | "pdf">("");
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
      setError(e?.response?.data?.message ?? t("ledger.journalLoadFailed"));
    }
  }, [startDate, endDate, accountId, page, extraQs, t]);
  useEffect(() => {
    setPage(1);
  }, [accountId, startDate, endDate, extraQs]);
  useEffect(() => {
    load();
  }, [load]);
  const toggle = (id: number) => setExpanded((m) => ({ ...m, [id]: !m[id] }));
  const entries = data?.data ?? [];

  // The exports list each entry's lines, so they cover the whole filtered
  // period rather than the 25 rows on screen. The API caps pageSize at 200.
  const EXPORT_PAGE_SIZE = 200;
  const EXPORT_MAX_PAGES = 50; // 10k entries — a guard against a runaway loop
  const exportDeps = {
    money,
    shortDate,
    sourceLabel: (e: JournalEntryLike) => sourceLabel(e.source),
    locationLabel: (e: JournalEntryLike) => locName(locations, e.locationId),
    accountLabel: (l: JournalLineLike) =>
      `${l.account?.code ? `${l.account.code} · ` : ""}${l.account?.name ?? `#${l.accountId}`}`,
    accountType: (l: JournalLineLike) =>
      l.account?.type ? statusLabel(l.account.type) : "",
  };
  const fetchAllForExport = async () => {
    const all: JournalEntryLike[] = [];
    for (let p = 1; p <= EXPORT_MAX_PAGES; p++) {
      const params = `startDate=${startDate}&endDate=${endDate}&page=${p}&pageSize=${EXPORT_PAGE_SIZE}${extraQs}`;
      const r = await api.get(
        `/finance/gl/journal?${params}${accountId ? `&accountId=${accountId}` : ""}`,
      );
      const batch: JournalEntryLike[] = r.data?.data ?? [];
      all.push(...batch);
      if (batch.length < EXPORT_PAGE_SIZE) break;
    }
    return all;
  };
  /**
   * The rows both exports share, plus the line count that goes into the report
   * header. Logged so "the PDF has no lines" is instantly explainable: `lines`
   * counts what the API sent, `detailRows` what actually reached the file.
   */
  const buildExportRows = async () => {
    const pageEntries = (data?.data ?? []) as JournalEntryLike[];
    const countLines = (list: JournalEntryLike[]) =>
      list.reduce((n, e) => n + (e.lines?.length ?? 0), 0);

    let all = await fetchAllForExport();
    let lines = countLines(all);
    const visibleLines = countLines(pageEntries);
    // Safety net: if the export fetch came back without breakdown lines while
    // the page in front of the user has them, export what they can see rather
    // than silently printing entry rows only.
    if (!lines && visibleLines) {
      all = pageEntries;
      lines = visibleLines;
    }
    const rows = buildJournalExport(all, data?.totals, exportDeps);
    console.info("[gl-export]", {
      entries: all.length,
      lines,
      detailRows: rows.filter((r) => r.detail).length,
    });
    return { all, rows, lines };
  };
  const runExport = async (kind: "csv" | "pdf", run: () => Promise<void>) => {
    setExporting(kind);
    setError("");
    try {
      await run();
    } catch (e) {
      setError(exportErrorMessage(e));
    } finally {
      setExporting("");
    }
  };
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 25)));
  return (
    <div className="space-y-3">
      {savedMsg && <div className="bg-green-50 text-green-700 p-2 rounded text-sm">{savedMsg}</div>}
      {error && <div className="bg-red-50 text-red-600 p-2 rounded text-sm">{error}</div>}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="border border-gray-300 rounded p-2 text-sm">
            <option value="">{t("ledger.allAccounts")}</option>
            {accounts.map((a: any) => (
              <option key={a.id} value={a.id}>{a.code ? `${a.code} · ` : ""}{a.name}</option>
            ))}
          </select>
          {(filters.moduleSource !== "ALL" || filters.status !== "ALL" || filters.locationId) && (
            <span className="text-xs text-gray-500 bg-gray-100 rounded px-2 py-1">
              {t(MODULE_OPTIONS.find((m) => m.key === filters.moduleSource)?.labelKey ?? "ledger.modAll")} ·{" "}
              {t(STATUS_OPTIONS.find((s) => s.key === filters.status)?.labelKey ?? "ledger.statusAll")} · {locName(locations, filters.locationId ? Number(filters.locationId) : undefined)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled={exporting !== ""}
            onClick={() =>
              runExport("csv", async () => {
                const { rows } = await buildExportRows();
                downloadCsv(
                  "general-ledger-journal.csv",
                  JOURNAL_EXPORT_COLUMNS,
                  toCsvRows(rows),
                );
              })
            }
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            {exporting === "csv" ? t("ledger.preparing") : "CSV"}
          </button>
          <button
            disabled={exporting !== ""}
            onClick={() =>
              runExport("pdf", async () => {
                // Real PDF download from the API: every entry with its account
                // breakdown lines, then the period totals.
                const params = `startDate=${startDate}&endDate=${endDate}${extraQs}${
                  accountId ? `&accountId=${accountId}` : ""
                }`;
                await downloadApiFile(
                  `/finance/gl/journal/pdf?${params}`,
                  "general-ledger-journal.pdf",
                );
              })
            }
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            {exporting === "pdf" ? t("ledger.preparing") : t("ledger.downloadPdf")}
          </button>
          {canManage && (
            <button onClick={() => setShowModal(true)} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-2 text-sm font-medium">{t("ledger.newEntryBtn")}</button>
          )}
        </div>
      </div>
      {!data ? (
        <p className="text-gray-400 text-sm py-8 text-center">{t("ledger.loadingJournal")}</p>
      ) : entries.length === 0 ? (
        <p className="text-gray-400 text-sm py-8 text-center">{t("ledger.noJournal")}</p>
      ) : (
        <div className="gl-print-card bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="gl-print-scroll overflow-x-auto">
            <table className="gl-print-table w-full text-sm whitespace-nowrap min-w-[1000px]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-100 bg-gray-50/60">
                  <th className="px-3 py-2">{t("common.date")}</th>
                  <th className="px-3 py-2">{t("ledger.colReference")}</th>
                  <th className="px-3 py-2">{t("common.description")}</th>
                  <th className="px-3 py-2">{t("ledger.colSource")}</th>
                  <th className="px-3 py-2">{t("common.status")}</th>
                  <th className="px-3 py-2">{t("common.location")}</th>
                  <th className="px-3 py-2 text-right">{t("fin.colDebit")}</th>
                  <th className="px-3 py-2 text-right">{t("fin.colCredit")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries.map((e: any) => (
                  <Fragment key={e.id}>
                    <tr onClick={() => toggle(e.id)} className="cursor-pointer hover:bg-gray-50">
                      <td className="px-3 py-2">{shortDate(e.entryDate)}</td>
                      <td className="px-3 py-2 font-medium text-gray-800">{e.reference ?? "—"}</td>
                      <td className="px-3 py-2 text-gray-500">{e.description ?? ""}</td>
                      <td className="px-3 py-2"><span className={`text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 ${srcBadge(e.source)}`}>{sourceLabel(e.source)}</span></td>
                      <td className="px-3 py-2">{statusBadge(e.postingStatus) ?? <span className="text-[10px] text-gray-300 font-semibold uppercase tracking-wide">{t("ledger.statusPosted")}</span>}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{locName(locations, e.locationId)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(e.totalDebit)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(e.totalCredit)}</td>
                    </tr>
                    {(e.lines ?? []).map((l: any) => (
                        <tr
                          key={`l${l.id}`}
                          data-expanded={expanded[e.id] ? "true" : "false"}
                          className={
                            "ledger-sub-line bg-gray-50/60 text-xs " +
                            (expanded[e.id] ? "" : "hidden")
                          }
                        >
                          <td className="px-3 py-1.5 pl-6 text-gray-400">{t("ledger.subLine")}</td>
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
            <span className="text-gray-500">{t("ledger.journalFooter", { count: data?.total ?? 0, debit: money(data?.totals?.debit), credit: money(data?.totals?.credit) })}</span>
            <div className="flex items-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="px-2 py-1 text-xs border border-gray-200 rounded disabled:opacity-40">{t("pg.previous")}</button>
              <span className="text-xs text-gray-400">{t("ledger.pageOf", { page, total: totalPages })}</span>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="px-2 py-1 text-xs border border-gray-200 rounded disabled:opacity-40">{t("pg.next")}</button>
            </div>
          </div>
        </div>
      )}
      <EntryModal
        open={showModal}
        onClose={() => setShowModal(false)}
        accounts={accounts}
        onSaved={() => {
          setShowModal(false);
          setSavedMsg(t("ledger.entrySaved"));
          setTimeout(() => setSavedMsg(""), 2500);
          load();
        }}
      />
    </div>
  );
}

function TrialTab({ startDate, endDate, locations, filters }: any) {
  const { t } = useTranslation();
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
      setError(e?.response?.data?.message ?? t("ledger.trialLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, extraQs, t]);
  useEffect(() => {
    load();
  }, [load]);
  if (loading) return <p className="text-gray-400 text-sm py-8 text-center">{t("ledger.loadingTrial")}</p>;
  const cols = [t("common.code"), t("ledger.colAccount"), t("common.type"), t("fin.colDebit"), t("fin.colCredit"), t("ledger.colBalance")];
  return (
    <div className="space-y-3">
      {error && <div className="bg-red-50 text-red-600 p-2 rounded text-sm">{error}</div>}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-xs font-semibold rounded px-2 py-1 ${balanced ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
          {balanced ? t("ledger.balanced") : t("ledger.unbalanced")}
        </span>
        <span className="text-xs text-gray-400">{t("ledger.totalsLine", { debit: money(totals?.debit), credit: money(totals?.credit) })}</span>
        <span className="flex-1" />
        <button
          onClick={() => {
            const body = rows.map((r: any) => [r.code ?? "", r.name, r.type ?? "", r.debit ?? 0, r.credit ?? 0, r.balance ?? 0]);
            const withTotals = [...body, ["", t("ledger.totalsRow"), "", totals?.debit ?? 0, totals?.credit ?? 0, totals?.difference ?? 0]];
            downloadCsv("trial-balance.csv", cols, withTotals);
          }}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          CSV
        </button>
        <button
          onClick={() => {
            setPrintDoc({
              title: t("ledger.tabs.trial"),
              meta: [
                `${startDate} → ${endDate}`,
                t(MODULE_OPTIONS.find((m) => m.key === filters.moduleSource)?.labelKey ?? "ledger.modAll"),
                locName(locations, filters.locationId ? Number(filters.locationId) : undefined),
              ],
              columns: cols,
              rows: [...rows.map((r: any) => [r.code ?? "", r.name, r.type ?? "", r.debit ?? 0, r.credit ?? 0, r.balance ?? 0]), ["", "TOTALS", "", totals?.debit ?? 0, totals?.credit ?? 0, totals?.difference ?? 0]],
            });
            setTimeout(() => window.print(), 120);
          }}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          {t("ledger.printPdf")}
        </button>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap min-w-[800px]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-100 bg-gray-50/60">
                <th className="px-3 py-2">{t("common.code")}</th>
                <th className="px-3 py-2">{t("ledger.colAccount")}</th>
                <th className="px-3 py-2">{t("common.type")}</th>
                <th className="px-3 py-2 text-right">{t("fin.colDebit")}</th>
                <th className="px-3 py-2 text-right">{t("fin.colCredit")}</th>
                <th className="px-3 py-2 text-right">{t("ledger.colBalance")}</th>
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
                <td className="px-3 py-2 text-gray-500" colSpan={3}>{t("common.total")}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(totals?.debit)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(totals?.credit)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(totals?.difference)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {rows.length === 0 && <p className="text-gray-400 text-sm py-8 text-center">{t("ledger.noActivity")}</p>}
      </div>
      {printDoc && <PrintReport {...printDoc} />}
    </div>
  );
}

function AccountTab({ startDate, endDate, accounts, locations, filters }: any) {
  const { t } = useTranslation();
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
      setError(e?.response?.data?.message ?? t("ledger.accountLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [accountId, startDate, endDate, extraQs, t]);
  useEffect(() => {
    load();
  }, [load]);
  const normal = ledger?.normal === "DEBIT" ? t("ledger.debitNormal") : t("ledger.creditNormal");
  const rows = ledger?.rows ?? [];
  const cols = [t("common.date"), t("ledger.colReference"), t("common.description"), t("fin.colDebit"), t("fin.colCredit"), t("ledger.colBalance")];
  return (
    <div className="space-y-3">
      {error && <div className="bg-red-50 text-red-600 p-2 rounded text-sm">{error}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="border border-gray-300 rounded p-2 text-sm">
          <option value="">{t("ledger.selectAccount")}</option>
          {accounts.map((a: any) => (
            <option key={a.id} value={a.id}>{a.code ? `${a.code} · ` : ""}{a.name}</option>
          ))}
        </select>
        {ledger && (
          <span className="text-xs text-gray-400">
            {ledger.account?.name} · {normal} · {t("ledger.openingClosing", { opening: money(ledger.openingBalance), closing: money(ledger.closingBalance) })}
          </span>
        )}
        <span className="flex-1" />
        <button
          onClick={() => {
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
              title: t("ledger.accountLedgerTitle", { name: ledger?.account?.name ?? "" }),
              meta: [
                `${startDate} → ${endDate}`,
                t(MODULE_OPTIONS.find((m) => m.key === filters.moduleSource)?.labelKey ?? "ledger.modAll"),
                locName(locations, filters.locationId ? Number(filters.locationId) : undefined),
                t("ledger.openingClosing", { opening: money(ledger?.openingBalance), closing: money(ledger?.closingBalance) }),
              ],
              columns: cols,
              rows: rows.map((r: any) => [shortDate(r.date), r.reference ?? "", r.description ?? "", r.debit ?? 0, r.credit ?? 0, r.balance ?? 0]),
            });
            setTimeout(() => window.print(), 120);
          }}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          {t("ledger.printPdf")}
        </button>
      </div>
      {loading ? (
        <p className="text-gray-400 text-sm py-8 text-center">{t("ledger.loadingAccount")}</p>
      ) : !ledger ? (
        <p className="text-gray-400 text-sm py-8 text-center">{t("ledger.selectAccountHint")}</p>
      ) : rows.length === 0 ? (
        <p className="text-gray-400 text-sm py-8 text-center">{t("ledger.accountNoActivity")}</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap min-w-[900px]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-100 bg-gray-50/60">
                  <th className="px-3 py-2">{t("common.date")}</th>
                  <th className="px-3 py-2">{t("ledger.colReference")}</th>
                  <th className="px-3 py-2">{t("common.description")}</th>
                  <th className="px-3 py-2 text-right">{t("fin.colDebit")}</th>
                  <th className="px-3 py-2 text-right">{t("fin.colCredit")}</th>
                  <th className="px-3 py-2 text-right">{t("ledger.colBalance")}</th>
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
  const { t } = useTranslation();
  const [cov, setCov] = useState<any>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await api.get(`/finance/gl/coverage?startDate=${startDate}&endDate=${endDate}`);
      setCov(r.data);
      setError("");
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("ledger.coverageLoadFailed"));
    }
  }, [startDate, endDate, t]);
  useEffect(() => {
    load();
  }, [load]);
  if (!cov && !error) return <p className="text-gray-400 text-sm py-8 text-center">{t("ledger.loadingCoverage")}</p>;
  const total = cov?.totals;
  const statusText = (s: string) =>
    s === "ok"
      ? t("ledger.covOk")
      : s === "partial"
        ? t("ledger.covPartial")
        : s === "missing"
          ? t("ledger.covMissing")
          : t("ledger.noActivityStatus");
  return (
    <div className="space-y-4">
      {error && <div className="bg-red-50 text-red-600 p-2 rounded text-sm">{error}</div>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t("ledger.kpiEntries")}</p>
          <p className="text-xl font-bold text-gray-800 tabular-nums">{total?.journalEntries ?? 0}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t("ledger.kpiLines")}</p>
          <p className="text-xl font-bold text-gray-800 tabular-nums">{total?.journalLines ?? 0}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t("ledger.kpiTotalDebit")}</p>
          <p className="text-xl font-bold text-gray-800 tabular-nums">{money(total?.debit)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t("ledger.kpiTotalCredit")}</p>
          <p className="text-xl font-bold text-gray-800 tabular-nums">{money(total?.credit)}</p>
        </div>
      </div>
      <span className={`inline-block text-xs font-semibold rounded px-2 py-1 ${total?.balanced ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
        {total?.balanced ? t("ledger.ledgerBalanced") : t("ledger.balanceDiff", { diff: money(total?.difference) })}
      </span>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap min-w-[900px]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-400 border-b border-gray-100 bg-gray-50/60">
              <th className="px-3 py-2">{t("ledger.colSource")}</th>
              <th className="px-3 py-2 text-right">{t("ledger.colExpected")}</th>
              <th className="px-3 py-2 text-right">{t("ledger.tabs.journal")}</th>
              <th className="px-3 py-2 text-right">{t("status.income")}</th>
              <th className="px-3 py-2 text-right">{t("ledger.colCogs")}</th>
              <th className="px-3 py-2">{t("common.status")}</th>
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
        <p className="text-xs font-semibold text-gray-500 mb-2">{t("ledger.byReference")}</p>
        <div className="flex flex-wrap gap-2">
          {(cov?.byReference ?? []).map((b: any) => (
            <span key={b.key} className={`text-xs rounded px-2 py-1 ${srcBadge(b.key)}`}>{sourceLabel(b.key)} · {b.count}</span>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-gray-400">
        {t("ledger.coverageNote")}
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
            <option value="">{t("sales.allLocations")}</option>
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
              <option key={m.key} value={m.key}>{t(m.labelKey)}</option>
            ))}
          </select>
          <select
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            className="border border-gray-300 rounded p-2 text-sm"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.key} value={s.key}>{t(s.labelKey)}</option>
            ))}
          </select>
          <input
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            placeholder={t("ledger.searchPh")}
            className="border border-gray-300 rounded p-2 text-sm flex-1 min-w-[180px]"
          />
          {(filters.locationId || filters.moduleSource !== "ALL" || filters.status !== "ALL" || filters.search) && (
            <button
              onClick={() => setFilters({ locationId: "", moduleSource: "ALL", status: "ALL", search: "" })}
              className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
              {t("ledger.resetFilters")}
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
