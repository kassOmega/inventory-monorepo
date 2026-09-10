"use client";
import Modal from "@/app/components/Modal";
import api from "@/lib/api";
import { fmtCurrency } from "@/lib/currency";
import { useCallback, useEffect, useState } from "react";

const money = (n: any) => fmtCurrency(Number(n || 0));
type Line = {
  productId: string;
  quantity: string;
  unitCost: string;
  batchNumber: string;
  expiryDate: string;
};
const emptyLine = (): Line => ({ productId: "", quantity: "", unitCost: "", batchNumber: "", expiryDate: "" });

export default function DirectBuyPanel({ vendors, materials, canManage }: any) {
  const [locations, setLocations] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [vendorId, setVendorId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await api.get("/locations").catch(() => ({ data: [] }));
      setLocations(r.data ?? []);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const loadHistory = useCallback(async () => {
    try {
      const r = await api.get("/manufacturing/goods-receipts").catch(() => ({ data: [] }));
      setHistory((r.data ?? []).filter((g: any) => g.isDirect));
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);
  const product = (id: any) => materials.find((m: any) => m.id === Number(id));
  const setLine = (i: number, patch: any) =>
    setLines((ls) => ls.map((l, x) => (x === i ? { ...l, ...patch } : l)));
  const pickProduct = (i: number, id: string) => {
    const p = product(id);
    setLine(i, {
      productId: id,
      unitCost: p?.currentBuyPrice != null ? String(p.currentBuyPrice) : "",
    });
  };
  const total = lines.reduce(
    (s: number, l: any) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0),
    0,
  );
  const submit = async () => {
    if (!locationId) return setError("Choose a receiving location");
    const clean = lines.filter((l) => l.productId && (Number(l.quantity) || 0) > 0);
    if (!clean.length) return setError("Add at least one product");
    setSaving(true);
    setError("");
    try {
      await api.post("/manufacturing/goods-receipts/direct", {
        vendorId: vendorId ? Number(vendorId) : undefined,
        locationId: Number(locationId),
        notes: notes || undefined,
        items: clean.map((l) => ({
          productId: Number(l.productId),
          quantity: Number(l.quantity),
          unitCost: Number(l.unitCost),
          batchNumber: l.batchNumber || undefined,
          expiryDate: l.expiryDate || undefined,
        })),
      });
      setOpen(false);
      setLines([emptyLine()]);
      setVendorId("");
      setLocationId("");
      setNotes("");
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to save direct receipt");
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">Direct buy / quick receipt</h3>
        {canManage && (
          <button onClick={() => setOpen(true)} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-1.5 text-xs font-medium">New direct buy</button>
        )}
      </div>
      {history.length > 0 && (
        <div className="px-4 py-2 border-b border-gray-100">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1">Recent direct receipts</p>
          <div className="flex flex-wrap gap-2">
            {history.slice(0, 8).map((g: any) => (
              <span key={g.id} className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded px-2 py-1">
                {g.grnNumber} · {new Date(g.receivedAt).toLocaleDateString()} · {money(g.totalAmount ?? 0)}
              </span>
            ))}
          </div>
        </div>
      )}
      {!canManage && <p className="text-gray-400 text-xs px-4 py-2">Requires manufacturing.manage.</p>}
      <Modal isOpen={open} onClose={() => setOpen(false)} title="Direct buy (quick receipt)">
        <div className="space-y-3">
          {error && <p className="bg-red-50 text-red-600 p-2 rounded text-sm">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Vendor (optional)</label>
              <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="border border-gray-300 rounded p-2 text-sm w-full">
                <option value="">— no vendor —</option>
                {vendors.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Receiving location *</label>
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="border border-gray-300 rounded p-2 text-sm w-full">
                <option value="">Select…</option>
                {locations.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs font-medium text-gray-500">Lines</p>
          {lines.map((l: any, i: number) => (
            <div key={i} className="border border-gray-200 rounded p-2 space-y-2">
              <div className="flex items-center gap-2">
                <select value={l.productId} onChange={(e) => pickProduct(i, e.target.value)} className="border border-gray-300 rounded p-2 text-sm flex-1">
                  <option value="">Select material…</option>
                  {materials.map((m: any) => <option key={m.id} value={m.id}>{m.brand ? `${m.brand} ` : ""}{m.baseName}</option>)}
                </select>
                <button type="button" onClick={() => setLines((ls) => ls.filter((_, x) => x !== i))} className="text-red-500 hover:text-red-700 text-lg leading-none">×</button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input type="number" min="0" step="any" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} placeholder="Qty" className="border border-gray-300 rounded p-2 text-sm w-full" />
                <input type="number" min="0" step="any" value={l.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value })} placeholder="Unit cost" className="border border-gray-300 rounded p-2 text-sm w-full" />
                <input value={l.batchNumber} onChange={(e) => setLine(i, { batchNumber: e.target.value })} placeholder="Batch / lot" className="border border-gray-300 rounded p-2 text-sm w-full" />
              </div>
              <input type="date" value={l.expiryDate} onChange={(e) => setLine(i, { expiryDate: e.target.value })} className="border border-gray-300 rounded p-2 text-sm w-full" title="Expiry" />
            </div>
          ))}
          <button type="button" onClick={() => setLines((ls) => [...ls, emptyLine()])} className="text-sm text-blue-600 hover:underline">+ Add line</button>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className="border border-gray-300 rounded p-2 text-sm w-full" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Total {money(total)}</span>
            <div className="flex gap-2">
              <button onClick={() => setOpen(false)} className="px-3 py-2 text-sm text-gray-600">Cancel</button>
              <button onClick={submit} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-2 text-sm font-medium">{saving ? "Saving…" : "Stock in & post"}</button>
            </div>
          </div>
        </div>
      </Modal>
    </section>
  );
}
