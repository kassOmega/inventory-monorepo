"use client";
import BarcodeScanner from "@/app/components/BarcodeScanner";
import { CURRENCY_SYMBOL } from "@/lib/currency";
import { isAmharic } from "@/lib/locale";
import Modal from "@/app/components/Modal";
import ProductForm from "@/app/components/ProductForm";
import SearchableSelect from "@/app/components/SearchableSelect";
import { useToast } from "@/app/components/ToastProvider";
import Loading from "@/app/components/Loading";
import { useAuth } from "@/context/AuthContext";
import { variantLabel } from "@/lib/variantLabel";
import VariantLinesEditor, {
  addOrBumpVariantLine,
  VariantSaleLine,
} from "@/app/components/VariantLinesEditor";
import api, { markHandled } from "@/lib/api";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export default function RestockPage() {
  const { t } = useTranslation();
  const { user, activeMembership } = useAuth();
  const toast = useToast();
  // Amharic mode labels the price fields with the native currency word.
  const curSymbol = isAmharic() ? "ብር" : CURRENCY_SYMBOL;
  const isOwner = user?.isSuperuser === true;
  // Standalone shops manage a single hidden location — no location picker.
  const isStandalone = activeMembership?.standalone === true;
  // Non-owners (storekeepers or shop employees) restock their own location;
  // the backend enforces this too.
  const myLocationId =
    user?.locationType === "STORE" || user?.locationType === "SHOP"
      ? String(user.locationId ?? "")
      : "";

  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Product filters
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  const [form, setForm] = useState({
    productId: "",
    storeId: "",
    quantity: 1,
    newBuyPrice: 0,
    newSellPrice: 0,
    variantId: "",
    batchNumber: "",
    manufactureDate: "",
    expiryDate: "",
  });
  // Multi-variant restock lines (used when the product has variants).
  const [variantLines, setVariantLines] = useState<VariantSaleLine[]>([]);
  const [showProductModal, setShowProductModal] = useState(false);
  const [showVariantForm, setShowVariantForm] = useState(false);
  const [newVariant, setNewVariant] = useState({
    size: "",
    color: "",
    quantity: 1,
  });
  const [addingVariant, setAddingVariant] = useState(false);
  const selectedProduct = products.find((p: any) => p.id === Number(form.productId));

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const res = await api.get(
        `/products?search=${search}&categoryId=${categoryFilter}`,
      );
      setProducts(res.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
    // Both STORE and SHOP locations are valid restock targets.
    api.get("/locations").then((res) => setStores(res.data));
    api.get("/categories").then((res) => setCategories(res.data));
  }, [search, categoryFilter]);

  const myLocation = stores.find((s: any) => s.id === Number(myLocationId));

  const handleProductChange = (id: string) => {
    const p = products.find((p: any) => p.id === Number(id));
    if (p) {
      setForm((f) => ({
        ...f,
        productId: id,
        newBuyPrice: p.currentBuyPrice,
        newSellPrice: p.currentSellPrice,
      }));
      // Single-variant products pre-select that variant automatically.
      setVariantLines(
        p.hasVariants && p.variants?.length === 1
          ? [
              {
                variantId: String(p.variants[0].id),
                quantity: 1,
                customPrice: "",
              },
            ]
          : [],
      );
    }
  };

  const handleRestockScan = (sku: string) => {
    const code = sku.toLowerCase();
    // Match the product SKU/barcode first.
    const product = products.find(
      (p: any) =>
        p.sku.toLowerCase() === code ||
        (p.barcode && p.barcode.toLowerCase() === code),
    );
    if (product) {
      handleProductChange(String(product.id));
      return;
    }
    // Then match a variant barcode/SKU.
    for (const p of products) {
      const v = (p.variants ?? []).find(
        (v: any) =>
          v.sku.toLowerCase() === code ||
          (v.barcode && v.barcode.toLowerCase() === code),
      );
      if (v) {
        handleProductChange(String(p.id));
        setVariantLines((prev) =>
          addOrBumpVariantLine(prev, {
            variantId: String(v.id),
            quantity: 1,
            customPrice: "",
          }),
        );
        return;
      }
    }
    toast.error(t("restock.noProductForSku", { sku }));
  };

  // Inline "+ Add New Variant" from the variant dropdown.
  const handleAddVariant = async () => {
    if (!selectedProduct) return;
    if (!newVariant.size.trim() && !newVariant.color.trim()) {
      toast.error(t("restock.variantNeedsSizeOrColor"));
      return;
    }
    setAddingVariant(true);
    try {
      const attributes: any = {};
      if (newVariant.size.trim()) attributes.size = newVariant.size.trim();
      if (newVariant.color.trim()) attributes.color = newVariant.color.trim();
      const payload: any = { attributes };
      if (newVariant.quantity && Number(newVariant.quantity) > 0) {
        payload.quantity = Number(newVariant.quantity);
      }
      // Deposit the new variant's stock at the current restock target.
      const targetStoreId = isOwner
        ? isStandalone
          ? undefined
          : Number(form.storeId)
        : Number(myLocationId);
      if (targetStoreId) payload.storeId = targetStoreId;
      const res = await api.post(
        `/products/${selectedProduct.id}/variants`,
        payload,
      );
      await fetchProducts();
      setVariantLines((prev) =>
        addOrBumpVariantLine(prev, {
          variantId: String(res.data.id),
          quantity: 1,
          customPrice: "",
        }),
      );
      setShowVariantForm(false);
      setNewVariant({ size: "", color: "", quantity: 1 });
      toast.success(t("restock.variantAdded"));
    } catch (err: any) {
      markHandled(err);
      toast.error(err?.response?.data?.message || t("restock.failedAddVariant"));
    } finally {
      setAddingVariant(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const product = products.find(
        (p: any) => p.id === Number(form.productId),
      );
      if (!product) {
        toast.error(t("restock.errorRestocking"));
        return;
      }
      // Standalone owners never pick a location — the backend resolves the shop.
      const storeId = isOwner
        ? isStandalone
          ? undefined
          : Number(form.storeId)
        : Number(myLocationId);
      const base: any = {
        productId: Number(form.productId),
      };
      if (storeId !== undefined) base.storeId = storeId;
      if (form.batchNumber.trim()) base.batchNumber = form.batchNumber.trim();
      if (form.manufactureDate) base.manufactureDate = form.manufactureDate;
      if (form.expiryDate) base.expiryDate = form.expiryDate;
      // Only the owner can change prices on a restock.
      if (isOwner) {
        base.newBuyPrice = form.newBuyPrice;
        base.newSellPrice = form.newSellPrice;
      }
      // Variant products: one restock line per selected variant.
      const lines: { variantId?: number; quantity: number }[] =
        product.hasVariants
          ? variantLines
              .filter((l) => l.quantity > 0)
              .map((l) => ({
                variantId: Number(l.variantId),
                quantity: l.quantity,
              }))
          : [{ quantity: form.quantity }];
      if (lines.length === 0) {
        toast.error(
          t("sv.needQty", {
            name: `${product.brand} ${product.baseName}`.trim(),
          }),
        );
        return;
      }
      let lastMessage: string | undefined;
      for (const ln of lines) {
        const payload: any = { ...base };
        if (product.hasVariants) payload.variantId = ln.variantId;
        payload.quantity = ln.quantity;
        const res = await api.post("/restock", payload);
        lastMessage = res.data?.message;
      }
      toast.success(
        lastMessage ??
          (isOwner
            ? t("restock.submittedOwner")
            : t("restock.submittedStaff")),
      );
      setForm({
        productId: "",
        storeId: "",
        quantity: 1,
        newBuyPrice: 0,
        newSellPrice: 0,
        variantId: "",
        batchNumber: "",
        manufactureDate: "",
        expiryDate: "",
      });
      setVariantLines([]);
    } catch (err) {
      markHandled(err);
      toast.error(t("restock.errorRestocking"));
    }
  };

  const handleProductCreated = (newProduct: any) => {
    fetchProducts();
    handleProductChange(String(newProduct.id));
    setShowProductModal(false);
  };

  if (loading) return <Loading className="py-24" />;

  return (
    <div>
      <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800 mb-6">
        {t("restock.title")}
      </h1>

      {!isOwner && (
        <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
          {t("restock.staffInfo", { location: myLocation?.name ?? t("restock.yourLocation") })}
        </p>
      )}

      <form
        onSubmit={handleSubmit}
        className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border grid grid-cols-1 gap-3 sm:gap-4 lg:max-w-3xl"
      >
        {/* Category Filter */}
        <div className="mb-2 pb-4 border-b">
          <label className="block text-sm font-medium text-gray-500 mb-1">
            {t("common.filterByCategory")}
          </label>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="border p-2 rounded-lg w-full bg-white"
          >
            <option value="">{t("sales.allCategories")}</option>
            {categories.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs sm:text-sm font-medium text-gray-500 mb-1">
            {t("restock.selectProduct")}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <SearchableSelect
              options={products.map((p: any) => ({
                value: String(p.id),
                label: `${p.brand} ${p.baseName} (${p.category?.name || t("common.notAvailable")})`,
                searchText: `${p.brand} ${p.baseName} ${p.sku}`,
              }))}
              value={form.productId}
              onChange={handleProductChange}
              placeholder={t("restock.searchProduct")}
              required
              className="flex-1 w-full"
            />
            <div className="flex gap-2 flex-wrap">
              <BarcodeScanner onScan={handleRestockScan} />
              <button
                type="button"
                onClick={() => setShowProductModal(true)}
                className="bg-gray-200 px-3 sm:px-4 rounded-lg text-xs sm:text-sm whitespace-nowrap"
              >
                + {t("common.new")}
              </button>
            </div>
          </div>
        </div>

        {selectedProduct?.hasVariants && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="block text-sm font-medium text-gray-500">
                {t("restock.variantSpec")}
              </label>
              <button
                type="button"
                onClick={() => setShowVariantForm((s) => !s)}
                className="text-xs font-semibold text-blue-600 whitespace-nowrap"
              >
                + {t("restock.addNewVariant")}
              </button>
            </div>

            <VariantLinesEditor
              hidePrice
              allowOutOfStock
              hideStock
              product={selectedProduct}
              lines={variantLines}
              onChange={setVariantLines}
            />

            {showVariantForm && (
              <div className="border border-blue-200 bg-blue-50 rounded-lg p-3 space-y-2">
                <p className="text-xs font-semibold text-blue-700">
                  {t("restock.addVariantTitle", {
                    name: `${selectedProduct.brand} ${selectedProduct.baseName}`,
                  })}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      {t("restock.size")}
                    </label>
                    <input
                      value={newVariant.size}
                      onChange={(e) =>
                        setNewVariant({ ...newVariant, size: e.target.value })
                      }
                      placeholder="e.g. 42"
                      className="border p-2 rounded-lg w-full text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      {t("restock.color")}
                    </label>
                    <input
                      value={newVariant.color}
                      onChange={(e) =>
                        setNewVariant({ ...newVariant, color: e.target.value })
                      }
                      placeholder="e.g. Black"
                      className="border p-2 rounded-lg w-full text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    {t("restock.initialQty")}
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={newVariant.quantity}
                    onChange={(e) =>
                      setNewVariant({
                        ...newVariant,
                        quantity: Number(e.target.value),
                      })
                    }
                    className="border p-2 rounded-lg w-full text-sm"
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setShowVariantForm(false)}
                    className="bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-xs"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={handleAddVariant}
                    disabled={addingVariant}
                    className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
                  >
                    {addingVariant
                      ? t("purchases.saving")
                      : t("restock.saveVariant")}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {selectedProduct?.isPerishable && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">
                {t("restock.batchNumber")}
              </label>
              <input
                value={form.batchNumber}
                onChange={(e) =>
                  setForm({ ...form, batchNumber: e.target.value })
                }
                placeholder="e.g. BATCH-001"
                className="border p-2 rounded-lg w-full"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">
                {t("restock.manufactureDate")}
              </label>
              <input
                type="date"
                value={form.manufactureDate}
                onChange={(e) =>
                  setForm({ ...form, manufactureDate: e.target.value })
                }
                className="border p-2 rounded-lg w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">
                {t("restock.expiryDate")}
              </label>
              <input
                type="date"
                value={form.expiryDate}
                onChange={(e) =>
                  setForm({ ...form, expiryDate: e.target.value })
                }
                className="border p-2 rounded-lg w-full"
                required
              />
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-500 mb-1">
            {t("restock.targetLocation")}
          </label>
          {isStandalone ? (
            <div className="border border-gray-200 bg-gray-50 p-2 rounded-lg text-sm text-gray-700">
              {t("restock.standaloneShopInfo")}
            </div>
          ) : isOwner ? (
            <SearchableSelect
              options={stores.map((s: any) => ({
                value: String(s.id),
                label: `${s.name} (${t(s.type === "SHOP" ? "status.shop" : "status.store")})`,
              }))}
              value={form.storeId}
              onChange={(v) => setForm({ ...form, storeId: v })}
              placeholder={t("restock.searchLocation")}
              required
            />
          ) : (
            <div className="border border-gray-200 bg-gray-50 p-2 rounded-lg text-sm text-gray-700">
              {myLocation?.name ?? t("restock.yourLocationLabel")}
            </div>
          )}
        </div>

        <div
          className={
            "grid grid-cols-1 gap-4 " +
            (selectedProduct?.hasVariants
              ? "md:grid-cols-2"
              : "md:grid-cols-3")
          }
        >
          {!selectedProduct?.hasVariants && (
            <div>
              <label className="block text-sm font-medium text-gray-500 mb-1">
                {t("common.quantity")}
              </label>
              <input
                type="number"
                min="1"
                value={form.quantity}
                onChange={(e) =>
                  setForm({ ...form, quantity: Number(e.target.value) })
                }
                className="border p-2 rounded-lg w-full"
                required
              />
            </div>
          )}
          {isOwner && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">
                  {t("restock.buyPriceWithSymbol", { symbol: curSymbol })}
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={form.newBuyPrice}
                  onChange={(e) =>
                    setForm({ ...form, newBuyPrice: Number(e.target.value) })
                  }
                  className="border p-2 rounded-lg w-full"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">
                  {t("restock.sellPriceWithSymbol", { symbol: curSymbol })}
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={form.newSellPrice}
                  onChange={(e) =>
                    setForm({ ...form, newSellPrice: Number(e.target.value) })
                  }
                  className="border p-2 rounded-lg w-full"
                  required
                />
              </div>
            </>
          )}
        </div>

        <button
          type="submit"
          className="bg-green-600 text-white p-2 rounded-lg hover:bg-green-700 mt-2 font-medium"
        >
          {t("restock.saveRestock")}
        </button>
      </form>

      {/* Product Form Modal */}
      <Modal
        isOpen={showProductModal}
        onClose={() => setShowProductModal(false)}
        title={t("products.addNewTitle")}
      >
        <ProductForm
          onProductCreated={handleProductCreated}
          onCancel={() => setShowProductModal(false)}
        />
      </Modal>
    </div>
  );
}
