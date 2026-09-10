"use client";
import DateFilter, { getDateRange } from "@/app/components/DateFilter";
import FilterPanel from "@/app/components/FilterPanel";
import ActivityAuditReport from "@/app/components/ActivityAuditReport";
import FinancialBreakdown from "@/app/components/FinancialBreakdown";
import FinanceComparison from "@/app/components/FinanceComparison";
import ItemizedPerformanceTable from "@/app/components/ItemizedPerformanceTable";
import ProfitLossSummary from "@/app/components/ProfitLossSummary";
import HospitalityInventoryReport from "@/app/components/HospitalityInventoryReport";
import HospitalityReport from "@/app/components/HospitalityReport";
import ManufacturingReport from "@/app/components/ManufacturingReport";
import Modal from "@/app/components/Modal";
import SalesReport from "@/app/components/SalesReport";
import { useToast } from "@/app/components/ToastProvider";
import { useAuth } from "@/context/AuthContext";
import { variantLabel } from "@/lib/variantLabel";
import { getVerticalFeatures } from "@/lib/verticals";
import { useSingleLocationAutofill } from "@/lib/singleLocation";
import api from "@/lib/api";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "next/navigation";
import { Fragment, useEffect, useState } from "react";

type DatePreset = "today" | "week" | "month" | "year";

