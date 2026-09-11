"use client";
import BarcodeScanner from "@/app/components/BarcodeScanner";
import { CURRENCY_SYMBOL, fmtCurrency } from "@/lib/currency";
import AiPhotoPicker from "@/app/components/AiPhotoPicker";
import { useSingleLocationAutofill } from "@/lib/singleLocation";
import CustomerForm from "@/app/components/CustomerForm";
import SearchableSelect from "@/app/components/SearchableSelect";
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
import { newClientRef } from "@/lib/clientRef";
import { formatDateTime } from "@/lib/datetime";
import { addScannedToCart } from "@/lib/cart";
import { batchLabel, variantLabel } from "@/lib/variantLabel";
import VariantLinesEditor, {
  defaultVariantLine,
  variantStockFor,
  variantUnitPrice,
} from "@/app/components/VariantLinesEditor";
import { useRouter } from "next/navigation";
import useServerPaging from "@/lib/useServerPaging";
import Pagination from "@/app/components/Pagination";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface Product {
  id: number;
  sku: string;
  barcode?: string;
  brand: string;
  baseName: string;
  currentBuyPrice: number;
  currentSellPrice: number;
  hasVariants?: boolean;
  variants?: any[];
  inventory: Array<{
    productId: number;
    variantId?: number | null;
    locationId: number;
    quantity: number;
  }>;
  category: { id: number; name: string } | null;
  unit: { id: number; name: string } | null;
}

interface VariantLine {
  variantId: string;
  quantity: number;
  customPrice: string;
}

interface CartItem {
  productId: string;
  quantity: number;
  customPrice: string;
  search: string;
  catFilter: string;
  variantLines?: VariantLine[];
}

type DatePreset = "today" | "week" | "month" | "year";

/**
 * Resolve a scanned/typed code against the loaded catalogue: a product SKU or
 * barcode first, then a variant SKU/barcode (which carries its parent product).
 */
type ScannedHit = { product: Product; variant: any };

