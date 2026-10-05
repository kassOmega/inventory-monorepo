"use client";
// The sale form — items, sale type and payment — for every place a sale is
// recorded: the Sales page (cash / partial / credit entry points plus the
// "edit sale" action) and the Credit pages, which open it for one customer.
//
// It owns its reference data (products, categories, customers, payment
// methods, shops) and its own Modal, so a caller only has to say *why* it is
// opening the form:
//
//   <SaleForm isOpen={open} onClose={close} onSaved={refreshSales} />
//   <SaleForm isOpen={open} onClose={close} defaultSaleType="CREDITED"
//             defaultCustomerId={c.id} defaultCustomerName={c.name}
//             creditCustomersOnly onSaved={refreshCustomer} />
//
// Behaviour that used to differ between the two forms is unified here: the
// stricter stock validation of the Sales page (per-variant, edit-mode aware)
// applies everywhere, and the idempotency key survives a failed submit so a
// retry can never book the sale twice.
import api, { markHandled } from "@/lib/api";
import BarcodeScanner from "./BarcodeScanner";
import AiPhotoPicker from "./AiPhotoPicker";
import SearchableSelect from "./SearchableSelect";
import CustomerForm from "./CustomerForm";
import Modal from "./Modal";
import Loading from "./Loading";
import VariantLinesEditor, {
  defaultVariantLine,
  VariantSaleLine,
  variantStockFor,
  variantUnitPrice,
} from "./VariantLinesEditor";
import { addScannedToCart } from "@/lib/cart";
import { lookupScannedProduct } from "@/lib/scanLookup";
import { newClientRef } from "@/lib/clientRef";
import { variantLabel } from "@/lib/variantLabel";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "./ToastProvider";
import { useSingleLocationAutofill } from "@/lib/singleLocation";
import { fmtCurrency } from "@/lib/currency";

export type SaleType = "FULLY_PAID" | "PARTIALLY_PAID" | "CREDITED";

/** The three sale types, in the order the type switch shows them. */
export const SALE_TYPES: SaleType[] = [
  "FULLY_PAID",
  "PARTIALLY_PAID",
  "CREDITED",
];

interface Product {
  id: number;
  sku?: string;
  barcode?: string;
  brand?: string;
  baseName?: string;
  currentSellPrice?: number;
  hasVariants?: boolean;
  variants?: any[];
  inventory?: Array<{ quantity?: number; variantId?: number | null }>;
  category?: { id: number; name: string } | null;
  unit?: { id: number; name: string } | null;
}

interface CartItem {
  productId: string;
  quantity: number;
  customPrice: string;
  search: string;
  catFilter: string;
  variantLines?: VariantSaleLine[];
}

interface SaleItemPayload {
  productId: number;
  variantId?: number;
  quantity: number;
  customPrice?: number;
}

interface Props {
  isOpen: boolean;
  /** Called for every way out of the modal: ✕, backdrop or Cancel. */
  onClose: () => void;
  /** Sale being corrected: the form pre-fills from it and PUTs `/sales/:id`. */
  editing?: any | null;
  /** Type the form opens with — the entry point usually fixes it (POS: cash). */
  defaultSaleType?: SaleType;
  /** Open the form for a known customer (the credit pages do). */
  defaultCustomerId?: number | string | null;
  /** Shown while {@link defaultCustomerId} is missing from the customer list. */
  defaultCustomerName?: string;
  /** Offer only credit-eligible customers (the credit pages do). */
  creditCustomersOnly?: boolean;
  /**
   * Hide the type switch: the caller's entry point already chose the type, so
   * switching it here would contradict the button that was pressed.
   */
  hideSaleTypeSwitch?: boolean;
  /** Modal heading; defaults to a title derived from the sale type. */
  title?: string;
  /** Called with the created/updated sale once the request succeeds. */
  onSaved?: (sale: any) => void;
}

/** A pristine cart row: the form keeps at least one so it is never empty. */
const blankRow = (): CartItem => ({
  productId: "",
  quantity: 1,
  customPrice: "",
  search: "",
  catFilter: "",
});

export default function SaleForm(props: Props) {
  // The form body is remounted whenever the form opens — or switches to another
  // sale — so its state is initialised from the props instead of being reset by
  // an effect: a fresh sale, or the one being corrected.
  const openKey = props.isOpen
    ? `open-${props.editing?.id ?? "new"}`
    : "closed";
  return <SaleFormModal key={openKey} {...props} />;
}

