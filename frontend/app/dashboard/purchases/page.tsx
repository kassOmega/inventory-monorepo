"use client";
// app/dashboard/purchases/page.tsx
//
// One page for every purchase. A quick purchase (paid from the till) and a
// credit purchase (taken from a vendor) are the same record, so they share the
// same form, the same table and the same actions — the only difference the page
// draws attention to is how the buy side settles. The tabs filter that one list;
// they do not switch to a second implementation.
import { getDateRange } from "@/app/components/DateFilter";
import ClearableInput from "@/app/components/ClearableInput";
import { useSingleLocationAutofill } from "@/lib/singleLocation";
import Loading from "@/app/components/Loading";
import PurchaseForm, { PurchaseMode } from "@/app/components/PurchaseForm";
import PurchasesTable, { recordedMargin } from "@/app/components/PurchasesTable";
import PurchaseDetailModal from "@/app/components/PurchaseDetailModal";
import VendorPaymentModal from "@/app/components/VendorPaymentModal";
import SearchableSelect from "@/app/components/SearchableSelect";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useToast } from "@/app/components/ToastProvider";
import { useAuth } from "@/context/AuthContext";
import api, { markHandled } from "@/lib/api";
import { fmtCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/datetime";
import { statusLabel } from "@/lib/statusLabel";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type DatePreset = "today" | "week" | "month" | "year";
/** ALL shows both settlements side by side; the other two filter the list. */
type Tab = "ALL" | "PAID" | "CREDIT";

/** The range shortcuts behind the Filters toggle; labels live in `filters.*`. */
const DATE_PRESETS: { key: DatePreset; labelKey: string }[] = [
  { key: "today", labelKey: "filters.dateToday" },
  { key: "week", labelKey: "filters.dateWeek" },
  { key: "month", labelKey: "filters.dateMonth" },
  { key: "year", labelKey: "filters.dateYear" },
];

export default function PurchasesPage() {
  const { t } = useTranslation();
  const { user, hasPermission } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const isOwner = user?.isSuperuser === true;
  const canApprove = hasPermission("purchases.approve");
  const canCreate = hasPermission("purchases.create");

  const [rows, setRows] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [tab, setTab] = useState<Tab>("ALL");
  const [statusFilter, setStatusFilter] = useState("");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("month");
  const [startDate, setStartDate] = useState(() => getDateRange("month").start);
  const [endDate, setEndDate] = useState(() => getDateRange("month").end);
  const [shopFilter, setShopFilter] = useState("");
  const [vendorFilter, setVendorFilter] = useState("");
  const [shops, setShops] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [payTarget, setPayTarget] = useState<any>(null);
  // The row whose detail modal is open — the table keeps only the headline, so
  // this modal is where the rest of the record is read.
  const [viewTarget, setViewTarget] = useState<any>(null);
  const [fetching, setFetching] = useState(true);
  const [daySheet, setDaySheet] = useState<any>(null);
  // The date range is the one filter that is not touched on every visit, so it
  // hides behind the Filters toggle.
  const [showFilters, setShowFilters] = useState(false);
  // Autofill the sole shop when the business has only one.
  useSingleLocationAutofill(locations, shopFilter, setShopFilter);

  const fetchPurchases = async () => {
    setFetching(true);
    try {
      const params = new URLSearchParams();
      if (tab !== "ALL") params.set("paymentType", tab);
      if (statusFilter) params.set("status", statusFilter);
      // The settlement status only means anything on a credit row.
      if (tab !== "PAID" && paymentStatusFilter)
        params.set("paymentStatus", paymentStatusFilter);
      if (search) params.set("search", search);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (shopFilter) params.set("shopId", shopFilter);
      if (tab !== "PAID" && vendorFilter)
        params.set("vendorCustomerId", vendorFilter);
      const query = params.toString();
      // The stats strip always reports both settlements, so it is asked without
      // the tab's paymentType filter.
      const statsParams = new URLSearchParams(params);
      statsParams.delete("paymentType");
      const [res, sres] = await Promise.all([
        api.get(`/purchases${query ? "?" + query : ""}`),
        api.get(`/purchases/stats?${statsParams.toString()}`),
      ]);
      setRows(Array.isArray(res.data) ? res.data : (res.data?.data ?? []));
      setStats(sres.data);
    } catch (err: any) {
      markHandled(err);
      toast.error(t("purchases.failed"));
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    fetchPurchases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tab,
    statusFilter,
    paymentStatusFilter,
    search,
    startDate,
    endDate,
    shopFilter,
    vendorFilter,
  ]);

  useEffect(() => {
    api
      .get(
        `/reports/day-sheet?locationId=${shopFilter || ""}&startDate=${startDate}&endDate=${endDate}`,
      )
      .then((r) => setDaySheet(r.data))
      .catch(() => {});
  }, [shopFilter, startDate, endDate]);

  useEffect(() => {
    if (isOwner)
      api
        .get("/locations")
        .then((r) => {
          setLocations(r.data);
          setShops(r.data.filter((l: any) => l.type === "SHOP"));
        })
        .catch(() => {});
    // Vendors are customers — the picker reuses the customer directory.
    api
      .get("/customers")
      .then((r) =>
        setVendors(Array.isArray(r.data) ? r.data : (r.data?.data ?? [])),
      )
      .catch(() => {});
  }, [isOwner]);

  // --- Actions ------------------------------------------------------------

  const handleApprove = async (row: any) => {
    try {
      await api.patch(
        `/purchases/${row.publicId ?? row.id}/approve`,
      );
      fetchPurchases();
    } catch (err: any) {
      markHandled(err);
      toast.error(err?.response?.data?.message ?? t("purchases.failed"));
    }
  };

  const handleReject = async (row: any) => {
    try {
      await api.patch(`/purchases/${row.publicId ?? row.id}/reject`);
      fetchPurchases();
    } catch (err: any) {
      markHandled(err);
      toast.error(err?.response?.data?.message ?? t("purchases.failed"));
    }
  };

  const handleDelete = async (row: any) => {
    const ok = await confirm(t("purchases.deleteConfirm"));
    if (!ok) return;
    try {
      await api.delete(`/purchases/${row.publicId ?? row.id}`);
      fetchPurchases();
      toast.success(t("purchases.deleted"));
    } catch (err: any) {
      markHandled(err);
      toast.error(err?.response?.data?.message ?? t("purchases.failedDelete"));
    }
  };

  const formMode: PurchaseMode = tab === "CREDIT" ? "CREDIT" : "PAID";

  // --- What the strip summarises, per settlement --------------------------

  // Summed from the loaded rows: a credit purchase records its margin while the
  // goods sit on the shelf, and only books it when they are actually resold.
  const creditMargin = rows
    .filter((r) => r.paymentType === "CREDIT")
    .reduce((sum, r) => sum + recordedMargin(r), 0);

  // The chip on the Filters button, so a collapsed panel still says which range
  // the list below it is showing.
  const activeRange =
    startDate || endDate
      ? `${startDate ? formatDate(`${startDate}T00:00:00`) : "—"} – ${
          endDate ? formatDate(`${endDate}T00:00:00`) : "—"
        }`
      : "";

  if (fetching && rows.length === 0 && !stats) return <Loading className="py-24" />;

  return (
    <div>
      <div className="flex justify-between items-start md:items-center mb-4 gap-3">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">
          {t("purchases.title")}
        </h1>
        {canCreate && (
          <button
            onClick={() => setShowForm(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 whitespace-nowrap"
          >
            + {t("purchases.newPurchase")}
          </button>
        )}
      </div>

      {/* One list, filtered by settlement — never two implementations. */}
      <div className="flex gap-0.5 sm:gap-1 mb-4 border-b overflow-x-auto pb-px">
        {(["ALL", "PAID", "CREDIT"] as Tab[]).map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={
              "px-3 sm:px-4 py-2 whitespace-nowrap text-xs sm:text-sm font-medium rounded-t-lg transition " +
              (tab === tb
                ? "bg-white text-blue-600 border border-b-white -mb-px shadow-sm"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-100")
            }
          >
            {tb === "ALL"
              ? t("purchases.tabAll")
              : tb === "PAID"
                ? t("purchases.tabPaid")
                : t("purchases.tabCredit")}
          </button>
        ))}
      </div>

      {/* One slim toolbar. The filters a shopkeeper touches on every visit stay
          visible; the date range hides behind Filters and reports itself as a
          chip, so the list gets the room instead of the chrome. */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <ClearableInput
          value={search}
          onChange={setSearch}
          placeholder={t("filters.searchProducts")}
          className="flex-1 min-w-[150px]"
          inputClassName="border p-1.5 sm:p-2 rounded-lg w-full text-xs sm:text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border p-1.5 sm:p-2 rounded-lg bg-white text-xs sm:text-sm"
        >
          <option value="">{t("purchases.allStatus")}</option>
          <option value="PENDING">{statusLabel("PENDING")}</option>
          <option value="APPROVED">{statusLabel("APPROVED")}</option>
          <option value="REJECTED">{statusLabel("REJECTED")}</option>
        </select>
        {tab !== "PAID" && (
          <select
            value={paymentStatusFilter}
            onChange={(e) => setPaymentStatusFilter(e.target.value)}
            className="border p-1.5 sm:p-2 rounded-lg bg-white text-xs sm:text-sm"
          >
            <option value="">{t("purchases.allPaymentStatus")}</option>
            <option value="UNPAID">{statusLabel("UNPAID")}</option>
            <option value="PARTIALLY_PAID">
              {statusLabel("PARTIALLY_PAID")}
            </option>
            <option value="PAID">{statusLabel("PAID")}</option>
          </select>
        )}
        {tab !== "PAID" && (
          <div className="w-full sm:w-44">
            <SearchableSelect
              options={vendors.map((v: any) => ({
                value: String(v.id),
                label: v.name,
                searchText: `${v.name ?? ""} ${v.phone ?? ""}`,
              }))}
              value={vendorFilter}
              onChange={setVendorFilter}
              placeholder={t("purchases.filterVendor")}
              clearable
              clearLabel={t("common.clear")}
            />
          </div>
        )}
        {isOwner && shops.length > 0 && (
          <select
            value={shopFilter}
            onChange={(e) => setShopFilter(e.target.value)}
            className="border p-1.5 sm:p-2 rounded-lg bg-white text-xs sm:text-sm"
          >
            <option value="">{t("filters.allLocations")}</option>
            {shops.map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          className={
            "px-2.5 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium border whitespace-nowrap transition " +
            (showFilters
              ? "bg-blue-50 text-blue-700 border-blue-200"
              : "bg-white text-gray-600 hover:bg-gray-50")
          }
        >
          {t("common.filters")}
          {!showFilters && activeRange && (
            <span className="ml-1 text-[10px] sm:text-xs text-gray-400">
              {activeRange}
            </span>
          )}
        </button>
      </div>

      {/* Looking back at an older range is rare enough to hide: the presets stay
          one tap away and the custom dates sit next to them. */}
      {showFilters && (
        <div className="bg-white rounded-xl shadow-sm border p-2 sm:p-3 mb-3 flex flex-wrap items-center gap-1.5 sm:gap-2">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => {
                setDatePreset(p.key);
                const range = getDateRange(p.key);
                setStartDate(range.start);
                setEndDate(range.end);
              }}
              className={
                "px-2.5 py-1 rounded-full text-[11px] sm:text-xs font-medium transition " +
                (datePreset === p.key
                  ? "bg-blue-600 text-white shadow"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200")
              }
            >
              {t(p.labelKey)}
            </button>
          ))}
          <div className="flex items-center gap-1 sm:gap-2 ml-0.5 sm:ml-1 flex-wrap">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="border p-1 rounded text-[11px] sm:text-xs bg-white"
            />
            <span className="text-gray-400 text-[11px] sm:text-xs">
              {t("filters.to")}
            </span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="border p-1 rounded text-[11px] sm:text-xs bg-white"
            />
          </div>
        </div>
      )}

      {/* Both settlements on one line, with the till's day figures dimmed after
          them: the numbers a shopkeeper checks without scrolling past cards. Each
          figure group may shrink and wrap, so a 360 px phone never scrolls the
          page sideways to finish reading a number. */}
      <div className="bg-white rounded-xl shadow-sm border px-3 py-2 mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm overflow-hidden">
        {tab !== "CREDIT" && stats?.paid && (
          <span className="min-w-0">
            <span className="text-gray-400">{t("purchases.modePaid")}</span>{" "}
            <strong className="text-red-600">
              {fmtCurrency(stats.paid.totalCost)}
            </strong>
            <span className="text-gray-300"> → </span>
            <strong className="text-blue-700">
              {fmtCurrency(stats.paid.totalRevenue)}
            </strong>
            {isOwner && (
              <>
                <span className="text-gray-300"> · </span>
                <span className="text-gray-400">{t("purchases.profit")}</span>{" "}
                <strong
                  className={
                    stats.paid.totalProfit >= 0
                      ? "text-green-700"
                      : "text-red-700"
                  }
                >
                  {fmtCurrency(stats.paid.totalProfit)}
                </strong>
              </>
            )}
            <span className="text-gray-300"> · </span>
            <span className="text-yellow-700">
              {stats.paid.pendingCount} {t("status.pending")}
            </span>
          </span>
        )}
        {tab !== "PAID" && stats?.credit && (
          <span className="min-w-0">
            <span className="text-gray-400">{t("purchases.modeCredit")}</span>{" "}
            <strong className="text-gray-800">
              {fmtCurrency(stats.credit.totalTaken)}
            </strong>
            <span className="text-gray-300"> · </span>
            <span className="text-gray-400">
              {t("purchases.creditPaidBack")}
            </span>{" "}
            <strong className="text-green-700">
              {fmtCurrency(stats.credit.totalPaidToVendor)}
            </strong>
            <span className="text-gray-300"> · </span>
            <span className="text-gray-400">
              {t("purchases.creditOutstanding")}
            </span>{" "}
            <strong className="text-red-600">
              {fmtCurrency(stats.credit.totalRemainingToPay)}
            </strong>
            <span className="text-gray-300"> · </span>
            <span className="text-red-700">
              {stats.credit.unpaidCount} {t("purchases.creditUnpaid")}
            </span>
            {isOwner && (
              <>
                <span className="text-gray-300"> · </span>
                <span
                  className="text-gray-400"
                  title={t("purchases.recordedMarginHint")}
                >
                  {t("purchases.recordedMargin")}
                </span>{" "}
                <strong
                  className={creditMargin >= 0 ? "text-green-700" : "text-red-700"}
                >
                  ~{fmtCurrency(creditMargin)}
                </strong>
              </>
            )}
          </span>
        )}
        {daySheet && (
          <span className="min-w-0 w-full sm:w-auto text-[10px] sm:text-xs text-gray-400">
            {t("purchases.openingCash")} {fmtCurrency(daySheet.opening)}
            {" · "}
            {t("purchases.inflow")} +{fmtCurrency(daySheet.totalInflow)}
            {" · "}
            {t("purchases.outflow")} -{fmtCurrency(daySheet.totalOutflow)}
            {" · "}
            {t("purchases.closingCash")} {fmtCurrency(daySheet.closing)}
          </span>
        )}
      </div>

      <PurchasesTable
        rows={rows}
        mode={tab}
        canApprove={canApprove}
        canCreate={canCreate}
        onView={setViewTarget}
        onApprove={handleApprove}
        onReject={handleReject}
        onDelete={handleDelete}
        onPay={setPayTarget}
      />

      {/* Everything the slimmed-down table no longer prints. */}
      <PurchaseDetailModal
        purchase={viewTarget}
        onClose={() => setViewTarget(null)}
      />

      <PurchaseForm
        isOpen={showForm}
        onClose={() => setShowForm(false)}
        mode={formMode}
        // The tab that opened the form already chose the settlement; only the
        // ALL tab leaves the switch on the form itself.
        hideModeSwitch={tab !== "ALL"}
        onSaved={fetchPurchases}
      />

      <VendorPaymentModal
        isOpen={!!payTarget}
        onClose={() => setPayTarget(null)}
        purchase={payTarget}
        onSaved={fetchPurchases}
      />
    </div>
  );
}
