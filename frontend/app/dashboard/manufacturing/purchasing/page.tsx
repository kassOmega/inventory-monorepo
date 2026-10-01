"use client";

import Loading from "@/app/components/Loading";
import Modal from "@/app/components/Modal";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useToast } from "@/app/components/ToastProvider";
import { fmtCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/datetime";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
// PO status → `mfg.purchasing.st*` label key (resolved with t() at render).
const STATUS_KEY: Record<string, string> = {
  DRAFT: "mfg.purchasing.stDraft",
  SENT: "mfg.purchasing.stSent",
  PARTIALLY_RECEIVED: "mfg.purchasing.stPartiallyReceived",
  RECEIVED: "mfg.purchasing.stReceived",
  CANCELLED: "mfg.purchasing.stCancelled",
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
  const { t } = useTranslation();
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
    pos: t("mfg.purchasing.tabPos"),
    backorders: t("mfg.purchasing.tabBackorders"),
    bills: t("mfg.purchasing.tabBills"),
    direct: t("mfg.purchasing.tabDirect"),
    vendors: t("mfg.purchasing.tabVendors"),
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
      toast.error(t("mfg.purchasing.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [toast, t]);
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
        toast.error(t("mfg.purchasing.noShortages"));
        return;
      }
      setForm({
        vendorId: "",
        newVendorName: "",
        expectedDeliveryDate: "",
        notes: t("mfg.purchasing.nettingNote", { count: r.data?.orderCount ?? 0 }),
        lines,
      });
      setShowForm(true);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.purchasing.nettingFailed"));
    }
  };

  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }));
  const setLine = (i: number, patch: Partial<Line>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l, x) => (x === i ? { ...l, ...patch } : l)) }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const vendorId = form.vendorId ? Number(form.vendorId) : 0;
    if (!vendorId) {
      toast.error(t("mfg.purchasing.chooseVendor"));
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
      toast.error(t("mfg.purchasing.lineRequired"));
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
      toast.success(t("mfg.purchasing.savedDraft"));
      setShowForm(false);
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.purchasing.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const send = async (po: any) => {
    try {
      await api.post(`/manufacturing/purchase-orders/${po.id}/send`);
      toast.success(t("mfg.purchasing.sent"));
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.purchasing.sendFailed"));
    }
  };
  const cancel = async (po: any) => {
    if (!(await confirm(t("mfg.purchasing.cancelConfirm", { number: po.poNumber })))) return;
    try {
      await api.post(`/manufacturing/purchase-orders/${po.id}/cancel`);
      toast.success(t("mfg.purchasing.cancelled"));
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.purchasing.cancelFailed"));
    }
  };
  const remove = async (po: any) => {
    if (!(await confirm(t("mfg.purchasing.deleteConfirm", { number: po.poNumber })))) return;
    try {
      await api.delete(`/manufacturing/purchase-orders/${po.id}`);
      toast.success(t("mfg.purchasing.deleted"));
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.purchasing.deleteFailed"));
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
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800">{t("mfg.purchasing.title")}</h1>
          <p className="text-sm text-gray-500 mt-1">{t("mfg.purchasing.subtitle")}</p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <button onClick={openNetting} className="border border-blue-300 text-blue-700 px-3 py-2 rounded-lg text-sm whitespace-nowrap">
              {t("mfg.purchasing.draftFromNetting")}
            </button>
            <button onClick={openCreate} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm whitespace-nowrap">{t("mfg.purchasing.newPo")}</button>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 mb-3">
        {["", ...STATUSES].map((s) => (
          <button key={s || "all"} onClick={() => setStatus(s)} className={`px-3 py-1 rounded-full text-xs border ${status === s ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200"}`}>
            {s ? t(STATUS_KEY[s] ?? "") || s : t("mfg.purchasing.stAll")}
          </button>
        ))}
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("mfg.purchasing.searchPlaceholder")} className="ml-auto border p-2 rounded-lg text-sm w-56" />
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
        <table className="w-full text-left min-w-[860px] text-xs sm:text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="p-3">{t("mfg.purchasing.colPoNumber")}</th>
              <th className="p-3">{t("mfg.purchasing.colVendor")}</th>
              <th className="p-3">{t("mfg.purchasing.colCreated")}</th>
              <th className="p-3">{t("mfg.purchasing.colExpected")}</th>
              <th className="p-3 text-right">{t("mfg.purchasing.colTotal")}</th>
              <th className="p-3">{t("mfg.purchasing.colStatus")}</th>
              <th className="p-3 text-right">{t("mfg.purchasing.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((po) => (
              <tr key={po.id} className="border-b hover:bg-gray-50">
                <td className="p-3 font-medium">{po.poNumber}</td>
                <td className="p-3">{vendorName(po.vendorId)}</td>
                <td className="p-3 text-gray-500">{formatDate(po.createdAt)}</td>
                <td className="p-3 text-gray-500">{po.expectedDeliveryDate ? formatDate(po.expectedDeliveryDate) : "—"}</td>
                <td className="p-3 text-right font-medium">{money(po.totalAmount)}</td>
                <td className="p-3">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${BADGE[po.status] ?? "bg-gray-100 text-gray-700"}`}>{t(STATUS_KEY[po.status] ?? "") || po.status}</span>
                </td>
                <td className="p-3">
                  <div className="flex justify-end gap-2 text-xs">
                    <button onClick={() => setDetail(po)} className="text-gray-600 hover:underline">{t("mfg.purchasing.view")}</button>
                    {canManage && po.status === "DRAFT" && <button onClick={() => send(po)} className="text-blue-600 hover:underline">{t("mfg.purchasing.send")}</button>}
                    {canManage && ["DRAFT", "SENT"].includes(po.status) && <button onClick={() => cancel(po)} className="text-orange-600 hover:underline">{t("mfg.common.cancel")}</button>}
                    {canManage && ["DRAFT", "CANCELLED"].includes(po.status) && <button onClick={() => remove(po)} className="text-red-600 hover:underline">{t("mfg.common.delete")}</button>}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-gray-400">{t("mfg.purchasing.none")}</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title={t("mfg.purchasing.newPoTitle")}>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>{t("mfg.purchasing.vendorLabel")}</label>
              <select className={inputCls} value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })}>
                <option value="">—</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              <button type="button" onClick={() => setShowVendorModal(true)} className="text-blue-600 hover:underline text-xs mt-1">{t("mfg.purchasing.addVendor")}</button>
            </div>
            <div>
              <label className={labelCls}>{t("mfg.purchasing.expectedLabel")}</label>
              <input type="date" className={inputCls} value={form.expectedDeliveryDate} onChange={(e) => setForm({ ...form, expectedDeliveryDate: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>{t("mfg.purchasing.notesLabel")}</label>
              <input className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t("mfg.purchasing.optionalPlaceholder")} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium text-gray-500">{t("mfg.purchasing.lineItems")}</p>
              <button type="button" onClick={addLine} className="text-xs text-blue-600 hover:underline">{t("mfg.purchasing.addLine")}</button>
            </div>
            {form.lines.length === 0 && <p className="text-xs text-gray-400 border border-dashed rounded-lg p-3 text-center">{t("mfg.purchasing.noLines")}</p>}
            <div className="space-y-2">
              {form.lines.map((line, i) => {
                const qty = Number(line.quantity) || 0;
                const cost = Number(line.unitCost) || 0;
                return (
                  <div key={i} className="grid grid-cols-[1fr_110px_110px_70px_24px] gap-2 items-center bg-gray-50 rounded-lg p-2">
                    <select className={inputCls} value={line.productId} onChange={(e) => setLine(i, { productId: e.target.value })}>
                      <option value="">{t("mfg.purchasing.materialOption")}</option>
                      {materials.map((m) => <option key={m.id} value={m.id}>{m.brand ? `${m.brand} ` : ""}{m.baseName}</option>)}
                    </select>
                    <input type="number" min="0" step="any" className={inputCls} placeholder={t("mfg.purchasing.qtyPlaceholder")} value={line.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                    <input type="number" min="0" step="any" className={inputCls} placeholder={t("mfg.purchasing.unitCostPlaceholder")} value={line.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value })} />
                    <span className="text-xs text-gray-500 text-right">{money(qty * cost)}</span>
                    <button type="button" onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((_, x) => x !== i) }))} className="text-red-500 text-xs">✕</button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between border-t pt-3">
            <span className="text-sm text-gray-500">{t("mfg.purchasing.total")}</span>
            <span className="font-semibold">{money(form.lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0))}</span>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm">{t("mfg.common.cancel")}</button>
            <button type="submit" disabled={saving} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">{saving ? t("mfg.purchasing.saving") : t("mfg.purchasing.saveDraft")}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title={detail ? t("mfg.purchasing.detailTitle", { number: detail.poNumber }) : ""}>
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="flex justify-between items-center">
              <div>
                <p className="font-medium">{vendorName(detail.vendorId)}</p>
                <p className="text-xs text-gray-400">{formatDate(detail.createdAt)} · {detail.expectedDeliveryDate ? t("mfg.purchasing.expectedOn", { date: formatDate(detail.expectedDeliveryDate) }) : t("mfg.purchasing.noDueDate")}</p>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${BADGE[detail.status] ?? "bg-gray-100"}`}>{t(STATUS_KEY[detail.status] ?? "") || detail.status}</span>
            </div>
            {detail.notes && <p className="text-gray-600">{detail.notes}</p>}
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-400 border-b">
                  <th className="py-1">{t("mfg.purchasing.colMaterial")}</th>
                  <th className="py-1 text-right">{t("mfg.purchasing.colQty")}</th>
                  <th className="py-1 text-right">{t("mfg.purchasing.colUnitCost")}</th>
                  <th className="py-1 text-right">{t("mfg.purchasing.colReceived")}</th>
                  <th className="py-1 text-right">{t("mfg.purchasing.colSubtotal")}</th>
                </tr>
              </thead>
              <tbody>
                {(detail.items ?? []).map((it: any) => (
                  <tr key={it.id} className="border-b">
                    <td className="py-1">{productName(it.productId)}</td>
                    <td className="py-1 text-right">{it.quantity}</td>
                    <td className="py-1 text-right">{money(it.unitCost)}</td>
                    <td className="py-1 text-right text-green-700">{it.quantityReceived ?? 0}{it.quantityRejected ? ` ${t("mfg.purchasing.rejectedSuffix", { count: it.quantityRejected })}` : ""}</td>
                    <td className="py-1 text-right">{money(it.quantity * it.unitCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {detail.receipts?.length ? <p className="text-xs text-gray-500">{t("mfg.purchasing.receipts", { list: (detail.receipts ?? []).map((r: any) => r.grnNumber).join(", ") })}</p> : null}
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
          toast.success(t("mfg.purchasing.vendorAdded"));
        }}
      />
    </div>
  );
}