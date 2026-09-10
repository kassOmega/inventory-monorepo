"use client";
import api, { markHandled } from "@/lib/api";
import BarcodeScanner from "./BarcodeScanner";
import AiPhotoPicker from "./AiPhotoPicker";
import SearchableSelect from "./SearchableSelect";
import CustomerForm from "./CustomerForm";
import Modal from "./Modal";
import Loading from "./Loading";
import VariantLinesEditor, {
  addOrBumpVariantLine,
  defaultVariantLine,
  VariantSaleLine,
  variantUnitPrice,
} from "./VariantLinesEditor";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "./ToastProvider";
import { useSingleLocationAutofill } from "@/lib/singleLocation";
import { fmtCurrency } from "@/lib/currency";

interface Props {
  customerId: number;
  customerName: string;
  onCreated: () => void;
  onCancel: () => void;
}

interface CartItem {
  productId: string;
  quantity: number;
  customPrice: string;
  search: string;
  catFilter: string;
  variantLines?: VariantSaleLine[];
}

type SaleType = "FULLY_PAID" | "PARTIALLY_PAID" | "CREDITED";

export default function CreditSaleForm({
  customerId,
  customerName,
  onCreated,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const { user, hasPermission } = useAuth();
  const toast = useToast();

  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [shops, setShops] = useState<any[]>([]);
  const [ownerShopId, setOwnerShopId] = useState("");
  const [cart, setCart] = useState<CartItem[]>([
    { productId: "", quantity: 1, customPrice: "", search: "", catFilter: "" },
  ]);
  const [saleType, setSaleType] = useState<SaleType>("CREDITED");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [newMethodName, setNewMethodName] = useState("");
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number>(
    customerId,
  );
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [scanBusyIndex, setScanBusyIndex] = useState<number | null>(null);

  const isOwner = user?.isSuperuser === true;
  const canAiScan = user?.isSuperuser || hasPermission("ai.sales-assist");
  const cashMethod = paymentMethods.find(
    (m: any) => m.name.toLowerCase() === "cash",
  );
  const selectedCustomerName =
    customers.find((c: any) => c.id === selectedCustomerId)?.name ??
    customerName;
  useSingleLocationAutofill(locations, ownerShopId, setOwnerShopId);

  useEffect(() => {
    api.get("/categories").then((r) => setCategories(r.data));
    api.get("/customers").then((r) => setCustomers(r.data));
    api.get("/payment-methods").then((r) => {
      setPaymentMethods(r.data);
      const cash = (r.data as any[]).find(
        (m: any) => m.name.toLowerCase() === "cash",
      );
      setPaymentMethodId((prev) => prev || (cash ? String(cash.id) : ""));
    });
    if (isOwner) {
      api
        .get("/locations")
        .then((r) => {
          setLocations(r.data);
          setShops(r.data.filter((l: any) => l.type === "SHOP"));
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const locParam = isOwner && ownerShopId ? `?locationId=${ownerShopId}` : "";
    api
      .get(`/products${locParam}`)
      .then((r) => setProducts(r.data))
      .catch(() => setErrorMsg(t("cs.processingError")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner, ownerShopId]);

  const patchRow = (index: number, patch: Partial<CartItem>) =>
    setCart((prev) =>
      prev.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    );

  const productStock = (p: any): number =>
    (p?.inventory ?? []).reduce(
      (sum: number, inv: any) => sum + (inv.quantity ?? 0),
      0,
    );

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
    const price = Number(c.customPrice) || p.currentSellPrice || 0;
    return price * Number(c.quantity || 1);
  };
  const total = cart.reduce((sum, c) => sum + rowTotal(c), 0);

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
      const { product, variant } = res.data;
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
      toast.success(t("sales.matchedProduct", { name: productName }));
    } catch (err: any) {
      markHandled(err);
      toast.error(err?.response?.data?.message || t("sales.aiReadFailed"));
    } finally {
      setScanBusyIndex(null);
    }
  };

  const handleScanAt = (index: number, sku: string) => {
    const code = sku.toLowerCase();
    let product = products.find(
      (p) =>
        (p.sku || "").toLowerCase() === code ||
        (p.barcode || "").toLowerCase() === code,
    );
    let matchedVariant: any = null;
    if (!product) {
      for (const p of products) {
        const v = (p.variants ?? []).find(
          (vx: any) =>
            (vx.sku || "").toLowerCase() === code ||
            (vx.barcode || "").toLowerCase() === code,
        );
        if (v) {
          product = p;
          matchedVariant = v;
          break;
        }
      }
    }
    if (!product) {
      setErrorMsg(t("cs.noProductFor", { sku }));
      return;
    }
    const rowHas = cart[index];
    const sameProduct = String(rowHas?.productId) === String(product.id);
    if (
      !sameProduct &&
      cart.some(
        (c, i) =>
          i !== index &&
          String(c.productId) === String(product.id) &&
          (c.variantLines ?? []).length === 0,
      )
    ) {
      setErrorMsg(
        t("cs.alreadyInSale", {
          name: `${product.brand} ${product.baseName}`,
        }),
      );
      return;
    }
    patchRow(index, {
      productId: String(product.id),
      variantLines: matchedVariant
        ? sameProduct
          ? addOrBumpVariantLine(
              rowHas?.variantLines ?? [],
              defaultVariantLine(product, matchedVariant),
            )
          : [defaultVariantLine(product, matchedVariant)]
        : product.hasVariants
          ? []
          : undefined,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    if (isOwner && shops.length > 0 && !ownerShopId) {
      setErrorMsg(t("sv.shopRequired"));
      return;
    }
    const rows = cart.filter((c) => c.productId);
    if (rows.length === 0) {
      setErrorMsg(t("cs.atLeastOneItem"));
      return;
    }
    for (const c of rows) {
      const p = products.find((pr) => pr.id === Number(c.productId));
      if (
        p?.hasVariants &&
        !(c.variantLines ?? []).some((l) => l.quantity > 0)
      ) {
        setErrorMsg(
          t("sv.needQty", {
            name: `${p.brand ?? ""} ${p.baseName ?? ""}`.trim(),
          }),
        );
        return;
      }
    }
    if (
      (saleType === "FULLY_PAID" || saleType === "PARTIALLY_PAID") &&
      !paymentMethodId
    ) {
      setErrorMsg(t("cs.methodRequired"));
      return;
    }
    if (
      saleType === "PARTIALLY_PAID" &&
      (!paidAmount || Number(paidAmount) <= 0)
    ) {
      setErrorMsg(t("cs.paidAmountError"));
      return;
    }
    const items = rows.flatMap((c) => {
      const p = products.find((pr) => pr.id === Number(c.productId));
      if (!p) return [];
      if (p.hasVariants) {
        return (c.variantLines ?? [])
          .filter((l) => l.quantity > 0)
          .map((l) => ({
            productId: Number(c.productId),
            variantId: Number(l.variantId),
            quantity: l.quantity,
            customPrice: l.customPrice ? Number(l.customPrice) : undefined,
          }));
      }
      return [
        {
          productId: Number(c.productId),
          quantity: Number(c.quantity),
          customPrice: c.customPrice ? Number(c.customPrice) : undefined,
        },
      ];
    });
    if (items.length === 0) {
      setErrorMsg(t("cs.atLeastOneItem"));
      return;
    }
    setLoading(true);
    try {
      await api.post("/sales", {
        items,
        saleType,
        paidAmount:
          saleType === "PARTIALLY_PAID" ? Number(paidAmount) : undefined,
        paymentMethodId:
          saleType === "CREDITED" ? undefined : Number(paymentMethodId),
        customerId:
          saleType === "FULLY_PAID" ? undefined : Number(selectedCustomerId),
        shopId: isOwner && ownerShopId ? Number(ownerShopId) : undefined,
      });
      onCreated();
    } catch (err: any) {
      markHandled(err);
      setErrorMsg(err?.response?.data?.message ?? t("cs.processingError"));
    } finally {
      setLoading(false);
    }
  };

  const addRow = () =>
    setCart([
      ...cart,
      { productId: "", quantity: 1, customPrice: "", search: "", catFilter: "" },
    ]);
  const removeRow = (index: number) =>
    setCart(cart.filter((_, i) => i !== index));

  return (
    <>
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4">
      {/* Selected customer (auto-filled, changeable in the field below) */}
      <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm">
        <span className="text-blue-500 text-xs block">{t("cs.customer")}</span>
        <span className="font-semibold text-blue-900">
          {selectedCustomerName}
        </span>
      </div>

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

      <div className="bg-gray-50 p-3 rounded-lg text-center border">
        <span className="text-sm text-gray-500">{t("sales.totalLabel")}</span>
        <span className="block text-xl font-bold text-gray-800">
          {fmtCurrency(total)}
        </span>
      </div>

      {cart.map((item, index) => {
        const selectedProduct = products.find(
          (p) => p.id === Number(item.productId),
        );
        const isVariantRow = !!selectedProduct?.hasVariants;
        const stock = selectedProduct ? productStock(selectedProduct) : 0;
        const exceedsStock = item.productId && Number(item.quantity) > stock;
        const rowProducts = products.filter(
          (p) => !item.catFilter || String(p.category?.id) === item.catFilter,
        );
        return (
          <div
            key={index}
            className="p-3 bg-gray-50 rounded-lg border space-y-2"
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
                <div className="flex gap-2">
                  <SearchableSelect
                    options={rowProducts.map((p: any) => ({
                      value: String(p.id),
                      label: `${p.brand} ${p.baseName} — ${productStock(p)}${
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
                    className="flex-1"
                  />
                  <BarcodeScanner
                    onScan={(sku) => handleScanAt(index, sku)}
                    className="px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap bg-blue-600 text-white hover:bg-blue-700"
                  />
                </div>
              </div>
            </div>

            {isVariantRow ? (
              <VariantLinesEditor
                product={selectedProduct}
                lines={item.variantLines ?? []}
                onChange={(lines) =>
                  patchRow(index, { variantLines: lines })
                }
              />
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex-1 min-w-32">
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    {t("common.qty")}
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={stock || undefined}
                    value={item.quantity}
                    onChange={(e) =>
                      patchRow(index, { quantity: Number(e.target.value) })
                    }
                    className={
                      "border p-2 rounded-lg w-full text-sm " +
                      (exceedsStock ? "border-red-500 bg-red-50" : "")
                    }
                    required
                  />
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
                        ? t("sales.maxValue", { n: String(stock) })
                        : t("sales.stockValue", { n: String(stock) })}
                    </p>
                  )}
                </div>
                <div className="flex-1 min-w-32">
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    {t("sales.price")}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={item.customPrice}
                    placeholder={
                      selectedProduct
                        ? String(selectedProduct.currentSellPrice || "0.00")
                        : "0.00"
                    }
                    onChange={(e) =>
                      patchRow(index, { customPrice: e.target.value })
                    }
                    className="border p-2 rounded-lg w-full text-sm"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  className="text-red-400 hover:text-red-600 text-xl font-bold mb-1"
                  title={t("common.remove")}
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

      {/* Sale type */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-1">
          {t("sales.paymentType")}
        </p>
        <div className="flex gap-2">
          {(["FULLY_PAID", "PARTIALLY_PAID", "CREDITED"] as const).map(
            (st) => (
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
            ),
          )}
        </div>
      </div>

      {/* Payment method */}
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
                  setErrorMsg(t("credits.failedAddMethod"));
                }
              }}
              className="bg-gray-200 px-2 rounded-lg text-xs"
            >
              +
            </button>
          </div>
        </div>
      )}

      {/* Paid amount */}
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

      {/* Customer (auto-filled with the selected user) */}
      {saleType !== "FULLY_PAID" && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            {t("sales.customer")}
          </label>
          <div className="flex gap-2">
            <select
              value={String(selectedCustomerId)}
              onChange={(e) => setSelectedCustomerId(Number(e.target.value))}
              className="border p-2 rounded-lg flex-1 bg-white text-sm"
            >
              <option value={String(selectedCustomerId)}>
                {selectedCustomerName}
              </option>
              {customers
                .filter((c: any) => c.id !== selectedCustomerId)
                .map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.phone ? " · " + c.phone : ""}
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

      {errorMsg && (
        <p className="text-red-500 text-sm bg-red-50 p-2 rounded-lg">
          {errorMsg}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex-1 flex items-center justify-center gap-2"
        >
          {loading && <Loading size="sm" />}
          {loading ? t("cs.processing") : t("sales.completeSale")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-300"
        >
          {t("common.cancel")}
        </button>
      </div>
    </form>

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
          setSelectedCustomerId(cust.id);
          setShowCustomerModal(false);
        }}
        onCancel={() => setShowCustomerModal(false)}
      />
    </Modal>
    </>
  );
}
