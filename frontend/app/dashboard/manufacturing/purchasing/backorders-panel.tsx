"use client";
import api from "@/lib/api";
import { fmtCurrency } from "@/lib/currency";
import { useCallback, useEffect, useState } from "react";

const money = (n: any) => fmtCurrency(Number(n || 0));
const shortDate = (d: any) => (d ? new Date(d).toLocaleDateString() : "—");
const STATUS_BADGE: Record<string, string> = {
  SENT: "bg-blue-100 text-blue-700",
  PARTIALLY_RECEIVED: "bg-yellow-100 text-yellow-700",
};

export default function BackordersPanel({ materials }: any) {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [error, setError] = useState("");
  const name = (id: any) =>
    materials?.find((m: any) => m.id === Number(id))?.baseName ?? `#${id}`;
  const load = useCallback(async () => {
    try {
      const r = await api.get("/manufacturing/purchase-orders/backorders");
      setRows(r.data ?? []);
      setError("");
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to load backorders");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const toggle = (id: number) => setOpen((m) => ({ ...m, [id]: !m[id] }));
  return (
    <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">Backorders / Open PO lines</h3>
        <button onClick={load} className="text-xs text-blue-600 hover:underline">Refresh</button>
      </div>
      {error && <p className="text-red-600 text-xs px-4 py-2">{error}</p>}
      {rows.length === 0 ? (
        <p className="text-gray-400 text-sm py-6 text-center">No open lines — all purchase orders are fully received.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {rows.map((r: any) => (
            <div key={r.poId}>
              <button onClick={() => toggle(r.poId)} className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-gray-800">{r.poNumber} <span className="text-gray-400 font-normal">· {r.vendor ?? "No vendor"}</span></span>
                <span className="text-xs flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded ${STATUS_BADGE[r.status] ?? "bg-gray-100 text-gray-600"}`}>{r.status}</span>
                  <span className="text-gray-400">{r.lines.length} open line(s) · {money(r.totalValue)}</span>
                </span>
              </button>
              {open[r.poId] && (
                <div className="px-4 pb-3">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-400 border-b">
                        <th className="py-1">Material</th>
                        <th className="py-1 text-right">Ordered</th>
                        <th className="py-1 text-right">Received</th>
                        <th className="py-1 text-right">Rejected</th>
                        <th className="py-1 text-right">Backorder</th>
                        <th className="py-1 text-right">Expected</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(r.lines ?? []).map((l: any) => (
                        <tr key={l.poItemId} className="border-b last:border-0">
                          <td className="py-1">{name(l.productId)}</td>
                          <td className="py-1 text-right">{l.orderedQty}</td>
                          <td className="py-1 text-right text-green-700">{l.receivedQty}</td>
                          <td className="py-1 text-right text-red-600">{l.rejectedQty}</td>
                          <td className="py-1 text-right font-medium text-yellow-700">{l.backorderQty}</td>
                          <td className="py-1 text-right text-gray-400">{shortDate(l.expectedDeliveryDate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
