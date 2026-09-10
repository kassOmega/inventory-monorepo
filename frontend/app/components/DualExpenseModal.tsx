"use client";
import api from "@/lib/api";
import SearchableSelect from "@/app/components/SearchableSelect";
import { useToast } from "@/app/components/ToastProvider";
import { useAuth } from "@/context/AuthContext";
import { useTranslation } from "react-i18next";
import { variantLabel } from "@/lib/variantLabel";
import { useEffect, useState } from "react";

interface DualExpenseModalProps {
  open: boolean;
  editing?: any | null;
  expenseAccounts: any[];
  onClose: () => void;
  onSaved: () => void;
}

/** Derive product kind from a category: explicit kind/defaultKind if the
 * backend exposes one, else a name-based fallback ("ingredient"/"raw" ->
 * INGREDIENT, "beverage"/"bar"/"drink" -> BEVERAGE, default GOODS). */
function resolveKindFromCategory(cat: any): string {
  const explicit = cat?.kind ?? cat?.defaultKind;
  if (explicit && ["GOODS", "INGREDIENT", "BEVERAGE"].includes(explicit)) {
    return explicit;
  }
  const name = (cat?.name ?? "").toLowerCase();
  if (/ingredient|raw/.test(name)) return "INGREDIENT";
  if (/beverage|bar|drink/.test(name)) return "BEVERAGE";
  return "GOODS";
}

