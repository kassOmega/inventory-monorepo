"use client";
import { useToast } from "@/app/components/ToastProvider";
import { useAuth } from "@/context/AuthContext";
import { generateEan13 } from "@/lib/barcode";
import api, { markHandled } from "@/lib/api";
import { variantLabel } from "@/lib/variantLabel";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import AiPhotoPicker from "./AiPhotoPicker";
import BarcodeScanner from "./BarcodeScanner";

interface ProductFormProps {
  /** Called after a successful create (add mode). */
  onProductCreated?: (product: any) => void;
  onCancel: () => void;
  /** When provided the form loads the existing product for editing (PUT). */
  editing?: any | null;
  /** Called after a successful update (edit mode). */
  onProductUpdated?: (product: any) => void;
}

interface VariantRow {
  slot1: string;
  slot2: string;
  slot3: string;
  slot4: string;
  sku: string;
  barcode: string;
  buyPrice: string;
  sellPrice: string;
  quantity: string;
  /** Per-variant low-stock alert number ("" → inherit the product's). */
  reorderLevel: string;
  /** Per-variant suggested reorder qty ("" → inherit the product's). */
  reorderQty: string;
  /** Set when editing an existing variant so the backend updates instead of cloning. */
  variantId?: number;
}

const emptyVariant = (): VariantRow => ({
  slot1: "",
  slot2: "",
  slot3: "",
  slot4: "",
  sku: "",
  barcode: "",
  buyPrice: "",
  sellPrice: "",
  quantity: "",
  // Blank on purpose: a variant inherits the product's numbers until it is given
  // its own (0 = inherit on the backend).
  reorderLevel: "",
  reorderQty: "",
});

// Map an existing product variant's attributes back into the 4 UI slots.
// New data uses slot1..slot4 keys; legacy data (size/color/power/...) is folded
// into the slots so every product edits cleanly.
const mapVariantToSlots = (v: any): VariantRow => {
  const a = v.attributes ?? {};
  const pick = (k: string) =>
    a[k] !== undefined && a[k] !== null ? String(a[k]) : "";
  const others = Object.entries(a)
    .filter(
      ([k]) =>
        !["slot1", "slot2", "slot3", "slot4", "size", "color"].includes(k),
    )
    .map(([, val]) => String(val));
  return {
    slot1: pick("slot1") || pick("size") || others[0] || "",
    slot2: pick("slot2") || pick("color") || others[1] || "",
    slot3: pick("slot3") || others[2] || "",
    slot4: pick("slot4") || others[3] || "",
    sku: v.sku ?? "",
    barcode: v.barcode ?? "",
    buyPrice: v.buyPrice != null ? String(v.buyPrice) : "",
    sellPrice: v.sellPrice != null ? String(v.sellPrice) : "",
    quantity: v.quantity != null ? String(v.quantity) : "",
    // 0 / null mean "inherit the product's numbers", so they show as blank.
    reorderLevel: v.reorderLevel ? String(v.reorderLevel) : "",
    reorderQty: v.reorderQty != null ? String(v.reorderQty) : "",
    variantId: v.id ?? undefined,
  };
};

