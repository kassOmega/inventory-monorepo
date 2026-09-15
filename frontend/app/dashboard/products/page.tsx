"use client";
import Modal from "@/app/components/Modal";
import Loading from "@/app/components/Loading";
import ProductForm from "@/app/components/ProductForm";
import RowActionsMenu from "@/app/components/RowActionsMenu";
import { useToast } from "@/app/components/ToastProvider";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useAuth } from "@/context/AuthContext";
import { variantLabel } from "@/lib/variantLabel";
import { fmtCurrency } from "@/lib/currency";
import { statusLabel } from "@/lib/statusLabel";
import api, { markHandled } from "@/lib/api";
import { QRCodeSVG } from "qrcode.react";
import { ChevronDown, ChevronRight } from "lucide-react";
import CategoriesManager from "@/app/components/CategoriesManager";
import ProductDetailModal from "@/app/components/ProductDetailModal";
import { Fragment, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import useServerPaging from "@/lib/useServerPaging";
import Pagination from "@/app/components/Pagination";

export default function ProductsPage() {
  const { t } = useTranslation();
  const { user, hasPermission } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const paged = useServerPaging({ pageSize: 20 });

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjusting, setAdjusting] = useState<any>(null);
  const [adjustForm, setAdjustForm] = useState({
    locationId: "",
    variantId: "",
    quantity: 0,
    reason: "",
  });
  const [locations, setLocations] = useState<any[]>([]);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrProduct, setQrProduct] = useState<any>(null);
  const [tab, setTab] = useState<"products" | "categories">("products");
  const [loading, setLoading] = useState(true);
  const [detailProduct, setDetailProduct] = useState<any>(null);

  const fetchProducts = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api.get(
        `/products?search=${debouncedSearch}&categoryId=${categoryFilter}&page=${paged.page}&pageSize=${paged.pageSize}`,
      );
      const body = res.data;
      const rows = Array.isArray(body) ? body : (body?.data ?? []);
      setProducts(rows);
      paged.setTotal(Array.isArray(body) ? rows.length : (body?.total ?? rows.length));
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
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

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
      if (document.visibilityState === "visible") productsFetchRef.current(true);
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
   * Stock of one item at one location, straight from the list payload: a variant
   * row when `variantId` is given, the plain row otherwise. Used to prefill the
   * reconciliation count — the modal used to show the product-wide total across
   * variants *and* locations, which is also why the backend wrote the wrong row.
   */
  const stockAt = (product: any, locationId: string, variantId?: string) =>
    (product?.inventory ?? [])
      .filter(
        (i: any) =>
          String(i.locationId) === String(locationId) &&
          (variantId === undefined ||
            String(i.variantId ?? "") === String(variantId)),
      )
      .reduce((sum: number, i: any) => sum + (i.quantity ?? 0), 0);

  /** Open the modal, optionally pinned to one variant (per-variant Adjust). */
  const startAdjust = (p: any, variantId?: number | string) => {
    const locationId = locations.length === 1 ? String(locations[0].id) : "";
    const selectedVariant =
      p?.hasVariants && variantId !== undefined ? String(variantId) : "";
    setAdjusting(p);
    setAdjustForm({
      locationId,
      variantId: selectedVariant,
      quantity: locationId
        ? stockAt(p, locationId, p?.hasVariants ? selectedVariant : undefined)
        : 0,
      reason: "",
    });
    setShowAdjustModal(true);
  };

  /** Keep the counted quantity in step with the chosen location / variant. */
  const syncAdjustTarget = (next: { locationId: string; variantId: string }) => {
    const quantity = next.locationId
      ? stockAt(
          adjusting,
          next.locationId,
          adjusting?.hasVariants ? next.variantId : undefined,
        )
      : 0;
    setAdjustForm((f) => ({ ...f, ...next, quantity }));
  };

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjusting || !adjustForm.locationId) {
      toast.error(t("products.pleaseSelectLocation"));
      return;
    }
    if (adjusting.hasVariants && !adjustForm.variantId) {
      toast.error(t("products.selectVariant"));
      return;
    }
    try {
      await api.post(`/products/${adjusting.id}/adjust-stock`, {
        locationId: Number(adjustForm.locationId),
        // Stock for a variant product lives on the variant rows, so the API needs
        // to know which one is being counted (it rejects the request otherwise).
        ...(adjusting.hasVariants
          ? { variantId: Number(adjustForm.variantId) }
          : {}),
        quantity: Number(adjustForm.quantity),
        reason: adjustForm.reason || undefined,
      });
      toast.success(t("products.stockAdjusted"));
      setShowAdjustModal(false);
      setAdjusting(null);
      fetchProducts();
    } catch (err: any) {
      markHandled(err);
      toast.error(t("products.failedAdjustStock"));
    }
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
      toast.error(err.response?.data?.message || t("products.failedDeleteProduct"));
    }
  };

  const startQr = (p: any) => {
    setQrProduct(p);
    setShowQrModal(true);
  };

  if (loading) return <Loading className="py-24" />;

  return (
    <div>
      <div className="flex justify-between items-start md:items-center mb-6 gap-3">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">
          {t("products.title")}
        </h1>
        {tab === "products" && canCreate && (
          <button
            onClick={() => setShowAddModal(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg whitespace-nowrap text-sm"
          >
            + {t("common.add")}
          </button>
        )}
      </div>

      <div className="flex gap-2 mb-6">
        <button type="button" onClick={() => setTab("products")}
          className={"px-4 py-2 rounded text-sm " + (tab === "products" ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-600")}>
          {t("products.tabProducts")}
        </button>
        <button type="button" onClick={() => setTab("categories")}
          className={"px-4 py-2 rounded text-sm " + (tab === "categories" ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-600")}>
          {t("products.tabCategories")}
        </button>
      </div>

      {tab === "categories" ? (
        <CategoriesManager />
      ) : (
      <>
      <div className="flex w-full items-start md:items-center mb-6 gap-3">
        <input
          placeholder={t("products.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border p-2 rounded-lg flex-1 text-sm"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="border p-2 rounded-lg bg-white text-sm"
        >
          <option value="">{t("sales.allCategories")}</option>
          {categories.map((c: any) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[600px] sm:min-w-[700px] text-xs sm:text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="p-2 sm:p-3 md:p-4">{t("products.sku")}</th>
                <th className="p-2 sm:p-3 md:p-4">{t("products.name")}</th>
                <th className="p-2 sm:p-3 md:p-4">{t("products.category")}</th>
                <th className="p-2 sm:p-3 md:p-4">{t("products.stock")}</th>
                <th className="p-2 sm:p-3 md:p-4">{t("products.qr")}</th>
                {(canEdit || canDelete || canAdjust) && <th className="p-2 sm:p-3 md:p-4">{t("common.actions")}</th>}
              </tr>
            </thead>
            <tbody>
              {products.map((p: any) => {
                const stock = getTotalStock(p);
                return (
                  <Fragment key={p.id}>
                  <tr onClick={() => setDetailProduct(p)} className="border-b hover:bg-gray-50 cursor-pointer">
                    <td className="p-2 sm:p-3 md:p-4">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleRow(String(p.id)); }}
                        className="mr-1.5 text-gray-400 cursor-pointer align-middle"
                        title={expandedIds.has(String(p.id)) ? t("products.collapseVariants") : t("products.expandVariants")}
                      >
                        {expandedIds.has(String(p.id)) ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </button>
                      <span className="font-mono text-xs sm:text-sm">
                        {p.sku}
                      </span>
                    </td>
                    <td className="p-2 sm:p-3 md:p-4 font-medium">
                      {p.brand} {p.baseName}
                      {p.kind && p.kind !== "GOODS" && (
                        <span className="ml-1 text-[10px] text-blue-600">{statusLabel(p.kind)}</span>
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
                        onClick={(e) => { e.stopPropagation(); startQr(p); }}
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
                              ? [{ label: t("common.edit"), onClick: () => startEdit(p) }]
                              : []),
                            ...(canAdjust
                              ? [
                                  {
                                    label: t("products.adjust"),
                                    color: "text-green-600",
                                    onClick: () => startAdjust(p),
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
                    <tr key={`${p.id}-variants`} className="bg-slate-50/60">
                      <td colSpan={7} className="p-2 sm:p-3 md:p-4 pl-8 sm:pl-12">
                        <table className="w-full bg-slate-50/60 text-xs">
                          <thead>
                            <tr className="text-gray-400">
                              <th className="text-left p-1 font-medium">{t("products.variationSpec")}</th>
                              <th className="text-left p-1 font-medium">{t("products.variantSku")}</th>
                              <th className="text-left p-1 font-medium">{t("products.barcode")}</th>
                              {canViewProfit && (
                                <th className="text-right p-1 font-medium">{t("products.buyPrice")}</th>
                              )}
                              <th className="text-right p-1 font-medium">{t("products.sellPrice")}</th>
                              <th className="text-right p-1 font-medium">{t("products.quantityStock")}</th>
                              <th className="text-right p-1 font-medium">{t("common.actions")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(p.variants ?? []).map((v: any) => {
                              const qty =
                                (p.inventory ?? []).find(
                                  (i: any) => i.variantId === v.id,
                                )?.quantity ?? 0;
                              return (
                                <tr key={v.id} className="border-t border-gray-200">
                                  <td className="p-1">{variantLabel(v) || t("products.standard")}</td>
                                  <td className="p-1 font-mono">{v.sku}</td>
                                  <td className="p-1 font-mono">{v.barcode || "—"}</td>
                                  {canViewProfit && (
                                    <td className="p-1 text-right">
                                      {v.buyPrice != null ? fmtCurrency(v.buyPrice) : "—"}
                                    </td>
                                  )}
                                  <td className="p-1 text-right">
                                    {v.sellPrice != null ? fmtCurrency(v.sellPrice) : "—"}
                                  </td>
                                  <td className="p-1 text-right font-semibold">{qty}</td>
                                  <td className="p-1 text-right whitespace-nowrap">
                                    {canAdjust && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          startAdjust(p, v.id);
                                        }}
                                        className="text-emerald-600 hover:underline mr-2"
                                        title={t("products.adjustVariantTitle")}
                                      >
                                        {t("products.adjust")}
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); startQr(p); }}
                                      className="text-blue-600 hover:underline mr-2"
                                      title={t("products.printQrTitle")}
                                    >
                                      {t("products.printQr")}
                                    </button>
                                    {canEdit && (
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); startEdit(p); }}
                                        className="text-gray-500 hover:underline"
                                        title={t("products.editVariants")}
                                      >
                                        {t("products.editVariant")}
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                            {(p.variants ?? []).length === 0 && (
                              <tr>
                                <td
                                  colSpan={7}
                                  className="p-1 text-gray-400"
                                >
                                  {t("products.noVariants")}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
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

      {/* Adjust Stock Modal */}
      <Modal
        isOpen={showAdjustModal}
        onClose={() => setShowAdjustModal(false)}
        title={t("products.adjustStockTitle", {
          name: `${adjusting?.brand ?? ""} ${adjusting?.baseName ?? ""}`.trim(),
        })}
      >
        <form onSubmit={handleAdjust} className="grid grid-cols-1 gap-4">
          <p className="text-[11px] text-gray-400">
            {t("products.reconciliationHint")}
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("common.location")}
            </label>
            <select
              value={adjustForm.locationId}
              onChange={(e) =>
                syncAdjustTarget({
                  locationId: e.target.value,
                  variantId: adjustForm.variantId,
                })
              }
              className="border p-2 rounded-lg w-full bg-white"
              required
            >
              <option value="">{t("products.selectLocation")}</option>
              {locations.map((l: any) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          {adjusting?.hasVariants && (
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">
                {t("products.selectVariant")}
              </label>
              <select
                value={adjustForm.variantId}
                onChange={(e) =>
                  syncAdjustTarget({
                    locationId: adjustForm.locationId,
                    variantId: e.target.value,
                  })
                }
                className="border p-2 rounded-lg w-full bg-white"
                required
              >
                <option value="">{t("products.selectVariant")}</option>
                {(adjusting?.variants ?? []).map((v: any) => (
                  <option key={v.id} value={v.id}>
                    {variantLabel(v) || v.sku || `#${v.id}`}
                    {v.sku ? ` — ${v.sku}` : ""}
                  </option>
                ))}
              </select>
              {adjustForm.locationId && adjustForm.variantId && (
                <p className="text-[11px] text-gray-400 mt-1">
                  {t("products.stockAtLocation", {
                    n: stockAt(adjusting, adjustForm.locationId, adjustForm.variantId),
                  })}
                </p>
              )}
            </div>
          )}
          {!adjusting?.hasVariants && adjustForm.locationId && (
            <p className="text-[11px] text-gray-400 -mt-2">
              {t("products.stockAtLocation", {
                n: stockAt(adjusting, adjustForm.locationId),
              })}
            </p>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("products.newQuantity")}
            </label>
            <input
              type="number"
              min="0"
              value={adjustForm.quantity}
              onChange={(e) =>
                setAdjustForm({ ...adjustForm, quantity: Number(e.target.value) })
              }
              className="border p-2 rounded-lg w-full"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("products.reasonOptional")}
            </label>
            <input
              value={adjustForm.reason}
              onChange={(e) =>
                setAdjustForm({ ...adjustForm, reason: e.target.value })
              }
              className="border p-2 rounded-lg w-full"
              placeholder={t("products.reasonPlaceholder")}
            />
          </div>
          <button
            type="submit"
            className="bg-green-600 text-white p-2 rounded-lg mt-2 font-medium"
          >
            {t("products.saveAdjustment")}
          </button>
        </form>
      </Modal>

      {/* QR Code Modal */}
      <Modal
        isOpen={showQrModal}
        onClose={() => setShowQrModal(false)}
        title={t("products.productQrCodes")}
      >
        <div className="flex flex-col gap-4 py-2 max-h-[70vh] overflow-y-auto">
          <div className="flex flex-col items-center gap-2 border rounded-lg p-3">
            <QRCodeSVG value={qrProduct?.sku || ""} size={140} />
            <p className="font-mono text-sm font-semibold">{qrProduct?.sku}</p>
            <p className="text-gray-500 text-sm text-center">
              {qrProduct?.brand} {qrProduct?.baseName}
            </p>
            {qrProduct?.barcode && (
              <p className="text-xs text-gray-400">{t("products.barcodePrefix")} {qrProduct.barcode}</p>
            )}
          </div>

          {(qrProduct?.variants ?? []).map((v: any) => {
            const label = variantLabel(v);
            return (
              <div
                key={v.id}
                className="flex flex-col items-center gap-2 border rounded-lg p-3"
              >
                <QRCodeSVG value={v.sku || ""} size={140} />
                <p className="font-mono text-sm font-semibold">{v.sku}</p>
                <p className="text-gray-500 text-sm">{label}</p>
                {v.barcode && (
                  <p className="text-xs text-gray-400">{t("products.barcodePrefix")} {v.barcode}</p>
                )}
              </div>
            );
          })}

          <button
            type="button"
            onClick={() => window.print()}
            className="bg-blue-600 text-white py-2 px-4 rounded-lg text-sm font-medium self-center"
          >
            {t("products.printLabels")}
          </button>
        </div>
      </Modal>

      <ProductDetailModal
        product={detailProduct}
        onClose={() => setDetailProduct(null)}
      />
    </div>
  );
}
