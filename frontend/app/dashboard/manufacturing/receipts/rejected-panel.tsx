"use client";
import api from "@/lib/api";
import { useCallback, useEffect, useState } from "react";

const BADGE: Record<string, string> = {
  QUARANTINE: "bg-yellow-100 text-yellow-700",
  RETURNED_TO_VENDOR: "bg-blue-100 text-blue-700",
  SCRAPPED: "bg-red-100 text-red-600",
  CREDIT_NOTE_ISSUED: "bg-green-100 text-green-700",
};
const FILTERS = ["ALL", "QUARANTINE", "CREDIT_NOTE_ISSUED", "SCRAPPED", "RETURNED_TO_VENDOR"];

export default function RejectedStockPanel({ materials, canManage }: any) {
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
      setError(e?.response?.data?.message ?? "Failed to load rejected stock");
    }
  }, [filter]);
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
      flash("Scrapped and posted to Spoilage & Wastage");
      load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Scrap failed");
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
      flash("Credit note issued and applied (Dr AP ↔ Cr Inventory)");
      load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Credit note failed");
    } finally {
      setBusyId(null);
    }
  };
  return (
    <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-gray-800">Rejected stock / quarantine</h3>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-green-700">{saved}</span>}
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className="border border-gray-300 rounded p-1.5 text-xs">
            {FILTERS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <button onClick={load} className="text-xs text-blue-600 hover:underline">Refresh</button>
        </div>
      </div>
      {error && <p className="text-red-600 text-xs px-4 py-2">{error}</p>}
      {rows.length === 0 ? (
        <p className="text-gray-400 text-sm py-6 text-center">No rejected stock records.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-400 border-b bg-gray-50/60">
              <th className="px-3 py-2">Material</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Value</th>
              <th className="px-3 py-2">Reason</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r: any) => (
              <tr key={r.id} className="align-top">
                <td className="px-3 py-2 font-medium text-gray-800">{name(r.productId)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.quantity}</td>
                <td className="px-3 py-2 text-right tabular-nums">{(r.quantity * r.unitCost).toFixed(2)}</td>
                <td className="px-3 py-2 text-gray-500">{r.reason ?? "OTHER"}</td>
                <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${BADGE[r.disposition] ?? ""}`}>{r.disposition}</span></td>
                <td className="px-3 py-2">
                  {canManage && r.disposition === "QUARANTINE" && (
                    <div className="flex items-center gap-2">
                      <button onClick={() => creditNote(r.id)} disabled={busyId === r.id} className="text-blue-600 hover:underline">Credit note</button>
                      <button onClick={() => scrap(r.id)} disabled={busyId === r.id} className="text-red-600 hover:underline">Scrap</button>
                    </div>
                  )}
                  {busyId === r.id && <span className="text-xs text-gray-400">working…</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