export default function ProductForm({
  onProductCreated,
  onCancel,
  editing,
  onProductUpdated,
}: ProductFormProps) {
  const { t } = useTranslation();
  const { activeMembership, hasPermission, user } = useAuth();
  const toast = useToast();
  // Standalone shops have a single SHOP location (no separate store) and manage
  // their own inventory, so the stock picker targets the shop location.
  const isStandalone = activeMembership?.standalone === true;
  const isEdit = !!editing;
  // AI product assistant: only for owners with the permission + an enabled AI
  // entitlement, and only on the add flow (never clobber an existing product).
  const canUseAi =
    !isEdit &&
    activeMembership?.aiEnabled === true &&
    hasPermission("ai.product-assist");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSuggestBusy, setAiSuggestBusy] = useState(false);

  const [categories, setCategories] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [showCatForm, setShowCatForm] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [newUnit, setNewUnit] = useState("");
  const [form, setForm] = useState<any>({
    brand: "",
    baseName: "",
    currentBuyPrice: 0,
    currentSellPrice: 0,
    categoryId: "",
    unitId: "",
    storeId: "",
    quantity: 1,
    barcode: "",
    hasVariants: false,
    isPerishable: false,
    // Default low-stock alert level for a new product; variants inherit it.
    reorderLevel: 10,
    // Blank = "let the system suggest it" (a literal 0 would pin every suggestion
    // to 1 on the backend).
    reorderQty: "",
  });
  const [attrs, setAttrs] = useState([{ key: "", value: "" }]);
  // Variant builder rows (revealed when Has Variants is checked). Each row has
  // 4 explicit attribute slots (generic across industries) + barcode tools.
  const [variants, setVariants] = useState<VariantRow[]>([emptyVariant()]);
  // Catalog-derived variant suggestions for the selected category:
  // GET /products/variant-suggestions returns the matrices other items in this
  // category already use. Read-only — the user applies rows, prunes and edits
  // them, and nothing is written until the form is submitted.
  const [variantSuggest, setVariantSuggest] = useState<any | null>(null);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [suggestDismissed, setSuggestDismissed] = useState(false);
  const [copySourceId, setCopySourceId] = useState("");
  // Batch / expiry fields (revealed when Perishable is checked).
  const [batch, setBatch] = useState({
    batchNumber: "",
    manufactureDate: "",
    expiryDate: "",
  });
  // Existing product that matches the entered brand + base name (duplicate
  // detection). When found, the form is pre-filled so the user can adjust it.
  const [duplicate, setDuplicate] = useState<any>(null);
  const autofilledKey = useRef<string | null>(null);

  // Populate the form when editing an existing product.
  useEffect(() => {
    if (!editing?.id) return;
    setForm({
      brand: editing.brand,
      baseName: editing.baseName,
      currentBuyPrice: editing.currentBuyPrice,
      currentSellPrice: editing.currentSellPrice,
      categoryId: editing.categoryId ? String(editing.categoryId) : "",
      unitId: editing.unitId ? String(editing.unitId) : "",
      // Default the stock target to the user's own location so variant initial
      // stock added while editing is deposited instead of silently ignored.
      storeId: user?.locationId ? String(user.locationId) : "",
      quantity: 1,
      barcode: editing.barcode || "",
      hasVariants: !!editing.hasVariants,
      isPerishable: !!editing.isPerishable,
      reorderLevel: editing.reorderLevel ?? 0,
      reorderQty: editing.reorderQty ?? 0,
    });
    setAttrs(
      Object.entries(editing.attributes ?? {}).map(([k, v]) => ({
        key: k,
        value: String(v),
      })),
    );
    setVariants(
      (editing.variants ?? []).length > 0
        ? (editing.variants ?? []).map(mapVariantToSlots)
        : [emptyVariant()],
    );
    setBatch({
      batchNumber: editing.batches?.[0]?.batchNumber ?? "",
      manufactureDate: editing.batches?.[0]?.manufactureDate
        ? new Date(editing.batches[0].manufactureDate)
            .toISOString()
            .slice(0, 10)
        : "",
      expiryDate: editing.batches?.[0]?.expiryDate
        ? new Date(editing.batches[0].expiryDate).toISOString().slice(0, 10)
        : "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.id]);

  useEffect(() => {
    api.get("/categories").then((res) => setCategories(res.data));
    api.get("/units").then((res) => setUnits(res.data));
    api.get("/locations").then((res) => {
      // Normal orgs target a STORE location; standalone shops target their own
      // single SHOP location (auto-selected once it loads).
      const list = isStandalone
        ? res.data
        : res.data.filter((l: any) => l.type === "STORE");
      setStores(list);
      if (isStandalone && list.length === 1) {
        setForm((f: any) =>
          f.storeId ? f : { ...f, storeId: String(list[0].id) },
        );
      }
    });
  }, [isStandalone]);

  // Suggest the variant rows other products in this category already use, so a
  // second brand of the same wire/bulb does not have to be retyped. Brand is only
  // a ranking hint (it decides whose prices get pre-filled), so it is read at
  // request time instead of re-fetching on every keystroke.
  useEffect(() => {
    const categoryId = Number(form.categoryId);
    if (!categoryId || !form.hasVariants) {
      setVariantSuggest(null);
      setSuggestDismissed(false);
      setCopySourceId("");
      return;
    }
    let cancelled = false;
    setSuggestBusy(true);
    setSuggestDismissed(false);
    setCopySourceId("");
    api
      .get("/products/variant-suggestions", {
        params: {
          categoryId,
          brand: form.brand?.trim() || undefined,
          excludeProductId: editing?.id || undefined,
        },
      })
      .then((res) => {
        if (!cancelled) setVariantSuggest(res.data ?? null);
      })
      .catch((err) => {
        // A suggestion is a convenience, never a blocker: the builder still works
        // by hand (and the AI suggester is still there). Handled here so the
        // global API error toast stays quiet.
        markHandled(err);
        if (!cancelled) setVariantSuggest(null);
      })
      .finally(() => {
        if (!cancelled) setSuggestBusy(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.categoryId, form.hasVariants, editing?.id]);

  // Duplicate detection: when the entered brand + base name exactly match an
  // existing product, pre-fill the form so the user can edit what should be
  // different. True duplicates are still rejected on submit.
  const autofillFromExisting = (p: any) => {
    const key = `${p.brand.toLowerCase()}::${p.baseName.toLowerCase()}`;
    if (autofilledKey.current === key) return;
    autofilledKey.current = key;
    setForm((f: any) => ({
      ...f,
      brand: p.brand,
      baseName: p.baseName,
      barcode: p.barcode || "",
      currentBuyPrice: p.currentBuyPrice ?? 0,
      currentSellPrice: p.currentSellPrice ?? 0,
      categoryId: p.categoryId ? String(p.categoryId) : "",
      unitId: p.unitId ? String(p.unitId) : "",
      kind: p.kind ?? "GOODS",
      hasVariants: !!p.hasVariants,
      isPerishable: !!p.isPerishable,
      reorderLevel: p.reorderLevel ?? 0,
      reorderQty: p.reorderQty ?? 0,
    }));
    setAttrs(
      Object.entries(p.attributes ?? {}).map(([k, v]) => ({
        key: k,
        value: String(v),
      })),
    );
    setVariants(
      (p.variants ?? []).length > 0
        ? (p.variants ?? []).map(mapVariantToSlots)
        : [emptyVariant()],
    );
  };

  useEffect(() => {
    if (isEdit) {
      setDuplicate(null);
      return;
    }
    const brand = form.brand?.trim();
    const baseName = form.baseName?.trim();
    if (!brand || !baseName) {
      setDuplicate(null);
      return;
    }
    const timer = setTimeout(() => {
      api
        .get(
          `/products/lookup?brand=${encodeURIComponent(brand)}&baseName=${encodeURIComponent(baseName)}`,
        )
        .then((res) => {
          const p = res.data?.product ?? null;
          setDuplicate(p);
          if (p) autofillFromExisting(p);
        })
        .catch(() => setDuplicate(null));
    }, 500);
    return () => clearTimeout(timer);
  }, [form.brand, form.baseName, isEdit]);

  // Apply the AI suggestion directly into the ProductForm state. Fields the
  // user already typed are preserved; the suggestion fills/overrides the rest.
  const applyAiSuggestion = (s: any) => {
    setForm((f: any) => ({
      ...f,
      brand: s.brand?.trim() || f.brand,
      baseName: s.baseName?.trim() || f.baseName,
      categoryId: s.categoryId ? String(s.categoryId) : f.categoryId,
      unitId: s.unitId ? String(s.unitId) : f.unitId,
      currentBuyPrice:
        s.currentBuyPrice != null ? s.currentBuyPrice : f.currentBuyPrice,
      currentSellPrice:
        s.currentSellPrice != null ? s.currentSellPrice : f.currentSellPrice,
      barcode: s.barcode?.trim() || f.barcode,
      // Show the Variant Builder whenever the AI returned real variant rows,
      // even if Gemini flagged hasVariants: false on its own.
      hasVariants:
        !!s.hasVariants ||
        (Array.isArray(s.variants) &&
          s.variants.some(
            (v: any) => v.slot1 || v.slot2 || v.slot3 || v.slot4,
          )),
      isPerishable: !!s.isPerishable,
      reorderLevel: s.reorderLevel ?? f.reorderLevel,
      reorderQty: s.reorderQty ?? f.reorderQty,
    }));
    const suggestedVariants = (Array.isArray(s.variants) ? s.variants : [])
      .filter(
        (v: any) => v.slot1 || v.slot2 || v.slot3 || v.slot4 || v.sku || v.barcode,
      )
      .map((v: any) => ({
        slot1: v.slot1 ?? "",
        slot2: v.slot2 ?? "",
        slot3: v.slot3 ?? "",
        slot4: v.slot4 ?? "",
        sku: v.sku ?? "",
        barcode: v.barcode ?? "",
        buyPrice: v.buyPrice != null ? String(v.buyPrice) : "",
        sellPrice: v.sellPrice != null ? String(v.sellPrice) : "",
        quantity: v.quantity != null ? String(v.quantity) : "",
      }));
    if (suggestedVariants.length > 0) {
      setVariants(suggestedVariants);
    }
    if (
      s.attributes &&
      typeof s.attributes === "object" &&
      Object.keys(s.attributes).length > 0
    ) {
      setAttrs(
        Object.entries(s.attributes).map(([k, v]) => ({
          key: k,
          value: String(v),
        })),
      );
    }
    if (s.isPerishable) {
      setBatch((b: any) => ({
        ...b,
        batchNumber: s.batchNumber || b.batchNumber,
        expiryDate: s.expiryDate || b.expiryDate,
      }));
    }
    toast.success(t("pf.aiApplied"));
  };

  const handleAiPhoto = async (images: string[]) => {
    if (images.length === 0) return;
    setAiBusy(true);
    try {
      // Two photos give the AI much more to read (label + details + variants).
      const res = await api.post(
        "/ai/product/analyze-photo",
        {
          base64Image: images[0],
          ...(images[1] ? { base64Image2: images[1] } : {}),
        },
        { timeout: 60000 },
      );
      applyAiSuggestion(res.data);
    } catch (err: any) {
      markHandled(err);
      toast.error(
        err?.response?.data?.message || t("pf.aiPhotoError"),
      );
    } finally {
      setAiBusy(false);
    }
  };

  const handleSuggestVariants = async () => {
    if (!form.brand?.trim() && !form.baseName?.trim()) {
      toast.error(t("pf.aiNeedName"));
      return;
    }
    setAiSuggestBusy(true);
    try {
      const res = await api.post(
        "/ai/product/suggest-variants",
        {
          brand: form.brand?.trim() || undefined,
          baseName: form.baseName?.trim() || undefined,
          existing: variants
            .filter((v) => v.slot1 || v.slot2 || v.slot3 || v.slot4)
            .map((v) => ({
              slot1: v.slot1 || undefined,
              slot2: v.slot2 || undefined,
              slot3: v.slot3 || undefined,
              slot4: v.slot4 || undefined,
            })),
        },
        { timeout: 45000 },
      );
      const suggested = (res.data ?? []).map((v: any) => ({
        slot1: v.slot1 ?? "",
        slot2: v.slot2 ?? "",
        slot3: v.slot3 ?? "",
        slot4: v.slot4 ?? "",
        sku: v.sku ?? "",
        barcode: v.barcode ?? "",
        buyPrice: v.buyPrice != null ? String(v.buyPrice) : "",
        sellPrice: v.sellPrice != null ? String(v.sellPrice) : "",
        quantity: v.quantity != null ? String(v.quantity) : "",
      }));
      if (suggested.length === 0) {
        toast.error(t("pf.aiSuggestEmpty"));
        return;
      }
      setVariants(suggested);
      setForm((f: any) => (f.hasVariants ? f : { ...f, hasVariants: true }));
      toast.success(
        t("pf.aiSuggested", { count: suggested.length }),
      );
    } catch (err: any) {
      markHandled(err);
      toast.error(
        err?.response?.data?.message || t("pf.aiSuggestError"),
      );
    } finally {
      setAiSuggestBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // --- Client-side pricing + stock-target rules (custom i18n toasts, never
    // native HTML tooltips) ---------------------------------------------
    if (form.hasVariants) {
      if (activeVariants.length === 0) {
        toast.error(t("pf.needVariant"));
        return;
      }
      const missingIdx = activeVariants.findIndex(
        (v) => !(Number(v.buyPrice) > 0) || !(Number(v.sellPrice) > 0),
      );
      if (missingIdx !== -1) {
        toast.error(t("pf.variantPricesRequired", { n: missingIdx + 1 }));
        return;
      }
    } else {
      const buy = Number(form.currentBuyPrice);
      const sell = Number(form.currentSellPrice);
      if (!(buy > 0) || !(sell > 0)) {
        toast.error(t("pf.pricesRequired"));
        return;
      }
    }
    if (needsStore && !form.storeId) {
      toast.error(t("pf.storeRequired"));
      return;
    }

    const attributes = attrs.reduce(
      (acc, { key, value }) => (key ? { ...acc, [key]: value } : acc),
      {},
    );
    const hasVariants = !!form.hasVariants;
    const payload: any = {
      brand: form.brand,
      baseName: form.baseName,
      attributes,
      categoryId: Number(form.categoryId),
      unitId: form.unitId ? Number(form.unitId) : undefined,
      storeId: form.storeId ? Number(form.storeId) : undefined,
      barcode: form.barcode?.trim() || undefined,
      hasVariants,
      isPerishable: !!form.isPerishable,
      reorderLevel: Number(form.reorderLevel) || 0,
      // null (not undefined) so clearing the field on an edit resets it back to
      // "suggest it for me" instead of leaving the old number in place.
      reorderQty:
        form.reorderQty !== "" && form.reorderQty !== undefined
          ? Number(form.reorderQty)
          : null,
    };
    if (!hasVariants) {
      // Plain products carry their own buy/sell prices and initial quantity.
      // Variant products omit them — pricing lives per row and the backend
      // snapshots the row average onto the parent Product.
      payload.currentBuyPrice = Number(form.currentBuyPrice);
      payload.currentSellPrice = Number(form.currentSellPrice);
      payload.quantity = Number(form.quantity) || 0;
    }
    if (hasVariants) {
      payload.variants = activeVariants.map((v) => {
          const entry: any = {
            // Save only non-empty slots into v.attributes.
            attributes: Object.fromEntries(
              (["slot1", "slot2", "slot3", "slot4"] as const)
                .map((k) => [k, v[k].trim()] as const)
                .filter(([, val]) => val !== ""),
            ),
            sku: v.sku?.trim() || undefined,
            barcode: v.barcode?.trim() || undefined,
            buyPrice:
              v.buyPrice !== "" && v.buyPrice !== undefined
                ? Number(v.buyPrice)
                : undefined,
            sellPrice:
              v.sellPrice !== "" && v.sellPrice !== undefined
                ? Number(v.sellPrice)
                : undefined,
            quantity:
              v.quantity !== "" && v.quantity !== undefined
                ? Number(v.quantity)
                : undefined,
            // Blank = inherit (0) the product's low-stock alert number.
            reorderLevel: v.reorderLevel === "" ? 0 : Number(v.reorderLevel),
            // Blank = inherit (null) the product's suggested reorder qty.
            reorderQty: v.reorderQty === "" ? null : Number(v.reorderQty),
          };
          // Upsert: pass the existing variant id when editing.
          if (isEdit && v.variantId) entry.id = v.variantId;
          return entry;
        });
    }
    if (form.isPerishable) {
      payload.batch = {
        batchNumber: batch.batchNumber?.trim() || undefined,
        manufactureDate: batch.manufactureDate || undefined,
        expiryDate: batch.expiryDate || undefined,
        quantity: form.quantity > 0 ? Number(form.quantity) : undefined,
      };
    }
    try {
      const res = isEdit
        ? await api.put(`/products/${editing.id}`, payload)
        : await api.post("/products", payload);
      if (isEdit) onProductUpdated?.(res.data);
      else onProductCreated?.(res.data);
    } catch (err: any) {
      markHandled(err);
      toast.error(err?.response?.data?.message || t("pf.saveError"));
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCat) return;
    const res = await api.post("/categories", { name: newCat });
    setCategories([...categories, res.data]);
    setNewCat("");
    setShowCatForm(false);
    setForm({ ...form, categoryId: res.data.id });
  };

  const handleAddUnit = async () => {
    if (!newUnit.trim()) return;
    const res = await api.post("/units", { name: newUnit.trim() });
    setUnits([...units, res.data]);
    setForm({ ...form, unitId: res.data.id });
    setNewUnit("");
  };

  const updateVariant = (
    index: number,
    field: keyof VariantRow,
    value: string,
  ) => {
    setVariants((prev) =>
      prev.map((v, i) => (i === index ? { ...v, [field]: value } : v)),
    );
  };

  // Total Quantity = sum of the variant initial quantities (variants) or the
  // single initial quantity input (plain products).
  const totalQuantity = form.hasVariants
    ? variants.reduce((s, v) => s + (Number(v.quantity) || 0), 0)
    : Number(form.quantity) || 0;

  // Rows the user actually filled (attribute slots / sku / barcode). Empty
  // starter rows are ignored for validation and submission alike.
  const activeVariants = variants.filter(
    (v) =>
      v.slot1.trim() ||
      v.slot2.trim() ||
      v.slot3.trim() ||
      v.slot4.trim() ||
      v.sku.trim() ||
      v.barcode.trim(),
  );
  // A Store/Location is required whenever initial stock will actually be
  // deposited: any positive quantity on create, or only brand-new rows while
  // editing (existing rows' quantities are historical and never re-deposited).
  const needsStore = isEdit
    ? activeVariants.some(
        (v) => !v.variantId && (Number(v.quantity) || 0) > 0,
      )
    : form.hasVariants
      ? activeVariants.some((v) => (Number(v.quantity) || 0) > 0)
      : (Number(form.quantity) || 0) > 0;

  const addVariantRow = () => setVariants([...variants, emptyVariant()]);

  // Signature of a builder row's slots — used to skip suggested rows that are
  // already in the builder, so applying a suggestion can never duplicate a
  // variant the user already has.
  const variantRowKey = (r: VariantRow) =>
    [r.slot1, r.slot2, r.slot3, r.slot4]
      .map((s) => s.trim().toLowerCase())
      .join("|");

  // Drop suggested rows into the builder: attributes (including legacy
  // size/color keys) fold into the slots exactly like an existing variant's do,
  // prices fall back to the product's own numbers, and nothing the user typed is
  // overwritten.
  const applySuggestedRows = (rows: any[]) => {
    const seen = new Set(variants.map(variantRowKey));
    const mapped = rows
      .map((r) => mapVariantToSlots(r))
      .map((r) => ({
        ...r,
        buyPrice:
          r.buyPrice ||
          (form.currentBuyPrice ? String(form.currentBuyPrice) : ""),
        sellPrice:
          r.sellPrice ||
          (form.currentSellPrice ? String(form.currentSellPrice) : ""),
      }))
      .filter((r) => {
        const key = variantRowKey(r);
        if (!key.replace(/\|/g, "").trim()) return false; // empty source row
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    if (mapped.length === 0) {
      toast.error(t("pf.variantSuggestNone"));
      return;
    }
    // Replace the untouched starter row when there is nothing else, otherwise
    // append — a typed row is never overwritten.
    const pristine = variants.length === 1 && !activeVariants.length;
    setVariants(pristine ? mapped : [...variants, ...mapped]);
    setForm((f: any) => (f.hasVariants ? f : { ...f, hasVariants: true }));
    toast.success(t("pf.variantSuggestApplied", { count: mapped.length }));
  };

  const copyVariantsFromProduct = () => {
    const source = (variantSuggest?.products ?? []).find(
      (p: any) => String(p.id) === copySourceId,
    );
    if (!source) return;
    applySuggestedRows(source.rows ?? []);
  };

  // The best suggestion for this category (identical rows used by the most
  // products, preferring the typed brand).
  const topSuggestion = variantSuggest?.groups?.[0] ?? null;
  const showSuggestions =
    !suggestDismissed && !!topSuggestion && (topSuggestion.rows ?? []).length > 0;


  return (
    <form
      onSubmit={handleSubmit}
      className="grid grid-cols-1 md:grid-cols-2 gap-3"
    >
      {canUseAi && (
        <div className="md:col-span-2">
          <AiPhotoPicker onImages={handleAiPhoto} busy={aiBusy} />
          <p className="text-[11px] text-gray-400 mt-1">
            {t("pf.aiBanner")}
          </p>
        </div>
      )}

      {duplicate && (
        <div className="md:col-span-2 border border-amber-300 bg-amber-50 rounded-lg p-3 text-sm text-amber-800">
          <p className="font-semibold">
            {t("pf.dupExists", { name: `${duplicate.brand} ${duplicate.baseName}` })}
          </p>
          <p className="text-xs text-amber-700 mt-1">
            {t("pf.dupHint")}
          </p>
        </div>
      )}

      {/* --- 1. Basic Info --- */}
      <div>
        <label className="block text-sm font-medium text-gray-500 mb-1">
          {t("pf.brand")}
        </label>
        <input
          value={form.brand}
          onChange={(e) => setForm({ ...form, brand: e.target.value })}
          className="border p-2 rounded-lg w-full text-sm"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-500 mb-1">
          {t("pf.baseName")}
        </label>
        <input
          value={form.baseName}
          onChange={(e) => setForm({ ...form, baseName: e.target.value })}
          className="border p-2 rounded-lg w-full text-sm"
          required
        />
      </div>
      <div className="md:col-span-2">
        <label className="block text-sm font-medium text-gray-500 mb-1">
          {t("pf.category")}
        </label>
        <div className="flex gap-2">
          <select
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            className="border p-2 rounded-lg w-full bg-white text-sm"
            required
          >
            <option value="">{t("pf.selectCategory")}</option>
            {categories.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setShowCatForm(!showCatForm)}
            className="bg-gray-200 px-3 rounded-lg text-sm whitespace-nowrap"
          >
            {t("pf.addCat")}
          </button>
        </div>
        {showCatForm && (
          <div className="flex gap-2 mt-2">
            <input
              placeholder={t("cat.newNamePh")}
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              className="border p-2 rounded-lg flex-1 text-sm"
            />
            <button
              type="button"
              onClick={handleAddCategory}
              className="bg-green-600 text-white px-3 rounded-lg text-sm"
            >
              {t("common.add")}
            </button>
          </div>
        )}
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-500 mb-1">
          {t("pf.unit")}
        </label>
        <div className="flex gap-2">
          <select
            value={form.unitId}
            onChange={(e) => setForm({ ...form, unitId: e.target.value })}
            className="border p-2 rounded-lg flex-1 bg-white text-sm"
          >
            <option value="">{t("pf.select")}</option>
            {units.map((u: any) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <input
            placeholder={t("pf.newPh")}
            value={newUnit}
            onChange={(e) => setNewUnit(e.target.value)}
            className="border p-2 rounded-lg w-24 text-sm"
          />
          <button
            type="button"
            onClick={handleAddUnit}
            className="bg-gray-200 px-2 rounded-lg text-xs"
          >
            +
          </button>
        </div>
      </div>

      {/* --- 2. Has Variants / Perishable toggles --- */}
      <div className="md:col-span-2 flex gap-6">
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={!!form.hasVariants} onChange={(e) => setForm({ ...form, hasVariants: e.target.checked })} className="rounded" /> {t("pf.hasVariants")}
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={!!form.isPerishable} onChange={(e) => setForm({ ...form, isPerishable: e.target.checked })} className="rounded" /> {t("pf.perishable")}
        </label>
      </div>


      {/* --- 3. Variant Builder (4-slot rows + per-row barcode tools) --- */}
      {form.hasVariants && (
        <div className="md:col-span-2 border rounded-lg p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-sm">{t("pf.variantBuilder")}</h3>
            {canUseAi && (
              <button
                type="button"
                onClick={handleSuggestVariants}
                disabled={aiSuggestBusy}
                className="text-xs text-indigo-600 hover:underline disabled:opacity-60"
              >
                {aiSuggestBusy ? t("pf.suggesting") : t("pf.suggestVariants")}
              </button>
            )}
          </div>
          <p className="text-[11px] text-gray-400">
            {t("pf.variantHint")}
          </p>
          {suggestBusy && (
            <p className="text-[11px] text-gray-400">
              {t("pf.variantSuggestLoading")}
            </p>
          )}
          {showSuggestions && (
            <div className="border border-blue-200 bg-blue-50/60 rounded-lg p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-blue-900">
                  {t("pf.variantSuggestFrom", {
                    count: topSuggestion.count,
                    category: variantSuggest?.categoryName ?? "",
                  })}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => applySuggestedRows(topSuggestion.rows ?? [])}
                    className="bg-blue-600 text-white rounded px-2 py-1 text-xs"
                  >
                    {t("pf.variantSuggestApply")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSuggestDismissed(true)}
                    className="text-xs text-gray-500 hover:underline"
                  >
                    {t("pf.variantSuggestDismiss")}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {(topSuggestion.rows ?? []).map((r: any, i: number) => (
                  <span
                    key={i}
                    className="bg-white border rounded px-2 py-0.5 text-[11px] text-gray-600"
                  >
                    {variantLabel(r) ||
                      Object.values(r.attributes ?? {}).join(" · ")}
                  </span>
                ))}
              </div>
              {(variantSuggest?.products ?? []).length > 0 && (
                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-blue-100">
                  <select
                    value={copySourceId}
                    onChange={(e) => setCopySourceId(e.target.value)}
                    className="border p-1.5 rounded text-xs bg-white"
                  >
                    <option value="">{t("pf.copyFromProductPick")}</option>
                    {(variantSuggest?.products ?? []).map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {`${p.brand} ${p.baseName} (${p.variantCount})`}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={copyVariantsFromProduct}
                    disabled={!copySourceId}
                    className="text-xs text-blue-700 hover:underline disabled:opacity-50"
                  >
                    {t("pf.copyFromProduct")}
                  </button>
                </div>
              )}
            </div>
          )}
          {variants.map((v, i) => (
            <div key={i} className="border rounded-lg p-3 space-y-2 bg-gray-50/50">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500">
                  {t("pf.variantLabel", { n: i + 1 })}
                </span>
                <button
                  type="button"
                  onClick={() => setVariants(variants.filter((_, idx) => idx !== i))}
                  className="text-red-500 text-xs"
                >
                  {t("pf.remove")}
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">
                    {t("pf.slot1Label")}
                  </label>
                  <input placeholder={t("pf.slot1Ph")} value={v.slot1} onChange={(e) => updateVariant(i, "slot1", e.target.value)} className="border p-2 rounded-lg text-sm w-full" />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">
                    {t("pf.slot2Label")}
                  </label>
                  <input placeholder={t("pf.slot2Ph")} value={v.slot2} onChange={(e) => updateVariant(i, "slot2", e.target.value)} className="border p-2 rounded-lg text-sm w-full" />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">
                    {t("pf.slot3Label")}
                  </label>
                  <input placeholder={t("pf.slot3Ph")} value={v.slot3} onChange={(e) => updateVariant(i, "slot3", e.target.value)} className="border p-2 rounded-lg text-sm w-full" />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">
                    {t("pf.slot4Label")}
                  </label>
                  <input placeholder={t("pf.slot4Ph")} value={v.slot4} onChange={(e) => updateVariant(i, "slot4", e.target.value)} className="border p-2 rounded-lg text-sm w-full" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">
                    {t("pf.variantSku")}
                  </label>
                  <input placeholder={t("pf.optional")} value={v.sku} onChange={(e) => updateVariant(i, "sku", e.target.value)} className="border p-2 rounded-lg text-sm w-full" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">
                    {t("pf.barcode")}
                  </label>
                  <div className="flex gap-1">
                    <input placeholder={t("pf.scanOrGen")} value={v.barcode} onChange={(e) => updateVariant(i, "barcode", e.target.value)} className="border p-2 rounded-lg text-sm flex-1 min-w-0" />
                    <BarcodeScanner onScan={(code) => updateVariant(i, "barcode", code)} label={t("pf.scan")} />
                    <button
                      type="button"
                      onClick={() => updateVariant(i, "barcode", generateEan13())}
                      className="bg-gray-200 px-2 rounded-lg text-xs whitespace-nowrap"
                      title={t("pf.genTitle")}
                    >
                      {t("pf.generate")}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">
                    {t("pf.initialQty")}
                  </label>
                  {v.variantId ? (
                    // Existing variants keep their stock in the inventory rows —
                    // this field only seeds a NEW variant, so typing here looked
                    // like it "restored" stock while changing nothing.
                    <p className="border p-2 rounded-lg text-[11px] text-gray-400 bg-gray-50 leading-snug">
                      {t("pf.useAdjustForStock")}
                    </p>
                  ) : (
                    <input type="number" min="0" placeholder="0" value={v.quantity} onChange={(e) => updateVariant(i, "quantity", e.target.value)} className="border p-2 rounded-lg text-sm w-full" />
                  )}
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">
                    {t("pf.buyPrice")}
                  </label>
                  <input type="number" placeholder="e.g. 12.50" value={v.buyPrice} onChange={(e) => updateVariant(i, "buyPrice", e.target.value)} className="border p-2 rounded-lg text-sm w-full" />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">
                    {t("pf.sellPrice")}
                  </label>
                  <input type="number" placeholder="e.g. 19.99" value={v.sellPrice} onChange={(e) => updateVariant(i, "sellPrice", e.target.value)} className="border p-2 rounded-lg text-sm w-full" />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">
                    {t("pf.variantLowStock")}
                  </label>
                  <input type="number" min="0" placeholder={String(form.reorderLevel ?? 0)} value={v.reorderLevel} onChange={(e) => updateVariant(i, "reorderLevel", e.target.value)} className="border p-2 rounded-lg text-sm w-full" />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-500 mb-1">
                    {t("pf.variantReorderQty")}
                  </label>
                  <input type="number" min="0" placeholder={t("pf.inherit")} value={v.reorderQty} onChange={(e) => updateVariant(i, "reorderQty", e.target.value)} className="border p-2 rounded-lg text-sm w-full" />
                </div>
              </div>
            </div>
          ))}
          <button type="button" onClick={addVariantRow} className="text-sm text-blue-600">
            {t("pf.addVariant")}
          </button>
        </div>
      )}


      {/* --- 4. Batch / Expiry (perishable) --- */}
      {form.isPerishable && (
        <div className="md:col-span-2 border rounded-lg p-3 space-y-3">
          <h3 className="font-semibold text-sm">{t("pf.batchTitle")}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t("pf.batchNumber")}</label>
              <input value={batch.batchNumber} onChange={(e) => setBatch({ ...batch, batchNumber: e.target.value })} placeholder={t("pf.batchNumberPh")} className="border p-2 rounded-lg text-sm w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t("pf.manufactureDate")}</label>
              <input type="date" value={batch.manufactureDate} onChange={(e) => setBatch({ ...batch, manufactureDate: e.target.value })} className="border p-2 rounded-lg text-sm w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t("pf.expiryDate")}</label>
              <input type="date" value={batch.expiryDate} onChange={(e) => setBatch({ ...batch, expiryDate: e.target.value })} className="border p-2 rounded-lg text-sm w-full" />
            </div>
          </div>
          {totalQuantity > 0 && (
            <p className="text-[11px] text-gray-400">
              {t("pf.attachedUnits", { n: totalQuantity })}
            </p>
          )}
        </div>
      )}

      {/* --- 5. Product Specifications --- */}
      <div className="md:col-span-2 border-t pt-4 mt-2">
        <h3 className="font-semibold mb-2 text-sm">{t("pf.specsTitle")}</h3>
        {attrs.map((attr, i) => (
          <div key={i} className="flex gap-2 mb-2">
            <input
              placeholder={t("pf.specKeyPh")}
              value={attr.key}
              onChange={(e) =>
                setAttrs(
                  attrs.map((a, idx) =>
                    idx === i ? { ...a, key: e.target.value } : a,
                  ),
                )
              }
              className="border p-2 rounded-lg flex-1 text-sm"
            />
            <input
              placeholder={t("pf.specValuePh")}
              value={attr.value}
              onChange={(e) =>
                setAttrs(
                  attrs.map((a, idx) =>
                    idx === i ? { ...a, value: e.target.value } : a,
                  ),
                )
              }
              className="border p-2 rounded-lg flex-1 text-sm"
            />
            <button
              type="button"
              onClick={() => setAttrs(attrs.filter((_, idx) => idx !== i))}
              className="text-red-500 px-2"
            >
              X
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setAttrs([...attrs, { key: "", value: "" }])}
          className="text-sm text-blue-600"
        >
          {t("pf.addSpec")}
        </button>
      </div>


      {/* --- 6. Stock target, prices, quantity, barcode, reorder --- */}
      <div>
        <label className="block text-sm font-medium text-gray-500 mb-1">
          {t("pf.store")}
          {needsStore && <span className="text-red-500"> *</span>}
        </label>
        <select
          value={form.storeId}
          onChange={(e) => setForm({ ...form, storeId: e.target.value })}
          aria-required={needsStore}
          className="border p-2 rounded-lg w-full bg-white text-sm"
        >
          <option value="">{t("pf.noInventory")}</option>
          {stores.map((s: any) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      {!form.hasVariants && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("pf.buyPrice")}
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.currentBuyPrice}
              onChange={(e) =>
                setForm({ ...form, currentBuyPrice: Number(e.target.value) })
              }
              className="border p-2 rounded-lg w-full text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("pf.sellPrice")}
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.currentSellPrice}
              onChange={(e) =>
                setForm({ ...form, currentSellPrice: Number(e.target.value) })
              }
              className="border p-2 rounded-lg w-full text-sm"
            />
          </div>
        </>
      )}
      <div>
        <label className="block text-sm font-medium text-gray-500 mb-1">
          {t("pf.totalQuantity")}
        </label>
        {form.hasVariants ? (
          <div className="border p-2 rounded-lg w-full text-sm bg-gray-50 font-medium">
            {t("pf.sumOfVariants", { n: totalQuantity })}
          </div>
        ) : (
          <input
            type="number"
            min="0"
            value={form.quantity}
            onChange={(e) =>
              setForm({ ...form, quantity: Number(e.target.value) })
            }
            className="border p-2 rounded-lg w-full text-sm"
          />
        )}
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-500 mb-1">{t("pf.lowStockLevel")}</label>
        <input type="number" min="0" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} className="border p-2 rounded-lg w-full text-sm" placeholder={t("pf.zeroNoAlert")} />
        <p className="text-[11px] text-gray-400 mt-0.5">{t("pf.lowStockHint")}</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-500 mb-1">{t("pf.suggestedReorder")}</label>
        <input type="number" min="0" value={form.reorderQty} onChange={(e) => setForm({ ...form, reorderQty: e.target.value })} className="border p-2 rounded-lg w-full text-sm" placeholder={t("pf.optional")} />
      </div>

      {!form.hasVariants && (
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-500 mb-1">{t("pf.barcodeField")}</label>
          <div className="flex gap-2">
            <input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder={t("pf.optional")} className="border p-2 rounded-lg flex-1 text-sm" />
            <BarcodeScanner onScan={(code) => setForm({ ...form, barcode: code })} label={t("pf.scanCode")} />
            <button
              type="button"
              onClick={() => setForm({ ...form, barcode: generateEan13() })}
              className="bg-gray-200 px-3 rounded-lg text-sm whitespace-nowrap"
              title={t("pf.genTitle")}
            >
              {t("pf.generate")}
            </button>
          </div>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {t("pf.barcodeHint")}
          </p>
        </div>
      )}
      <div className="md:col-span-2 flex gap-2 mt-2">
        <button
          type="submit"
          className="bg-green-600 text-white p-2 rounded-lg flex-1 text-sm"
        >
          {isEdit ? t("pf.updateProduct") : t("pf.saveProduct")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="bg-gray-200 text-gray-700 p-2 rounded-lg flex-1 text-sm"
        >
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}

