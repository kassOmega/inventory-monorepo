"use client";
import CategoriesManager from "@/app/components/CategoriesManager";
import CollapsibleFilterPanel from "@/app/components/CollapsibleFilterPanel";
import { useConfirm } from "@/app/components/ConfirmProvider";
import Loading from "@/app/components/Loading";
import Modal from "@/app/components/Modal";
import Pagination from "@/app/components/Pagination";
import PriceListModal from "@/app/components/PriceListModal";
import ProductDetailModal from "@/app/components/ProductDetailModal";
import ProductForm from "@/app/components/ProductForm";
import RowActionsMenu from "@/app/components/RowActionsMenu";
import StockCountModal from "@/app/components/StockCountModal";
import { useToast } from "@/app/components/ToastProvider";
import { useAuth } from "@/context/AuthContext";
import api, { markHandled } from "@/lib/api";
import { fmtCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/datetime";
import {
  buildQrLabelPdf,
  qrLabelFileName,
  qrPngDataUrls,
  type QrLabel,
} from "@/lib/qrLabelPdf";
import { canShareFiles, shareFile } from "@/lib/shareFile";
import { statusLabel } from "@/lib/statusLabel";
import useServerPaging from "@/lib/useServerPaging";
import useDebouncedValue from "@/lib/useDebouncedValue";
import { variantLabel } from "@/lib/variantLabel";
import { ChevronDown, ChevronRight, Share2 } from "lucide-react";
import Link from "next/link";
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

export default function ProductsPage() {
  const { t } = useTranslation();
  const { user, hasPermission } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const paged = useServerPaging({ pageSize: 20 });

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [locations, setLocations] = useState<any[]>([]);
  /** The item the Adjust modal is open on (null = closed). */
  const [counting, setCounting] = useState<{
    productId: number;
    variantId?: string | number;
  } | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [showPriceListModal, setShowPriceListModal] = useState(false);
  const [qrProduct, setQrProduct] = useState<any>(null);
  const [tab, setTab] = useState<"products" | "categories">("products");
  const [loading, setLoading] = useState(true);
  const [detailProduct, setDetailProduct] = useState<any>(null);
  /** True while a label sheet is being built (Share/Download in the QR modal). */
  const [qrPdfBusy, setQrPdfBusy] = useState(false);
  /** Off-screen canvases, rendered only to rasterise the codes for the PDF. */
  const qrCanvasRef = useRef<HTMLDivElement | null>(null);
  // Asked once: file sharing exists only on some platforms, and it decides
  // whether a Share button is offered next to the Print/Download actions.
  const shareSupported = useMemo(() => canShareFiles(), []);

  /**
   * Every QR label for the open product: its own label first, then one per
   * variant. This single list feeds the on-screen cards, the print portal and
   * the PDF, so all three always carry the same set of labels.
   */
  const qrLabels: QrLabel[] = useMemo(() => {
    if (!qrProduct) return [];
    const labels: QrLabel[] = [
      {
        key: String(qrProduct.id),
        sku: qrProduct.sku || "",
        name: `${qrProduct.brand ?? ""} ${qrProduct.baseName ?? ""}`.trim(),
        barcode: qrProduct.barcode ?? "",
      },
    ];
    for (const v of qrProduct.variants ?? []) {
      labels.push({
        key: `${qrProduct.id}-${v.id}`,
        sku: v.sku || "",
        name: variantLabel(v),
        barcode: v.barcode ?? "",
      });
    }
    return labels;
  }, [qrProduct]);

  const fetchProducts = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api.get(
        `/products?search=${debouncedSearch}&categoryId=${categoryFilter}&page=${paged.page}&pageSize=${paged.pageSize}`,
      );
      const body = res.data;
      const rows = Array.isArray(body) ? body : (body?.data ?? []);
      setProducts(rows);
      paged.setTotal(
        Array.isArray(body) ? rows.length : (body?.total ?? rows.length),
      );
    } finally {
      // Always clear loading (silent fetches skip showing the spinner but still
      // must resolve the initial loading state).
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    const res = await api.get("/categories");
    setCategories(res.data);
  };

  // Debounce the search input so we don't fire an API request on every
  // keystroke (and never unmount the page mid-typing).
  const debouncedSearch = useDebouncedValue(search, 300);

  // Reset to page 1 when the search/category filters change, then refetch.
  const prodFilterSig = `${debouncedSearch}|${categoryFilter}`;
  const prodFilterRef = useRef(prodFilterSig);
  useEffect(() => {
    if (prodFilterRef.current !== prodFilterSig) {
      prodFilterRef.current = prodFilterSig;
      if (paged.page !== 1) {
        paged.setPage(1);
        return;
      }
    }
    fetchProducts(true);
    fetchCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prodFilterSig, paged.page, paged.pageSize]);

  // Silent auto-refresh every 5s + on focus: keeps stock counts current so a
  // restock/request confirmation (or any stock movement) shows up here without
  // a manual page reload.
  const productsFetchRef = useRef(fetchProducts);
  useEffect(() => {
    productsFetchRef.current = fetchProducts;
  }, [fetchProducts]);
  useEffect(() => {
    const id = setInterval(() => productsFetchRef.current(true), 5000);
    const onVisibility = () => {
      if (document.visibilityState === "visible")
        productsFetchRef.current(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, []);

  const startEdit = (p: any) => {
    setEditing(p);
    setShowEditModal(true);
  };

  const canCreate = hasPermission("products.create");
  const canEdit = hasPermission("products.edit");
  const canDelete = hasPermission("products.delete");
  const canAdjust = hasPermission("products.adjust-stock");
  // Cost / profit visibility is RBAC-gated (owners and roles with the
  // sales.view-profit permission see Buy Price + margin; everyone else sees
  // only retail/selling prices).
  const canViewProfit = hasPermission("sales.view-profit");
  // The Actions column only exists when the user may act on a row, so expanded
  // rows and empty states must span exactly this many columns.
  const tableColCount = 6 + (canEdit || canDelete || canAdjust ? 1 : 0);
  // Expandable variant subtable rows (per-product detail incl. prices).
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleRow = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /**
   * Calculate total stock for a product from its inventory array.
   */
  const getTotalStock = (product: any): number => {
    if (!product.inventory || product.inventory.length === 0) return 0;
    return product.inventory.reduce(
      (sum: number, inv: any) => sum + inv.quantity,
      0,
    );
  };

  useEffect(() => {
    if (!canAdjust) return;
    api.get("/locations").then((res) => {
      const locs = res.data;
      if (user?.locationType === "STORE") {
        setLocations(locs.filter((l: any) => l.id === user.locationId));
      } else {
        setLocations(locs);
      }
    });
  }, [canAdjust, user]);

  /**
   * "Adjust" opens the count modal on this item: its card is pre-loaded with
   * today's numbers (left untouched) and the clicked variant focused, and more
   * items can be added inside the modal before a single save.
   */
  const openCountModal = (p: any, variantId?: number | string) => {
    setCounting({
      productId: Number(p.id),
      variantId:
        variantId !== undefined && variantId !== null && variantId !== ""
          ? variantId
          : undefined,
    });
  };

  const handleDelete = async (p: any) => {
    const ok = await confirm(
      t("products.deleteConfirm", { name: `${p.brand} ${p.baseName}` }),
    );
    if (!ok) return;
    try {
      await api.delete(`/products/${p.id}`);
      toast.success(t("products.productDeleted"));
      fetchProducts();
    } catch (err: any) {
      markHandled(err);
      toast.error(
        err.response?.data?.message || t("products.failedDeleteProduct"),
      );
    }
  };

  const startQr = (p: any) => {
    setQrProduct(p);
    setShowQrModal(true);
  };

  /**
   * Build the label sheet and hand it over: "download" saves the PDF, "share"
   * passes the same bytes to the OS share sheet without saving anything. Both
   * paths use one rasterisation pass over the same label list, so they cannot
   * drift apart. A dismissed share sheet closes quietly — cancelling is not a
   * failure.
   */
  const handleQrPdf = async (action: "download" | "share") => {
    if (qrLabels.length === 0) return;
    setQrPdfBusy(true);
    try {
      const doc = await buildQrLabelPdf({
        labels: qrLabels,
        // Document text is drawn with the built-in Helvetica font, which has no
        // Ethiopic glyphs, so the sheet takes the Latin-only strings from
        // `qrSheet` while the modal and the print sheet use the localized ones.
        title: t("products.qrSheet.docTitle"),
        // The same "Generated on <date>" line as the price list.
        generatedOnLabel: t("products.priceList.generatedOn", {
          date: formatDate(new Date().toISOString(), "en"),
        }),
        barcodePrefix: t("products.qrSheet.barcodeLabel"),
        images: qrPngDataUrls(qrCanvasRef.current),
      });
      const fileName = qrLabelFileName();
      if (action === "share") {
        // Memory to share sheet, never to the file system.
        const file = new File([doc.output("blob")], fileName, {
          type: "application/pdf",
        });
        const outcome = await shareFile(file, t("products.productQrCodes"));
        if (outcome === "shared") toast.success(t("products.qrShared"));
        return;
      }
      doc.save(fileName);
      toast.success(t("products.qrPdfDownloaded"));
    } catch (err) {
      markHandled(err);
      toast.error(
        t(action === "share" ? "products.shareFailed" : "products.qrPdfFailed"),
      );
    } finally {
      setQrPdfBusy(false);
    }
  };

  if (loading) return <Loading className="py-24" />;

  return (
    <div>
      <div className="flex justify-between items-start md:items-center mb-6 gap-3">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">
          {t("products.title")}
        </h1>
        {tab === "products" && (
          <div className="flex items-center gap-2">
            {/* Customer-facing sheet of selling prices — no cost data is printed,
                so this needs no extra permission beyond viewing the catalog. */}
            <button
              type="button"
              onClick={() => setShowPriceListModal(true)}
              className="border border-blue-600 text-blue-600 px-4 py-2 rounded-lg whitespace-nowrap text-sm"
            >
              {t("products.priceList.generate")}
            </button>
            {canCreate && (
              <button
                onClick={() => setShowAddModal(true)}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg whitespace-nowrap text-sm"
              >
                + {t("common.add")}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-2 mb-6">
        <button
          type="button"
          onClick={() => setTab("products")}
          className={
            "px-4 py-2 rounded text-sm " +
            (tab === "products"
              ? "bg-blue-600 text-white"
              : "bg-gray-200 text-gray-600")
          }
        >
          {t("products.tabProducts")}
        </button>
        <button
          type="button"
          onClick={() => setTab("categories")}
          className={
            "px-4 py-2 rounded text-sm " +
            (tab === "categories"
              ? "bg-blue-600 text-white"
              : "bg-gray-200 text-gray-600")
          }
        >
          {t("products.tabCategories")}
        </button>
      </div>

      {tab === "categories" ? (
        <CategoriesManager />
      ) : (
        <>
          {/* The shared Sales-style filter panel, collapsible (starts expanded).
              The Stock Count link is an action, not a filter, so it stays out. */}
          {canAdjust && (
            <div className="flex justify-end mb-2">
              <Link
                href="/dashboard/adjust-stock"
                className="border border-blue-600 text-blue-700 rounded-lg px-3 py-2 text-sm whitespace-nowrap hover:bg-blue-50"
              >
                {t("nav.stockCount")}
              </Link>
            </div>
          )}
          <CollapsibleFilterPanel
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder={t("products.searchPlaceholder")}
            category={categoryFilter}
            onCategoryChange={setCategoryFilter}
            categories={categories}
          />

          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[720px] sm:min-w-[880px] text-xs sm:text-sm whitespace-nowrap">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="p-2 sm:p-3 md:p-4">{t("products.sku")}</th>
                    <th className="p-2 sm:p-3 md:p-4">{t("products.brand")}</th>
                    <th className="p-2 sm:p-3 md:p-4">{t("products.name")}</th>
                    <th className="p-2 sm:p-3 md:p-4">
                      {t("products.category")}
                    </th>
                    <th className="p-2 sm:p-3 md:p-4">{t("products.stock")}</th>
                    <th className="p-2 sm:p-3 md:p-4">{t("products.qr")}</th>
                    {(canEdit || canDelete || canAdjust) && (
                      <th className="p-2 sm:p-3 md:p-4">
                        {t("common.actions")}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {products.map((p: any) => {
                    const stock = getTotalStock(p);
                    return (
                      <Fragment key={p.id}>
                        <tr
                          onClick={() => setDetailProduct(p)}
                          className="border-b hover:bg-gray-50 cursor-pointer"
                        >
                          <td className="p-2 sm:p-3 md:p-4 flex items-left">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleRow(String(p.id));
                              }}
                              className="mr-1.5 px-[8px] text-gray-400 cursor-pointer align-middle"
                              title={
                                expandedIds.has(String(p.id))
                                  ? t("products.collapseVariants")
                                  : t("products.expandVariants")
                              }
                            >
                              {expandedIds.has(String(p.id)) ? (
                                <ChevronDown className="w-4 h-4" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                            </button>
                            {/* Internal codes can be long: keep each row on one line
                          and ellipsise instead of wrapping the table. */}
                            <span
                              className="inline-block max-w-[9rem] truncate align-middle font-mono text-xs sm:text-sm"
                              title={p.sku ?? ""}
                            >
                              {p.sku}
                            </span>
                          </td>
                          <td className="p-2 sm:p-3 md:p-4 text-gray-600">
                            {p.brand || t("common.notAvailable")}
                          </td>
                          <td className="p-2 sm:p-3 md:p-4 font-medium">
                            {p.baseName}
                            {p.kind && p.kind !== "GOODS" && (
                              <span className="ml-1 text-[10px] text-blue-600">
                                {statusLabel(p.kind)}
                              </span>
                            )}
                          </td>
                          <td className="p-2 sm:p-3 md:p-4">
                            <span className="bg-gray-100 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded text-[10px] sm:text-xs">
                              {p.category?.name || t("common.notAvailable")}
                            </span>
                          </td>
                          <td className="p-2 sm:p-3 md:p-4">
                            <span
                              className={`font-bold text-xs sm:text-sm ${stock < 10 ? "text-red-500" : "text-gray-800"}`}
                            >
                              {stock}
                            </span>
                          </td>
                          <td className="p-2 sm:p-3 md:p-4">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                startQr(p);
                              }}
                              className="text-gray-600 text-xs sm:text-sm cursor-pointer"
                            >
                              {t("products.qr")}
                            </button>
                          </td>
                          {(canEdit || canDelete || canAdjust) && (
                            <td className="p-2 sm:p-3 md:p-4">
                              <RowActionsMenu
                                items={[
                                  {
                                    label: t("products.viewDetails"),
                                    onClick: () => setDetailProduct(p),
                                  },
                                  ...(canEdit
                                    ? [
                                        {
                                          label: t("common.edit"),
                                          onClick: () => startEdit(p),
                                        },
                                      ]
                                    : []),
                                  ...(canAdjust
                                    ? [
                                        {
                                          label: t("products.adjust"),
                                          color: "text-green-600",
                                          onClick: () => openCountModal(p),
                                        },
                                      ]
                                    : []),
                                  ...(canDelete
                                    ? [
                                        {
                                          label: t("common.delete"),
                                          color: "text-red-500",
                                          onClick: () => handleDelete(p),
                                        },
                                      ]
                                    : []),
                                ]}
                              />
                            </td>
                          )}
                        </tr>
                        {expandedIds.has(String(p.id)) && (
                          <tr
                            key={`${p.id}-variants`}
                            className="bg-slate-50/60"
                          >
                            <td
                              colSpan={tableColCount}
                              className="p-2 sm:p-3 md:p-4 pl-8 sm:pl-12"
                            >
                              {(p.variants ?? []).length === 0 ? (
                                /* No variants: the product itself is the single row,
                             laid out in the same table the variant products use
                             below — same columns in the same order, named for a
                             product (its own SKU rather than a variant's).
                             Specifications live in the details modal only. */
                                <table className="w-full bg-slate-50/60 text-xs whitespace-nowrap">
                                  <thead>
                                    <tr className="text-gray-400">
                                      <th className="text-left p-1 font-medium">
                                        {t("products.sku")}
                                      </th>
                                      <th className="text-left p-1 font-medium">
                                        {t("products.barcode")}
                                      </th>
                                      {canViewProfit && (
                                        <th className="text-right p-1 font-medium">
                                          {t("products.buyPrice")}
                                        </th>
                                      )}
                                      <th className="text-right p-1 font-medium">
                                        {t("products.sellPrice")}
                                      </th>
                                      <th className="text-right p-1 font-medium">
                                        {t("products.stock")}
                                      </th>
                                      <th className="text-right p-1 font-medium">
                                        {t("common.actions")}
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    <tr className="border-t border-gray-200">
                                      <td className="p-1 font-mono">{p.sku}</td>
                                      <td className="p-1 font-mono">
                                        {p.barcode || "—"}
                                      </td>
                                      {canViewProfit && (
                                        <td className="p-1 text-right">
                                          {p.currentBuyPrice != null
                                            ? fmtCurrency(p.currentBuyPrice)
                                            : "—"}
                                        </td>
                                      )}
                                      <td className="p-1 text-right">
                                        {p.currentSellPrice != null
                                          ? fmtCurrency(p.currentSellPrice)
                                          : "—"}
                                      </td>
                                      <td className="p-1 text-right font-semibold">
                                        {stock}
                                      </td>
                                      <td className="p-1 text-right whitespace-nowrap">
                                        {canAdjust && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              openCountModal(p);
                                            }}
                                            className="text-emerald-600 hover:underline mr-2"
                                          >
                                            {t("products.adjust")}
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            startQr(p);
                                          }}
                                          className="text-blue-600 hover:underline mr-2"
                                          title={t("products.printQrTitle")}
                                        >
                                          {t("products.printQr")}
                                        </button>
                                        {canEdit && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              startEdit(p);
                                            }}
                                            className="text-gray-500 hover:underline"
                                          >
                                            {t("common.edit")}
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  </tbody>
                                </table>
                              ) : (
                                <table className="w-full bg-slate-50/60 text-xs whitespace-nowrap">
                                  <thead>
                                    <tr className="text-gray-400">
                                      <th className="text-left p-1 font-medium">
                                        {t("products.variationSpec")}
                                      </th>
                                      <th className="text-left p-1 font-medium">
                                        {t("products.variantSku")}
                                      </th>
                                      <th className="text-left p-1 font-medium">
                                        {t("products.barcode")}
                                      </th>
                                      {canViewProfit && (
                                        <th className="text-right p-1 font-medium">
                                          {t("products.buyPrice")}
                                        </th>
                                      )}
                                      <th className="text-right p-1 font-medium">
                                        {t("products.sellPrice")}
                                      </th>
                                      <th className="text-right p-1 font-medium">
                                        {t("products.quantityStock")}
                                      </th>
                                      <th className="text-right p-1 font-medium">
                                        {t("common.actions")}
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(p.variants ?? []).map((v: any) => {
                                      const qty =
                                        (p.inventory ?? []).find(
                                          (i: any) => i.variantId === v.id,
                                        )?.quantity ?? 0;
                                      return (
                                        <tr
                                          key={v.id}
                                          className="border-t border-gray-200"
                                        >
                                          <td className="p-1">
                                            {variantLabel(v) ||
                                              t("products.standard")}
                                          </td>
                                          <td className="p-1 font-mono">
                                            {v.sku}
                                          </td>
                                          <td className="p-1 font-mono">
                                            {v.barcode || "—"}
                                          </td>
                                          {canViewProfit && (
                                            <td className="p-1 text-right">
                                              {v.buyPrice != null
                                                ? fmtCurrency(v.buyPrice)
                                                : "—"}
                                            </td>
                                          )}
                                          <td className="p-1 text-right">
                                            {v.sellPrice != null
                                              ? fmtCurrency(v.sellPrice)
                                              : "—"}
                                          </td>
                                          <td className="p-1 text-right font-semibold">
                                            {qty}
                                          </td>
                                          <td className="p-1 text-right whitespace-nowrap">
                                            {canAdjust && (
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  openCountModal(p, v.id);
                                                }}
                                                className="text-emerald-600 hover:underline mr-2"
                                                title={t(
                                                  "products.adjustVariantTitle",
                                                )}
                                              >
                                                {t("products.adjust")}
                                              </button>
                                            )}
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                startQr(p);
                                              }}
                                              className="text-blue-600 hover:underline mr-2"
                                              title={t("products.printQrTitle")}
                                            >
                                              {t("products.printQr")}
                                            </button>
                                            {canEdit && (
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  startEdit(p);
                                                }}
                                                className="text-gray-500 hover:underline"
                                                title={t(
                                                  "products.editVariants",
                                                )}
                                              >
                                                {t("products.editVariant")}
                                              </button>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
        </>
      )}

      {/* Add Product Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title={t("products.addNewTitle")}
      >
        <ProductForm
          onProductCreated={() => {
            setShowAddModal(false);
            fetchProducts();
            fetchCategories();
          }}
          onCancel={() => setShowAddModal(false)}
        />
      </Modal>

      {/* Edit Product Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        title={t("products.editTitle", {
          name: `${editing?.brand ?? ""} ${editing?.baseName ?? ""}`.trim(),
        })}
      >
        <ProductForm
          editing={editing}
          onProductUpdated={() => {
            setShowEditModal(false);
            setEditing(null);
            fetchProducts();
          }}
          onCancel={() => setShowEditModal(false)}
        />
      </Modal>

      {/* Count one item (or several) without leaving the list. */}
      <StockCountModal
        isOpen={!!counting}
        onClose={() => setCounting(null)}
        productId={counting?.productId ?? null}
        variantId={counting?.variantId}
        locations={locations}
        boundLocationId={
          user?.locationType === "STORE" || user?.locationType === "SHOP"
            ? String(user?.locationId ?? "")
            : null
        }
        onSaved={fetchProducts}
      />

      {/* QR Code Modal */}
      <Modal
        isOpen={showQrModal}
        onClose={() => setShowQrModal(false)}
        title={t("products.productQrCodes")}
      >
        <div className="flex flex-col gap-4 py-2 max-h-[70vh] overflow-y-auto">
          {/* One card per label, straight from qrLabels: the same list the
              print portal and the PDF sheet are built from. */}
          {qrLabels.map((label) => (
            <div
              key={label.key}
              className="flex flex-col items-center gap-2 border rounded-lg p-3"
            >
              <QRCodeSVG value={label.sku} size={140} />
              <p className="font-mono text-sm font-semibold">{label.sku}</p>
              {label.name && (
                <p className="text-gray-500 text-sm text-center">
                  {label.name}
                </p>
              )}
              {label.barcode && (
                <p className="text-xs text-gray-400">
                  {t("products.barcodePrefix")} {label.barcode}
                </p>
              )}
            </div>
          ))}

          {/* Hidden 256 px canvases, rendered only to rasterise each code for
              the PDF. A canvas keeps its bitmap while it is not displayed, so
              qrPngDataUrls() can read them without anything flashing on screen. */}
          <div ref={qrCanvasRef} className="hidden" aria-hidden="true">
            {qrLabels.map((label) => (
              <QRCodeCanvas key={label.key} value={label.sku} size={256} />
            ))}
          </div>

          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="border border-blue-600 text-blue-600 py-2 px-4 rounded-lg text-sm font-medium"
            >
              {t("products.printLabels")}
            </button>
            {/* Share leads where the platform can carry the file (phones); the
                download takes over the primary styling where it cannot. */}
            {shareSupported && (
              <button
                type="button"
                onClick={() => handleQrPdf("share")}
                disabled={qrPdfBusy}
                className="flex items-center gap-2 bg-blue-600 text-white py-2 px-4 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {qrPdfBusy && <Loading size="sm" />}
                <Share2 size={16} />
                {t("products.shareLabel")}
              </button>
            )}
            <button
              type="button"
              onClick={() => handleQrPdf("download")}
              disabled={qrPdfBusy}
              className={
                shareSupported
                  ? "border border-blue-600 text-blue-600 py-2 px-4 rounded-lg text-sm font-medium disabled:opacity-50"
                  : "bg-blue-600 text-white py-2 px-4 rounded-lg text-sm font-medium disabled:opacity-50"
              }
            >
              {t("products.downloadQrPdf")}
            </button>
          </div>
        </div>
      </Modal>

      {/* The sheet `window.print()` prints. It lives outside the app because the
          modal body scrolls (max-h-[70vh] + overflow-y-auto) and browsers only
          print the visible part of a scroll container: labels past the first
          screen used to be dropped. globals.css hides the rest of the page
          while this portal exists, so every label reaches the paper. */}
      {showQrModal &&
        typeof document !== "undefined" &&
        createPortal(
          <div id="print-root">
            <div className="qr-print-grid">
              {qrLabels.map((label) => (
                <div key={label.key} className="qr-print-label">
                  <QRCodeSVG value={label.sku} size={128} />
                  <p className="qr-print-sku">{label.sku}</p>
                  {label.name && <p className="qr-print-name">{label.name}</p>}
                  {label.barcode && (
                    <p className="qr-print-barcode">
                      {t("products.barcodePrefix")} {label.barcode}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}

      <ProductDetailModal
        product={detailProduct}
        onClose={() => setDetailProduct(null)}
      />

      {/* Generate a customer-facing price list PDF. Mounted only while open, so
          each open starts with a fresh catalog + empty selection. */}
      {showPriceListModal && (
        <PriceListModal isOpen onClose={() => setShowPriceListModal(false)} />
      )}
    </div>
  );
}
