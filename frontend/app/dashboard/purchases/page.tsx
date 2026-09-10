"use client";
import { getDateRange } from "@/app/components/DateFilter";
import { useSingleLocationAutofill } from "@/lib/singleLocation";
import FilterPanel from "@/app/components/FilterPanel";
import Modal from "@/app/components/Modal";
import Loading from "@/app/components/Loading";
import RowActionsMenu from "@/app/components/RowActionsMenu";
import { useToast } from "@/app/components/ToastProvider";
import { useAuth } from "@/context/AuthContext";
import api, { markHandled } from "@/lib/api";
import { fmtCurrency } from "@/lib/currency";
import { statusLabel } from "@/lib/statusLabel";
import { newClientRef } from "@/lib/clientRef";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type DatePreset = "today" | "week" | "month" | "year";

export default function PurchasesPage() {
  const { t } = useTranslation();
  const { user, hasPermission } = useAuth();
  const toast = useToast();
  const isOwner = user?.isSuperuser === true;
  const canApprove = hasPermission("purchases.approve");
  const [purchases, setPurchases] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("month");
  const [startDate, setStartDate] = useState(() => getDateRange("month").start);
  const [endDate, setEndDate] = useState(() => getDateRange("month").end);
  const [shopFilter, setShopFilter] = useState("");
  const [shops, setShops] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  // Autofill the sole shop when the business has only one.
  useSingleLocationAutofill(locations, shopFilter, setShopFilter);
  const [form, setForm] = useState({ productName: "", quantity: 1, unitPrice: 0, sellPrice: 0, notes: "", paymentMethodId: "" });
  const [clientRef, setClientRef] = useState(() => newClientRef());
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [daySheet, setDaySheet] = useState<any>(null);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  // The org's "Cash" method (case-insensitive) — the default payment method.
  const cashMethod = paymentMethods.find(
    (m: any) => m.name.toLowerCase() === "cash",
  );

  const fetchPurchases = async () => {
    setFetching(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (search) params.set("search", search);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (shopFilter) params.set("shopId", shopFilter);
      const query = params.toString();
      const [res, sres] = await Promise.all([
        api.get(`/purchases${query ? "?" + query : ""}`),
        api.get(`/purchases/stats?${query}`),
      ]);
      setPurchases(res.data);
      setStats(sres.data);
    } finally {
      setFetching(false);
    }
  };
  useEffect(() => { fetchPurchases(); }, [statusFilter, search, startDate, endDate, shopFilter]);

  useEffect(() => {
    api.get("/payment-methods").then(r => {
      setPaymentMethods(r.data);
      const cash = (r.data as any[]).find(
        (m: any) => m.name.toLowerCase() === "cash",
      );
      // Cash is the default + initially selected payment method.
      setForm((f) =>
        f.paymentMethodId
          ? f
          : { ...f, paymentMethodId: cash ? String(cash.id) : "" },
      );
    }).catch(() => {});
    api.get(`/reports/day-sheet?locationId=${shopFilter || ""}&startDate=${startDate}&endDate=${endDate}`)
      .then(r => setDaySheet(r.data)).catch(() => {});
  }, [shopFilter, startDate, endDate]);

  useEffect(() => {
    if (isOwner) api.get("/locations").then(r => {
      setLocations(r.data);
      setShops(r.data.filter((l: any) => l.type === "SHOP"));
    });
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true);
    try {
      await api.post("/purchases", { productName: form.productName, quantity: Number(form.quantity), unitPrice: Number(form.unitPrice), sellPrice: Number(form.sellPrice), notes: form.notes || undefined, paymentMethodId: form.paymentMethodId ? Number(form.paymentMethodId) : undefined, clientRef });
      setShowForm(false); setForm({ productName: "", quantity: 1, unitPrice: 0, sellPrice: 0, notes: "", paymentMethodId: cashMethod ? String(cashMethod.id) : "" }); setClientRef(newClientRef()); fetchPurchases();
    } catch (err: any) { markHandled(err); toast.error(err?.response?.data?.message ?? t("purchases.failed")); } finally { setLoading(false); }
  };
  const handleApprove = async (id: number) => { try { await api.patch(`/purchases/${id}/approve`); fetchPurchases(); } catch (err: any) { markHandled(err); toast.error(t("purchases.failed")); } };
  const handleReject = async (id: number) => { try { await api.patch(`/purchases/${id}/reject`); fetchPurchases(); } catch (err: any) { markHandled(err); toast.error(t("purchases.failed")); } };

  const badge = (s: string) => (<span className={"px-2 py-0.5 text-xs rounded-full font-semibold " + (s==="PENDING"?"bg-yellow-100 text-yellow-800":s==="APPROVED"?"bg-green-100 text-green-800":"bg-red-100 text-red-800")}>{statusLabel(s)}</span>);

  if (fetching) return <Loading className="py-24" />;

  return (
    <div>
      <div className="flex justify-between items-start md:items-center mb-6 gap-3">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">{t("purchases.title")}</h1>
        {hasPermission("purchases.create") && <button onClick={()=>setShowForm(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 whitespace-nowrap">+ {t("purchases.newPurchase")}</button>}
      </div>

      <FilterPanel
        showDateFilter
        datePreset={datePreset}
        onDatePresetChange={(p) => {
          setDatePreset(p);
          const range = getDateRange(p);
          setStartDate(range.start);
          setEndDate(range.end);
        }}
        startDate={startDate}
        onStartDateChange={setStartDate}
        endDate={endDate}
        onEndDateChange={setEndDate}
        search={search}
        onSearchChange={setSearch}
        category=""
        onCategoryChange={() => {}}
        categories={[]}
        location={shopFilter}
        onLocationChange={setShopFilter}
        locations={locations}
        showLocation={isOwner}
      />

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            ...(isOwner
              ? [{ label: t("purchases.cost"), value: fmtCurrency(stats.totalCost), color: "text-gray-800" }]
              : []),
            { label: t("purchases.revenue"), value: fmtCurrency(stats.totalRevenue), color: "text-blue-700" },
            ...(isOwner
              ? [{ label: t("purchases.profit"), value: fmtCurrency(stats.totalProfit), color: stats.totalProfit >= 0 ? "text-green-700" : "text-red-700" }]
              : []),
            { label: t("status.pending"), value: stats.pendingCount, color: "text-yellow-700" },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl shadow-sm border p-3 sm:p-4">
              <div className="text-xs text-gray-500">{s.label}</div>
              <div className={"text-lg font-bold " + s.color}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {daySheet && (
        <div className="bg-white rounded-xl shadow-sm border p-3 sm:p-4 mb-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div><span className="text-xs uppercase text-gray-400 font-semibold mr-2">{t("purchases.openingCash")}</span><strong>{fmtCurrency(daySheet.opening)}</strong></div>
          <div><span className="text-xs uppercase text-gray-400 font-semibold mr-2">{t("purchases.inflow")}</span><strong className="text-green-600">+{fmtCurrency(daySheet.totalInflow)}</strong></div>
          <div><span className="text-xs uppercase text-gray-400 font-semibold mr-2">{t("purchases.outflow")}</span><strong className="text-red-600">-{fmtCurrency(daySheet.totalOutflow)}</strong></div>
          <div><span className="text-xs uppercase text-gray-400 font-semibold mr-2">{t("purchases.closingCash")}</span><strong className="text-blue-700">{fmtCurrency(daySheet.closing)}</strong></div>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} className="border p-2 rounded-lg bg-white text-sm">
          <option value="">{t("purchases.allStatus")}</option><option value="PENDING">{t("status.pending")}</option><option value="APPROVED">{t("status.approved")}</option><option value="REJECTED">{t("status.rejected")}</option>
        </select>
      </div>
      <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
        <table className="w-full text-left min-w-[500px] text-xs sm:text-sm"><thead className="bg-gray-50 border-b"><tr>
          <th className="p-2 sm:p-3 md:p-4">{t("common.product")}</th><th className="p-2 sm:p-3 md:p-4">{t("status.shop")}</th><th className="p-2 sm:p-3 md:p-4">{t("common.qty")}</th>
          <th className="p-2 sm:p-3 md:p-4 text-right">{t("purchases.unitPrice")}</th><th className="p-2 sm:p-3 md:p-4 text-right">{t("purchases.sellPrice")}</th>
          {isOwner && <th className="p-2 sm:p-3 md:p-4 text-right">{t("purchases.profit")}</th>}
          <th className="p-2 sm:p-3 md:p-4">{t("purchases.invoice")}</th>
          <th className="p-2 sm:p-3 md:p-4">{t("common.status")}</th>
          {(isOwner || canApprove) && <th className="p-2 sm:p-3 md:p-4">{t("common.actions")}</th>}
        </tr></thead><tbody>
          {purchases.map((p:any) => (<tr key={p.id} className="border-b hover:bg-gray-50">
            <td className="p-2 sm:p-3 md:p-4 font-medium whitespace-nowrap">{p.productName}</td>
            <td className="p-2 sm:p-3 md:p-4 text-gray-500 whitespace-nowrap">{p.shop?.name}</td>
            <td className="p-2 sm:p-3 md:p-4">{p.quantity}</td>
            <td className="p-2 sm:p-3 md:p-4 text-right">{fmtCurrency(p.unitPrice)}</td>
            <td className="p-2 sm:p-3 md:p-4 text-right">{fmtCurrency(p.sellPrice)}</td>
            {isOwner && <td className={"p-2 sm:p-3 md:p-4 text-right font-semibold " + (p.profit >= 0 ? "text-green-600" : "text-red-500")}>{fmtCurrency(p.profit)}</td>}
            <td className="p-2 sm:p-3 md:p-4 font-mono text-xs">{p.sale?.invoiceNumber || "—"}</td>
            <td className="p-2 sm:p-3 md:p-4">{badge(p.status)}</td>
            {(isOwner || canApprove) && <td className="p-2 sm:p-3 md:p-4">{p.status==="PENDING" && <RowActionsMenu items={[{label:t("purchases.approve"), color:"text-green-600", onClick:()=>handleApprove(p.id)},{label:t("purchases.reject"), color:"text-red-500", onClick:()=>handleReject(p.id)}]} />}</td>}
          </tr>))}
          {purchases.length===0 && <tr><td colSpan={isOwner?9:canApprove?8:7} className="p-6 text-center text-gray-400 text-sm">{t("purchases.noPurchases")}</td></tr>}
        </tbody></table>
      </div>
      <Modal isOpen={showForm} onClose={()=>setShowForm(false)} title={t("purchases.newPurchase")}>
        <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4">
          <div><label className="block text-sm font-medium text-gray-500 mb-1">{t("purchases.productName")}</label>
            <input value={form.productName} onChange={e=>setForm({...form,productName:e.target.value})} placeholder={t("purchases.productNamePlaceholder")} className="border p-2 rounded-lg w-full text-sm" required/>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium text-gray-500 mb-1">{t("purchases.quantity")}</label>
              <input type="number" min="1" value={form.quantity} onChange={e=>setForm({...form,quantity:Number(e.target.value)})} className="border p-2 rounded-lg w-full text-sm" required/>
            </div>
            <div><label className="block text-sm font-medium text-gray-500 mb-1">{t("purchases.buyPriceBirr")}</label>
              <input type="number" step="0.01" min="0" value={form.unitPrice} onChange={e=>setForm({...form,unitPrice:Number(e.target.value)})} className="border p-2 rounded-lg w-full text-sm" required/>
            </div>
            <div><label className="block text-sm font-medium text-gray-500 mb-1">{t("purchases.sellPriceBirr")}</label>
              <input type="number" step="0.01" min="0" value={form.sellPrice} onChange={e=>setForm({...form,sellPrice:Number(e.target.value)})} className="border p-2 rounded-lg w-full text-sm" required/>
            </div>
          </div>
          <div><label className="block text-sm font-medium text-gray-500 mb-1">{t("purchases.paymentMethod")}</label>
            <select value={form.paymentMethodId} onChange={e=>setForm({...form,paymentMethodId:e.target.value})} className="border p-2 rounded-lg w-full text-sm">
              {!cashMethod && <option value="">{t("purchases.selectPaymentMethod")}</option>}
              {paymentMethods.map((m:any)=>(<option key={m.id} value={m.id}>{m.name}</option>))}
            </select>
          </div>
          <div><label className="block text-sm font-medium text-gray-500 mb-1">{t("purchases.notesOptional")}</label>
            <input value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} className="border p-2 rounded-lg w-full text-sm"/>
          </div>
          <div className="flex gap-2 mt-2">
            <button type="submit" disabled={loading} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <Loading size="sm" />
                  {t("purchases.saving")}
                </span>
              ) : (
                t("common.submit")
              )}
            </button>
            <button type="button" onClick={()=>setShowForm(false)} className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-300">{t("common.cancel")}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

