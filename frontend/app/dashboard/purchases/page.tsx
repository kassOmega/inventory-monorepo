"use client";
// app/dashboard/purchases/page.tsx
//
// One page for every purchase. A quick purchase (paid from the till) and a
// credit purchase (taken from a vendor) are the same record, so they share the
// same form, the same table and the same actions — the only difference the page
// draws attention to is how the buy side settles. The tabs filter that one list;
// they do not switch to a second implementation.
import { getDateRange } from "@/app/components/DateFilter";
import CollapsibleFilterPanel from "@/app/components/CollapsibleFilterPanel";
import { FilterSelect } from "@/app/components/FilterPanel";
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
import { statusLabel } from "@/lib/statusLabel";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type DatePreset = "today" | "week" | "month" | "year";
/** ALL shows both settlements side by side; the other two filter the list. */
type Tab = "ALL" | "PAID" | "CREDIT";

/** Remember the stats summary's open/closed choice across visits. */
const STATS_OPEN_KEY = "purchases.statsOpen";

/**
 * One figure of the summary. Deliberately tiny — a label line + a tight value —
 * so the expanded grid never dominates the page on a phone.
 */
function StatCard({
  label,
  value,
  valueClass = "text-gray-800",
  hint,
}: {
  label: string;
  value: string;
  valueClass?: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5">
      <p className="truncate text-[10px] uppercase tracking-wide text-gray-400">
        {label}
      </p>
      <p className={`truncate text-sm font-semibold leading-tight ${valueClass}`}>
        {value}
      </p>
      {hint && (
        <p className="truncate text-[10px] leading-tight text-gray-400">
          {hint}
        </p>
      )}
    </div>
  );
}

