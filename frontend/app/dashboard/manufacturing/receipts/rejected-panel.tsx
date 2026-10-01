"use client";
import api from "@/lib/api";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const BADGE: Record<string, string> = {
  QUARANTINE: "bg-yellow-100 text-yellow-700",
  RETURNED_TO_VENDOR: "bg-blue-100 text-blue-700",
  SCRAPPED: "bg-red-100 text-red-600",
  CREDIT_NOTE_ISSUED: "bg-green-100 text-green-700",
};
const FILTERS = ["ALL", "QUARANTINE", "CREDIT_NOTE_ISSUED", "SCRAPPED", "RETURNED_TO_VENDOR"];
// Disposition enum → `mfg.rejected.d*` label key (resolved with t() at render).
const DISPOSITION_KEY: Record<string, string> = {
  ALL: "mfg.rejected.dAll",
  QUARANTINE: "mfg.rejected.dQuarantine",
  RETURNED_TO_VENDOR: "mfg.rejected.dReturnedToVendor",
  SCRAPPED: "mfg.rejected.dScrapped",
  CREDIT_NOTE_ISSUED: "mfg.rejected.dCreditNoteIssued",
};

export default function RejectedStockPanel({ materials, canManage }: any) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<any[]>([]);
  const [filter, setFilter] = useState("QUARANTINE");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [saved, setSaved] = useState("");
  const name = (id: any) =>
    materials?.find((m: any) => m.id === Number(id))?.baseName ?? `#${id}`;
  const load = useCallback(async () => {
    try {
      const q = filter === "ALL" ? "" : `?disposition=${filter}`;
      const r = await api.get(`/manufacturing/rejected-stock${q}`);
      setRows(r.data ?? []);
      setError("");
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("mfg.rejected.loadFailed"));
    }
  }, [filter, t]);
  useEffect(() => {
    load();
  }, [load]);
  const flash = (msg: string) => {
    setSaved(msg);
    setTimeout(() => setSaved(""), 2500);
  };
  const scrap = async (id: number) => {
    setBusyId(id);
    try {
      await api.post(`/manufacturing/rejected-stock/${id}/scrap`);
      flash(t("mfg.rejected.scrapDone"));
      load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("mfg.rejected.scrapFailed"));
    } finally {
      setBusyId(null);
    }
  };
  const creditNote = async (id: number) => {
    setBusyId(id);
    try {
      const created = await api.post("/manufacturing/vendor-credit-notes", {
        items: [{ rejectionId: id }],
      });
      const cnId = created.data?.id;
      if (cnId) {
        await api.post(`/manufacturing/vendor-credit-notes/${cnId}/issue`);
        await api.post(`/manufacturing/vendor-credit-notes/${cnId}/apply`);
      }
      flash(t("mfg.rejected.creditDone"));
      load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("mfg.rejected.creditFailed"));
    } finally {
      setBusyId(null);
    }
  };
  return (
    <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-gray-800">{t("mfg.rejected.title")}</h3>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-green-700">{saved}</span>}
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="border border-gray-300 rounded p-1.5 text-xs">
            {FILTERS.map((f) => <option key={f} value={f}>{t(DISPOSITION_KEY[f] ?? "")}</option>)}
          </select>
          <button onClick={load} className="text-xs text-blue-600 hover:underline">{t("mfg.rejected.refresh")}</button>
        </div>
      </div>
      {error && <p className="text-red-600 text-xs px-4 py-2">{error}</p>}
      {rows.length === 0 ? (
        <p className="text-gray-400 text-sm py-6 text-center">{t("mfg.rejected.none")}</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-400 border-b bg-gray-50/60">
              <th className="px-3 py-2">{t("mfg.rejected.colMaterial")}</th>
              <th className="px-3 py-2 text-right">{t("mfg.rejected.colQty")}</th>
              <th className="px-3 py-2 text-right">{t("mfg.rejected.colValue")}</th>
              <th className="px-3 py-2">{t("mfg.rejected.colReason")}</th>
              <th className="px-3 py-2">{t("common.status")}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r: any) => (
              <tr key={r.id} className="align-top">
                <td className="px-3 py-2 font-medium text-gray-800">{name(r.productId)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.quantity}</td>
                <td className="px-3 py-2 text-right tabular-nums">{(r.quantity * r.unitCost).toFixed(2)}</td>
                <td className="px-3 py-2 text-gray-500">{r.reason ?? t("mfg.rejected.dOther")}</td>
                <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${BADGE[r.disposition] ?? ""}`}>{t(DISPOSITION_KEY[r.disposition] ?? "") || r.disposition}</span></td>
                <td className="px-3 py-2">
                  {canManage && r.disposition === "QUARANTINE" && (
                    <div className="flex items-center gap-2">
                      <button onClick={() => creditNote(r.id)} disabled={busyId === r.id} className="text-blue-600 hover:underline">{t("mfg.rejected.creditNote")}</button>
                      <button onClick={() => scrap(r.id)} disabled={busyId === r.id} className="text-red-600 hover:underline">{t("mfg.rejected.scrap")}</button>
                    </div>
                  )}
                  {busyId === r.id && <span className="text-xs text-gray-400">{t("mfg.rejected.working")}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
