"use client";

import Loading from "@/app/components/Loading";
import Modal from "@/app/components/Modal";
import RowActionsMenu from "@/app/components/RowActionsMenu";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useToast } from "@/app/components/ToastProvider";
import { fmtCurrency } from "@/lib/currency";
import { statusLabel } from "@/lib/statusLabel";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const STATUSES = ["DRAFT", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

const emptyForm = () => ({
  bomId: "",
  locationId: "",
  targetQuantity: "1",
  batchNumber: "",
  expiryDate: "",
  notes: "",
});

const productName = (p: any) =>
  p ? `${p.brand ?? ""} ${p.baseName ?? ""}`.trim() : "";

export default function ManufacturingProductionPage() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [orders, setOrders] = useState<any[]>([]);
  const [boms, setBoms] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [showScrap, setShowScrap] = useState<any | null>(null);
  const [scrapForm, setScrapForm] = useState({ productId: "", quantity: "1", reason: "" });
  const [detail, setDetail] = useState<any | null>(null);
  const [showComplete, setShowComplete] = useState<any | null>(null);
  const [compForm, setCompForm] = useState({ goodUnits: "", scrapUnits: "0", locationId: "" });
  const [compEst, setCompEst] = useState<number | null>(null);
  const [compBusy, setCompBusy] = useState(false);

  const canManage = hasPermission("manufacturing.manage");

  const load = useCallback(async () => {
    try {
      const [o, b, l] = await Promise.all([
        api.get("/manufacturing/work-orders"),
        api.get("/manufacturing/boms"),
        api.get("/locations").catch(() => ({ data: [] })),
      ]);
      setOrders(o.data ?? []);
      setBoms(b.data ?? []);
      setLocations(l.data ?? []);
    } catch {
      toast.error(t("mfg.workOrders.failedLoad"));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusFilter && o.status !== statusFilter) return false;
      if (!q) return true;
      const bom = boms.find((b) => b.id === o.bomId);
      const hay = [productName(bom?.finishedProduct), o.batchNumber].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [orders, boms, search, statusFilter]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/manufacturing/work-orders", {
        bomId: Number(form.bomId),
        targetQuantity: Number(form.targetQuantity) || 1,
        locationId: Number(form.locationId),
        batchNumber: form.batchNumber.trim() || undefined,
        expiryDate: form.expiryDate || undefined,
        notes: form.notes || undefined,
      });
      toast.success(t("mfg.workOrders.created"));
      setShowCreate(false);
      setForm(emptyForm());
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.workOrders.failedCreate"));
    }
  };

  const setStatus = async (o: any, status: string) => {
    try {
      await api.patch(`/manufacturing/work-orders/${o.id}/status`, { status });
      toast.success(t("mfg.workOrders.statusUpdated"));
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.workOrders.failedStatus"));
    }
  };

  const cancelOrder = async (o: any) => {
    const ok = await confirm(t("mfg.workOrders.cancelConfirm", { id: o.id }));
    if (!ok) return;
    await setStatus(o, "CANCELLED");
  };

  // Completion: good units + scrap + target inventory store (finished goods).
  const openComplete = async (o: any) => {
    setShowComplete(o);
    const stores = locations.filter((l) => l.type === "STORE");
    const defLoc = stores.find((l) => l.id === o.locationId) ? o.locationId : stores[0]?.id ?? o.locationId;
    setCompForm({
      goodUnits: String(o.targetQuantity ?? 1),
      scrapUnits: "0",
      locationId: defLoc ? String(defLoc) : "",
    });
    setCompEst(null);
    try {
      const r = await api.get(`/manufacturing/work-orders/${o.id}`);
      const d = r.data;
      const bom = d?.bom;
      let est = 0;
      for (const it of bom?.items ?? []) {
        const req = it.quantityRequired * (d.targetQuantity ?? 1) * (1 + (bom.scrapPercentage ?? 0) / 100);
        est += req * (it.rawMaterial?.currentBuyPrice ?? 0);
      }
      setCompEst(est);
    } catch {
      setCompEst(null);
    }
  };

  const submitComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showComplete) return;
    setCompBusy(true);
    try {
      await api.patch(`/manufacturing/work-orders/${showComplete.id}/status`, {
        status: "COMPLETED",
        completedQuantity: compForm.goodUnits ? Number(compForm.goodUnits) : undefined,
        scrappedQuantity: compForm.scrapUnits ? Number(compForm.scrapUnits) : undefined,
        finishedLocationId: compForm.locationId ? Number(compForm.locationId) : undefined,
      });
      toast.success(t("mfg.workOrders.statusUpdated"));
      setShowComplete(null);
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.workOrders.failedStatus"));
    } finally {
      setCompBusy(false);
    }
  };

  const logScrap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showScrap || !scrapForm.productId) return;
    try {
      await api.post(`/manufacturing/work-orders/${showScrap.id}/scrap`, {
        productId: Number(scrapForm.productId),
        quantity: Number(scrapForm.quantity) || 1,
        reason: scrapForm.reason || undefined,
      });
      toast.success(t("mfg.workOrders.scrapLogged"));
      setShowScrap(null);
      setScrapForm({ productId: "", quantity: "1", reason: "" });
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("mfg.workOrders.failedScrap"));
    }
  };

  const label = (text: string, required?: boolean) => (
    <label className="block text-sm font-medium text-gray-500 mb-1">
      {text}
      {required && <span className="text-red-500"> *</span>}
    </label>
  );

  if (loading) return <Loading className="py-24" />;


  const bomName = (bomId: number) => {
    const b = boms.find((x) => x.id === bomId);
    return productName(b?.finishedProduct) || `BOM #${bomId}`;
  };
  const locName = (locId: number) => {
    const l = locations.find((x) => x.id === locId);
    return l?.name || `#${locId}`;
  };

  return (
    <div>
      <div className="flex justify-between items-start md:items-center mb-6 gap-3">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">
          {t("mfg.workOrders.title")}
        </h1>
        {canManage && (
          <button
            onClick={() => setShowCreate(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg whitespace-nowrap text-sm"
          >
            {t("mfg.workOrders.newOrder")}
          </button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-6">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("mfg.workOrders.searchPlaceholder")}
          aria-label={t("mfg.workOrders.searchPlaceholder")}
          className="border p-2 rounded-lg flex-1 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border p-2 rounded-lg bg-white text-sm"
        >
          <option value="">{t("mfg.workOrders.allStatuses")}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{{ [s]: null }[s]}{statusLabel(s)}</option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[820px] text-xs sm:text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="p-2 sm:p-3 md:p-4">{t("mfg.workOrders.colId")}</th>
                <th className="p-2 sm:p-3 md:p-4">{t("mfg.workOrders.colProduct")}</th>
                <th className="p-2 sm:p-3 md:p-4">{t("mfg.workOrders.colDesign")}</th>
                <th className="p-2 sm:p-3 md:p-4">{t("mfg.workOrders.colLocation")}</th>
                <th className="p-2 sm:p-3 md:p-4">{t("mfg.workOrders.colQuantity")}</th>
                <th className="p-2 sm:p-3 md:p-4">{t("mfg.workOrders.colBatch")}</th>
                <th className="p-2 sm:p-3 md:p-4">{t("mfg.workOrders.colStatus")}</th>
                <th className="p-2 sm:p-3 md:p-4">{t("mfg.workOrders.colCogm")}</th>
                <th className="p-2 sm:p-3 md:p-4">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const actions: any[] = [];
                if (o.status === "DRAFT") actions.push({ label: t("mfg.workOrders.schedule"), onClick: () => setStatus(o, "SCHEDULED") });
                if (o.status === "SCHEDULED") actions.push({ label: t("mfg.workOrders.start"), onClick: () => setStatus(o, "IN_PROGRESS") });
                if (o.status === "IN_PROGRESS") {
                  actions.push({ label: t("mfg.workOrders.complete"), onClick: () => openComplete(o) });
                  actions.push({ label: t("mfg.workOrders.logScrap"), onClick: () => { setScrapForm({ productId: String(o.finishedProductId), quantity: "1", reason: "" }); setShowScrap(o); } });
                }
                if (!["COMPLETED", "CANCELLED"].includes(o.status)) actions.push({ label: t("mfg.workOrders.cancel"), color: "text-red-600", onClick: () => cancelOrder(o) });
                return (
                  <tr key={o.id} onClick={() => setDetail(o)} className="border-b hover:bg-gray-50 cursor-pointer">
                    <td className="p-2 sm:p-3 md:p-4 text-gray-400">#{o.id}</td>
                    <td className="p-2 sm:p-3 md:p-4 font-medium">{bomName(o.bomId)}</td>
                    <td className="p-2 sm:p-3 md:p-4">
                      {o.designCatalog ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-blue-700 max-w-[150px]">
                          {o.designCatalog.mediaUrls?.[0] ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={o.designCatalog.mediaUrls[0]}
                              alt=""
                              className="h-5 w-5 rounded object-cover shrink-0"
                            />
                          ) : null}
                          <a
                            href="/dashboard/manufacturing/catalog"
                            onClick={(e) => e.stopPropagation()}
                            className="hover:underline truncate"
                          >
                            {o.designCatalog.name}
                          </a>
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="p-2 sm:p-3 md:p-4 text-gray-500">{locName(o.locationId)}</td>
                    <td className="p-2 sm:p-3 md:p-4">
                      {o.targetQuantity} / {o.producedQuantity || 0}
                    </td>
                    <td className="p-2 sm:p-3 md:p-4 text-gray-500">{o.batchNumber ?? "—"}</td>
                    <td className="p-2 sm:p-3 md:p-4">
                      <span className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded text-[10px] sm:text-xs font-semibold">
                        {statusLabel(o.status)}
                      </span>
                    </td>
                    <td className="p-2 sm:p-3 md:p-4 text-gray-600">
                      {o.cogmUnitCost > 0 ? fmtCurrency(o.cogmUnitCost) : "—"}
                    </td>
                    <td className="p-2 sm:p-3 md:p-4" onClick={(e) => e.stopPropagation()}>
                      <RowActionsMenu items={actions} />
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-gray-400">
                    {t("mfg.workOrders.noOrders")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>



      {/* New work order modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title={t("mfg.workOrders.createTitle")}>
        <form onSubmit={create} className="grid grid-cols-1 gap-4">
          <div>
            {label(t("mfg.workOrders.bomLabel"), true)}
            <select id="wo-bom" value={form.bomId} onChange={(e) => setForm({ ...form, bomId: e.target.value })} className="border p-2 rounded-lg w-full bg-white" required>
              <option value="">{t("mfg.common.required")}</option>
              {boms.map((b) => (
                <option key={b.id} value={b.id}>{bomName(b.id)}</option>
              ))}
            </select>
          </div>
          <div>
            {label(t("mfg.workOrders.locationLabel"), true)}
            <select id="wo-loc" value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })} className="border p-2 rounded-lg w-full bg-white" required>
              <option value="">{t("mfg.common.required")}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              {label(t("mfg.workOrders.targetQuantityLabel"), true)}
              <input id="wo-qty" type="number" min="1" step="any" value={form.targetQuantity} onChange={(e) => setForm({ ...form, targetQuantity: e.target.value })} className="border p-2 rounded-lg w-full" required />
            </div>
            <div>
              {label(t("mfg.workOrders.batchNumberLabel"))}
              <input id="wo-batch" value={form.batchNumber} onChange={(e) => setForm({ ...form, batchNumber: e.target.value })} placeholder={t("mfg.common.optional")} className="border p-2 rounded-lg w-full" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              {label(t("mfg.workOrders.expiryDateLabel"))}
              <input id="wo-expiry" type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} className="border p-2 rounded-lg w-full" />
            </div>
            <div>
              {label(t("mfg.workOrders.notesLabel"))}
              <input id="wo-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t("mfg.common.optional")} className="border p-2 rounded-lg w-full" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowCreate(false)} className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm">{t("mfg.common.cancel")}</button>
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">{t("mfg.common.save")}</button>
          </div>
        </form>
      </Modal>

      {/* Completion modal */}
      <Modal
        isOpen={!!showComplete}
        onClose={() => setShowComplete(null)}
        title={`${t("mfg.workOrders.complete")} — ${bomName(showComplete?.bomId)}`}
      >
        {showComplete && (
          <form onSubmit={submitComplete} className="grid grid-cols-1 gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                {label(t("mfg.workOrders.produced"), true)}
                <input type="number" min="0.0001" step="any" required value={compForm.goodUnits} onChange={(e) => setCompForm({ ...compForm, goodUnits: e.target.value })} className="border p-2 rounded-lg w-full" />
                <p className="text-[11px] text-gray-400 mt-1">Good units deposited into the store</p>
              </div>
              <div>
                {label(t("mfg.workOrders.scrapQuantityLabel"))}
                <input type="number" min="0" step="any" value={compForm.scrapUnits} onChange={(e) => setCompForm({ ...compForm, scrapUnits: e.target.value })} className="border p-2 rounded-lg w-full" />
                <p className="text-[11px] text-gray-400 mt-1">Finished units scrapped (not stocked)</p>
              </div>
            </div>
            <div>
              {label("Target inventory store")}
              <select className="border p-2 rounded-lg w-full bg-white" value={compForm.locationId} onChange={(e) => setCompForm({ ...compForm, locationId: e.target.value })}>
                <option value="">—</option>
                {locations.filter((l) => l.type === "STORE").map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 text-sm">
              <div>
                <span className="block text-xs text-gray-400">Total COGM (est.)</span>
                <span className="font-semibold text-gray-800">{compEst != null ? fmtCurrency(compEst) : "—"}</span>
              </div>
              <div>
                <span className="block text-xs text-gray-400">Unit COGM = COGM ÷ good units</span>
                <span className="font-semibold text-gray-800">
                  {compEst != null && Number(compForm.goodUnits) > 0
                    ? fmtCurrency(compEst / Number(compForm.goodUnits))
                    : "—"}
                </span>
              </div>
            </div>
            <p className="text-[11px] text-gray-400">
              Estimates use current raw-material prices; the exact COGM is computed at completion from store average costs.
            </p>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowComplete(null)} className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm">{t("mfg.common.cancel")}</button>
              <button type="submit" disabled={compBusy} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm">{compBusy ? "Working…" : t("mfg.workOrders.complete")}</button>
            </div>
          </form>
        )}
      </Modal>

      {/* Scrap modal */}
      <Modal isOpen={!!showScrap} onClose={() => setShowScrap(null)} title={t("mfg.workOrders.scrapTitle")}>
        {showScrap && (
          <form onSubmit={logScrap} className="grid grid-cols-1 gap-4">
            <div>
              {label(t("mfg.workOrders.scrapProductLabel"), true)}
              <select id="scrap-product" value={scrapForm.productId} onChange={(e) => setScrapForm({ ...scrapForm, productId: e.target.value })} className="border p-2 rounded-lg w-full bg-white" required>
                <option value={showScrap.finishedProductId}>{bomName(showScrap.bomId)}</option>
                {(showScrap.bom?.items ?? []).map((it: any) => (
                  <option key={it.rawMaterialProductId} value={it.rawMaterialProductId}>
                    {it.rawMaterial?.baseName ?? `#${it.rawMaterialProductId}`}
                  </option>
                ))}
              </select>
            </div>
            <div>
              {label(t("mfg.workOrders.scrapQuantityLabel"), true)}
              <input id="scrap-qty" type="number" min="0.0001" step="any" value={scrapForm.quantity} onChange={(e) => setScrapForm({ ...scrapForm, quantity: e.target.value })} className="border p-2 rounded-lg w-full" required />
            </div>
            <div>
              {label(t("mfg.workOrders.scrapReasonLabel"))}
              <input id="scrap-reason" value={scrapForm.reason} onChange={(e) => setScrapForm({ ...scrapForm, reason: e.target.value })} placeholder={t("mfg.common.optional")} className="border p-2 rounded-lg w-full" />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowScrap(null)} className="border border-gray-300 text-gray-600 px-4 py-2 rounded-lg text-sm">{t("mfg.common.cancel")}</button>
              <button type="submit" className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm">{t("mfg.workOrders.logScrap")}</button>
            </div>
          </form>
        )}
      </Modal>

      {/* Detail modal */}
      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title={t("mfg.workOrders.detailTitle", { id: detail?.id ?? "" })}>
        {detail && (
          <div className="space-y-2 text-sm">
            <p className="text-gray-700"><b>{bomName(detail.bomId)}</b> · {locName(detail.locationId)}</p>
            <p className="text-gray-500">
              {t("mfg.workOrders.target")}: {detail.targetQuantity} · {t("mfg.workOrders.produced")}: {detail.producedQuantity || 0}
            </p>
            {detail.batchNumber && <p className="text-gray-500">{t("mfg.workOrders.colBatch")}: {detail.batchNumber}</p>}
            {detail.expiryDate && <p className="text-gray-500">{t("mfg.workOrders.expiryDateLabel")}: {new Date(detail.expiryDate).toLocaleDateString()}</p>}
            {detail.notes && <p className="text-gray-600">{detail.notes}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}