/** The cart rows of a sale being corrected (one empty row when creating). */
function cartFromSale(sale: any | null): CartItem[] {
  if (!sale) return [blankRow()];
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
        customPrice: first?.unitSellPrice ? String(first.unitSellPrice) : "",
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
        customPrice: it.unitSellPrice ? String(it.unitSellPrice) : "",
      })),
    };
  });
}

/**
 * Original quantities per product+variant while editing, so the stock the form
 * allows is currentStock + originalQty: those units are still allocated to this
 * sale until it is saved.
 */
function originalQtyFromSale(sale: any | null): Record<string, number> {
  const original: Record<string, number> = {};
  for (const it of sale?.items ?? []) {
    const key = `${it.productId}:${it.variantId ?? ""}`;
    original[key] = (original[key] ?? 0) + (it.quantity || 0);
  }
  return original;
}

function SaleFormModal({
  isOpen,
  onClose,
  editing = null,
  defaultSaleType = "FULLY_PAID",
  defaultCustomerId = null,
  defaultCustomerName = "",
  creditCustomersOnly = false,
  hideSaleTypeSwitch = false,
  title,
  onSaved,
}: Props) {
  const { t } = useTranslation();
  const { user, hasPermission } = useAuth();
  const toast = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [shops, setShops] = useState<any[]>([]);
  const [ownerShopId, setOwnerShopId] = useState(
    editing?.shopId && user?.isSuperuser ? String(editing.shopId) : "",
  );
  const [cart, setCart] = useState<CartItem[]>(() => cartFromSale(editing));
  const [saleType, setSaleType] = useState<SaleType>(
    editing?.saleType ?? defaultSaleType,
  );
  const [paymentMethodId, setPaymentMethodId] = useState(
    editing?.paymentMethodId ? String(editing.paymentMethodId) : "",
  );
  const [paidAmount, setPaidAmount] = useState(
    editing?.saleType === "PARTIALLY_PAID" && editing?.paidAmount != null
      ? String(editing.paidAmount)
      : "",
  );
  const [customerId, setCustomerId] = useState(
    editing?.customerId
      ? String(editing.customerId)
      : defaultCustomerId != null
        ? String(defaultCustomerId)
        : "",
  );
  const [newMethodName, setNewMethodName] = useState("");
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  // Original quantities on the sale being corrected ({} when creating) — fixed
  // for as long as this mount lives, since the body remounts per open.
  const editOriginalQty = useMemo(() => originalQtyFromSale(editing), [editing]);
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(false);
  // AI scan (photo → match catalog product) for individual cart lines.
  const [scanBusyIndex, setScanBusyIndex] = useState<number | null>(null);
  // Row touched by the last cart-level scan: highlighted briefly, qty focused.
  const [scannedRowIndex, setScannedRowIndex] = useState<number | null>(null);

  // Idempotency key: fresh for every new sale, but kept while the same sale is
  // retried, so a double submit cannot book it twice.
  const clientRef = useRef<string>(newClientRef());
  // Latest cart for the "scan to cart" flow: scans arrive back-to-back, so each
  // one must build on the previous result rather than on render state.
  const cartRef = useRef<CartItem[]>(cart);
  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);
  // Refs to the quantity inputs so a barcode scan can focus the quantity field.
  const qtyRefs = useRef<Array<HTMLInputElement | null>>([]);

  const isOwner = user?.isSuperuser === true;
  const canAiScan = user?.isSuperuser || hasPermission("ai.sales-assist");
  const cashMethod = paymentMethods.find(
    (m: any) => m.name.toLowerCase() === "cash",
  );
  // Autofill the sole shop when the business has only one.
  useSingleLocationAutofill(locations, ownerShopId, setOwnerShopId);

  const currentCustomerName =
    customers.find((c: any) => String(c.id) === customerId)?.name ??
    defaultCustomerName;
  // Pickers are loaded for an open form; the body mounts per open, so a closed
  // form fetches nothing and an open one loads exactly once.
  useEffect(() => {
    if (!isOpen) return;
    api
      .get("/categories")
      .then((r) => setCategories(r.data))
      .catch(() => {});
    // Only credit-eligible customers can be billed on the credit pages — the
    // backend enforces the same rule, this keeps blocked ones out of the picker.
    api
      .get(creditCustomersOnly ? "/customers?canTakeCredit=true" : "/customers")
      .then((r) => setCustomers(r.data))
      .catch(() => {});
    api
      .get("/payment-methods")
      .then((r) => {
        setPaymentMethods(r.data);
        const cash = (r.data as any[]).find(
          (m: any) => m.name.toLowerCase() === "cash",
        );
        // Cash is the default + initially selected payment method.
        setPaymentMethodId((prev) => prev || (cash ? String(cash.id) : ""));
      })
      .catch(() => {});
    if (isOwner) {
      api
        .get("/locations")
        .then((r) => {
          setLocations(r.data);
          setShops(r.data.filter((l: any) => l.type === "SHOP"));
        })
        .catch(() => {});
    }
  }, [isOpen, isOwner, creditCustomersOnly]);

  // Products carry location-scoped stock, so re-read them when the chosen shop
  // changes. A shopkeeper is scoped to their own location by their token.
  useEffect(() => {
    if (!isOpen) return;
    const locParam = isOwner && ownerShopId ? `?locationId=${ownerShopId}` : "";
    api
      .get(`/products${locParam}`)
      .then((r) => setProducts(r.data))
      .catch(() => setErrorMsg(t("sales.errorProcessing")));
    // Intent: reload for the open form whenever the shop scope changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isOwner, ownerShopId]);

  /** On-hand stock for a product, summed over the locations in scope. */
  const productStock = (p: any): number =>
    ((p?.inventory ?? []) as any[]).reduce(
      (sum, inv) => sum + (inv?.quantity ?? 0),
      0,
    );

  const getStockForProduct = (productId: number | string): number => {
    const id = Number(productId);
    if (!id) return 0;
    const product = products.find((p) => p.id === id);
    if (!product) return 0;
    return productStock(product);
  };

  // Original quantity already allocated to this sale line (0 when creating).
  const originalQtyFor = (
    productId: number | string,
    variantId?: number | string | null,
  ) => editOriginalQty[`${productId}:${variantId ?? ""}`] ?? 0;

  // Per-variant original map for the variant editor (only used in edit mode).
  const originalByVariantFor = (productId: string | number) => {
    const prefix = `${productId}:`;
    const out: Record<string, number> = {};
    for (const [key, qty] of Object.entries(editOriginalQty)) {
      if (key.startsWith(prefix)) out[key.slice(prefix.length)] = qty;
    }
    return out;
  };

  const rowTotal = (c: CartItem): number => {
    if (!c.productId) return 0;
    const p = products.find((x) => x.id === Number(c.productId));
    if (!p) return 0;
    if (p.hasVariants) {
      return (c.variantLines ?? []).reduce(
        (s, l) => s + variantUnitPrice(p, l) * (l.quantity || 0),
        0,
      );
    }
    const price = Number(c.customPrice) || Number(p.currentSellPrice) || 0;
    return price * Number(c.quantity || 1);
  };
  const total = cart.reduce((sum, c) => sum + rowTotal(c), 0);

  /** One payload line per sold variant line, or per plain cart row. */
  const expandCartItems = (): SaleItemPayload[] => {
    const rows = cart.filter((c) => c.productId);
    const items: SaleItemPayload[] = [];
    for (const c of rows) {
      const p = products.find((x) => x.id === Number(c.productId));
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

  const patchRow = (index: number, patch: Partial<CartItem>) =>
    setCart((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  const addRow = () => setCart((prev) => [...prev, blankRow()]);
  const removeRow = (index: number) =>
    setCart((prev) => prev.filter((_, i) => i !== index));

  /** Photo → catalog match for one cart line (AI sales assist). */
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
          nm ? t("sales.noAiMatch", { name: nm }) : t("sales.noAiMatchGeneric"),
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
      const productName = `${product.brand} ${product.baseName}${
        variant ? ` (${variant.sku || t("sales.variantWord")})` : ""
      }`;
      toast.success(
        t("sales.matchedProduct", { name: productName }) +
          (matchType === "partial" ? t("sales.partialConfirm") : ""),
      );
    } catch (err: any) {
      markHandled(err);
      toast.error(err?.response?.data?.message || t("sales.aiReadFailed"));
    } finally {
      setScanBusyIndex(null);
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

    // Exact backend lookup first (it also resolves a variant code and the
    // shop's stock); the shared helper falls back to the catalogue in memory.
    const hit = await lookupScannedProduct(
      code,
      products,
      isOwner && ownerShopId ? ownerShopId : null,
    );

    if (!hit) {
      toast.error(t("restock.noProductForSku", { sku: code }));
      return;
    }

    const { product } = hit;
    // Merge so the row's select and the stock helpers can see the product.
    setProducts((prev) =>
      prev.some((p) => p.id === product.id) ? prev : [...prev, product],
    );

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
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    if (isOwner && shops.length > 0 && !ownerShopId) {
      setErrorMsg(t("sv.shopRequired"));
      return;
    }
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
      setErrorMsg(t("sales.addAtLeastOneItem"));
      return;
    }
    // Every variant row needs at least one variant quantity.
    for (const row of cart.filter((c) => c.productId)) {
      const p = products.find((x) => x.id === Number(row.productId));
      if (
        p?.hasVariants &&
        !(row.variantLines ?? []).some((l) => l.quantity > 0)
      ) {
        setErrorMsg(
          t("sv.needQty", {
            name: `${p.brand ?? ""} ${p.baseName ?? ""}`.trim(),
          }),
        );
        return;
      }
    }
    // Plain rows check product stock; variant lines check the exact variant.
    // While editing, the units already on the sale stay sellable, hence the
    // currentStock + originalQty allowance.
    for (const item of items) {
      const p = products.find((pr) => pr.id === item.productId);
      if (!p) continue;
      const stock = item.variantId
        ? variantStockFor(p, item.variantId)
        : getStockForProduct(item.productId);
      const stockMax =
        stock +
        (editing ? originalQtyFor(item.productId, item.variantId) : 0);
      if (item.quantity > stockMax) {
        const v = item.variantId
          ? (p.variants ?? []).find((vv: any) => vv.id === item.variantId)
          : undefined;
        toast.error(
          t("sales.cannotSell", {
            qty: String(item.quantity),
            name: `${p.brand ?? ""} ${p.baseName ?? ""}${
              v ? " • " + variantLabel(v) : ""
            }`.trim(),
            stock: String(stockMax),
          }),
        );
        return;
      }
    }

    const payload = {
      items,
      saleType,
      paidAmount:
        saleType === "PARTIALLY_PAID" ? Number(paidAmount) : undefined,
      paymentMethodId:
        saleType === "CREDITED" || !paymentMethodId
          ? undefined
          : Number(paymentMethodId),
      customerId: customerId ? Number(customerId) : undefined,
      shopId: isOwner && ownerShopId ? Number(ownerShopId) : undefined,
    };

    setLoading(true);
    try {
      if (editing) {
        const res = await api.put(`/sales/${editing.id}`, payload);
        onSaved?.(res.data);
      } else {
        const res = await api.post("/sales", {
          ...payload,
          clientRef: clientRef.current,
        });
        // CRM: tell the cashier what the customer just earned, when the loyalty
        // programme is on and the sale was billed to somebody.
        const earned = res.data?.loyalty?.earned ?? 0;
        if (earned > 0) {
          toast.success(t("crm.earnedToast", { points: earned }));
        }
        onSaved?.(res.data);
      }
    } catch (err: any) {
      markHandled(err);
      setErrorMsg(err?.response?.data?.message ?? t("sales.errorProcessing"));
    } finally {
      setLoading(false);
    }
  };
  const heading =
    title ??
    (editing
      ? t("sales.editSaleTitle", { id: editing.id })
      : saleType === "FULLY_PAID"
        ? t("sales.recordCashSale")
        : saleType === "PARTIALLY_PAID"
          ? t("sales.recordPartialPayment")
          : t("sales.recordCreditSale"));

  // A customer the caller opened the form for, but the picker cannot show yet
  // (the list is still loading, or the customer is not credit-eligible).
  const missingPresetCustomer =
    !!customerId && !customers.some((c: any) => String(c.id) === customerId);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={heading}>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4">
        {/* Owner Shop Selector — must be first */}
        {isOwner && shops.length > 0 && (
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
          <span className="block text-xl font-bold text-gray-800">
            {fmtCurrency(total)}
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
          const stock = getStockForProduct(item.productId);
          // While editing a sale the originally sold quantity stays allocated
          // to this line, so max allowed = current stock + original qty.
          const stockMax =
            stock + (editing ? originalQtyFor(item.productId) : 0);
          const exceedsStock =
            item.productId && Number(item.quantity) > stockMax;
          const itemProducts = products.filter(
            (p) => !item.catFilter || String(p.category?.id) === item.catFilter,
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
              <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                <div className="w-full sm:w-28">
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    {t("sales.category")}
                  </label>
                  <select
                    value={item.catFilter}
                    onChange={(e) =>
                      patchRow(index, { catFilter: e.target.value })
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
                      label: `${p.brand ?? ""} ${p.baseName ?? ""} — ${productStock(p)}${
                        p.unit ? " " + p.unit.name : ""
                      }`,
                      searchText: `${p.brand ?? ""} ${p.baseName ?? ""} ${
                        p.sku ?? ""
                      }`,
                      disabled: cart.some(
                        (c, i) => c.productId === String(p.id) && i !== index,
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
                      onClick={() => removeRow(index)}
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
                          patchRow(index, { quantity: Number(e.target.value) })
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
                          ? String(selectedProduct.currentSellPrice || "0.00")
                          : "0.00"
                      }
                      className="border p-2 rounded-lg w-full text-sm"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
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
            onClick={addRow}
            className="text-sm text-blue-600 font-medium"
          >
            {t("sales.addItem")}
          </button>
        </div>

        <div className="border-t pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Sale type — the entry point usually fixes it (see hideSaleTypeSwitch). */}
          {!hideSaleTypeSwitch && (
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {t("sales.paymentType")}
              </label>
              <div className="flex gap-2">
                {SALE_TYPES.map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setSaleType(st)}
                    className={`flex-1 py-2 rounded-lg text-xs sm:text-sm font-medium border ${
                      saleType === st
                        ? st === "CREDITED"
                          ? "bg-red-500 text-white border-red-500"
                          : st === "PARTIALLY_PAID"
                            ? "bg-amber-500 text-white border-amber-500"
                            : "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-gray-600 border-gray-300"
                    }`}
                  >
                    {st === "FULLY_PAID"
                      ? t("status.fullyPaid")
                      : st === "PARTIALLY_PAID"
                        ? t("sales.typePartial")
                        : t("sales.typeCredit")}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Payment method — not needed for a fully credited sale */}
          {saleType !== "CREDITED" && (
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
                    <option value="">
                      {t("purchases.selectPaymentMethod")}
                    </option>
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

          {/* Paid amount — only for a partially paid sale */}
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
          {/* Customer — required for credit/partial, an optional attachment
              otherwise (so a walk-in can still be tied to a profile). */}
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              {t("sales.customer")}
              {(saleType === "PARTIALLY_PAID" || saleType === "CREDITED") && (
                <span className="text-red-500"> *</span>
              )}
            </label>
            <div className="flex gap-2">
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="border p-2 rounded-lg flex-1 bg-white text-sm"
                required={
                  saleType === "PARTIALLY_PAID" || saleType === "CREDITED"
                }
              >
                <option value="">{t("sales.selectCustomer")}</option>
                {/* The customer this form was opened for, shown until the list
                    holds them (or when they are not credit-eligible). */}
                {missingPresetCustomer && (
                  <option value={customerId}>
                    {currentCustomerName || t("sales.selectCustomer")}
                  </option>
                )}
                {customers.map((c: any) => {
                  // The backend blocks credit-blocked customers from credit
                  // sales; keep them unpickable here so the cashier sees why
                  // before the sale is rejected.
                  const blocked = c.canTakeCredit === false;
                  return (
                    <option
                      key={c.id}
                      value={c.id}
                      disabled={blocked && saleType !== "FULLY_PAID"}
                    >
                      {c.name} {c.phone ? "· " + c.phone : ""}
                      {blocked ? ` — ${t("crm.creditBlocked")}` : ""}
                    </option>
                  );
                })}
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
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={loading}
            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex-1 flex items-center justify-center gap-2"
          >
            {loading && <Loading size="sm" />}
            {editing ? t("sales.updateSale") : t("sales.completeSale")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-300"
          >
            {t("common.cancel")}
          </button>
        </div>
        {errorMsg && (
          <p className="text-red-500 text-sm bg-red-50 p-2 rounded-lg">
            {errorMsg}
          </p>
        )}
      </form>

      {/* New customer without losing the cart: the form stays open behind it. */}
      <Modal
        isOpen={showCustomerModal}
        onClose={() => setShowCustomerModal(false)}
        title={t("credits.newCustomerTitle")}
      >
        <CustomerForm
          onCreated={(cust: any) => {
            setCustomers((prev) =>
              prev.some((c: any) => c.id === cust.id) ? prev : [...prev, cust],
            );
            setCustomerId(String(cust.id));
            setShowCustomerModal(false);
          }}
          onCancel={() => setShowCustomerModal(false)}
        />
      </Modal>
    </Modal>
  );
}
