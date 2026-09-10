"use client";
import Modal from "@/app/components/Modal";
import api from "@/lib/api";
import { fmtCurrency } from "@/lib/currency";
import { useCallback, useEffect, useState } from "react";

const money = (n: any) => fmtCurrency(Number(n || 0));
const BADGE: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  OPEN: "bg-blue-100 text-blue-700",
  PARTIALLY_PAID: "bg-yellow-100 text-yellow-700",
  PAID: "bg-green-100 text-green-700",
  VOIDED: "bg-red-100 text-red-600",
};

export default function BillsPanel({ canManage }: any) {
  const [bills, setBills] = useState<any[]>([]);
  const [grns, setGrns] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [grnId, setGrnId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [payBill, setPayBill] = useState<any>(null);
  const [payAmount, setPayAmount] = useState("");
  const [saved, setSaved] = useState("");
  const flash = (msg: string) => {
    setSaved(msg);
    setTimeout(() => setSaved(""), 2500);
  };
  const load = useCallback(async () => {
    try {
      const [b, g] = await Promise.all([
        api.get("/manufacturing/vendor-bills").catch(() => ({ data: [] })),
        api.get("/manufacturing/goods-receipts").catch(() => ({ data: [] })),
      ]);
      setBills(b.data ?? []);
      setGrns(g.data ?? []);
      setError("");
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to load vendor bills");
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const grnLabel = (id: any) =>
    grns.find((g: any) => g.id === Number(id))?.grnNumber ?? `#${id}`;
  const createFromGrn = async () => {
    if (!grnId) return setError("Choose a goods receipt");
    setSaving(true);
    try {
      await api.post("/manufacturing/vendor-bills/from-grn", {
        grnId: Number(grnId),
        dueDate: dueDate || undefined,
      });
      setShowCreate(false);
      setGrnId("");
      flash("Draft bill created from GRN");
      load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to create bill");
    } finally {
      setSaving(false);
    }
  };
  const act = async (fn: () => Promise<any>, ok: string) => {
    setSaving(true);
    try {
      await fn();
      flash(ok);
      load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Action failed");
    } finally {
      setSaving(false);
    }
  };
  const submitPay = async () => {
    if (!payBill || !(Number(payAmount) > 0)) return;
    await act(
      () =>
        api.post(`/manufacturing/vendor-bills/${payBill.id}/pay`, {
          amount: Number(payAmount),
        }),
      "Payment recorded",
    );
    setPayBill(null);
  };
  return (
    <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2">
        <h3 className="font-semibold text-gray-800">Vendor bills (AP)</h3>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-green-700">{saved}</span>}
          <button onClick={load} className="text-xs text-blue-600 hover:underline">Refresh</button>
          {canManage && (
            <button onClick={() => setShowCreate(true)} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-1.5 text-xs font-medium">New from GRN</button>
          )}
        </div>
      </div>
      {error && <p className="text-red-600 text-xs px-4 py-2">{error}</p>}
      {bills.length === 0 ? (
        <p className="text-gray-400 text-sm py-6 text-center">No vendor bills yet — create one from a goods receipt.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-400 border-b bg-gray-50/60">
              <th className="px-3 py-2">Bill</th>
              <th className="px-3 py-2">GRN</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2">Due</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Items</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {bills.map((b: any) => (
              <tr key={b.id} className="align-top">
                <td className="px-3 py-2 font-medium text-gray-800">{b.billNumber}</td>
                <td className="px-3 py-2 text-gray-500">{grnLabel(b.grnId)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(b.totalAmount)}</td>
                <td className="px-3 py-2 text-gray-500">{b.dueDate ? new Date(b.dueDate).toLocaleDateString() : "—"}</td>
                <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${BADGE[b.status] ?? ""}`}>{b.status}</span></td>
                <td className="px-3 py-2 text-gray-500">{(b.items ?? []).length}</td>
                <td className="px-3 py-2">
                  {canManage && b.status === "DRAFT" && (
                    <div className="flex items-center gap-2">
                      <button onClick={() => act(() => api.post(`/manufacturing/vendor-bills/${b.id}/approve`), "Bill approved")} className="text-blue-600 hover:underline">Approve</button>
                      <button onClick={() => act(() => api.delete(`/manufacturing/vendor-bills/${b.id}`), "Bill deleted")} className="text-red-600 hover:underline">Delete</button>
                    </div>
                  )}
                  {canManage && (b.status === "OPEN" || b.status === "PARTIALLY_PAID") && (
                    <button onClick={() => { setPayBill(b); setPayAmount(String(b.totalAmount ?? 0)); }} className="text-green-600 hover:underline">Pay</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Create vendor bill from GRN">
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Goods receipt</label>
            <select value={grnId} onChange={(e) => setGrnId(e.target.value)} className="border border-gray-300 rounded p-2 text-sm w-full">
              <option value="">Select GRN…</option>
              {grns.map((g: any) => (
                <option key={g.id} value={g.id}>{g.grnNumber} · vendor #{g.vendorId ?? "—"}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Due date (optional)</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="border border-gray-300 rounded p-2 text-sm w-full" />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowCreate(false)} className="px-3 py-2 text-sm text-gray-600">Cancel</button>
            <button onClick={createFromGrn} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-2 text-sm font-medium">{saving ? "Saving…" : "Create draft bill"}</button>
          </div>
        </div>
      </Modal>
      <Modal isOpen={!!payBill} onClose={() => setPayBill(null)} title={`Pay ${payBill?.billNumber ?? ""}`}>
        <div className="space-y-3">
          <p className="text-xs text-gray-500">Bill total {money(payBill?.totalAmount)} — the backend deducts issued/APPLIED credit notes from the outstanding amount.</p>
          <input type="number" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className="border border-gray-300 rounded p-2 text-sm w-full" placeholder="Amount" />
          <div className="flex justify-end gap-2">
            <button onClick={() => setPayBill(null)} className="px-3 py-2 text-sm text-gray-600">Cancel</button>
            <button onClick={submitPay} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-2 text-sm font-medium">{saving ? "Saving…" : "Record payment"}</button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