/** A titled row of cards for one settlement; the left accent tints the group. */
function StatGroup({
  title,
  accentClass,
  children,
}: {
  title: string;
  accentClass: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`border-l-2 pl-2 ${accentClass}`}>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
        {title}
      </p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
        {children}
      </div>
    </div>
  );
}

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
  // The smart-cards summary is collapsible and starts collapsed (its header keeps
  // the headline number visible); the choice is remembered across visits.
  const [statsOpen, setStatsOpen] = useState(false);
  // Autofill the sole shop when the business has only one.
  useSingleLocationAutofill(locations, shopFilter, setShopFilter);

  // Remember the summary's open/closed choice. Read on mount (after hydration,
  // so SSR/first paint stays collapsed), written on every explicit toggle.
  useEffect(() => {
    if (localStorage.getItem(STATS_OPEN_KEY) === "1") setStatsOpen(true);
  }, []);
  const toggleStats = () =>
    setStatsOpen((prev) => {
      const next = !prev;
      localStorage.setItem(STATS_OPEN_KEY, next ? "1" : "0");
      return next;
    });

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

      {/* The shared Sales-style filter panel, collapsible (starts expanded). */}
      <CollapsibleFilterPanel
        showDateFilter
        datePreset={datePreset}
        onDatePresetChange={setDatePreset}
        startDate={startDate}
        onStartDateChange={setStartDate}
        endDate={endDate}
        onEndDateChange={setEndDate}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("filters.searchProducts")}
        extra={
          <>
            <FilterSelect
              label={t("common.status")}
              value={statusFilter}
              onChange={setStatusFilter}
              allLabel={t("purchases.allStatus")}
              options={[
                { value: "PENDING", label: statusLabel("PENDING") },
                { value: "APPROVED", label: statusLabel("APPROVED") },
                { value: "REJECTED", label: statusLabel("REJECTED") },
              ]}
            />
            {tab !== "PAID" && (
              <FilterSelect
                label={t("purchases.paymentStatus")}
                value={paymentStatusFilter}
                onChange={setPaymentStatusFilter}
                allLabel={t("purchases.allPaymentStatus")}
                options={[
                  { value: "UNPAID", label: statusLabel("UNPAID") },
                  { value: "PARTIALLY_PAID", label: statusLabel("PARTIALLY_PAID") },
                  { value: "PAID", label: statusLabel("PAID") },
                ]}
              />
            )}
            {tab !== "PAID" && (
              <div>
                <label className="block text-[10px] sm:text-xs font-medium text-gray-500 mb-0.5 sm:mb-1">
                  {t("purchases.vendor")}
                </label>
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
              <FilterSelect
                label={t("filters.location")}
                value={shopFilter}
                onChange={setShopFilter}
                allLabel={t("filters.allLocations")}
                options={shops.map((s: any) => ({
                  value: String(s.id),
                  label: s.name,
                }))}
              />
            )}
          </>
        }
      />

      {/* Smart-cards summary: collapsible, starts collapsed with the headline
          number kept in the header, so on a phone it costs one slim row and the
          list keeps the room. Expanded, the cards are tiny (2 per row on a
          phone) and never force a sideways scroll. */}
      {(stats?.paid || stats?.credit || daySheet) && (
        <div className="mb-3 rounded-xl border border-gray-200 bg-white shadow-sm">
          <button
            type="button"
            onClick={toggleStats}
            aria-expanded={statsOpen}
            className="flex w-full items-center gap-2 px-3 py-2 text-left"
          >
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              {t("purchases.summaryTitle")}
            </span>
            {/* Headline that stays readable while collapsed. */}
            <span className="min-w-0 flex-1 truncate text-xs text-gray-400">
              {tab !== "CREDIT" && stats?.paid ? (
                <>
                  {t("purchases.modePaid")}:{" "}
                  <strong className="text-red-600">
                    {fmtCurrency(stats.paid.totalCost)}
                  </strong>
                </>
              ) : tab !== "PAID" && stats?.credit ? (
                <>
                  {t("purchases.modeCredit")}:{" "}
                  <strong className="text-gray-800">
                    {fmtCurrency(stats.credit.totalTaken)}
                  </strong>
                </>
              ) : null}
            </span>
            <svg
              className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${statsOpen ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {statsOpen && (
            <div className="space-y-2.5 border-t border-gray-100 px-3 py-2.5">
              {tab !== "CREDIT" && stats?.paid && (
                <StatGroup
                  title={t("purchases.modePaid")}
                  accentClass="border-blue-400"
                >
                  <StatCard
                    label={t("purchases.totalCost")}
                    value={fmtCurrency(stats.paid.totalCost)}
                    valueClass="text-red-600"
                  />
                  <StatCard
                    label={t("purchases.revenue")}
                    value={fmtCurrency(stats.paid.totalRevenue)}
                    valueClass="text-blue-700"
                  />
                  {isOwner && (
                    <StatCard
                      label={t("purchases.profit")}
                      value={fmtCurrency(stats.paid.totalProfit)}
                      valueClass={
                        stats.paid.totalProfit >= 0
                          ? "text-green-700"
                          : "text-red-700"
                      }
                    />
                  )}
                  <StatCard
                    label={t("status.pending")}
                    value={String(stats.paid.pendingCount)}
                    valueClass="text-yellow-700"
                  />
                </StatGroup>
              )}

              {tab !== "PAID" && stats?.credit && (
                <StatGroup
                  title={t("purchases.modeCredit")}
                  accentClass="border-amber-400"
                >
                  <StatCard
                    label={t("purchases.creditTaken")}
                    value={fmtCurrency(stats.credit.totalTaken)}
                  />
                  <StatCard
                    label={t("purchases.creditPaidBack")}
                    value={fmtCurrency(stats.credit.totalPaidToVendor)}
                    valueClass="text-green-700"
                  />
                  <StatCard
                    label={t("purchases.creditOutstanding")}
                    value={fmtCurrency(stats.credit.totalRemainingToPay)}
                    valueClass="text-red-600"
                  />
                  {isOwner && (
                    <StatCard
                      label={t("purchases.recordedMargin")}
                      value={`~${fmtCurrency(creditMargin)}`}
                      valueClass={
                        creditMargin >= 0 ? "text-green-700" : "text-red-700"
                      }
                    />
                  )}
                  <StatCard
                    label={t("purchases.creditUnpaid")}
                    value={String(stats.credit.unpaidCount)}
                    valueClass="text-red-700"
                  />
                </StatGroup>
              )}

              {daySheet && (
                <StatGroup
                  title={t("purchases.tillTitle")}
                  accentClass="border-gray-300"
                >
                  <StatCard
                    label={t("purchases.openingCash")}
                    value={fmtCurrency(daySheet.opening)}
                  />
                  <StatCard
                    label={t("purchases.inflow")}
                    value={`+${fmtCurrency(daySheet.totalInflow)}`}
                    valueClass="text-green-700"
                  />
                  <StatCard
                    label={t("purchases.outflow")}
                    value={`-${fmtCurrency(daySheet.totalOutflow)}`}
                    valueClass="text-red-600"
                  />
                  <StatCard
                    label={t("purchases.closingCash")}
                    value={fmtCurrency(daySheet.closing)}
                  />
                </StatGroup>
              )}
            </div>
          )}
        </div>
      )}

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
