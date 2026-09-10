"use client";

import Loading from "@/app/components/Loading";
import Modal from "@/app/components/Modal";
import { useToast } from "@/app/components/ToastProvider";
import { fmtCurrency } from "@/lib/currency";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useState } from "react";
import RejectedStockPanel from "./rejected-panel";

const inputCls = "border p-2 rounded-lg w-full bg-white";
const labelCls = "block text-sm font-medium text-gray-500 mb-1";
const money = (n: number | null | undefined) => fmtCurrency(n ?? 0);
type QtyMap = Record<number, string>;

export default function ManufacturingReceiptsPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const canManage = hasPermission("manufacturing.manage");
  const [receipts, setReceipts] = useState<any[]>([]);
  const [pos, setPos] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [show, setShow] = useState(false);
  const [poId, setPoId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [notes, setNotes] = useState("");
  const [rec, setRec] = useState<QtyMap>({});
  const [rej, setRej] = useState<QtyMap>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, p, m, l] = await Promise.all([
        api.get("/manufacturing/goods-receipts"),
        api.get("/manufacturing/purchase-orders"),
        api.get("/manufacturing/purchase-orders/material-products").catch(() => ({ data: [] })),
        api.get("/locations").catch(() => ({ data: [] })),
      ]);
      setReceipts(r.data ?? []);
      setPos(p.data ?? []);
      setMaterials(m.data ?? []);
      setStores((l.data ?? []).filter((x: any) => x.type === "STORE"));
    } catch {
      toast.error("Failed to load receipts");
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const productName = (id: number) => materials.find((m) => m.id === id)?.baseName ?? `#${id}`;
  const receivable = pos.filter((po) => ["SENT", "PARTIALLY_RECEIVED"].includes(po.status));

  const openReceive = () => {
    setPoId("");
    setStoreId(stores[0] ? String(stores[0].id) : "");
    setNotes("");
    setRec({});
    setRej({});
    setShow(true);
  };

  const selectPo = (id: string) => {
    setPoId(id);
    const po = pos.find((p) => p.id === Number(id));
    const map: QtyMap = {};
    for (const it of po?.items ?? []) {
      const outstanding = Math.max(0, it.quantity - it.quantityReceived - it.quantityRejected);
      if (outstanding > 0) map[it.id] = String(outstanding);
    }
    setRec(map);
    setRej({});
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!poId || !storeId) {
      toast.error("Pick a purchase order and a store");
      return;
    }
    const items = Object.keys(rec)
      .map((k) => ({
        poItemId: Number(k),
        receivedQty: Number(rec[Number(k)]) || 0,
        rejectedQty: Number(rej[Number(k)]) || 0,
      }))
      .filter((i) => i.receivedQty > 0 || i.rejectedQty > 0);
    if (!items.length) {
      toast.error("Enter a quantity to receive");
      return;
    }
    setBusy(true);
    try {
      await api.post("/manufacturing/goods-receipts", {
        purchaseOrderId: Number(poId),
        locationId: Number(storeId),
        notes: notes || undefined,
        items,
      });
      toast.success("Stock received — store balance updated");
      setShow(false);
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to receive stock");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading className="py-24" />;

  const filtered = receipts.filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return `${r.grnNumber} ${r.po?.poNumber ?? ""}`.toLowerCase().includes(q);
  });

  return (
    <div>
      <div className="flex justify-between items-center mb-3 flex-wrap gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">Stock Receipts (GRN)</h1>
          <p className="text-sm text-gray-500 mt-1">Receiving updates store balances immediately.</p>
        </div>
        {canManage && <button onClick={openReceive} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm whitespace-nowrap">+ Receive Stock</button>}
      </div>
      <div className="mb-3"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search GRN or PO number…" className="border p-2 rounded-lg text-sm w-64" /></div>
      <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
        <table className="w-full text-left min-w-[820px] text-xs sm:text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="p-3">GRN #</th>
              <th className="p-3">PO #</th>
              <th className="p-3">Vendor</th>
              <th className="p-3">Store</th>
              <th className="p-3">Received on</th>
              <th className="p-3 text-right">Value</th>
              <th className="p-3 text-center">Lines</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const value = (r.items ?? []).reduce((s: number, i: any) => s + (i.receivedQty - i.rejectedQty) * i.unitCost, 0);
              return (
                <tr key={r.id} className="border-b hover:bg-gray-50">
                  <td className="p-3 font-medium">{r.grnNumber}</td>
                  <td className="p-3">{r.po?.poNumber ?? `#${r.poId}`}</td>
                  <td className="p-3">{r.po?.vendor?.name ?? `#${r.po?.vendorId ?? ""}`}</td>
                  <td className="p-3 text-gray-500">{stores.find((s) => s.id === r.locationId)?.name ?? `#${r.locationId}`}</td>
                  <td className="p-3 text-gray-500">{new Date(r.receivedAt).toLocaleString()}</td>
                  <td className="p-3 text-right font-medium">{money(value)}</td>
                  <td className="p-3 text-center">
                    <div>{(r.items ?? []).length}</div>
                    {(r.items ?? []).some((i: any) => i.batchNumber) && (
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        {(r.items ?? [])
                          .filter((i: any) => i.batchNumber)
                          .map((i: any) => (
                            <div key={i.id} className="truncate max-w-[180px]">
                              {i.batchNumber}
                              {i.expiryDate ? ` · ${new Date(i.expiryDate).toLocaleDateString()}` : ""}
                            </div>
                          ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-gray-400">No stock receipts yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <Modal isOpen={show} onClose={() => setShow(false)} title="Receive Stock">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Purchase order *</label>
              <select className={inputCls} value={poId} onChange={(e) => selectPo(e.target.value)}>
                <option value="">Select…</option>
                {receivable.map((po) => (
                  <option key={po.id} value={po.id}>{po.poNumber} — {po.vendor?.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Receive into store *</label>
              <select className={inputCls} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                <option value="">Select…</option>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>

          {poId && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[680px]">
                <thead>
                  <tr className="text-left text-gray-400 border-b">
                    <th className="py-1">Raw material</th>
                    <th className="py-1 text-right">Ordered</th>
                    <th className="py-1 text-right">Received</th>
                    <th className="py-1 text-right">Receive now</th>
                    <th className="py-1 text-right">Reject/scrap</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(rec).map((k) => {
                    const it = pos.find((p) => p.id === Number(poId))?.items?.find((x: any) => x.id === Number(k));
                    if (!it) return null;
                    return (
                      <tr key={k} className="border-b">
                        <td className="py-1.5">{productName(it.productId)}</td>
                        <td className="py-1.5 text-right">{it.quantity}</td>
                        <td className="py-1.5 text-right text-green-700">{it.quantityReceived ?? 0}</td>
                        <td className="py-1.5 text-right">
                          <input type="number" min="0" step="any" className="border rounded p-1 w-24 text-right" value={rec[Number(k)] ?? ""} onChange={(e) => setRec({ ...rec, [Number(k)]: e.target.value })} />
                        </td>
                        <td className="py-1.5 text-right">
                          <input type="number" min="0" step="any" className="border rounded p-1 w-24 text-right" value={rej[Number(k)] ?? ""} onChange={(e) => setRej({ ...rej, [Number(k)]: e.target.value })} placeholder="0" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShow(false)} className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm">Cancel</button>
            <button type="submit" disabled={busy} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm">{busy ? "Receiving…" : "Confirm Receipt"}</button>
          </div>
        </form>
      </Modal>
      <RejectedStockPanel materials={materials} canManage={canManage} />
    </div>
  );
}