export default function DualExpenseModal({
  open,
  editing,
  expenseAccounts,
  onClose,
  onSaved,
}: DualExpenseModalProps) {
  const { activeMembership, user } = useAuth();
  const toast = useToast();
  const { t } = useTranslation();
  const isOwner = user?.isSuperuser === true;
  const isStandalone = activeMembership?.standalone === true;
  // Multi-variant purchases are a hospitality-only capability; retail and
  // distribution orgs keep the single-item purchase flow unchanged.
  const isHospitality =
    (activeMembership?.businessType ?? user?.businessType) === "HOSPITALITY";

  const [mode, setMode] = useState<"inventory" | "overhead">(
    editing ? "overhead" : "inventory",
  );

  // --- Inventory purchase state ---
  const [products, setProducts] = useState<any[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createBrand, setCreateBrand] = useState("");
  const [createUnitId, setCreateUnitId] = useState("");
  const [createCategoryId, setCreateCategoryId] = useState("");
  const [createKind, setCreateKind] = useState("GOODS");
  const [createSellPrice, setCreateSellPrice] = useState("");
  const [attrSize, setAttrSize] = useState("");
  const [attrColor, setAttrColor] = useState("");
  const [attrVolume, setAttrVolume] = useState("");
  const [showVariantAttrs, setShowVariantAttrs] = useState(false);
  // Hospitality multi-variant purchase state: per-variant quantity + cost.
  // purchaseLines = existing item variant lines; variantDrafts = create-new rows.
  const [purchaseLines, setPurchaseLines] = useState<
    { key: string; variantId: string; quantity: string; totalCost: string }[]
  >([]);
  const [variantDrafts, setVariantDrafts] = useState<
    {
      key: string;
      size: string;
      color: string;
      volume: string;
      quantity: string;
      totalCost: string;
    }[]
  >([]);
  const [quantity, setQuantity] = useState(1);
  const [totalAmount, setTotalAmount] = useState("");
  const [paid, setPaid] = useState(true);
  const [storeId, setStoreId] = useState("");
  const [vendor, setVendor] = useState("");
  const [notes, setNotes] = useState("");
  const [expenseDate, setExpenseDate] = useState("");
  const [showVariantForm, setShowVariantForm] = useState(false);
  const [newVariantSize, setNewVariantSize] = useState("");
  const [newVariantColor, setNewVariantColor] = useState("");
  const [showUnitForm, setShowUnitForm] = useState(false);
  const [newUnitName, setNewUnitName] = useState("");
  const [newUnitSymbol, setNewUnitSymbol] = useState("");

  // --- Operational overhead state ---
  const [accountId, setAccountId] = useState(
    editing?.accountId ? String(editing.accountId) : "",
  );
  const [amount, setAmount] = useState(
    editing?.amount != null ? String(editing.amount) : "",
  );
  const [vendor2, setVendor2] = useState(editing?.vendor ?? "");
  const [notes2, setNotes2] = useState(editing?.notes ?? "");
  // Friendly-category state: locally-created expense accounts + the EXPENSE
  // posting mapping (used for the read-only "what will this post?" preview).
  const [extraExpense, setExtraExpense] = useState<any[]>([]);
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [expenseMapping, setExpenseMapping] = useState<any>(null);

  const [categories, setCategories] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const selectedProduct = products.find(
    (p: any) => p.id === Number(productId),
  );

  // Load master data + reset state each time the modal opens.
  useEffect(() => {
    if (!open || mode !== "overhead") return;
    api
      .get("/finance/account-mappings")
      .then((r: any) => {
        const row = (r.data ?? []).find(
          (m: any) => m.transactionType === "EXPENSE",
        );
        setExpenseMapping(row?.mapping ?? null);
      })
      .catch(() => undefined);
    setExtraExpense([]);
    setShowNewCat(false);
    setNewCatName("");
  }, [open, mode]);

  const addExpenseCategory = async () => {
    if (!newCatName.trim()) {
      setError(t("de.errUnitName"));
      return;
    }
    try {
      const res = await api.post("/finance/accounts", {
        name: newCatName.trim(),
        type: "EXPENSE",
      });
      setExtraExpense((prev) => [...prev, res.data]);
      setAccountId(String(res.data.id));
      setShowNewCat(false);
      setNewCatName("");
      toast.success("Category created");
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create category");
    }
  };

  // Load master data + reset state each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setMode(editing ? "overhead" : "inventory");
    setError("");
    setProductSearch("");
    setProductId("");
    setVariantId("");
    setShowCreate(false);
    setCreateKind("GOODS");
    setShowVariantAttrs(false);
    setPurchaseLines([]);
    setVariantDrafts([]);
    setQuantity(1);
    setTotalAmount("");
    setPaid(true);
    setVendor("");
    setNotes("");
    setExpenseDate("");
    setAmount(editing?.amount != null ? String(editing.amount) : "");
    setAccountId(editing?.accountId ? String(editing.accountId) : "");
    setVendor2(editing?.vendor ?? "");
    setNotes2(editing?.notes ?? "");
    Promise.all([
      api.get("/products?search=").catch(() => ({ data: [] })),
      api.get("/categories").catch(() => ({ data: [] })),
      api.get("/units").catch(() => ({ data: [] })),
      api.get("/locations").catch(() => ({ data: [] })),
    ]).then(([p, c, u, l]) => {
      const locs = l.data ?? [];
      setProducts(p.data ?? []);
      setCategories(c.data ?? []);
      setUnits(u.data ?? []);
      setLocations(locs);
      // Auto-select the single location (or the user's own location) so a
      // purchase never fails with "Location not found".
      if (locs.length === 1) {
        setStoreId(String(locs[0].id));
        setError("");
      } else if (locs.length === 0 && user?.locationId != null) {
        setStoreId(String(user.locationId));
        setError("");
      }
    });
  }, [open, editing]);

  // Live product search while the item picker is visible.
  useEffect(() => {
    if (!open || showCreate) return;
    const t = setTimeout(() => {
      api
        .get(`/products?search=${encodeURIComponent(productSearch)}`)
        .then((r) => setProducts(r.data))
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [productSearch, open, showCreate]);

  if (!open) return null;

  const unitBuyPrice =
    quantity > 0 && Number(totalAmount) > 0
      ? (Number(totalAmount) / quantity).toFixed(2)
      : "—";

  // Hospitality variant purchase mode: the selected item has variants (existing
  // item) or the user added variant drafts (create-new). Root quantity/total are
  // replaced by per-variant quantity + cost in this mode.
  const useVariantPurchase =
    isHospitality &&
    (selectedProduct?.hasVariants ||
      (showCreate && createKind !== "INGREDIENT" && variantDrafts.length > 0));

  const lineUnitPrice = (qty: string, cost: string) =>
    Number(qty) > 0 && Number(cost) > 0
      ? (Number(cost) / Number(qty)).toFixed(2)
      : "—";

  const variantSummary = () => {
    const entries = showCreate
      ? variantDrafts.map((d) => ({
          quantity: d.quantity,
          totalCost: d.totalCost,
        }))
      : purchaseLines.map((l) => ({
          quantity: l.quantity,
          totalCost: l.totalCost,
        }));
    const qty = entries.reduce((s, x) => s + (Number(x.quantity) || 0), 0);
    const total = entries.reduce((s, x) => s + (Number(x.totalCost) || 0), 0);
    return { qty, total, count: entries.length };
  };

  const handleProductChange = (id: string) => {
    const p = products.find((x: any) => x.id === Number(id));
    setProductId(id);
    setError("");
    if (isHospitality && p?.hasVariants) {
      // Hospitality purchases land per-variant (qty + cost per variant).
      // Pre-fill the single-variant case; the legacy variantId select is unused.
      setVariantId("");
      setPurchaseLines(
        p.variants?.length === 1
          ? [
              {
                key: `l${Date.now()}`,
                variantId: String(p.variants[0].id),
                quantity: "",
                totalCost: "",
              },
            ]
          : [],
      );
    } else {
      setPurchaseLines([]);
      setVariantId(
        p?.hasVariants && p.variants?.length === 1
          ? String(p.variants[0].id)
          : "",
      );
    }
  };

  const handleAddVariant = async () => {
    if (!selectedProduct) return;
    if (!newVariantSize.trim() && !newVariantColor.trim()) {
      toast.error(t("de.errVariantNeedAttr"));
      return;
    }
    const attributes: any = {};
    if (newVariantSize.trim()) attributes.size = newVariantSize.trim();
    if (newVariantColor.trim()) attributes.color = newVariantColor.trim();
    try {
      const res = await api.post(
        `/products/${selectedProduct.id}/variants`,
        { attributes },
      );
      if (isHospitality) {
        // Assign the fresh variant to an empty purchase line if one is open.
        setPurchaseLines((prev) => {
          const open = prev.find((l) => !l.variantId);
          return open
            ? prev.map((l) =>
                l.key === open.key
                  ? { ...l, variantId: String(res.data.id) }
                  : l,
              )
            : prev;
        });
      } else {
        setVariantId(String(res.data.id));
      }
      setShowVariantForm(false);
      setNewVariantSize("");
      setNewVariantColor("");
      api
        .get(`/products?search=${encodeURIComponent(productSearch)}`)
        .then((r) => setProducts(r.data));
      toast.success(t("de.variantAdded"));
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t("de.errVariantAdd"));
    }
  };

  // --- Hospitality multi-variant purchase line helpers ---
  const updatePurchaseLine = (
    key: string,
    field: "variantId" | "quantity" | "totalCost",
    value: string,
  ) =>
    setPurchaseLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, [field]: value } : l)),
    );

  const addPurchaseLine = () => {
    const available = (selectedProduct?.variants ?? []).filter(
      (v: any) => !purchaseLines.some((l) => l.variantId === String(v.id)),
    );
    if (available.length === 0) {
      toast.error(t("de.allVariantsAdded"));
      return;
    }
    setPurchaseLines((prev) => [
      ...prev,
      {
        key: `l${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
        variantId: available.length === 1 ? String(available[0].id) : "",
        quantity: "",
        totalCost: "",
      },
    ]);
  };

  const removePurchaseLine = (key: string) =>
    setPurchaseLines((prev) => prev.filter((l) => l.key !== key));

  const updateVariantDraft = (
    key: string,
    field: "size" | "color" | "volume" | "quantity" | "totalCost",
    value: string,
  ) =>
    setVariantDrafts((prev) =>
      prev.map((d) => (d.key === key ? { ...d, [field]: value } : d)),
    );

  const addVariantDraft = () =>
    setVariantDrafts((prev) => [
      ...prev,
      {
        key: `d${Date.now()}${Math.random().toString(36).slice(2, 5)}`,
        size: "",
        color: "",
        volume: "",
        quantity: "",
        totalCost: "",
      },
    ]);

  const removeVariantDraft = (key: string) =>
    setVariantDrafts((prev) => prev.filter((d) => d.key !== key));

  const handleAddUnit = async () => {
    if (!newUnitName.trim()) {
      setError(t("de.errUnitName"));
      return;
    }
    try {
      const res = await api.post("/units", {
        name: newUnitName.trim(),
        symbol: newUnitSymbol.trim() || undefined,
      });
      const created = res.data;
      setUnits((prev) =>
        prev.some((u: any) => u.id === created.id)
          ? prev
          : [...prev, created],
      );
      setCreateUnitId(String(created.id));
      setShowUnitForm(false);
      setNewUnitName("");
      setNewUnitSymbol("");
      setError("");
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("de.errUnitCreate"));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      if (mode === "overhead") {
        if (!accountId) throw new Error(t("de.errSelectCategory"));
        const payload = {
          accountId: Number(accountId),
          amount: Number(amount),
          vendor: vendor2.trim() || undefined,
          notes: notes2.trim() || undefined,
        };
        if (editing?.id) await api.patch(`/finance/expenses/${editing.id}`, payload);
        else await api.post("/finance/expenses", payload);
        toast.success(editing?.id ? t("de.expenseUpdated") : t("de.expenseSaved"));
      } else {
        const payload: any = {
          quantity: Number(quantity),
          totalAmount: Number(totalAmount),
          paid,
        };
        if (storeId) payload.storeId = Number(storeId);
        if (vendor.trim()) payload.vendor = vendor.trim();
        if (notes.trim()) payload.notes = notes.trim();
        if (expenseDate) payload.expenseDate = expenseDate;

        if (showCreate && createName.trim()) {
          payload.createNew = {
            name: createName.trim(),
            brand: createBrand.trim() || undefined,
            kind: createKind,
          };
          if (createUnitId) payload.createNew.unitId = Number(createUnitId);
          if (createCategoryId) payload.createNew.categoryId = Number(createCategoryId);
          if (createSellPrice) payload.createNew.sellPrice = Number(createSellPrice);
          if (isHospitality && variantDrafts.length > 0) {
            // Hospitality multi-variant create: one variant per draft row, each
            // with its own quantity + total cost. The top-level quantity/total
            // are derived aggregates (the backend uses the variants array).
            const variants = variantDrafts.map((d) => {
              const attributes: Record<string, string> = {};
              if (d.size.trim()) attributes.size = d.size.trim();
              if (d.color.trim()) attributes.color = d.color.trim();
              if (d.volume.trim()) attributes.volume = d.volume.trim();
              return {
                attributes,
                quantity: Number(d.quantity),
                totalCost: Number(d.totalCost),
              };
            });
            for (const v of variants) {
              if (Object.keys(v.attributes).length === 0) {
                throw new Error(
                  t("de.errVariantAttr"),
                );
              }
              if (!(v.quantity > 0)) {
                throw new Error(t("de.errVariantQty"));
              }
              if (v.totalCost < 0) {
                throw new Error(t("de.errVariantCost"));
              }
            }
            payload.createNew.variants = variants;
            payload.quantity = variants.reduce((s, v) => s + v.quantity, 0);
            payload.totalAmount = variants.reduce((s, v) => s + v.totalCost, 0);
          } else {
            const attrs: Record<string, string> = {};
            if (attrSize.trim()) attrs.size = attrSize.trim();
            if (attrColor.trim()) attrs.color = attrColor.trim();
            if (attrVolume.trim()) attrs.volume = attrVolume.trim();
            if (createKind !== "INGREDIENT" && Object.keys(attrs).length) {
              payload.createNew.variantAttributes = attrs;
            }
          }
        } else {
          if (!productId) throw new Error(t("de.errPickOrCreate"));
          if (isHospitality && selectedProduct?.hasVariants) {
            if (purchaseLines.length === 0) {
              throw new Error(t("de.errNeedVariant"));
            }
            const lines = purchaseLines.map((l) => ({
              variantId: Number(l.variantId),
              quantity: Number(l.quantity),
              totalCost: Number(l.totalCost),
            }));
            for (const ln of lines) {
              if (!(ln.variantId > 0)) {
                throw new Error(t("de.errLineVariant"));
              }
              if (!(ln.quantity > 0)) {
                throw new Error(t("de.errVariantQty"));
              }
              if (ln.totalCost < 0) {
                throw new Error(t("de.errVariantCost"));
              }
            }
            payload.productId = Number(productId);
            payload.lines = lines;
            payload.quantity = lines.reduce((s, l) => s + l.quantity, 0);
            payload.totalAmount = lines.reduce((s, l) => s + l.totalCost, 0);
          } else {
            payload.productId = Number(productId);
            if (variantId) payload.variantId = Number(variantId);
          }
        }

        const res = await api.post("/restock/purchase", payload);
        toast.success(res.data?.message || t("de.purchaseSaved"));
      }
      onSaved();
    } catch (err: any) {
      setError(
        err?.response?.data?.message ?? err?.message ?? t("de.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-5 w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
        <h2 className="font-semibold text-gray-800 mb-3">
          {editing?.id ? t("de.editTitle") : t("de.addTitle")}
        </h2>

        {/* Mode toggle */}
        <div className="flex rounded-lg overflow-hidden border border-gray-200 mb-4 text-sm">
          <button
            type="button"
            onClick={() => setMode("inventory")}
            className={`flex-1 py-2 font-medium ${mode === "inventory" ? "bg-blue-600 text-white" : "bg-white text-gray-600"}`}
          >
            {t("de.invPurchase")}
          </button>
          <button
            type="button"
            onClick={() => setMode("overhead")}
            className={`flex-1 py-2 font-medium ${mode === "overhead" ? "bg-blue-600 text-white" : "bg-white text-gray-600"}`}
          >
            {t("de.overhead")}
          </button>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-2 rounded text-xs mb-3">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === "inventory" && (
            <>
              {/* Item search + create toggle */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t("de.item")}</label>
                {!showCreate ? (
                  <div className="flex gap-2">
                    <SearchableSelect
                      options={products.map((p: any) => ({
                        value: String(p.id),
                        label: `${p.brand ?? ""} ${p.baseName ?? ""}${p.category?.name ? ` (${p.category.name})` : ""}`,
                        searchText: `${p.brand ?? ""} ${p.baseName ?? ""} ${p.sku ?? ""}`,
                      }))}
                      value={productId}
                      onChange={handleProductChange}
                      placeholder={t("de.searchItem")}
                      className="flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setShowCreate(true);
                        setProductId("");
                        setVariantId("");
                        setPurchaseLines([]);
                      }}
                      className="bg-gray-200 px-3 rounded-lg text-xs sm:text-sm whitespace-nowrap"
                    >
                      {t("de.createNewItem")}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreate(false);
                      setVariantDrafts([]);
                    }}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    {t("de.backToSearch")}
                  </button>
                )}
              </div>

              {/* Variant picker + inline new variant */}
              {!showCreate && selectedProduct?.hasVariants && (
                <div className="space-y-2">
                  {isHospitality ? (
                    <>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        {t("de.variantsPerLine")}
                      </label>
                      {purchaseLines.length === 0 && (
                        <p className="text-xs text-gray-400">
                          {t("de.addVariantsHint")}
                        </p>
                      )}
                      {purchaseLines.map((line) => (
                        <div
                          key={line.key}
                          className="border border-gray-200 rounded-lg p-2 space-y-2"
                        >
                          <div className="flex items-center gap-2">
                            <select
                              value={line.variantId}
                              onChange={(e) =>
                                updatePurchaseLine(
                                  line.key,
                                  "variantId",
                                  e.target.value,
                                )
                              }
                              className="border border-gray-300 rounded p-2 text-sm bg-white flex-1"
                              required
                            >
                              <option value="">{t("de.selectVariant")}</option>
                              {(selectedProduct.variants ?? []).map((v: any) => (
                                <option
                                  key={v.id}
                                  value={v.id}
                                  disabled={purchaseLines.some(
                                    (l) =>
                                      l.variantId === String(v.id) &&
                                      l.key !== line.key,
                                  )}
                                >
                                  {variantLabel(v)}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => removePurchaseLine(line.key)}
                              className="text-gray-400 hover:text-red-500 text-lg leading-none px-1"
                              aria-label={t("de.removeVariant")}
                            >
                              ×
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="number"
                              min="1"
                              step="0.01"
                              value={line.quantity}
                              onChange={(e) =>
                                updatePurchaseLine(
                                  line.key,
                                  "quantity",
                                  e.target.value,
                                )
                              }
                              placeholder={t("de.qtyPh")}
                              className="border border-gray-300 rounded p-2 text-sm"
                            />
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.totalCost}
                              onChange={(e) =>
                                updatePurchaseLine(
                                  line.key,
                                  "totalCost",
                                  e.target.value,
                                )
                              }
                              placeholder={t("de.costPhEtb")}
                              className="border border-gray-300 rounded p-2 text-sm"
                            />
                          </div>
                          <p className="text-[10px] text-gray-400 text-right">
                            {t("de.unitPriceEtb", { price: lineUnitPrice(line.quantity, line.totalCost) })}
                          </p>
                        </div>
                      ))}
                      {purchaseLines.length > 0 && (
                        <p className="text-xs text-gray-500">
                          {t("de.totalAcross", { total: variantSummary().total.toFixed(2), count: variantSummary().count })}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={addPurchaseLine}
                          className="text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded"
                        >
                          {t("de.addVariant")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowVariantForm(true)}
                          className="text-xs text-gray-500 hover:underline"
                        >
                          {t("de.newVariant")}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <label className="block text-xs font-medium text-gray-500 mb-1">{t("de.variantField")}</label>
                      <select
                        value={variantId}
                        onChange={(e) => {
                          if (e.target.value === "__add__") {
                            setShowVariantForm(true);
                            setVariantId("");
                          } else {
                            setVariantId(e.target.value);
                            setShowVariantForm(false);
                          }
                        }}
                        className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
                        required
                      >
                        <option value="">{t("de.selectVariant")}</option>
                        {(selectedProduct.variants ?? []).map((v: any) => (
                          <option key={v.id} value={v.id}>
                            {variantLabel(v)}
                          </option>
                        ))}
                        <option value="__add__">{t("de.addNewVariant")}</option>
                      </select>
                    </>
                  )}

                  {showVariantForm && (
                    <div className="border border-blue-200 bg-blue-50 rounded-lg p-3 mt-2 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          value={newVariantSize}
                          onChange={(e) => setNewVariantSize(e.target.value)}
                          placeholder={t("de.sizePhEx")}
                          className="border p-2 rounded text-sm"
                        />
                        <input
                          value={newVariantColor}
                          onChange={(e) => setNewVariantColor(e.target.value)}
                          placeholder={t("de.colorPhEx")}
                          className="border p-2 rounded text-sm"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setShowVariantForm(false)}
                          className="text-xs text-gray-500"
                        >
                          {t("common.cancel")}
                        </button>
                        <button
                          type="button"
                          onClick={handleAddVariant}
                          disabled={saving}
                          className="bg-blue-600 text-white rounded px-3 py-1 text-xs"
                        >
                          {t("de.addVariant")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Create new item fields */}
              {showCreate && (
                <div className="border border-gray-200 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-semibold text-gray-700">{createKind === "INGREDIENT" ? t("de.newIngredient") : t("de.newItem")}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={createName}
                      onChange={(e) => setCreateName(e.target.value)}
                      placeholder={createKind === "INGREDIENT" ? t("de.ingNamePh") : t("de.itemNamePh")}
                      className="border border-gray-300 rounded p-2 text-sm"
                    />
                    <input
                      value={createBrand}
                      onChange={(e) => setCreateBrand(e.target.value)}
                      placeholder={t("de.brandPh")}
                      className="border border-gray-300 rounded p-2 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={createCategoryId}
                      onChange={(e) => {
                        const cid = e.target.value;
                        setCreateCategoryId(cid);
                        const cat = categories.find((c: any) => c.id === Number(cid));
                        const kind = resolveKindFromCategory(cat);
                        setCreateKind(kind);
                        setShowVariantAttrs(false);
                        if (kind === "INGREDIENT") {
                          setAttrSize("");
                          setAttrColor("");
                          setAttrVolume("");
                          setCreateSellPrice("");
                          setVariantDrafts([]);
                        }
                      }}
                      required
                      className="border border-gray-300 rounded p-2 text-sm bg-white"
                    >
                      <option value="">{t("de.categoryReq")}</option>
                      {categories.map((c: any) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <div>
                      <div className="flex gap-1">
                        <select
                          value={createUnitId}
                          onChange={(e) => {
                            setCreateUnitId(e.target.value);
                            setError("");
                          }}
                          required={createKind === "INGREDIENT"}
                          className="border border-gray-300 rounded p-2 text-sm bg-white flex-1"
                        >
                          <option value="">{t("de.unitReq")}</option>
                          {units.map((u: any) => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => setShowUnitForm(true)}
                          className="bg-gray-200 px-2 rounded text-xs whitespace-nowrap"
                        >
                          {t("de.unitAdd")}
                        </button>
                      </div>
                      {showUnitForm && (
                        <div className="border border-blue-200 bg-blue-50 rounded-lg p-2 mt-1 space-y-1">
                          <div className="grid grid-cols-2 gap-1">
                            <input
                              value={newUnitName}
                              onChange={(e) => setNewUnitName(e.target.value)}
                              placeholder={t("de.unitNamePh")}
                              className="border p-1.5 rounded text-xs"
                            />
                            <input
                              value={newUnitSymbol}
                              onChange={(e) => setNewUnitSymbol(e.target.value)}
                              placeholder={t("de.unitSymbolPh")}
                              className="border p-1.5 rounded text-xs"
                            />
                          </div>
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setShowUnitForm(false)}
                              className="text-xs text-gray-500"
                            >
                              {t("common.cancel")}
                            </button>
                            <button
                              type="button"
                              onClick={handleAddUnit}
                              disabled={saving}
                              className="bg-blue-600 text-white rounded px-2 py-0.5 text-xs"
                            >
                              {t("de.addUnitBtn")}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  {createKind !== "INGREDIENT" && (
                    <input
                      value={createSellPrice}
                      onChange={(e) => setCreateSellPrice(e.target.value)}
                      type="number"
                      step="0.01"
                      placeholder={t("de.sellPricePh")}
                      className="border border-gray-300 rounded p-2 text-sm w-full"
                    />
                  )}
                  {createKind !== "INGREDIENT" &&
                    (isHospitality ? (
                      <div className="space-y-2">
                        {variantDrafts.length > 0 && (
                          <div className="space-y-2">
                            {variantDrafts.map((d, di) => (
                              <div
                                key={d.key}
                                className="border border-gray-200 rounded-lg p-2 space-y-2"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] uppercase tracking-wide text-gray-400">
                                    {t("de.variantN", { n: di + 1 })}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => removeVariantDraft(d.key)}
                                    className="text-gray-400 hover:text-red-500 text-lg leading-none px-1"
                                    aria-label={t("de.removeVariant")}
                                  >
                                    ×
                                  </button>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                  <input
                                    value={d.size}
                                    onChange={(e) =>
                                      updateVariantDraft(d.key, "size", e.target.value)
                                    }
                                    placeholder={createKind === "BEVERAGE" ? t("de.packSize") : t("de.sizePh")}
                                    className="border border-gray-300 rounded p-2 text-sm"
                                  />
                                  <input
                                    value={d.color}
                                    onChange={(e) =>
                                      updateVariantDraft(d.key, "color", e.target.value)
                                    }
                                    placeholder={t("de.colorPh")}
                                    className="border border-gray-300 rounded p-2 text-sm"
                                  />
                                  <input
                                    value={d.volume}
                                    onChange={(e) =>
                                      updateVariantDraft(d.key, "volume", e.target.value)
                                    }
                                    placeholder={createKind === "BEVERAGE" ? t("de.volumeBevPh") : t("de.volumePh")}
                                    className="border border-gray-300 rounded p-2 text-sm"
                                  />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <input
                                    type="number"
                                    min="1"
                                    step="0.01"
                                    value={d.quantity}
                                    onChange={(e) =>
                                      updateVariantDraft(d.key, "quantity", e.target.value)
                                    }
                                    placeholder={t("de.qtyPh")}
                                    className="border border-gray-300 rounded p-2 text-sm"
                                  />
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={d.totalCost}
                                    onChange={(e) =>
                                      updateVariantDraft(d.key, "totalCost", e.target.value)
                                    }
                                    placeholder={t("de.costPhEtb")}
                                    className="border border-gray-300 rounded p-2 text-sm"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={addVariantDraft}
                          className="text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded"
                        >
                          {t("de.addVariant")}
                        </button>
                        {variantDrafts.length > 0 && (
                          <p className="text-xs text-gray-500">
                            {t("de.totalAcross", { total: variantSummary().total.toFixed(2), count: variantSummary().count })}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div>
                        <button
                          type="button"
                          onClick={() => setShowVariantAttrs((v) => !v)}
                          className="text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded"
                        >
                          {showVariantAttrs ? t("de.hideVariantDetails") : t("de.addVariant")}
                        </button>
                        {showVariantAttrs && (
                          <div className="grid grid-cols-3 gap-2 mt-2">
                            <input value={attrSize} onChange={(e) => setAttrSize(e.target.value)} placeholder={createKind === "BEVERAGE" ? t("de.packSize") : t("de.sizePh")} className="border border-gray-300 rounded p-2 text-sm" />
                            <input value={attrColor} onChange={(e) => setAttrColor(e.target.value)} placeholder={t("de.colorPh")} className="border border-gray-300 rounded p-2 text-sm" />
                            <input value={attrVolume} onChange={(e) => setAttrVolume(e.target.value)} placeholder={createKind === "BEVERAGE" ? t("de.volumeBevPh") : t("de.volumePh")} className="border border-gray-300 rounded p-2 text-sm" />
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              )}

              {/* Quantity / Total Cost / derived Unit Buy Price (single-item purchases) */}
              {!useVariantPurchase && (
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("de.quantity")}</label>
                    <input
                      type="number"
                      min="1"
                      step="0.01"
                      value={quantity}
                      onChange={(e) => {
                        setQuantity(Number(e.target.value));
                        setError("");
                      }}
                      className="border border-gray-300 rounded p-2 text-sm w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{createKind === "INGREDIENT" ? t("de.batchTotalCostEtb") : t("de.totalCostEtb")}</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={totalAmount}
                      onChange={(e) => {
                        setTotalAmount(e.target.value);
                        setError("");
                      }}
                      placeholder={t("de.amountEg")}
                      className="border border-gray-300 rounded p-2 text-sm w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("de.unitBuyPrice")}</label>
                    <div className="border border-gray-200 bg-gray-50 rounded p-2 text-sm text-gray-700 w-full">
                      {t("de.priceValue", { price: unitBuyPrice })}
                    </div>
                  </div>
                </div>
              )}

              {/* Payment type + target location */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t("de.payment")}</label>
                  <div className="flex rounded-lg overflow-hidden border border-gray-200 text-sm">
                    <button
                      type="button"
                      onClick={() => setPaid(true)}
                      className={`flex-1 py-1.5 ${paid ? "bg-emerald-600 text-white" : "bg-white text-gray-600"}`}
                    >
                      {t("de.paidCash")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaid(false)}
                      className={`flex-1 py-1.5 ${!paid ? "bg-amber-500 text-white" : "bg-white text-gray-600"}`}
                    >
                      {t("de.onAccount")}
                    </button>
                  </div>
                </div>
                {!isStandalone && locations.length > 1 ? (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("de.targetLocation")}</label>
                    <select
                      value={storeId}
                      onChange={(e) => {
                        setStoreId(e.target.value);
                        setError("");
                      }}
                      className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
                    >
                      <option value="">{t("de.selectLocation")}</option>
                      {locations.map((l: any) => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t("de.targetLocation")}</label>
                    <div className="border border-gray-200 bg-gray-50 rounded p-2 text-sm text-gray-700">
                      {isStandalone
                        ? t("de.autoShop")
                        : locations.length === 1
                          ? locations[0].name
                          : t("de.noLocationYet")}
                    </div>
                  </div>
                )}
              </div>

              {/* Vendor / Date / Notes */}
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  placeholder={t("de.vendorPh")}
                  className="border border-gray-300 rounded p-2 text-sm"
                />
                <input
                  type="date"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  className="border border-gray-300 rounded p-2 text-sm"
                />
              </div>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("de.notesPh")}
                className="border border-gray-300 rounded p-2 text-sm w-full"
              />
            </>
          )}

          {mode === "overhead" && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t("de.categoryReq")}</label>
                {!showNewCat ? (
                  <SearchableSelect
                    options={[...expenseAccounts, ...extraExpense].map((a: any) => ({
                      value: String(a.id),
                      label: a.code ? `${a.name} (${a.code})` : a.name,
                      searchText: `${a.name} ${a.code ?? ""}`,
                    }))}
                    value={accountId}
                    onChange={(v: string) => setAccountId(v)}
                    placeholder={t("de.selectCategory")}
                    className="w-full"
                  />
                ) : (
                  <div className="flex gap-2">
                    <input
                      value={newCatName}
                      onChange={(e) => setNewCatName(e.target.value)}
                      placeholder="New category name"
                      className="border border-gray-300 rounded p-2 text-sm flex-1"
                    />
                    <button
                      type="button"
                      onClick={addExpenseCategory}
                      className="bg-blue-600 hover:bg-blue-700 text-white rounded px-3 py-2 text-sm font-medium"
                    >
                      Add
                    </button>
                  </div>
                )}
                {!showNewCat && (
                  <button
                    type="button"
                    onClick={() => setShowNewCat(true)}
                    className="text-xs text-blue-600 hover:underline mt-1"
                  >
                    + New category (create an account)
                  </button>
                )}
                {accountId && (
                  (() => {
                    const sel = [...expenseAccounts, ...extraExpense].find(
                      (a: any) => String(a.id) === accountId,
                    );
                    const creditName =
                      expenseMapping?.creditAccount?.name ?? "Cash";
                    return sel ? (
                      <p className="text-[11px] text-gray-400 mt-1">
                        Posts: Debit {sel.name} ↔ Credit {creditName}
                      </p>
                    ) : null;
                  })()
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t("de.amountEtb")}</label>
                <input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={t("de.amountPh")}
                  className="border border-gray-300 rounded p-2 text-sm w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t("de.vendorLabel")}</label>
                <input
                  value={vendor2}
                  onChange={(e) => setVendor2(e.target.value)}
                  placeholder={t("de.vendorPh")}
                  className="border border-gray-300 rounded p-2 text-sm w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t("de.notesLabel")}</label>
                <input
                  value={notes2}
                  onChange={(e) => setNotes2(e.target.value)}
                  placeholder={t("de.notesPh")}
                  className="border border-gray-300 rounded p-2 text-sm w-full"
                />
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-3 py-2 text-sm text-gray-600"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="bg-gray-800 text-white rounded px-4 py-2 text-sm font-medium"
            >
              {saving
                ? t("de.saving")
                : editing?.id
                  ? t("de.save")
                  : mode === "inventory"
                    ? t("de.purchaseAdd")
                    : t("de.saveExpense")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