function resolveScannedCode(
  code: string,
  products: Product[],
): ScannedHit | null {
  const value = code.trim().toLowerCase();
  const product = products.find(
    (p) =>
      (p.sku || "").toLowerCase() === value ||
      (p.barcode && p.barcode.toLowerCase() === value),
  );
  if (product) return { product, variant: null };

  for (const p of products) {
    const variant = (p.variants ?? []).find(
      (v) =>
        (v.sku || "").toLowerCase() === value ||
        (v.barcode && v.barcode.toLowerCase() === value),
    );
    if (variant) return { product: p, variant };
  }
  return null;
}

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
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [cart, setCart] = useState<CartItem[]>([
    { productId: "", quantity: 1, customPrice: "", search: "", catFilter: "" },
  ]);
  // Original sale quantities while editing, keyed "productId:variantId", so the
  // stock delta (currentLocationStock + originalQty) is used in validation.
  const [editOriginalQty, setEditOriginalQty] = useState<Record<string, number>>({});
  // Refs to the quantity inputs so a barcode scan can focus the quantity field.
  const qtyRefs = useRef<Array<HTMLInputElement | null>>([]);
  // Latest cart for the "scan to cart" flow: scans arrive back-to-back, so each
  // one must build on the previous result rather than on render state.
  const cartRef = useRef<CartItem[]>(cart);
  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);
  // AI scan (photo → match catalog product) for individual cart lines.
  const [scanBusyIndex, setScanBusyIndex] = useState<number | null>(null);
  // Row touched by the last cart-level scan: highlighted briefly, qty focused.
  const [scannedRowIndex, setScannedRowIndex] = useState<number | null>(null);
  const canAiScan = user?.isSuperuser || hasPermission("ai.sales-assist");

  const handleAiScan = async (images: string[], index: number) => {
    setScanBusyIndex(index);
    try {
      const res = await api.post(
        "/ai/sales/identify-product",
        {
          base64Image: images[0],
          ...(images[1] ? { base64Image2: images[1] } : {}),
        },
        { timeout: 60000 },
      );
      const { product, variant, matchType } = res.data;
      if (!product) {
        const ex = res.data.extracted ?? {};
        const nm = [ex.brand, ex.baseName].filter(Boolean).join(" ");
        toast.error(
          nm
            ? t("sales.noAiMatch", { name: nm })
            : t("sales.noAiMatchGeneric"),
        );
        return;
      }
      // Merge the matched product into the local list so the select can show it.
      setProducts((prev) =>
        prev.some((p) => p.id === product.id) ? prev : [...prev, product],
      );
      setCart((prev) =>
        prev.map((c, i) =>
          i === index
            ? {
                ...c,
                productId: String(product.id),
                variantLines: variant?.id
                    ? [defaultVariantLine(product, variant)]
                    : [],
              }
            : c,
        ),
      );
      const productName = `${product.brand} ${product.baseName}${variant ? ` (${variant.sku || t("sales.variantWord")})` : ""}`;
      toast.success(
        t("sales.matchedProduct", { name: productName }) +
          (matchType === "partial" ? t("sales.partialConfirm") : ""),
      );
    } catch (err: any) {
      markHandled(err);
      toast.error(
        err?.response?.data?.message || t("sales.aiReadFailed"),
      );
    } finally {
      setScanBusyIndex(null);
    }
  };

  // Product filters for the dropdown
  const [search, setSearch] = useState("");
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
  const [customers, setCustomers] = useState<any[]>([]);
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [clientRef, setClientRef] = useState(() => newClientRef());
  const [saleType, setSaleType] = useState<
    "FULLY_PAID" | "PARTIALLY_PAID" | "CREDITED"
  >("FULLY_PAID");
  const [ownerShopId, setOwnerShopId] = useState("");
  // Autofill the sole shop when the business has only one.
  useSingleLocationAutofill(locations, ownerShopId, setOwnerShopId);
  const [shops, setShops] = useState<any[]>([]);
  const [newMethodName, setNewMethodName] = useState("");
  const [showCustomerModal, setShowCustomerModal] = useState(false);
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
      if (search.trim()) params.set("search", search.trim());
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

  const fetchProducts = async () => {
    const locParam = isOwner && ownerShopId ? `&locationId=${ownerShopId}` : "";
    const res = await api.get(
      `/products?search=${search}&categoryId=${categoryFilter}${locParam}`,
    );
    setProducts(res.data);
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
    setShops(locRes.data.filter((l: any) => l.type === "SHOP"));
  };

  useEffect(() => {
    fetchCategories();
    api.get("/payment-methods").then((r) => {
      setPaymentMethods(r.data);
      const cash = (r.data as any[]).find(
        (m: any) => m.name.toLowerCase() === "cash",
      );
      const cashId = cash ? String(cash.id) : "";
      // Cash is the default + initially selected payment method.
      setPaymentMethodId((prev) => prev || cashId);
      setSettleMethodId((prev) => prev || cashId);
    });
    api.get("/customers").then((r) => setCustomers(r.data));
  }, []);

  // Refetch the current sales page whenever filters/page/size change (filters
  // reset to page 1 first via the signature guard).
  const salesFilterSig = `${locationFilter}|${categoryFilter}|${search}|${saleTypeFilter}|${paymentFilter}|${startDate}|${endDate}`;
  const salesFilterRef = useRef(salesFilterSig);
  useEffect(() => {
    if (salesFilterRef.current !== salesFilterSig) {
      salesFilterRef.current = salesFilterSig;
      if (salesPaged.page !== 1) {
        salesPaged.setPage(1);
        return;
      }
    }
    fetchSales();
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
    if (search) params.set("search", search);
    api
      .get(`/reports/unified-stats?${params}`)
      .then((r) => setPurchaseStats(r.data))
      .catch((err) => console.error("Stats failed:", err));
  }, [startDate, endDate, locationFilter, categoryFilter, search, canViewProfit]);

  useEffect(() => {
    if (showForm) fetchProducts();
  }, [search, categoryFilter, showForm, ownerShopId]);

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

  const resetForm = () => {
    setCart([
      {
        productId: "",
        quantity: 1,
        customPrice: "",
        search: "",
        catFilter: "",
      },
    ]);
    setEditing(null);
    setEditOriginalQty({});
    setShowForm(false);
    setSearch("");
    setCategoryFilter("");
    setPaymentMethodId(cashMethod ? String(cashMethod.id) : "");
    setPaidAmount("");
    setCustomerId("");
    setSaleType("FULLY_PAID");
    setOwnerShopId("");
    // Fresh idempotency key for the next transaction (kept on retries after a failure).
    setClientRef(newClientRef());
  };

  const getStockForProduct = (productId: number | string): number => {
    const id = Number(productId);
    if (!id) return 0;
    const product = products.find((p) => p.id === id);
    if (!product || !product.inventory) return 0;
    // For owners with a selected shop, inventory is already filtered by the API
    // For shopkeepers, inventory is filtered to their location
    return product.inventory.reduce((sum, inv) => sum + inv.quantity, 0);
  };

  // Original quantity already allocated to this sale line (0 when creating).
  const originalQtyFor = (
    productId: number | string,
    variantId?: number | string | null,
  ) => editOriginalQty[`${productId}:${variantId ?? ""}`] ?? 0;
  // While editing a sale the sold quantity is still "allocated" to it, so the
  // effective sellable amount = current stock + original line quantity.
  const sellableMaxFor = (
    productId: number | string,
    variantId: number | string | null | undefined,
    currentStock: number,
  ) => currentStock + (editing ? originalQtyFor(productId, variantId) : 0);
  // Per-variant original map for the variant editor (only used in edit mode).
  const originalByVariantFor = (productId: string | number) => {
    const prefix = `${productId}:`;
    const out: Record<string, number> = {};
    for (const [key, qty] of Object.entries(editOriginalQty)) {
      if (key.startsWith(prefix)) out[key.slice(prefix.length)] = qty;
    }
    return out;
  };

  const patchRow = (index: number, patch: Partial<CartItem>) =>
    setCart((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  const rowTotalAll = () =>
    cart.reduce((sum, c) => {
      if (!c.productId) return sum;
      const p = products.find((x: any) => x.id === Number(c.productId));
      if (!p) return sum;
      if (p.hasVariants) {
        return (
          sum +
          (c.variantLines ?? []).reduce(
            (s, l) => s + variantUnitPrice(p, l) * (l.quantity || 0),
            0,
          )
        );
      }
      const price = Number(c.customPrice) || p.currentSellPrice || 0;
      return sum + price * Number(c.quantity || 1);
    }, 0);

  const expandCartItems = () => {
    const rows = cart.filter((c) => c.productId);
    const items: {
      productId: number;
      variantId?: number;
      quantity: number;
      customPrice?: number;
    }[] = [];
    for (const c of rows) {
      const p = products.find((x: any) => x.id === Number(c.productId));
      const hasVariantLines = (c.variantLines ?? []).some(
        (l) => l.quantity > 0,
      );
      if (p?.hasVariants || (!p && hasVariantLines)) {
        for (const l of c.variantLines ?? []) {
          if (l.quantity > 0) {
            items.push({
              productId: Number(c.productId),
              variantId: Number(l.variantId),
              quantity: l.quantity,
              customPrice: l.customPrice ? Number(l.customPrice) : undefined,
            });
          }
        }
      } else {
        items.push({
          productId: Number(c.productId),
          quantity: Number(c.quantity),
          customPrice: c.customPrice ? Number(c.customPrice) : undefined,
        });
      }
    }
    return items;
  };
  const handleSale = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    // Validate payment method
    if (
      (saleType === "FULLY_PAID" || saleType === "PARTIALLY_PAID") &&
      !paymentMethodId
    ) {
      setErrorMsg(t("sales.paymentMethodRequired"));
      return;
    }
    if (
      saleType === "PARTIALLY_PAID" &&
      (!paidAmount || Number(paidAmount) <= 0)
    ) {
      setErrorMsg(t("sales.paidAmountRequired"));
      return;
    }

    const items = expandCartItems();
    if (items.length === 0) {
      toast.error(t("sales.addAtLeastOneItem"));
      return;
    }
    // Every variant row needs at least one variant quantity.
    for (const row of cart.filter((c) => c.productId)) {
      const p = products.find((x: any) => x.id === Number(row.productId));
      if (p?.hasVariants && !(row.variantLines ?? []).some((l) => l.quantity > 0)) {
        toast.error(t("sv.needQty", { name: `${p.brand} ${p.baseName}`.trim() }));
        return;
      }
    }
    // Plain rows check product stock; variant lines check the exact variant.
    for (const item of items) {
      const p = products.find((pr: any) => pr.id === item.productId);
      if (!p) continue;
      const stock = item.variantId
        ? variantStockFor(p, item.variantId)
        : getStockForProduct(item.productId);
      const stockMax = sellableMaxFor(item.productId, item.variantId, stock);
      if (item.quantity > stockMax) {
        const v = item.variantId
          ? (p.variants ?? []).find((vv: any) => vv.id === item.variantId)
          : undefined;
        toast.error(
          t("sales.cannotSell", {
            qty: String(item.quantity),
            name: `${p.brand} ${p.baseName}${v ? " • " + variantLabel(v) : ""}`.trim(),
            stock: String(stockMax),
          }),
        );
        return;
      }
    }
    try {
      if (editing) {
        await api.put(`/sales/${editing.id}`, {
          items,
          saleType,
          paidAmount:
            saleType === "PARTIALLY_PAID" && paidAmount
              ? Number(paidAmount)
              : undefined,
          paymentMethodId: paymentMethodId
            ? Number(paymentMethodId)
            : undefined,
          customerId: customerId ? Number(customerId) : undefined,
          shopId: isOwner && ownerShopId ? Number(ownerShopId) : undefined,
        });
      } else
        await api.post("/sales", {
          items,
          saleType,
          paidAmount:
            saleType !== "CREDITED" && paidAmount
              ? Number(paidAmount)
              : undefined,
          paymentMethodId: paymentMethodId
            ? Number(paymentMethodId)
            : undefined,
          customerId: customerId ? Number(customerId) : undefined,
          shopId: isOwner && ownerShopId ? Number(ownerShopId) : undefined,
          clientRef,
        });
      resetForm();
      fetchSales();
    } catch (err: any) {
      markHandled(err);
      toast.error(
        err?.response?.data?.message ?? t("sales.errorProcessing"),
      );
    }
  };

  /**
   * Cart-level scan (the "Scan to cart" button): each scan puts the product on
   * the sale, and scanning the same product/variant again increments the line it
   * already occupies instead of adding a duplicate row.
   */
  const handleScanToCart = async (raw: string) => {
    const code = raw.trim();
    if (!code) return;

    let hit: ScannedHit | null = null;

    try {
      const locParam =
        isOwner && ownerShopId ? `&locationId=${ownerShopId}` : "";
      const res = await api.get(
        `/products/by-code?code=${encodeURIComponent(code)}${locParam}`,
      );
      const { product, variant } = res.data ?? {};
      if (product) {
        hit = { product, variant: variant ?? null };
        // Merge so the row's select and the stock helpers can see the product.
        setProducts((prev) =>
          prev.some((p) => p.id === product.id) ? prev : [...prev, product],
        );
      }
    } catch {
      // Lookup unavailable — fall back to the catalogue already in memory.
      hit = resolveScannedCode(code, products);
    }

    if (!hit) {
      toast.error(t("restock.noProductForSku", { sku: code }));
      return;
    }

    const line = hit.variant
      ? defaultVariantLine(hit.product, hit.variant)
      : null;
    // Read the ref (not render state) so back-to-back scans never lose a unit.
    const outcome = addScannedToCart(cartRef.current, hit.product, line);
    cartRef.current = outcome.cart;
    setCart(outcome.cart);

    // Show which line the scan touched and drop the cursor into its quantity so
    // the shopkeeper can adjust the count straight away.
    setScannedRowIndex(outcome.rowIndex);
    setTimeout(() => qtyRefs.current[outcome.rowIndex]?.focus(), 50);
    setTimeout(() => setScannedRowIndex(null), 1500);

    const name = [hit.product.brand, hit.product.baseName]
      .filter(Boolean)
      .join(" ");

    if (outcome.action === "NEEDS_VARIANT") {
      toast.info(t("sales.scannedPickVariant", { name }));
      return;
    }
    toast.success(
      t(
        outcome.action === "ADDED"
          ? "sales.scannedAdded"
          : "sales.scannedBumped",
        { name, qty: String(outcome.quantity) },
      ),
    );
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
    setCart(
      (() => {
        const byProduct = new Map<number, any[]>();
        for (const it of sale.items ?? []) {
          const arr = byProduct.get(it.productId) ?? [];
          arr.push(it);
          byProduct.set(it.productId, arr);
        }
        return Array.from(byProduct.values()).map((its) => {
          const first = its[0];
          if (!first?.variantId) {
            return {
              productId: String(first.productId),
              quantity: its.reduce((s, it) => s + (it.quantity || 0), 0),
              customPrice: first?.unitSellPrice
                ? String(first.unitSellPrice)
                : "",
              search: "",
              catFilter: "",
            };
          }
          return {
            productId: String(first.productId),
            quantity: 1,
            customPrice: "",
            search: "",
            catFilter: "",
            variantLines: its.map((it: any) => ({
              variantId: String(it.variantId),
              quantity: it.quantity || 0,
              customPrice: it.unitSellPrice
                ? String(it.unitSellPrice)
                : "",
            })),
          };
        });
      })(),
    );
    // Snapshot the original quantities per product+variant so inline stock
    // validation allows up to currentStock + originalQty while editing.
    const original: Record<string, number> = {};
    for (const it of sale.items ?? []) {
      const key = `${it.productId}:${it.variantId ?? ""}`;
      original[key] = (original[key] ?? 0) + (it.quantity || 0);
    }
    setEditOriginalQty(original);
    setSaleType(sale.saleType || "FULLY_PAID");
    setPaymentMethodId(
      sale.paymentMethodId ? String(sale.paymentMethodId) : "",
    );
    setCustomerId(sale.customerId ? String(sale.customerId) : "");
    setPaidAmount(
      sale.saleType === "PARTIALLY_PAID" ? String(sale.paidAmount) : "",
    );
    if (isOwner && sale.shopId) setOwnerShopId(String(sale.shopId));
  };

  const filteredProducts = useMemo(() => {
    if (!search) return products;
    const term = search.toLowerCase();
    return products.filter(
      (p) =>
        p.brand.toLowerCase().includes(term) ||
        p.baseName.toLowerCase().includes(term) ||
        p.sku.toLowerCase().includes(term) ||
        (p.barcode && p.barcode.toLowerCase().includes(term)),
    );
  }, [products, search]);

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
                setSaleType("FULLY_PAID");
                setShowForm(true);
              }}
              className="bg-green-600 text-white px-3 py-2 rounded-lg text-xs sm:text-sm font-medium hover:bg-green-700 whitespace-nowrap"
            >
              {t("sales.cashSale")}
            </button>
            <button
              onClick={() => {
                setEditing(null);
                setSaleType("PARTIALLY_PAID");
                setShowForm(true);
              }}
              className="bg-amber-500 text-white px-3 py-2 rounded-lg text-xs sm:text-sm font-medium hover:bg-amber-600 whitespace-nowrap"
            >
              {t("sales.partialSale")}
            </button>
            <button
              onClick={() => {
                setEditing(null);
                setSaleType("CREDITED");
                setShowForm(true);
              }}
              className="bg-red-500 text-white px-3 py-2 rounded-lg text-xs sm:text-sm font-medium hover:bg-red-600 whitespace-nowrap"
            >
              {t("sales.creditSaleShort")}
            </button>
          </div>
        </div>
      )}

      <Modal
        isOpen={showForm}
        onClose={resetForm}
        title={
          editing
            ? t("sales.editSaleTitle", { id: editing.id })
            : saleType === "FULLY_PAID"
              ? t("sales.recordCashSale")
              : saleType === "PARTIALLY_PAID"
                ? t("sales.recordPartialPayment")
                : t("sales.recordCreditSale")
        }
      >
        <form onSubmit={handleSale} className="grid grid-cols-1 gap-4">
          {/* Owner Shop Selector — must be first */}
          {isOwner && (
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">
                {t("sales.shopLocation")}
              </label>
              <SearchableSelect
                options={shops.map((s: any) => ({
                  value: String(s.id),
                  label: s.name,
                }))}
                value={ownerShopId}
                onChange={setOwnerShopId}
                placeholder={t("sales.searchShop")}
                required
              />
            </div>
          )}

          {/* Running Total */}
          <div className="bg-gray-50 p-3 rounded-lg text-center border">
            <span className="text-sm text-gray-500">{t("sales.totalLabel")}</span>
            <span className="text-xl font-bold text-gray-800">
              {fmtCurrency(rowTotalAll())}
            </span>
          </div>

          {/* Cart-level scanner: scan item after item; repeating a code bumps it. */}
          <BarcodeScanner
            continuous
            onScan={handleScanToCart}
            label={`📷 ${t("sales.scanToCart")}`}
            className="w-full px-4 py-2.5 rounded-lg text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700"
          />

          {cart.map((item, index) => {
            const selectedProduct = products.find(
              (p) => p.id === Number(item.productId),
            );
            const isVariantRow = !!selectedProduct?.hasVariants;
            const stockBase = getStockForProduct(item.productId);
            // While editing a sale the originally sold quantity stays allocated
            // to this line, so max allowed = current stock + original qty.
            const stockMax =
              stockBase + (editing ? originalQtyFor(item.productId) : 0);
            const stock = stockBase;
            const exceedsStock =
              item.productId && Number(item.quantity) > stockMax;
            const itemProducts = products.filter(
              (p) =>
                !item.catFilter || String(p.category?.id) === item.catFilter,
            );

            return (
              <div
                key={index}
                className={
                  "p-3 bg-gray-50 rounded-lg border transition-shadow " +
                  (scannedRowIndex === index
                    ? "ring-2 ring-indigo-400 border-indigo-300"
                    : "")
                }
              >
                <div className="flex flex-col sm:flex-row gap-2 mb-2 sm:items-end">
                  <div className="w-full sm:w-28">
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      {t("sales.category")}
                    </label>
                    <select
                      value={item.catFilter}
                      onChange={(e) =>
                        setCart(
                          cart.map((c, i) =>
                            i === index
                              ? { ...c, catFilter: e.target.value }
                              : c,
                          ),
                        )
                      }
                      className="border p-2 rounded-lg bg-white text-sm w-full"
                    >
                      <option value="">{t("common.all")}</option>
                      {categories.map((c: any) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-500 mb-1 flex items-center justify-between">
                      <span>{t("products.name")}</span>
                      {canAiScan && (
                        <AiPhotoPicker
                          compact
                          buttonLabel="scan"
                          busy={scanBusyIndex === index}
                          onImages={(images) => handleAiScan(images, index)}
                        />
                      )}
                    </label>
                    <SearchableSelect
                      options={itemProducts.map((p) => ({
                        value: String(p.id),
                        label: `${p.brand} ${p.baseName} — ${getStockForProduct(p.id)}${
                          p.unit ? " " + p.unit.name : ""
                        }`,
                        searchText: `${p.brand} ${p.baseName} ${p.sku}`,
                        disabled: cart.some(
                          (c, i) =>
                            c.productId === String(p.id) && i !== index,
                        ),
                      }))}
                      value={item.productId}
                      onChange={(v) =>
                        patchRow(index, { productId: v, variantLines: [] })
                      }
                      placeholder={t("restock.searchProduct")}
                      required
                      className="w-full"
                    />
                  </div>
                </div>

                {isVariantRow ? (
                  <div className="w-full">
                    <VariantLinesEditor
                      product={selectedProduct}
                      lines={item.variantLines ?? []}
                      originalByVariant={
                        editing ? originalByVariantFor(item.productId) : undefined
                      }
                      onChange={(lines) =>
                        patchRow(index, { variantLines: lines })
                      }
                    />
                    <div className="flex justify-end mt-1">
                      <button
                        type="button"
                        onClick={() =>
                          setCart(cart.filter((_, i) => i !== index))
                        }
                        className="text-red-400 hover:text-red-600 text-sm font-medium"
                      >
                        {t("sales.remove")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-500 mb-0.5">
                        {t("common.qty")}
                      </label>
                      <div className="flex items-center gap-1">
                        <input
                          ref={(el) => {
                            qtyRefs.current[index] = el;
                          }}
                          type="number"
                          min="1"
                          max={stockMax || undefined}
                          value={item.quantity}
                          onChange={(e) =>
                            patchRow(index, {
                              quantity: Number(e.target.value),
                            })
                          }
                          className={
                            "border p-2 rounded-lg flex-1 text-sm " +
                            (exceedsStock ? "border-red-500 bg-red-50" : "")
                          }
                          required
                        />
                        {selectedProduct?.unit && (
                          <span className="text-xs text-gray-500 whitespace-nowrap">
                            {selectedProduct.unit.name}
                          </span>
                        )}
                      </div>
                      {item.productId && (
                        <p
                          className={
                            "text-[10px] mt-0.5 " +
                            (exceedsStock
                              ? "text-red-500 font-semibold"
                              : "text-gray-400")
                          }
                        >
                          {exceedsStock
                            ? t("sales.maxValue", { n: String(stockMax) })
                            : t("sales.stockValue", { n: String(stock) })}
                        </p>
                      )}
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-500 mb-0.5">
                        {t("sales.price")}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={item.customPrice}
                        onChange={(e) =>
                          patchRow(index, { customPrice: e.target.value })
                        }
                        placeholder={
                          selectedProduct
                            ? selectedProduct.currentSellPrice.toFixed(2)
                            : ""
                        }
                        className="border p-2 rounded-lg w-full text-sm"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setCart(cart.filter((_, i) => i !== index))
                      }
                      className="text-red-400 hover:text-red-600 text-xl font-bold leading-none mb-1 flex-shrink-0"
                      title={t("sales.remove")}
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() =>
                setCart([
                  ...cart,
                  {
                    productId: "",
                    quantity: 1,
                    customPrice: "",
                    search: "",
                    catFilter: "",
                  },
                ])
              }
              className="text-sm text-blue-600 font-medium"
            >
              {t("sales.addItem")}
            </button>
          </div>

          <div className="border-t pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Running Total */}

            {/* Sale Type — only shown when editing */}
            {editing && (
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  {t("sales.paymentType")}
                </label>
                <div className="flex gap-2">
                  {(["FULLY_PAID", "PARTIALLY_PAID", "CREDITED"] as const).map(
                    (st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setSaleType(st)}
                        className={`flex-1 py-2 rounded-lg text-xs sm:text-sm font-medium border ${
                          saleType === st
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-gray-600 border-gray-300"
                        }`}
                      >
                        {st === "FULLY_PAID"
                          ? t("status.fullyPaid")
                          : st === "PARTIALLY_PAID"
                            ? t("sales.typePartial")
                            : t("sales.typeCredit")}
                      </button>
                    ),
                  )}
                </div>
              </div>
            )}

            {/* Payment Method — only for paid/partial */}
            {(saleType === "FULLY_PAID" || saleType === "PARTIALLY_PAID") && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  {t("sales.paymentMethod")}
                </label>
                <div className="flex gap-2">
                  <select
                    value={paymentMethodId}
                    onChange={(e) => setPaymentMethodId(e.target.value)}
                    className="border p-2 rounded-lg flex-1 bg-white text-sm"
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
                  <input
                    placeholder={t("credits.methodPlaceholder")}
                    value={newMethodName}
                    onChange={(e) => setNewMethodName(e.target.value)}
                    className="border p-2 rounded-lg w-24 text-sm"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!newMethodName.trim()) return;
                      try {
                        const r = await api.post("/payment-methods", {
                          name: newMethodName.trim(),
                        });
                        setPaymentMethods([...paymentMethods, r.data]);
                        setPaymentMethodId(String(r.data.id));
                        setNewMethodName("");
                      } catch (err: any) {
                        markHandled(err);
                        toast.error(
                          err?.response?.data?.message ??
                            t("credits.failedAddMethod"),
                        );
                      }
                    }}
                    className="bg-gray-200 px-2 rounded-lg text-xs"
                  >
                    +
                  </button>
                </div>
              </div>
            )}

            {/* Paid Amount — only for partial */}
            {saleType === "PARTIALLY_PAID" && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  {t("sales.paidAmountBirr")}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                  className="border p-2 rounded-lg w-full text-sm"
                  placeholder={t("sales.amountPaidNow")}
                />
              </div>
            )}

            {/* Customer — for partial and credited */}
            {(saleType === "PARTIALLY_PAID" || saleType === "CREDITED") && (
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  {t("sales.customer")}
                </label>
                <div className="flex gap-2">
                  <select
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    className="border p-2 rounded-lg flex-1 bg-white text-sm"
                    required
                  >
                    <option value="">{t("sales.selectCustomer")}</option>
                    {customers.map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.phone ? "· " + c.phone : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowCustomerModal(true)}
                    className="bg-gray-200 px-3 rounded-lg text-xs whitespace-nowrap"
                  >
                    + {t("common.new")}
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            type="submit"
            className="bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 font-medium text-sm"
          >
            {editing ? t("sales.updateSale") : t("sales.completeSale")}
          </button>
          {errorMsg && <p className="text-red-500 text-xs mt-1">{errorMsg}</p>}
        </form>
      </Modal>

      <Modal
        isOpen={showCustomerModal}
        onClose={() => setShowCustomerModal(false)}
        title={t("credits.newCustomerTitle")}
      >
        <CustomerForm
          onCreated={(cust) => {
            setCustomers([...customers, cust]);
            setCustomerId(String(cust.id));
            setShowCustomerModal(false);
          }}
          onCancel={() => setShowCustomerModal(false)}
        />
      </Modal>
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
              placeholder="e.g. damaged, wrong item"
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
              placeholder="e.g. Paid via CBE"
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
