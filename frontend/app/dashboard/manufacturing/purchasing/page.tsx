"use client";

import Loading from "@/app/components/Loading";
import Modal from "@/app/components/Modal";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useToast } from "@/app/components/ToastProvider";
import { fmtCurrency } from "@/lib/currency";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useState } from "react";
import BackordersPanel from "./backorders-panel";
import BillsPanel from "./bills-panel";
import DirectBuyPanel from "./direct-buy-panel";
import VendorsPanel from "./vendors-panel";
import VendorFormModal from "./vendor-form-modal";

const STATUSES = ["DRAFT", "SENT", "PARTIALLY_RECEIVED", "RECEIVED"];
const BADGE: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  SENT: "bg-blue-100 text-blue-700",
  PARTIALLY_RECEIVED: "bg-yellow-100 text-yellow-700",
  RECEIVED: "bg-green-100 text-green-700",
  CANCELLED: "bg-red-100 text-red-600",
};

type Line = { productId: string; quantity: string; unitCost: string };
const emptyLine = (): Line => ({ productId: "", quantity: "", unitCost: "" });

const emptyForm = () => ({
  vendorId: "",
  newVendorName: "",
  expectedDeliveryDate: "",
  notes: "",
  lines: [] as Line[],
});

const inputCls = "border p-2 rounded-lg w-full bg-white";
const labelCls = "block text-sm font-medium text-gray-500 mb-1";
const money = (n: number | null | undefined) => fmtCurrency(n ?? 0);

