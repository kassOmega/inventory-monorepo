"use client";
import { CURRENCY_SYMBOL, fmtCurrency } from "@/lib/currency";
import { getDateRange } from "@/app/components/DateFilter";
import FilterPanel from "@/app/components/FilterPanel";
import Modal from "@/app/components/Modal";
import Loading from "@/app/components/Loading";
import RowActionsMenu from "@/app/components/RowActionsMenu";
import FiscalPrintButton from "@/app/components/FiscalPrintButton";
import FiscalPrintPreviewModal from "@/app/components/FiscalPrintPreviewModal";
import {
  ackFiscalBatch,
  dispatchFiscalPrint,
  fetchFiscalBatchSummary,
  markBatchPrintFailed,
  markBatchPrintPending,
  prepareFiscalPrintPayload,
} from "@/lib/fiscal";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/app/components/ToastProvider";
import api, { markHandled } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { batchLabel, variantLabel } from "@/lib/variantLabel";
import SaleForm, { SaleType } from "@/app/components/SaleForm";
import { useRouter } from "next/navigation";
import useServerPaging from "@/lib/useServerPaging";
import useDebouncedValue from "@/lib/useDebouncedValue";
import Pagination from "@/app/components/Pagination";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

type DatePreset = "today" | "week" | "month" | "year";