export default function ReportsPage() {
  const { t } = useTranslation();
  const { user, hasPermission, activeMembership } = useAuth();
  const toast = useToast();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") || "sales");
  const vertical = getVerticalFeatures(activeMembership?.businessType ?? user?.businessType ?? "");
  const isHospitality = !vertical.inventory;
  const businessType = activeMembership?.businessType ?? user?.businessType ?? "";
  const isManufacturing = businessType === "MANUFACTURING";
  const manufacturingTabs = [
    { id: "production", label: t("reports.tabProduction"), permission: "reports.full" },
    { id: "finance", label: t("reports.tabFinance"), permission: "finance.view" },
    { id: "inventory", label: t("reports.tabInventory"), permission: "reports.view" },
    { id: "low-stock", label: t("reports.tabLowStock"), permission: "reports.view" },
    { id: "dead-stock", label: t("reports.tabDeadStock"), permission: "reports.view" },
    { id: "audit-trail", label: t("reports.tabAudit"), permission: "reports.full" },
  ];
  const tabs = (isManufacturing
    ? manufacturingTabs
    : isHospitality
      ? [
          { id: "sales", label: t("reports.tabSalesOrders"), permission: "reports.full" },
          { id: "finance", label: t("reports.tabFinance"), permission: "finance.view" },
          { id: "inventory", label: t("reports.tabInventory"), permission: "reports.view" },
          { id: "activity", label: t("reports.tabActivity"), permission: "reports.full" },
          { id: "audit-trail", label: t("reports.tabAudit"), permission: "reports.full" },
        ]
      : [
          { id: "sales", label: t("reports.tabSalesProfit"), permission: "reports.full" },
          { id: "finance", label: t("reports.tabFinance"), permission: "finance.view" },
          { id: "inventory", label: t("reports.tabInventory"), permission: "reports.view" },
          { id: "low-stock", label: t("reports.tabLowStock"), permission: "reports.view" },
          { id: "dead-stock", label: t("reports.tabDeadStock"), permission: "reports.view" },
          { id: "audit-trail", label: t("reports.tabAudit"), permission: "reports.full" },
        ]
  ).filter((x) => hasPermission(x.permission));


  useEffect(() => {
    if (tabs.length === 0) return;
    if (!tabs.some((t) => t.id === tab)) {
      setTab(tabs[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, tab]);

  const [inventoryData, setInventoryData] = useState<any>({
    columns: [],
    rows: [],
  });
  // Expandable parent rows (Inventory / Low Stock / Dead Stock). Rows are keyed
  // by stable strings so the same product can be expanded independently per
  // report (dead stock legitimately repeats a product once per location).
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const toggleRow = (key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const [lowStock, setLowStock] = useState<any[]>([]);
  const [deadStock, setDeadStock] = useState<any[]>([]);
  const [auditTrail, setAuditTrail] = useState<any[]>([]);

  // shared filters
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [location, setLocation] = useState("");
  const [categories, setCategories] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  // Autofill the sole location when the business has only one.
  useSingleLocationAutofill(locations, location, setLocation);

  // date filters
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const [startDate, setStartDate] = useState(() => getDateRange("today").start);
  const [endDate, setEndDate] = useState(() => getDateRange("today").end);

  // Quick Request Modal
  const [showReqModal, setShowReqModal] = useState(false);
  const [stores, setStores] = useState<any[]>([]);
  const [reqForm, setReqForm] = useState({
    productId: "",
    productName: "",
    storeId: "",
    quantity: 1,
  });
  // Autofill the sole store for the quick-request form when only one exists.
  useSingleLocationAutofill(stores, reqForm.storeId, (v) =>
    setReqForm((f) => ({ ...f, storeId: v })),
  );

  const isOwner = user?.isSuperuser === true;
  const canViewFull = hasPermission("reports.full");
  // Cost + valuation columns/cards are only shown to roles that hold
  // reports.view_cost_valuation (owners by default; staff opt-in).
  const canViewCost = hasPermission("reports.view_cost_valuation");
  // Valuation columns/cards render only once the API confirms the caller may
  // see cost data (inventoryData.valuation), so they never flash empty zero
  // cells for roles that lack the permission on the backend.
  const showCostValuation = canViewCost && !!inventoryData.valuation;
  const valCols = showCostValuation ? 5 : 1;
  const fmtMoney = (n: any) =>
    Number(n ?? 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  useEffect(() => {
    if (isHospitality) return;
    api.get("/categories").then((r) => setCategories(r.data));
    if (isOwner) api.get("/locations").then((r) => setLocations(r.data));
    if (user?.locationType === "SHOP") {
      api
        .get("/locations")
        .then((r) => setStores(r.data.filter((l: any) => l.type === "STORE")));
    }
  }, [user, isOwner, isHospitality]);

  useEffect(() => {
    const query = `search=${search}&categoryId=${category}&locationId=${location}&startDate=${startDate}&endDate=${endDate}`;

    if (tab === "inventory" && !isHospitality) {
      api
        .get(`/reports/inventory-breakdown?${query}`)
        .then((r) => setInventoryData(r.data));
    } else if (tab === "sales" && canViewFull) {
      // handled by SalesReport / HospitalityReport components
    } else if (tab === "low-stock") {
      api.get(`/reports/low-stock?${query}`).then((r) => setLowStock(r.data));
    } else if (tab === "dead-stock") {
      api.get(`/reports/dead-stock?${query}`).then((r) => setDeadStock(r.data));
    } else if (tab === "audit-trail" && canViewFull) {
      api.get("/reports/audit-trail").then((r) => setAuditTrail(r.data));
    }
  }, [tab, search, category, location, startDate, endDate, canViewFull]);

  const handleQuickRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const storeId = reqForm.storeId ? Number(reqForm.storeId) : undefined;
      await api.post("/requests", {
        ...(storeId ? { storeId } : {}),
        items: [
          {
            productId: Number(reqForm.productId),
            quantityRequested: Number(reqForm.quantity),
          },
        ],
      });
      setShowReqModal(false);
      setReqForm({ productId: "", productName: "", storeId: "", quantity: 1 });
      toast.success(t("reports.requestSubmitted"));
    } catch {
      toast.error(t("reports.requestFailed"));
    }
  };

  const downloadFile = async (path: string, filename: string) => {
    try {
      const res = await api.get(path, { responseType: "blob" });
      const url = window.URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error(t("reports.exportFailed"));
    }
  };

  const fullQuery = `search=${search}&categoryId=${category}&locationId=${location}&startDate=${startDate}&endDate=${endDate}`;

  const exportCfg = (() => {
    const q = `search=${search}&categoryId=${category}&locationId=${location}`;
    const sq = `${q}&startDate=${startDate}&endDate=${endDate}`;
    switch (tab) {
      case "sales":
        return {
          label: t("reports.exportSales"),
          csv: `/reports/sales-summary/export?${sq}`,
          pdf: `/reports/sales-summary/pdf?${sq}`,
          csvName: "sales-profit.csv",
          pdfName: "sales-profit.pdf",
        };
      case "inventory":
        return {
          label: t("reports.tabInventory"),
          csv: `/reports/inventory-breakdown/export?${q}`,
          pdf: `/reports/inventory-breakdown/pdf?${q}`,
          csvName: "inventory-breakdown.csv",
          pdfName: "inventory-breakdown.pdf",
        };
      case "low-stock":
        return {
          label: t("reports.tabLowStock"),
          csv: `/reports/low-stock/export?${q}`,
          pdf: `/reports/low-stock/pdf?${q}`,
          csvName: "low-stock.csv",
          pdfName: "low-stock.pdf",
        };
      case "dead-stock":
        return {
          label: t("reports.tabDeadStock"),
          csv: `/reports/dead-stock/export?${q}`,
          pdf: `/reports/dead-stock/pdf?${q}`,
          csvName: "dead-stock.csv",
          pdfName: "dead-stock.pdf",
        };
      default:
        return null;
    }
  })();

  return (
    <div>
      <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800 mb-6">
        {t("reports.title")}
      </h1>

      {/* Tabs */}
      <div className="flex gap-0.5 sm:gap-1 mb-6 border-b overflow-x-auto pb-px">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-2.5 sm:px-4 py-2 sm:py-2.5 whitespace-nowrap text-xs sm:text-sm font-medium rounded-t-lg transition ${
              tab === t.id
                ? "bg-white text-blue-600 border border-b-white -mb-px shadow-sm"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filter Bar — common across all tabs except audit-trail */}
      {tab !== "audit-trail" &&
        (isHospitality ? (
          <div className="bg-white p-2 sm:p-4 rounded-xl shadow-sm border mb-4 sm:mb-6">
            <DateFilter
              preset={datePreset}
              onPresetChange={setDatePreset}
              startDate={startDate}
              onStartDateChange={setStartDate}
              endDate={endDate}
              onEndDateChange={setEndDate}
            />
          </div>
        ) : (
          <FilterPanel
            showDateFilter={tab === "sales" || tab === "production" || tab === "finance" || tab === "inventory"}
            datePreset={datePreset}
            onDatePresetChange={setDatePreset}
            startDate={startDate}
            onStartDateChange={setStartDate}
            endDate={endDate}
            onEndDateChange={setEndDate}
            search={search}
            onSearchChange={setSearch}
            category={category}
            onCategoryChange={setCategory}
            categories={categories}
            location={location}
            onLocationChange={setLocation}
            locations={locations}
            showLocation={isOwner}
          />
        ))}

      {/* Export buttons — Sale/inventory-based exports don't apply to hospitality */}
      {!isHospitality && (
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-sm text-gray-500">{t("reports.exportColon")}</span>
        {exportCfg && (
          <>
            <button
              onClick={() => downloadFile(exportCfg.csv, exportCfg.csvName)}
              className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              {t("reports.exportCsv", { label: exportCfg.label })}
            </button>
            <button
              onClick={() => downloadFile(exportCfg.pdf, exportCfg.pdfName)}
              className="bg-red-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-red-700"
            >
              {t("reports.exportPdf", { label: exportCfg.label })}
            </button>
          </>
        )}
        {isOwner && (
          <>
            <span className="mx-1 text-gray-300">|</span>
            <button
              onClick={() =>
                downloadFile(`/reports/full/export?${fullQuery}`, "full-report.csv")
              }
              className="bg-gray-800 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-gray-700"
            >
              {t("reports.exportAllCsv")}
            </button>
            <button
              onClick={() =>
                downloadFile(`/reports/full/pdf?${fullQuery}`, "full-report.pdf")
              }
              className="bg-gray-800 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-gray-700"
            >
              {t("reports.exportAllPdf")}
            </button>
          </>
        )}
      </div>
      )}

      {/* PRODUCTION */}
      {tab === "production" && (
        <ManufacturingReport
          startDate={startDate}
          endDate={endDate}
          locationId={location ? Number(location) : undefined}
        />
      )}

      {/* FINANCE */}
      {tab === "finance" && (
        <div className="space-y-6">
          <ProfitLossSummary startDate={startDate} endDate={endDate} />
          <ItemizedPerformanceTable
            startDate={startDate}
            endDate={endDate}
            businessType={activeMembership?.businessType ?? user?.businessType ?? ""}
            locationId={location || undefined}
          />
          <FinancialBreakdown
            startDate={startDate}
            endDate={endDate}
            businessType={activeMembership?.businessType ?? user?.businessType ?? ""}
            locationId={location || undefined}
          />
          <FinanceComparison
            startDate={startDate}
            endDate={endDate}
            locationId={location || undefined}
          />
        </div>
      )}


      {tab === "inventory" && isHospitality && (
        <HospitalityInventoryReport
          startDate={startDate}
          endDate={endDate}
          locationId={location || undefined}
        />
      )}

      {tab === "inventory" && !isHospitality && (
        <>
          {canViewCost && inventoryData.valuation && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <div className="bg-white rounded-xl border shadow-sm p-4">
                <p className="text-[11px] font-medium text-gray-500 uppercase">
                  {t("reports.cardCost")}
                </p>
                <p className="text-lg font-bold text-gray-800 mt-1">
                  {fmtMoney(inventoryData.valuation.grandTotalBuyingValue)}
                </p>
              </div>
              <div className="bg-white rounded-xl border shadow-sm p-4">
                <p className="text-[11px] font-medium text-gray-500 uppercase">
                  {t("reports.cardValue")}
                </p>
                <p className="text-lg font-bold text-gray-800 mt-1">
                  {fmtMoney(inventoryData.valuation.grandTotalSellingValue)}
                </p>
              </div>
              <div className="bg-white rounded-xl border shadow-sm p-4">
                <p className="text-[11px] font-medium text-gray-500 uppercase">
                  {t("reports.cardProfit")}
                </p>
                <p className="text-lg font-bold text-green-700 mt-1">
                  {fmtMoney(inventoryData.valuation.potentialGrossProfit)}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {inventoryData.valuation.potentialMarginPct}%{" "}
                  {t("reports.cardMarginPct")}
                </p>
              </div>
            </div>
          )}
          <div className="bg-white rounded-xl shadow-sm border overflow-x-auto w-full">
          <table className="w-full text-left text-sm min-w-[1200px] whitespace-nowrap">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="p-2 sm:p-3 md:p-4">{t("reports.product")}</th>
                <th className="p-2 sm:p-3 md:p-4 text-center">{t("reports.total")}</th>
                {inventoryData.columns?.map((col: string) => (
                  <th key={col} className="p-2 sm:p-3 md:p-4 text-center">
                    {col}
                  </th>
                ))}
                <th className="p-2 sm:p-3 md:p-4 text-right">
                  {t("reports.colSellPrice")}
                </th>
                {showCostValuation && (
                  <>
                    <th className="p-2 sm:p-3 md:p-4 text-right">
                      {t("reports.colBuyPrice")}
                    </th>
                    <th className="p-2 sm:p-3 md:p-4 text-right">
                      {t("reports.colBuyTotal")}
                    </th>
                    <th className="p-2 sm:p-3 md:p-4 text-right">
                      {t("reports.colSellTotal")}
                    </th>
                    <th className="p-2 sm:p-3 md:p-4 text-right">
                      {t("reports.colProfit")}
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {inventoryData.rows?.map((r: any, i: number) => {
                const productId = r.productId ?? i;
                const expanded = expandedRows.has(String(productId));
                const hasVariantDetail =
                  Array.isArray(r.variants) && r.variants.length > 0;
                return (
                  <Fragment key={productId}>
                    <tr
                      className={
                        "border-b hover:bg-gray-50" +
                        (hasVariantDetail ? " cursor-pointer" : "")
                      }
                      onClick={() =>
                        hasVariantDetail && toggleRow(String(productId))
                      }
                    >
                      <td className="p-2 sm:p-3 md:p-4 font-medium">
                        {hasVariantDetail && (
                          <span className="mr-1 text-gray-400">
                            {expanded ? "▾" : "▸"}
                          </span>
                        )}
                        {r.productName}
                        <span className="block text-[10px] sm:text-xs text-gray-400">
                          {r.category}
                        </span>
                      </td>
                      <td
                        className={`p-2 sm:p-3 md:p-4 text-center font-bold ${r.total < 10 ? "text-red-500" : "text-blue-600"}`}
                      >
                        {r.total}
                      </td>
                      {inventoryData.columns?.map((col: string) => (
                        <td key={col} className="p-2 sm:p-3 md:p-4 text-center text-gray-600">
                          {r.locations[col] || 0}
                        </td>
                      ))}
                      <td className="p-2 sm:p-3 md:p-4 text-right text-gray-700">
                        {fmtMoney(r.unitSellPrice)}
                      </td>
                      {showCostValuation && (
                        <>
                          <td className="p-2 sm:p-3 md:p-4 text-right text-gray-700">
                            {fmtMoney(r.unitBuyPrice)}
                          </td>
                          <td className="p-2 sm:p-3 md:p-4 text-right text-gray-700">
                            {fmtMoney(r.buyTotal)}
                          </td>
                          <td className="p-2 sm:p-3 md:p-4 text-right text-gray-700">
                            {fmtMoney(r.sellTotal)}
                          </td>
                          <td className="p-2 sm:p-3 md:p-4 text-right text-green-700">
                            {fmtMoney(r.estimatedProfit)}
                          </td>
                        </>
                      )}
                    </tr>
                    {expanded && (
                      <tr className="bg-gray-50">
                        <td
                          colSpan={inventoryData.columns?.length + 2 + valCols}
                          className="p-2 sm:p-3 md:p-4"
                        >
                          <table className="w-full text-xs whitespace-nowrap">
                            <thead>
                              <tr className="text-gray-400">
                                <th className="text-left p-1 font-medium">
                                  {t("reports.variant")}
                                </th>
                                <th className="text-right p-1 font-medium">
                                  {t("reports.total")}
                                </th>
                                {inventoryData.columns?.map((col: string) => (
                                  <th
                                    key={col}
                                    className="text-right p-1 font-medium"
                                  >
                                    {col}
                                  </th>
                                ))}
                                <th className="text-right p-1 font-medium">
                                  {t("reports.colSellPrice")}
                                </th>
                                {showCostValuation && (
                                  <>
                                    <th className="text-right p-1 font-medium">
                                      {t("reports.colBuyPrice")}
                                    </th>
                                    <th className="text-right p-1 font-medium">
                                      {t("reports.colBuyTotal")}
                                    </th>
                                    <th className="text-right p-1 font-medium">
                                      {t("reports.colSellTotal")}
                                    </th>
                                    <th className="text-right p-1 font-medium">
                                      {t("reports.colProfit")}
                                    </th>
                                  </>
                                )}
                              </tr>
                            </thead>
                            <tbody>
                              {r.variants.map((vr: any, vIdx: number) => (
                                <tr
                                  key={vIdx}
                                  className="border-t border-gray-200"
                                >
                                  <td className="p-1">
                                    {variantLabel({
                                      attributes: vr.attributes,
                                      sku: vr.sku,
                                    }) || t("reports.standard")}
                                  </td>
                                  <td className="p-1 text-right font-semibold">
                                    {vr.quantity}
                                  </td>
                                  {inventoryData.columns?.map((col: string) => (
                                    <td
                                      key={col}
                                      className="p-1 text-right text-gray-600"
                                    >
                                      {vr.locations?.[col] || 0}
                                    </td>
                                  ))}
                                  <td className="p-1 text-right text-gray-600">
                                    {fmtMoney(vr.unitSellPrice)}
                                  </td>
                                  {showCostValuation && (
                                    <>
                                      <td className="p-1 text-right text-gray-600">
                                        {fmtMoney(vr.unitBuyPrice)}
                                      </td>
                                      <td className="p-1 text-right text-gray-600">
                                        {fmtMoney(vr.buyTotal)}
                                      </td>
                                      <td className="p-1 text-right text-gray-600">
                                        {fmtMoney(vr.sellTotal)}
                                      </td>
                                      <td className="p-1 text-right text-green-700">
                                        {fmtMoney(vr.estimatedProfit)}
                                      </td>
                                    </>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {inventoryData.rows?.length === 0 && (
                <tr>
                  <td colSpan={99} className="p-4 sm:p-6 text-center text-gray-400 text-xs sm:text-sm">
                    {t("reports.noProductsFound")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* SALES */}      {tab === "sales" &&
        canViewFull &&
        (isHospitality ? (
          <div className="space-y-6">
            {hasPermission("finance.view") && (
              <ProfitLossSummary startDate={startDate} endDate={endDate} />
            )}
            <HospitalityReport startDate={startDate} endDate={endDate} />
          </div>
        ) : (
          <SalesReport
            startDate={startDate}
            endDate={endDate}
            categoryId={category}
            locationId={location}
            search={search}
          />
        ))}
      {tab === "low-stock" && (
        <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="p-2 sm:p-3 md:p-4">{t("reports.product")}</th>
                {isOwner && <th className="p-2 sm:p-3 md:p-4">{t("reports.location")}</th>}
                <th className="p-2 sm:p-3 md:p-4 text-center">{t("reports.stock")}</th>
                {user?.locationType === "SHOP" && (
                  <th className="p-2 sm:p-3 md:p-4 text-right">{t("reports.action")}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {lowStock.map((r: any) => {
                const key = `low:${r.id}`;
                const expanded = expandedRows.has(key);
                const hasDetail =
                  Array.isArray(r.variants) && r.variants.length > 0;
                const colCount =
                  1 +
                  (isOwner ? 1 : 0) +
                  1 +
                  (user?.locationType === "SHOP" ? 1 : 0);
                return (
                  <Fragment key={key}>
                    <tr
                      className={
                        "border-b hover:bg-gray-50" +
                        (hasDetail ? " cursor-pointer" : "")
                      }
                      onClick={() => hasDetail && toggleRow(key)}
                    >
                      <td className="p-2 sm:p-3 md:p-4 font-medium">
                        {hasDetail && (
                          <span className="mr-1 text-gray-400">
                            {expanded ? "▾" : "▸"}
                          </span>
                        )}
                        {r.name}
                      </td>
                      {isOwner && (
                        <td className="p-2 sm:p-3 md:p-4 text-gray-500 text-xs sm:text-sm">
                          {r.locationName || "—"}
                        </td>
                      )}
                      <td className="p-2 sm:p-3 md:p-4 text-center text-red-500 font-bold">
                        {r.total}
                      </td>
                      {user?.locationType === "SHOP" && (
                        <td className="p-2 sm:p-3 md:p-4 text-right">
                          {r.requestedStatus ? (
                            <span className="text-[10px] sm:text-xs bg-yellow-100 text-yellow-800 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full font-medium">
                              {r.requestedStatus}
                            </span>
                          ) : (
                            <button
                              onClick={() => {
                                setReqForm({
                                  productId: r.id,
                                  productName: r.name,
                                  storeId: "",
                                  quantity: 1,
                                });
                                setShowReqModal(true);
                              }}
                              className="bg-blue-600 text-white px-2 sm:px-3 py-1 sm:py-1.5 text-xs rounded-lg hover:bg-blue-700 font-medium"
                            >
                              {t("reports.requestStockBtn")}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                    {expanded && hasDetail && (
                      <tr className="bg-gray-50">
                        <td colSpan={colCount} className="p-2 sm:p-3 md:p-4">
                          <table className="w-full text-xs whitespace-nowrap">
                            <thead>
                              <tr className="text-gray-400">
                                <th className="text-left p-1 font-medium">
                                  {t("reports.variant")}
                                </th>
                                <th className="text-right p-1 font-medium">
                                  {t("reports.stock")}
                                </th>
                                {isOwner && (
                                  <th className="text-right p-1 font-medium">
                                    {t("reports.location")}
                                  </th>
                                )}
                              </tr>
                            </thead>
                            <tbody>
                              {r.variants.map((vr: any, vIdx: number) => (
                                <tr
                                  key={vIdx}
                                  className="border-t border-gray-200"
                                >
                                  <td className="p-1">
                                    {variantLabel({
                                      attributes: vr.attributes,
                                      sku: vr.sku,
                                    }) || t("reports.standard")}
                                  </td>
                                  <td className="p-1 text-right font-semibold">
                                    {vr.quantity}
                                  </td>
                                  {isOwner && (
                                    <td className="p-1 text-right text-gray-600">
                                      {(vr.locations ?? []).join(", ") || "—"}
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {lowStock.length === 0 && (
                <tr>
                  <td
                    colSpan={
                      1 +
                      (isOwner ? 1 : 0) +
                      1 +
                      (user?.locationType === "SHOP" ? 1 : 0)
                    }
                    className="p-4 sm:p-6 text-center text-gray-400 text-xs sm:text-sm"
                  >
                    {t("reports.allHealthy")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* DEAD STOCK */}
      {tab === "dead-stock" && (
        <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="p-2 sm:p-3 md:p-4">{t("reports.product")}</th>
                {isOwner && <th className="p-2 sm:p-3 md:p-4">{t("reports.location")}</th>}
                <th className="p-2 sm:p-3 md:p-4">{t("reports.status")}</th>
              </tr>
            </thead>
            <tbody>
              {deadStock.map((r: any) => {
                const key = `dead:${r.id}:${r.locationId ?? 0}`;
                const expanded = expandedRows.has(key);
                const hasDetail =
                  Array.isArray(r.variants) && r.variants.length > 0;
                const colCount = 1 + (isOwner ? 1 : 0) + 1;
                return (
                  <Fragment key={key}>
                    <tr
                      className={
                        "border-b hover:bg-gray-50" +
                        (hasDetail ? " cursor-pointer" : "")
                      }
                      onClick={() => hasDetail && toggleRow(key)}
                    >
                      <td className="p-2 sm:p-3 md:p-4 font-medium">
                        {hasDetail && (
                          <span className="mr-1 text-gray-400">
                            {expanded ? "▾" : "▸"}
                          </span>
                        )}
                        {r.name}
                      </td>
                      {isOwner && (
                        <td className="p-2 sm:p-3 md:p-4 text-gray-500 text-xs sm:text-sm">
                          {r.locationName || "—"}
                        </td>
                      )}
                      <td className="p-2 sm:p-3 md:p-4">
                        <span className="text-[10px] sm:text-xs bg-red-100 text-red-700 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full font-medium">
                          {t("reports.deadReason")}
                        </span>
                      </td>
                    </tr>
                    {expanded && hasDetail && (
                      <tr className="bg-gray-50">
                        <td colSpan={colCount} className="p-2 sm:p-3 md:p-4">
                          <table className="w-full text-xs whitespace-nowrap">
                            <thead>
                              <tr className="text-gray-400">
                                <th className="text-left p-1 font-medium">
                                  {t("reports.variant")}
                                </th>
                                <th className="text-right p-1 font-medium">
                                  {t("reports.stock")}
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.variants.map((vr: any, vIdx: number) => (
                                <tr
                                  key={vIdx}
                                  className="border-t border-gray-200"
                                >
                                  <td className="p-1">
                                    {variantLabel({
                                      attributes: vr.attributes,
                                      sku: vr.sku,
                                    }) || t("reports.standard")}
                                  </td>
                                  <td className="p-1 text-right font-semibold">
                                    {vr.quantity}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {deadStock.length === 0 && (
                <tr>
                  <td
                    colSpan={1 + (isOwner ? 1 : 0) + 1}
                    className="p-4 sm:p-6 text-center text-gray-400 text-xs sm:text-sm"
                  >
                    {t("reports.noDeadStock")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* STAFF & STATION ACTIVITY AUDIT */}
      {tab === "activity" && canViewFull && (
        <ActivityAuditReport startDate={startDate} endDate={endDate} />
      )}

      {/* AUDIT TRAIL */}
      {tab === "audit-trail" && canViewFull && (
        <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
          <table className="w-full text-left min-w-[500px] sm:min-w-[600px] text-xs sm:text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="p-2 sm:p-3 md:p-4">{t("reports.dateTime")}</th>
                <th className="p-2 sm:p-3 md:p-4">{t("reports.user")}</th>
                <th className="p-2 sm:p-3 md:p-4">{t("reports.action")}</th>
                <th className="p-2 sm:p-3 md:p-4">{t("reports.details")}</th>
              </tr>
            </thead>
            <tbody>
              {auditTrail.map((log: any) => (
                <tr key={log.id} className="border-b hover:bg-gray-50">
                  <td className="p-2 sm:p-3 md:p-4 text-gray-500 whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="p-2 sm:p-3 md:p-4 font-medium">
                    {log.user?.name || t("reports.system")}
                  </td>
                  <td className="p-2 sm:p-3 md:p-4">
                    <span className="bg-blue-100 text-blue-800 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded text-[10px] sm:text-xs font-semibold">
                      {log.action}
                    </span>
                  </td>
                  <td className="p-2 sm:p-3 md:p-4 text-gray-700">{log.details}</td>
                </tr>
              ))}
              {auditTrail.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-4 sm:p-6 text-center text-gray-400 text-xs sm:text-sm">
                    {t("reports.noActivity")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Quick Request Modal */}
      <Modal
        isOpen={showReqModal}
        onClose={() => setShowReqModal(false)}
        title={t("reports.requestStockTitle")}
      >
        <form onSubmit={handleQuickRequest} className="grid grid-cols-1 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("reports.productLabel")}
            </label>
            <input
              value={reqForm.productName}
              disabled
              className="border p-2 rounded-lg w-full bg-gray-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("reports.storeLabel")}
            </label>
            {stores.length === 0 ? (
              <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-3">
                {t("reports.storeNonePre")}
                <b>{t("reports.storeNoneBold")}</b>
                {t("reports.storeNonePost")}
              </p>
            ) : (
              <select
                value={reqForm.storeId}
                onChange={(e) =>
                  setReqForm({ ...reqForm, storeId: e.target.value })
                }
                className="border p-2 rounded-lg w-full bg-white"
                required
              >
                <option value="">{t("reports.selectStore")}</option>
                {stores.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("reports.quantity")}
            </label>
            <input
              type="number"
              min="1"
              value={reqForm.quantity}
              onChange={(e) =>
                setReqForm({ ...reqForm, quantity: Number(e.target.value) })
              }
              className="border p-2 rounded-lg w-full"
              required
            />
          </div>
          <button
            type="submit"
            className="bg-green-600 text-white p-2 rounded-lg mt-2 font-medium"
          >
            {t("reports.submitRequest")}
          </button>
        </form>
      </Modal>
    </div>
  );
}