export default function ManufacturingPurchasingPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [pos, setPos] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);
  const canManage = hasPermission("manufacturing.manage");
  const [tab, setTab] = useState("pos");
  const [showVendorModal, setShowVendorModal] = useState(false);
  const TABS = ["pos", "backorders", "bills", "direct", "vendors"];
  const TAB_LABELS: Record<string, string> = {
    pos: "Purchase Orders",
    backorders: "Backorders",
    bills: "Vendor Bills (AP)",
    direct: "Direct Buy",
    vendors: "Vendors",
  };

  const load = useCallback(async () => {
    try {
      const [p, v, m] = await Promise.all([
        api.get("/manufacturing/purchase-orders"),
        api.get("/manufacturing/vendors").catch(() => ({ data: [] })),
        api.get("/manufacturing/purchase-orders/material-products").catch(() => ({ data: [] })),
      ]);
      setPos(p.data ?? []);
      setVendors(v.data ?? []);
      setMaterials(m.data ?? []);
    } catch {
      toast.error("Failed to load purchase orders");
    } finally {
      setLoading(false);
    }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setForm(emptyForm());
    setShowForm(true);
  };

  const openNetting = async () => {
    try {
      const r = await api.get("/manufacturing/purchase-orders/netting-shortage");
      const lines = (r.data?.lines ?? []).map((l: any) => ({
        productId: String(l.productId),
        quantity: String(l.suggestedQty),
        unitCost: String(l.unitCostHint || ""),
      }));
      if (!lines.length) {
        toast.error("No shortages right now — open orders are covered by stock");
        return;
      }
      setForm({
        vendorId: "",
        newVendorName: "",
        expectedDeliveryDate: "",
        notes: `Auto-drafted from netting (${r.data?.orderCount ?? 0} open order(s))`,
        lines,
      });
      setShowForm(true);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to compute shortages");
    }
  };

  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }));
  const setLine = (i: number, patch: Partial<Line>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l, x) => (x === i ? { ...l, ...patch } : l)) }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const vendorId = form.vendorId ? Number(form.vendorId) : 0;
    if (!vendorId) {
      toast.error("Choose a vendor - use '+ Add Vendor' to create one inline");
      return;
    }
    const lines = form.lines
      .filter((l) => l.productId && Number(l.quantity) > 0)
      .map((l) => ({
        productId: Number(l.productId),
        quantity: Number(l.quantity),
        unitCost: Number(l.unitCost) || 0,
      }));
    if (!lines.length) {
      toast.error("Add at least one line item");
      return;
    }
    setSaving(true);
    try {
      await api.post("/manufacturing/purchase-orders", {
        vendorId,
        expectedDeliveryDate: form.expectedDeliveryDate || undefined,
        notes: form.notes || undefined,
        items: lines,
      });
      toast.success("Purchase order saved as draft");
      setShowForm(false);
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to save purchase order");
    } finally {
      setSaving(false);
    }
  };

  const send = async (po: any) => {
    try {
      await api.post(`/manufacturing/purchase-orders/${po.id}/send`);
      toast.success("Purchase order sent");
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to send");
    }
  };
  const cancel = async (po: any) => {
    if (!(await confirm(`Cancel purchase order ${po.poNumber}?`))) return;
    try {
      await api.post(`/manufacturing/purchase-orders/${po.id}/cancel`);
      toast.success("Purchase order cancelled");
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to cancel");
    }
  };
  const remove = async (po: any) => {
    if (!(await confirm(`Delete purchase order ${po.poNumber}?`))) return;
    try {
      await api.delete(`/manufacturing/purchase-orders/${po.id}`);
      toast.success("Purchase order deleted");
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to delete");
    }
  };
  const productName = (id: number) =>
    materials.find((m) => m.id === id)?.baseName ?? `#${id}`;
  const vendorName = (id: number) =>
    vendors.find((v) => v.id === id)?.name ?? `#${id}`;
  const filtered = pos.filter((po) => {
    if (status && po.status !== status) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return `${po.poNumber} ${vendorName(po.vendorId)}`.toLowerCase().includes(q);
  });

  if (loading) return <Loading className="py-24" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 border-b border-gray-100 pb-2">
        {TABS.map((key) => (
          <button key={key} onClick={() => setTab(key)} className={`px-3 py-2 text-sm border-b-2 ${tab === key ? "border-blue-600 text-blue-600 font-medium" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {TAB_LABELS[key]}
          </button>
        ))}
      </div>
      {tab === "pos" && (
        <div className="space-y-4">
      <div className="flex justify-between items-center mb-1 flex-wrap gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">Purchase Orders</h1>
          <p className="text-sm text-gray-500 mt-1">Order raw materials from vendors; receipts deposit stock into your store.</p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <button onClick={openNetting} className="border border-blue-300 text-blue-700 px-3 py-2 rounded-lg text-sm whitespace-nowrap">
              Draft PO from Netting Shortage
            </button>
            <button onClick={openCreate} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm whitespace-nowrap">+ New Purchase Order</button>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 mb-3">
        {["", ...STATUSES].map((s) => (
          <button key={s || "all"} onClick={() => setStatus(s)} className={`px-3 py-1 rounded-full text-xs border ${status === s ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200"}`}>
            {s || "All"}
          </button>
        ))}
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search PO # or vendor…" className="ml-auto border p-2 rounded-lg text-sm w-56" />
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
        <table className="w-full text-left min-w-[860px] text-xs sm:text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="p-3">PO #</th>
              <th className="p-3">Vendor</th>
              <th className="p-3">Created</th>
              <th className="p-3">Expected delivery</th>
              <th className="p-3 text-right">Total cost</th>
              <th className="p-3">Status</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((po) => (
              <tr key={po.id} className="border-b hover:bg-gray-50">
                <td className="p-3 font-medium">{po.poNumber}</td>
                <td className="p-3">{vendorName(po.vendorId)}</td>
                <td className="p-3 text-gray-500">{new Date(po.createdAt).toLocaleDateString()}</td>
                <td className="p-3 text-gray-500">{po.expectedDeliveryDate ? new Date(po.expectedDeliveryDate).toLocaleDateString() : "—"}</td>
                <td className="p-3 text-right font-medium">{money(po.totalAmount)}</td>
                <td className="p-3">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${BADGE[po.status] ?? "bg-gray-100 text-gray-700"}`}>{po.status.replace("_", " ")}</span>
                </td>
                <td className="p-3">
                  <div className="flex justify-end gap-2 text-xs">
                    <button onClick={() => setDetail(po)} className="text-gray-600 hover:underline">View</button>
                    {canManage && po.status === "DRAFT" && <button onClick={() => send(po)} className="text-blue-600 hover:underline">Send</button>}
                    {canManage && ["DRAFT", "SENT"].includes(po.status) && <button onClick={() => cancel(po)} className="text-orange-600 hover:underline">Cancel</button>}
                    {canManage && ["DRAFT", "CANCELLED"].includes(po.status) && <button onClick={() => remove(po)} className="text-red-600 hover:underline">Delete</button>}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-gray-400">No purchase orders yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="New Purchase Order">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Vendor</label>
              <select className={inputCls} value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })}>
                <option value="">—</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              <button type="button" onClick={() => setShowVendorModal(true)} className="text-blue-600 hover:underline text-xs mt-1">+ Add Vendor</button>
            </div>
            <div>
              <label className={labelCls}>Expected delivery</label>
              <input type="date" className={inputCls} value={form.expectedDeliveryDate} onChange={(e) => setForm({ ...form, expectedDeliveryDate: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>Notes</label>
              <input className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium text-gray-500">Line items</p>
              <button type="button" onClick={addLine} className="text-xs text-blue-600 hover:underline">+ Add line</button>
            </div>
            {form.lines.length === 0 && <p className="text-xs text-gray-400 border border-dashed rounded-lg p-3 text-center">Add a raw material line to order.</p>}
            <div className="space-y-2">
              {form.lines.map((line, i) => {
                const qty = Number(line.quantity) || 0;
                const cost = Number(line.unitCost) || 0;
                return (
                  <div key={i} className="grid grid-cols-[1fr_110px_110px_70px_24px] gap-2 items-center bg-gray-50 rounded-lg p-2">
                    <select className={inputCls} value={line.productId} onChange={(e) => setLine(i, { productId: e.target.value })}>
                      <option value="">Material…</option>
                      {materials.map((m) => <option key={m.id} value={m.id}>{m.brand ? `${m.brand} ` : ""}{m.baseName}</option>)}
                    </select>
                    <input type="number" min="0" step="any" className={inputCls} placeholder="Qty" value={line.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                    <input type="number" min="0" step="any" className={inputCls} placeholder="Unit cost" value={line.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value })} />
                    <span className="text-xs text-gray-500 text-right">{money(qty * cost)}</span>
                    <button type="button" onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((_, x) => x !== i) }))} className="text-red-500 text-xs">✕</button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between border-t pt-3">
            <span className="text-sm text-gray-500">Total</span>
            <span className="font-semibold">{money(form.lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0))}</span>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm">Cancel</button>
            <button type="submit" disabled={saving} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">{saving ? "Saving…" : "Save as Draft"}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title={detail ? `Purchase Order ${detail.poNumber}` : ""}>
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="flex justify-between items-center">
              <div>
                <p className="font-medium">{vendorName(detail.vendorId)}</p>
                <p className="text-xs text-gray-400">{new Date(detail.createdAt).toLocaleDateString()} · {detail.expectedDeliveryDate ? `Expected ${new Date(detail.expectedDeliveryDate).toLocaleDateString()}` : "No due date"}</p>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${BADGE[detail.status] ?? "bg-gray-100"}`}>{detail.status.replace("_", " ")}</span>
            </div>
            {detail.notes && <p className="text-gray-600">{detail.notes}</p>}
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-400 border-b">
                  <th className="py-1">Material</th>
                  <th className="py-1 text-right">Qty</th>
                  <th className="py-1 text-right">Unit cost</th>
                  <th className="py-1 text-right">Received</th>
                  <th className="py-1 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {(detail.items ?? []).map((it: any) => (
                  <tr key={it.id} className="border-b">
                    <td className="py-1">{productName(it.productId)}</td>
                    <td className="py-1 text-right">{it.quantity}</td>
                    <td className="py-1 text-right">{money(it.unitCost)}</td>
                    <td className="py-1 text-right text-green-700">{it.quantityReceived ?? 0}{it.quantityRejected ? ` (+${it.quantityRejected} rej)` : ""}</td>
                    <td className="py-1 text-right">{money(it.quantity * it.unitCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {detail.receipts?.length ? <p className="text-xs text-gray-500">Receipts: {(detail.receipts ?? []).map((r: any) => r.grnNumber).join(", ")}</p> : null}
          </div>
        )}
      </Modal>
        </div>
      )}
      {tab === "backorders" && <BackordersPanel materials={materials} />}
      {tab === "bills" && <BillsPanel canManage={canManage} />}
      {tab === "direct" && <DirectBuyPanel vendors={vendors} materials={materials} canManage={canManage} />}
      {tab === "vendors" && <VendorsPanel vendors={vendors} canManage={canManage} onSaved={() => load()} />}
      <VendorFormModal
        open={showVendorModal}
        onClose={() => setShowVendorModal(false)}
        onCreated={(v: any) => {
          setVendors((prev) => [...prev, v]);
          setForm((f: any) => ({ ...f, vendorId: String(v.id) }));
          setShowVendorModal(false);
          toast.success("Vendor added and selected");
        }}
      />
    </div>
  );
}