export default function SalesPage() {
  const { t } = useTranslation();
  const { user, hasPermission } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [sales, setSales] = useState([]);
  const [summaryData, setSummaryData] = useState<any>({
    paymentBreakdown: [],
    saleGroups: [],
  });
  const salesPaged = useServerPaging({ pageSize: 20 });
  // Sale ids for the consolidated fiscal batch currently being printed.
  const [batchSaleIds, setBatchSaleIds] = useState<number[]>([]);
  const [batchPreview, setBatchPreview] = useState<any>(null);
  const [batchPrinting, setBatchPrinting] = useState(false);
  const [loading, setLoading] = useState(true);
  // True once the first page has loaded; later filter/search changes refetch in
  // place (silent) so the page never blanks out on a keystroke.
  const [hasLoaded, setHasLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  // Sale type the next *new* sale opens with — chosen by the entry button that
  // opens the form. An existing sale always re-opens with its own type.
  const [newSaleType, setNewSaleType] = useState<SaleType>("FULLY_PAID");
  // Catalogue categories and locations for the list filters (the shared form
  // loads its own copies for the cart).
  const [categories, setCategories] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);

  // List filters (what the sales table shows).
  const [search, setSearch] = useState("");
  // Debounce the term that drives the request (the input stays instant).
  const debouncedSearch = useDebouncedValue(search, 300);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("month");
  const [startDate, setStartDate] = useState(() => getDateRange("month").start);
  const [endDate, setEndDate] = useState(() => getDateRange("month").end);

  // Payment & credit
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  // The org's "Cash" method (case-insensitive) — the default payment method.
  const cashMethod = paymentMethods.find(
    (m: any) => m.name.toLowerCase() === "cash",
  );
  const [errorMsg, setErrorMsg] = useState("");
  const [purchaseStats, setPurchaseStats] = useState<any>(null);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returningSale, setReturningSale] = useState<any>(null);
  const [returnItems, setReturnItems] = useState<
    { productId: number; quantity: number }[]
  >([]);
  const [returnReason, setReturnReason] = useState("");
  const [returns, setReturns] = useState<any[]>([]);
  const [tab, setTab] = useState<"sales" | "payments">("sales");
  const [viewingSale, setViewingSale] = useState<any>(null);
  const [deletingReturn, setDeletingReturn] = useState<any>(null);

  // Filters (payment method + sale type)
  const [paymentFilter, setPaymentFilter] = useState("");
  const [saleTypeFilter, setSaleTypeFilter] = useState("");

  // Settle-payment modal (partial / credited sales)
  const [paySale, setPaySale] = useState<any>(null);
  const [settleAmount, setSettleAmount] = useState("");
  const [settleMethodId, setSettleMethodId] = useState("");
  const [settleNotes, setSettleNotes] = useState("");

  const isOwner = user?.isSuperuser === true;
  const canViewProfit = hasPermission("sales.view-profit");

  // Delete actions are available to the owner or the shop's own user.
  const canDeleteSale = (s: any) =>
    hasPermission("sales.delete") &&
    (isOwner || (user?.locationType === "SHOP" && user?.locationId === s.shopId));
  const canDeleteReturn = (r: any) =>
    hasPermission("sales.return") &&
    (isOwner || (user?.locationType === "SHOP" && user?.locationId === r.shopId));

  const fetchSales = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (locationFilter) params.set("locationId", locationFilter);
      if (categoryFilter) params.set("categoryId", categoryFilter);
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      if (saleTypeFilter) params.set("saleType", saleTypeFilter);
      if (paymentFilter) params.set("paymentMethodId", paymentFilter);
      if (startDate) params.set("dateFrom", startDate);
      if (endDate) params.set("dateTo", endDate);
      params.set("page", String(salesPaged.page));
      params.set("pageSize", String(salesPaged.pageSize));
      const res = await api.get(`/sales?${params}`);
      const body = res.data;
      const rows = Array.isArray(body) ? body : (body?.data ?? []);
      setSales(rows);
      salesPaged.setTotal(
        Array.isArray(body) ? rows.length : (body?.total ?? rows.length),
      );
      if (body?.summary) setSummaryData(body.summary);
    } finally {
      if (!silent) setLoading(false);
      setHasLoaded(true);
    }
  };

  // Returns helpers: refunded amount and refunded cost for a sale.
  const returnedFor = (s: any) =>
    (s.returns || []).reduce(
      (sum: number, r: any) => sum + (r.totalRefund || 0),
      0,
    );
  const returnedCostFor = (s: any) =>
    (s.returns || []).reduce(
      (sum: number, r: any) =>
        sum +
        (r.items || []).reduce(
          (s2: number, ri: any) => s2 + (ri.unitBuyPrice || 0) * (ri.quantity || 0),
          0,
        ),
      0,
    );

  // Record a payment against a partial/credited sale from the sales page.
  const handleSettlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paySale) return;
    const amount = Number(settleAmount);
    if (!amount || amount <= 0) {
      setErrorMsg(t("sales.enterAmountGreaterThan0"));
      return;
    }
    if (!paySale.customerId) {
      setErrorMsg(t("sales.noCustomerForPayment"));
      return;
    }
    try {
      await api.post("/credit-payments", {
        customerId: paySale.customerId,
        amount,
        notes: settleNotes || undefined,
        paymentMethodId: settleMethodId ? Number(settleMethodId) : undefined,
        saleId: paySale.id,
      });
      toast.success(t("sales.paymentRecorded"));
      setPaySale(null);
      setSettleAmount("");
      setSettleMethodId("");
      setSettleNotes("");
      fetchSales();
    } catch (err: any) {
      markHandled(err);
      toast.error(err.response?.data?.message || t("sales.failedRecordPayment"));
    }
  };

  const fetchCategories = async () => {
    const [catRes, locRes] = await Promise.all([
      api.get("/categories"),
      isOwner
        ? api.get("/locations").catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] }),
    ]);
    setCategories(catRes.data);
    setLocations(locRes.data);
  };

  useEffect(() => {
    fetchCategories();
    api.get("/payment-methods").then((r) => {
      setPaymentMethods(r.data);
      const cash = (r.data as any[]).find(
        (m: any) => m.name.toLowerCase() === "cash",
      );
      const cashId = cash ? String(cash.id) : "";
      // Cash is the default payment method of the settle-payment modal.
      setSettleMethodId((prev) => prev || cashId);
    });
  }, []);

  // Refetch the current sales page whenever filters/page/size change (filters
  // reset to page 1 first via the signature guard).
  const salesFilterSig = `${locationFilter}|${categoryFilter}|${debouncedSearch}|${saleTypeFilter}|${paymentFilter}|${startDate}|${endDate}`;
  const salesFilterRef = useRef(salesFilterSig);
  useEffect(() => {
    if (salesFilterRef.current !== salesFilterSig) {
      salesFilterRef.current = salesFilterSig;
      if (salesPaged.page !== 1) {
        salesPaged.setPage(1);
        return;
      }
    }
    // First load shows the full-page loader; later filter/search changes refetch
    // silently so the list stays on screen.
    fetchSales(hasLoaded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salesFilterSig, salesPaged.page, salesPaged.pageSize]);

  // Silent auto-refresh every 5s + on focus: keeps sales fresh without a
  // loading flash so it never interrupts what the user is doing.
  const salesFetchRef = useRef(fetchSales);
  useEffect(() => {
    salesFetchRef.current = fetchSales;
  }, [fetchSales]);
  useEffect(() => {
    const id = setInterval(() => salesFetchRef.current(true), 5000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") salesFetchRef.current(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, []);

  useEffect(() => {
    if (!canViewProfit) return;
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (locationFilter) params.set("locationId", locationFilter);
    if (categoryFilter) params.set("categoryId", categoryFilter);
    if (debouncedSearch) params.set("search", debouncedSearch);
    api
      .get(`/reports/unified-stats?${params}`)
      .then((r) => setPurchaseStats(r.data))
      .catch((err) => console.error("Stats failed:", err));
  }, [startDate, endDate, locationFilter, categoryFilter, debouncedSearch, canViewProfit]);


  // The server returns the filtered page rows plus a summary computed over the
  // whole filtered set (payment-method totals + fiscal-print sale groups).
  const paged = salesPaged;
  const paymentBreakdown: { method: string; total: number }[] =
    summaryData?.paymentBreakdown ?? [];
  const saleGroups: {
    customerId: number;
    label: string;
    saleIds: number[];
    count: number;
    total: number;
  }[] = summaryData?.saleGroups ?? [];

  const openBatchPreview = async (saleIds: number[]) => {
    if (saleIds.length === 0) return;
    setErrorMsg("");
    try {
      const summary = await fetchFiscalBatchSummary({ saleIds });
      setBatchSaleIds(saleIds);
      setBatchPreview(prepareFiscalPrintPayload(summary));
    } catch (e: any) {
      setErrorMsg(
        e?.response?.data?.message ??
          e?.message ??
          t("sales.fiscalSummaryFailed"),
      );
    }
  };
  const confirmBatchPrint = async () => {
    if (!batchPreview) return;
    setBatchPrinting(true);
    try {
      await markBatchPrintPending({ saleIds: batchSaleIds });
      const agent = await dispatchFiscalPrint(batchPreview);
      await ackFiscalBatch({ saleIds: batchSaleIds }, agent);
      setBatchPreview(null);
      setBatchSaleIds([]);
      await fetchSales();
    } catch (e: any) {
      try {
        await markBatchPrintFailed(
          { saleIds: batchSaleIds },
          e?.message ?? t("sales.fiscalPrintFailed"),
        );
      } catch {
        // ack-side failure is reported below
      }
      setErrorMsg(e?.message ?? t("sales.fiscalPrintFailed"));
      setBatchPreview(null);
      await fetchSales();
    } finally {
      setBatchPrinting(false);
    }
  };

  /** Close the form: the next open starts as a brand-new sale. */
  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
    setNewSaleType("FULLY_PAID");
  };

  /** The shared form saved a sale: close it and refresh the list. */
  const handleSaleSaved = () => {
    closeForm();
    fetchSales();
  };
  const startReturn = (sale: any) => {
    setReturningSale(sale);
    setReturnItems(
      sale.items.map((i: any) => ({ productId: i.productId, quantity: 0 })),
    );
    setReturnReason("");
    setShowReturnModal(true);
  };

  const handleReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returningSale) return;
    const items = returnItems.filter((i) => i.quantity > 0);
    if (items.length === 0) {
      toast.error(t("sales.returnAtLeastOne"));
      return;
    }
    try {
      await api.post(`/sales/${returningSale.id}/return`, {
        items,
        reason: returnReason || undefined,
      });
      toast.success(t("sales.returnProcessed"));
      setShowReturnModal(false);
      setReturningSale(null);
      fetchSales();
      api.get("/sales/returns").then((r) => setReturns(r.data));
    } catch (err: any) {
      markHandled(err);
      toast.error(err.response?.data?.message || t("sales.failedReturn"));
    }
  };

  const handleDeleteSale = async (s: any) => {
    const ok = await confirm(
      t("sales.deleteSaleConfirm", { invoice: s.invoiceNumber ?? String(s.id) }),
    );
    if (!ok) return;
    try {
      await api.delete(`/sales/${s.id}`);
      toast.success(t("sales.saleDeleted"));
      fetchSales();
      api.get("/sales/returns").then((r) => setReturns(r.data));
    } catch (err: any) {
      markHandled(err);
      toast.error(err.response?.data?.message || t("sales.failedDeleteSale"));
    }
  };

  const handleDeleteReturn = async (r: any, restore: boolean) => {
    try {
      await api.delete(`/sales/returns/${r.id}`, {
        params: restore ? { restore: true } : undefined,
      });
      toast.success(
        restore ? t("sales.returnDeletedRestored") : t("sales.returnDeletedKept"),
      );
      setDeletingReturn(null);
      setReturns((prev) => prev.filter((x: any) => x.id !== r.id));
      fetchSales();
    } catch (err: any) {
      markHandled(err);
      toast.error(err.response?.data?.message || t("sales.failedDeleteReturn"));
    }
  };

  useEffect(() => {
    api
      .get("/sales/returns")
      .then((r) => setReturns(r.data))
      .catch(() => {});
  }, []);

  const startEdit = (sale: any) => {
    setEditing(sale);
    setShowForm(true);
  };

  if (loading) return <Loading className="py-24" />;

  return (
    <div>
      <div className="flex items-center justify-between mb-2 w-full max-w-full gap-2">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800 whitespace-nowrap">
          {t("sales.title")}
        </h1>
        {purchaseStats && canViewProfit && (
          <div className="flex items-center gap-3 text-xs sm:text-sm text-gray-500 whitespace-nowrap overflow-x-auto">
            <span>
              {t("reports.revenue")}{" "}
              <strong className="text-gray-800">
                {fmtCurrency(purchaseStats.sales.revenue)}
              </strong>
            </span>
            <span className="text-gray-300">|</span>
            <span>
              {t("sales.tax")}{" "}
              <strong className="text-gray-800">
                {fmtCurrency(purchaseStats.combined.totalTax)}
              </strong>
            </span>
            <span className="text-gray-300">|</span>
            <span>
              {t("sales.profitAfterTax")}{" "}
              <strong
                className={
                  purchaseStats.combined.netProfit >= 0
                    ? "text-green-600"
                    : "text-red-500"
                }
              >
                {fmtCurrency(purchaseStats.combined.netProfit)}
              </strong>
            </span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        {(["sales", "payments"] as const).map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === tb
                ? "bg-white shadow text-blue-700"
                : "text-gray-600 hover:text-gray-800"
            }`}
          >
            {tb === "sales" ? t("sales.title") : t("nav.paymentMethods")}
          </button>
        ))}
      </div>

      {/* Filter Panel */}
      <FilterPanel
        showDateFilter
        datePreset={datePreset}
        onDatePresetChange={setDatePreset}
        startDate={startDate}
        onStartDateChange={setStartDate}
        endDate={endDate}
        onEndDateChange={setEndDate}
        search={search}
        onSearchChange={setSearch}
        category={categoryFilter}
        onCategoryChange={setCategoryFilter}
        categories={categories}
        location={locationFilter}
        onLocationChange={setLocationFilter}
        locations={locations}
        showLocation={isOwner}
      />

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <select
          value={saleTypeFilter}
          onChange={(e) => setSaleTypeFilter(e.target.value)}
          className="border p-2 rounded-lg bg-white text-sm"
        >
          <option value="">{t("sales.allSaleTypes")}</option>
          <option value="FULLY_PAID">{t("status.fullyPaid")}</option>
          <option value="PARTIALLY_PAID">{t("status.partiallyPaid")}</option>
          <option value="CREDITED">{t("status.credited")}</option>
        </select>
        <select
          value={paymentFilter}
          onChange={(e) => setPaymentFilter(e.target.value)}
          className="border p-2 rounded-lg bg-white text-sm"
        >
          <option value="">{t("sales.allPaymentMethods")}</option>
          {paymentMethods.map((m: any) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      {tab === "sales" && (
        <div className="flex justify-between items-center mb-6 w-full max-w-full">
          <div className="flex w-full items-center justify-end gap-2 flex-wrap">
            <button
              onClick={() => {
                setEditing(null);
                setNewSaleType("FULLY_PAID");
                setShowForm(true);
              }}
              className="bg-green-600 text-white px-3 py-2 rounded-lg text-xs sm:text-sm font-medium hover:bg-green-700 whitespace-nowrap"
            >
              {t("sales.cashSale")}
            </button>
            <button
              onClick={() => {
                setEditing(null);
                setNewSaleType("PARTIALLY_PAID");
                setShowForm(true);
              }}
              className="bg-amber-500 text-white px-3 py-2 rounded-lg text-xs sm:text-sm font-medium hover:bg-amber-600 whitespace-nowrap"
            >
              {t("sales.partialSale")}
            </button>
            <button
              onClick={() => {
                setEditing(null);
                setNewSaleType("CREDITED");
                setShowForm(true);
              }}
              className="bg-red-500 text-white px-3 py-2 rounded-lg text-xs sm:text-sm font-medium hover:bg-red-600 whitespace-nowrap"
            >
              {t("sales.creditSaleShort")}
            </button>
          </div>
        </div>
      )}

      {/* Recording and correcting a sale is one shared form: the entry buttons
          above only choose the sale type it opens with. */}
      <SaleForm
        isOpen={showForm}
        onClose={closeForm}
        editing={editing}
        defaultSaleType={newSaleType}
        hideSaleTypeSwitch={!editing}
        onSaved={handleSaleSaved}
      />
      {/* Fiscal-batch failures surface here: they belong to the page, not to
          the sale form, which keeps its own validation message. */}
      {errorMsg && (
        <p className="text-red-500 text-sm bg-red-50 p-2 rounded-lg mb-4">
          {errorMsg}
        </p>
      )}
      {tab === "sales" && (<>
      {saleGroups.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border p-4 mb-4">
          <h2 className="text-sm font-semibold text-gray-800 mb-3">
            {t("sales.fiscalConsolidated")}
          </h2>
          <div className="space-y-2">
            {saleGroups.map((g) => (
              <div key={g.customerId} className="flex items-center justify-between gap-2 border border-gray-100 rounded-lg p-2">
                <div>
                  <p className="text-sm font-medium text-gray-800">{g.label}</p>
                  <p className="text-xs text-gray-400">
                    {g.count} {g.count === 1 ? t("credits.sale") : t("credits.salePlural")} · {fmtCurrency(g.total)}
                  </p>
                </div>
                <button
                  onClick={() => openBatchPreview(g.saleIds)}
                  disabled={batchPrinting}
                  className="text-xs bg-gray-800 text-white rounded px-2.5 py-1.5 font-medium shrink-0 disabled:opacity-40"
                >
                  {t("sales.fiscalPrintInvoice", { count: g.count })}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
        <table className="w-full text-left min-w-max text-xs sm:text-sm whitespace-nowrap">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="p-2 sm:p-3 md:p-4">{t("sales.invoiceNo")}</th>
              <th className="p-2 sm:p-3 md:p-4">{t("common.date")}</th>
              {isOwner && <th className="p-2 sm:p-3 md:p-4">{t("status.shop")}</th>}
              <th className="p-2 sm:p-3 md:p-4">
                <span className="block">{t("credits.items")}</span>
                <span className="mt-0.5 flex text-[10px] uppercase font-medium text-gray-400">
                  <span className="flex-1 text-center">{t("products.name")}</span>
                  <span className="w-10 text-center">{t("common.qty")}</span>
                </span>
              </th>
              <th className="p-2 sm:p-3 md:p-4">{t("common.total")}</th>
              <th className="p-2 sm:p-3 md:p-4">{t("sales.tax")}</th>
              <th className="p-2 sm:p-3 md:p-4">{t("common.status")}</th>
              {canViewProfit && <th className="p-2 sm:p-3 md:p-4">{t("purchases.profit")}</th>}
              <th className="p-2 sm:p-3 md:p-4">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s: any) => (
              <tr key={s.id} onClick={() => setViewingSale(s)} className="border-b hover:bg-gray-50 cursor-pointer">
                <td className="p-2 sm:p-3 md:p-4 font-mono text-xs sm:text-sm">
                  {s.invoiceNumber}
                  {s.purchaseId && (
                    <span className="ml-2 px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] rounded font-sans font-semibold">
                      {t("sales.quickFlip")}
                    </span>
                  )}
                  {s.requestId && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/dashboard/requests?req=${s.requestId}`);
                      }}
                      className="ml-2 px-1.5 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] rounded font-sans font-semibold cursor-pointer hover:bg-indigo-200"
                    >
                      {t("sales.reqBadge", { id: s.requestId })}
                    </span>
                  )}
                </td>
                <td className="p-2 sm:p-3 md:p-4 text-xs sm:text-sm text-gray-500">
                  {formatDateTime(s.saleDate)}
                </td>
                {isOwner && (
                  <td className="p-2 sm:p-3 md:p-4 text-xs sm:text-sm">
                    {s.shop?.name}
                  </td>
                )}
                <td className="p-2 sm:p-3 md:p-4 text-xs sm:text-sm text-gray-700">
                  {s.items.length === 0 && s.purchase ? (
                    <table className="w-full">
                      <tbody>
                        <tr>
                          <td className="py-1 pr-3 whitespace-nowrap">{s.purchase.productName}</td>
                          <td className="py-1 w-10 whitespace-nowrap text-gray-500">{s.purchase.quantity}</td>
                        </tr>
                      </tbody>
                    </table>
                  ) : (
                    <table className="w-full">
                      <tbody>
                        {(s.items.length > 3 ? s.items.slice(0, 2) : s.items).map(
                          (i: any, idx: number) => (
                            <tr
                              key={idx}
                              className={
                                idx > 0 ? "border-t border-gray-200" : ""
                              }
                            >
                              <td className="py-1 pr-3 whitespace-nowrap">
                                {i.product.baseName}
                                {i.variant && (
                                  <span className="text-gray-400">
                                    {" "}• {variantLabel(i.variant)}
                                  </span>
                                )}
                                {i.batch && (
                                  <span className="block text-[10px] text-gray-400">
                                    {batchLabel(i.batch)}
                                  </span>
                                )}
                              </td>
                              <td className="py-1 w-10 whitespace-nowrap text-gray-500">
                                {i.quantity}
                              </td>
                            </tr>
                          ),
                        )}
                        {s.items.length > 3 && (
                          <tr className="border-t border-gray-200">
                            <td
                              colSpan={2}
                              className="py-1 text-blue-600 font-medium"
                            >
                              +{s.items.length - 2} more items
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </td>
                <td className="p-2 sm:p-3 md:p-4 font-semibold text-xs sm:text-sm">
                  {fmtCurrency(Math.max(0, s.totalAmount - returnedFor(s)))}
                  {returnedFor(s) > 0 && (
                    <div className="text-[10px] text-red-400 font-normal">
                      {t("sales.returnedText", {
                        amount: fmtCurrency(returnedFor(s)),
                      })}
                    </div>
                  )}
                </td>
                <td className="p-2 sm:p-3 md:p-4 text-xs sm:text-sm text-gray-500">
                  {s.taxAmount > 0 ? (
                    <span>{fmtCurrency(s.taxAmount)}</span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="p-2 sm:p-3 md:p-4">
                  <span
                    className={`px-1.5 sm:px-2 py-0.5 sm:py-1 text-[10px] sm:text-xs rounded-full font-semibold ${
                      s.saleType === "FULLY_PAID"
                        ? "bg-green-100 text-green-800"
                        : s.saleType === "PARTIALLY_PAID"
                          ? "bg-yellow-100 text-yellow-800"
                          : "bg-red-100 text-red-800"
                    }`}
                  >
                    {s.saleType === "FULLY_PAID"
                      ? t("sales.typePaid")
                      : s.saleType === "PARTIALLY_PAID"
                        ? t("sales.typePartial")
                        : t("sales.typeCredit")}
                  </span>
                  {s.paymentMethod && (
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {s.paymentMethod.name}
                    </div>
                  )}
                  {(s.saleType === "PARTIALLY_PAID" ||
                    s.saleType === "CREDITED") && (
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {t("sales.paidRemainingLabel")} {fmtCurrency(s.paidAmount)} /{" "}
                      {fmtCurrency(s.remainingAmount)}
                    </div>
                  )}
                </td>
                {canViewProfit && (
                  <td className="p-2 sm:p-3 md:p-4 text-green-600 font-semibold text-xs sm:text-sm">
                    {fmtCurrency(s.profit - returnedCostFor(s))}
                  </td>
                )}
                <td className="p-2 sm:p-3 md:p-4" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-2">
                    {s.saleType === "FULLY_PAID" && (
                      <FiscalPrintButton
                        target={{ kind: "sale", id: s.id }}
                        fiscalStatus={s.fiscalStatus}
                        receipt={s.fiscalReceipt}
                        onUpdated={fetchSales}
                      />
                    )}
                    <RowActionsMenu
                      items={[
                        { label: t("credits.view"), onClick: () => setViewingSale(s) },
                        { label: t("common.edit"), onClick: () => startEdit(s) },
                      {
                        label: t("sales.returnAction"),
                        color: "text-red-600",
                        onClick: () => startReturn(s),
                      },
                      ...((s.saleType === "PARTIALLY_PAID" ||
                        s.saleType === "CREDITED") &&
                      s.customerId
                        ? [
                            {
                              label: t("credits.recordPayment"),
                              color: "text-blue-600",
                              onClick: () => {
                                setPaySale(s);
                                setSettleAmount("");
                                setSettleMethodId("");
                                setSettleNotes("");
                              },
                            },
                          ]
                        : []),
                      ...(canDeleteSale(s)
                        ? [
                            {
                              label: t("common.delete"),
                              color: "text-red-600",
                              onClick: () => handleDeleteSale(s),
                            },
                          ]
                        : []),
                    ]}
                  />
                  </div>
                </td>
              </tr>
            ))}
            {sales.length === 0 && (
              <tr>
                <td
                  colSpan={6 + (isOwner ? 1 : 0) + (canViewProfit ? 1 : 0)}
                  className="p-4 text-center text-gray-500 text-xs sm:text-sm"
                >
                  {t("sales.noSales")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        page={paged.page}
        totalPages={paged.totalPages}
        total={paged.total}
        rangeStart={paged.rangeStart}
        rangeEnd={paged.rangeEnd}
        onPrev={paged.prev}
        onNext={paged.next}
        onPage={paged.setPage}
        onPageSizeChange={paged.setPageSize}
        pageSize={paged.pageSize}
      />

      {batchPreview && (
        <FiscalPrintPreviewModal
          payload={batchPreview}
          onClose={() => setBatchPreview(null)}
          onConfirm={confirmBatchPrint}
          printing={batchPrinting}
        />
      )}

      {/* Returns list */}
      {returns.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6 mt-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">{t("sales.returns")}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-max text-xs sm:text-sm whitespace-nowrap">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="p-2 sm:p-3">{t("sales.invoiceNo")}</th>
                  <th className="p-2 sm:p-3">
                    <span className="block">{t("credits.items")}</span>
                    <span className="mt-0.5 flex text-[10px] uppercase font-medium text-gray-400">
                      <span className="flex-1 text-center">{t("products.name")}</span>
                      <span className="w-10 text-center">{t("common.qty")}</span>
                    </span>
                  </th>
                  <th className="p-2 sm:p-3">{t("sales.refund")}</th>
                  <th className="p-2 sm:p-3">{t("common.reason")}</th>
                  <th className="p-2 sm:p-3">{t("common.date")}</th>
                  <th className="p-2 sm:p-3">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {returns.map((r: any) => (
                  <tr key={r.id} className="border-b hover:bg-gray-50">
                    <td className="p-2 sm:p-3 font-mono">
                      {r.sale?.invoiceNumber}
                    </td>
                    <td className="p-2 sm:p-3">
                      <table className="w-full">
                        <tbody>
                          {r.items.map((i: any, idx: number) => (
                            <tr key={idx} className={idx > 0 ? "border-t border-gray-200" : ""}>
                              <td className="py-1 pr-3 whitespace-nowrap">
                                {i.product.baseName}
                                {i.variant && (
                                  <span className="text-gray-400">
                                    {" "}• {variantLabel(i.variant)}
                                  </span>
                                )}
                                {i.batch && (
                                  <span className="block text-[10px] text-gray-400">
                                    {batchLabel(i.batch)}
                                  </span>
                                )}
                              </td>
                              <td className="py-1 w-10 whitespace-nowrap text-gray-500">{i.quantity}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                    <td className="p-2 sm:p-3 font-semibold text-red-600">
                      {fmtCurrency(r.totalRefund)}
                    </td>
                    <td className="p-2 sm:p-3 text-gray-500">
                      {r.reason || "—"}
                    </td>
                    <td className="p-2 sm:p-3 text-gray-500">
                      {r.createdAt?.slice(0, 10)}
                    </td>
                    <td className="p-2 sm:p-3" onClick={(e) => e.stopPropagation()}>
                      {canDeleteReturn(r) && (
                        <button
                          type="button"
                          onClick={() => setDeletingReturn(r)}
                          className="text-red-600 hover:text-red-800 text-xs font-medium"
                        >
                          {t("common.delete")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </>
      )}

      {/* Payment methods summary (Payments tab) */}
      {tab === "payments" && (
        <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
          <table className="w-full text-left min-w-[400px] text-xs sm:text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="p-2 sm:p-3 md:p-4">{t("sales.paymentMethodHeader")}</th>
                <th className="p-2 sm:p-3 md:p-4 text-right">{t("sales.amountCollected")}</th>
              </tr>
            </thead>
            <tbody>
              {paymentBreakdown.map((pm) => (
                <tr key={pm.method} className="border-b hover:bg-gray-50">
                  <td className="p-2 sm:p-3 md:p-4 font-medium">{pm.method}</td>
                  <td className="p-2 sm:p-3 md:p-4 text-right font-semibold">
                    {fmtCurrency(pm.total)}
                  </td>
                </tr>
              ))}
              {paymentBreakdown.length === 0 && (
                <tr>
                  <td colSpan={2} className="p-6 text-center text-gray-400 text-sm">
                    {t("sales.noPaymentsForFilters")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Return Modal */}
      <Modal
        isOpen={showReturnModal}
        onClose={() => setShowReturnModal(false)}
        title={t("sales.returnItemsTitle", { invoice: returningSale?.invoiceNumber ?? "" })}
      >
        <form onSubmit={handleReturn} className="grid grid-cols-1 gap-4">
          {returningSale?.items.map((i: any) => (
            <div key={i.productId} className="flex items-center gap-2">
              <span className="flex-1 text-sm text-gray-700">
                {i.product.brand} {i.product.baseName}
                {i.variant && (
                  <span className="text-gray-400"> • {variantLabel(i.variant)}</span>
                )}
                {i.batch && (
                  <span className="block text-[10px] text-gray-400">
                    {batchLabel(i.batch)}
                  </span>
                )}
                <span className="text-gray-400"> (sold {i.quantity})</span>
              </span>
              <input
                type="number"
                min="0"
                max={i.quantity}
                value={
                  returnItems.find((r) => r.productId === i.productId)
                    ?.quantity ?? 0
                }
                onChange={(e) =>
                  setReturnItems(
                    returnItems.map((r) =>
                      r.productId === i.productId
                        ? { ...r, quantity: Number(e.target.value) }
                        : r,
                    ),
                  )
                }
                className="border p-2 rounded-lg w-24 text-sm"
              />
            </div>
          ))}
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("products.reasonOptional")}
            </label>
            <input
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              className="border p-2 rounded-lg w-full"
              placeholder={t("sales.returnReasonPh")}
            />
          </div>
          <button
            type="submit"
            className="bg-red-600 text-white p-2 rounded-lg mt-2 font-medium"
          >
            {t("sales.processReturn")}
          </button>
        </form>
      </Modal>

      {/* Record Payment (settle partial/credited sale) Modal */}
      <Modal
        isOpen={!!paySale}
        onClose={() => setPaySale(null)}
        title={t("sales.recordPaymentTitleSale", {
          invoice: paySale?.invoiceNumber ?? "",
        })}
      >
        <form onSubmit={handleSettlePayment} className="grid grid-cols-1 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("credits.amount")}
            </label>
            <input
              type="number"
              step="0.01"
              min="1"
              value={settleAmount}
              onChange={(e) => setSettleAmount(e.target.value)}
              className="border p-2 rounded-lg w-full text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("sales.paymentMethod")}
            </label>
            <select
              value={settleMethodId}
              onChange={(e) => setSettleMethodId(e.target.value)}
              className="border p-2 rounded-lg w-full bg-white text-sm"
            >
              {!cashMethod && (
                <option value="">{t("purchases.selectPaymentMethod")}</option>
              )}
              {paymentMethods.map((m: any) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("common.notes")}
            </label>
            <input
              value={settleNotes}
              onChange={(e) => setSettleNotes(e.target.value)}
              placeholder={t("common.notesPh")}
              className="border p-2 rounded-lg w-full text-sm"
            />
          </div>
          <button
            type="submit"
            className="bg-green-600 text-white p-2 rounded-lg text-sm font-medium mt-2 hover:bg-green-700"
          >
            {t("credits.recordPayment")}
          </button>
        </form>
      </Modal>

      {/* Sale Details Modal */}
      <Modal
        isOpen={!!viewingSale}
        onClose={() => setViewingSale(null)}
        title={t("sales.saleDetailsTitle", { invoice: viewingSale?.invoiceNumber ?? "" })}
      >
        {viewingSale && (
          <div className="text-sm space-y-3">
            <div className="grid grid-cols-2 gap-2 text-gray-700">
              <div>
                <span className="text-gray-400">{t("common.date")}:</span>{" "}
                {formatDateTime(viewingSale.saleDate)}
              </div>
              <div>
                <span className="text-gray-400">{t("status.shop")}:</span>{" "}
                {viewingSale.shop?.name || "—"}
              </div>
              <div>
                <span className="text-gray-400">{t("sales.soldBy")}</span>{" "}
                {viewingSale.soldBy?.name || "—"}
              </div>
              <div>
                <span className="text-gray-400">{t("common.status")}:</span>{" "}
                {viewingSale.saleType === "FULLY_PAID"
                  ? t("sales.typePaid")
                  : viewingSale.saleType === "PARTIALLY_PAID"
                    ? t("sales.typePartial")
                    : t("sales.typeCredit")}
              </div>
              <div>
                <span className="text-gray-400">{t("sales.paymentLabel")}</span>{" "}
                {viewingSale.paymentMethod?.name || "—"}
              </div>
              {viewingSale.requestId && (
                <div className="col-span-2">
                  <span className="text-gray-400">{t("sales.requestLabel")}</span>{" "}
                  <button
                    onClick={() =>
                      router.push(
                        `/dashboard/requests?req=${viewingSale.requestId}`,
                      )
                    }
                    className="text-indigo-600 font-medium hover:underline"
                  >
                    #{viewingSale.requestId}
                  </button>
                </div>
              )}
              {viewingSale.customer && (
                <div className="col-span-2">
                  <span className="text-gray-400">{t("sales.customerLabel")}</span>{" "}
                  {viewingSale.customer.name}
                </div>
              )}
            </div>

            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="p-2 text-left">{t("sales.itemLabel")}</th>
                    <th className="p-2 text-right whitespace-nowrap">{t("common.qty")}</th>
                    <th className="p-2 text-right whitespace-nowrap">{t("sales.unit")}</th>
                    <th className="p-2 text-right whitespace-nowrap">{t("credits.subtotal")}</th>
                  </tr>
                </thead>
                <tbody>
                  {viewingSale.items.length === 0 && viewingSale.purchase ? (
                    <tr>
                      <td className="p-2 whitespace-nowrap">{viewingSale.purchase.productName}</td>
                      <td className="p-2 text-right whitespace-nowrap">{viewingSale.purchase.quantity}</td>
                      <td className="p-2 text-right whitespace-nowrap">
                        {fmtCurrency(viewingSale.purchase.sellPrice)}
                      </td>
                      <td className="p-2 text-right whitespace-nowrap">
                        {fmtCurrency(viewingSale.totalAmount)}
                      </td>
                    </tr>
                  ) : (
                    viewingSale.items.map((i: any, idx: number) => (
                      <tr key={idx} className="border-t">
                        <td className="p-2 whitespace-nowrap">
                          {i.product?.brand} {i.product?.baseName}
                          {i.variant && (
                            <span className="text-gray-500">
                              {" "}• {variantLabel(i.variant)}
                            </span>
                          )}
                          {i.batch && (
                            <span className="block text-[10px] text-gray-400">
                              {batchLabel(i.batch)}
                            </span>
                          )}
                        </td>
                        <td className="p-2 text-right whitespace-nowrap">{i.quantity}</td>
                        <td className="p-2 text-right whitespace-nowrap">{fmtCurrency(i.unitSellPrice)}</td>
                        <td className="p-2 text-right whitespace-nowrap">
                          {fmtCurrency(i.unitSellPrice * i.quantity)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-gray-400">{t("sales.totalLabel")}</span>{" "}
                <strong>
                  {fmtCurrency(
                    Math.max(0, viewingSale.totalAmount - returnedFor(viewingSale)),
                  )}
                </strong>
                {returnedFor(viewingSale) > 0 && (
                  <div className="text-[10px] text-red-400 font-normal">
                    {t("sales.returnedAmount", {
                      amount: fmtCurrency(returnedFor(viewingSale)),
                    })}
                  </div>
                )}
              </div>
              <div>
                <span className="text-gray-400">{t("sales.paidRemainingLabel")}</span>{" "}
                {fmtCurrency(viewingSale.paidAmount)} /{" "}
                {fmtCurrency(viewingSale.remainingAmount)}
              </div>
              {canViewProfit && (
                <>
                  <div>
                    <span className="text-gray-400">{t("sales.costLabel")}</span>{" "}
                    {fmtCurrency(viewingSale.totalCost)}
                  </div>
                  <div>
                    <span className="text-gray-400">{t("sales.profitLabel")}</span>{" "}
                    <strong
                      className={
                        viewingSale.profit >= 0 ? "text-green-600" : "text-red-500"
                      }
                    >
                      {fmtCurrency(viewingSale.profit - returnedCostFor(viewingSale))}
                    </strong>
                  </div>
                </>
              )}
            </div>
            {viewingSale.notes && (
              <div>
                <span className="text-gray-400">{t("sales.notesLabel")}</span> {viewingSale.notes}
              </div>
            )}
            {(viewingSale.saleType === "PARTIALLY_PAID" ||
              viewingSale.saleType === "CREDITED") &&
              viewingSale.customerId && (
                <button
                  onClick={() => {
                    setPaySale(viewingSale);
                    setSettleAmount("");
                    setSettleMethodId("");
                    setSettleNotes("");
                  }}
                  className="bg-blue-600 text-white px-3 py-2 rounded-lg text-xs sm:text-sm font-medium w-full"
                >
                  {t("credits.recordPayment")}
                </button>
              )}
          </div>
        )}
      </Modal>

      {/* Delete return — two modes */}
      <Modal
        isOpen={deletingReturn !== null}
        onClose={() => setDeletingReturn(null)}
        title={t("sales.deleteReturnTitle", {
          invoice: deletingReturn?.sale?.invoiceNumber ?? "",
        })}
      >
        <div className="grid grid-cols-1 gap-3">
          <p className="text-sm text-gray-600">
            {t("sales.deleteReturnHow", {
              amount: fmtCurrency(deletingReturn?.totalRefund),
            })}
          </p>
          <button
            type="button"
            onClick={() => handleDeleteReturn(deletingReturn, true)}
            className="bg-green-600 text-white p-2.5 rounded-lg font-medium text-sm text-left"
          >
            {t("sales.fullUndo")}
            <span className="block text-[11px] font-normal opacity-90">
              {t("sales.fullUndoHint")}
            </span>
          </button>
          <button
            type="button"
            onClick={() => handleDeleteReturn(deletingReturn, false)}
            className="bg-red-600 text-white p-2.5 rounded-lg font-medium text-sm text-left"
          >
            {t("sales.damagedWriteoff")}
            <span className="block text-[11px] font-normal opacity-90">
              {t("sales.damagedWriteoffHint")}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setDeletingReturn(null)}
            className="border border-gray-300 text-gray-700 p-2 rounded-lg font-medium text-sm"
          >
            {t("common.cancel")}
          </button>
        </div>
      </Modal>
    </div>
  );
}
