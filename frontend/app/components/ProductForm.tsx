"use client";
import { useToast } from "@/app/components/ToastProvider";
import Button from "@/app/components/Button";
import { useAuth } from "@/context/AuthContext";
import { generateEan13 } from "@/lib/barcode";
import api, { markHandled } from "@/lib/api";
import { variantLabel } from "@/lib/variantLabel";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Copy, Plus } from "lucide-react";
import AiAutofillCapture from "./AiAutofillCapture";
import CatalogImageInput from "./CatalogImageInput";
import BarcodeScanner from "./BarcodeScanner";
import Modal from "./Modal";
import UnitQuantityInput from "./UnitQuantityInput";
import { formatBaseQuantity } from "@/lib/unit-display";
import { pricePerUnitFromBase } from "@/lib/unit-stock";

// Field labels stay on one line. A half-width cell (and Amharic, which runs
// longer than English) used to break a label onto a second row, which pushed its
// input down and left the two columns of a row misaligned.
const LABEL =
  "block text-sm font-medium text-gray-500 mb-1 whitespace-nowrap truncate";
const LABEL_SM =
  "block text-xs font-medium text-gray-500 mb-1 whitespace-nowrap truncate";
const LABEL_XS =
  "block text-[11px] font-medium text-gray-500 mb-1 whitespace-nowrap truncate";

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
  /** Internal React/focus key. Never sent to the API. */
  rowId: string;
  slot1: string;
  slot2: string;
  slot3: string;
  slot4: string;
  barcode: string;
  buyPrice: string;
  sellPrice: string;
  /** Per-unit price overrides keyed by unitId (strings while editing). */
  unitPrices: Record<string, { buyPrice: string; sellPrice: string }>;
  quantity: string;
  /** Per-variant low-stock alert number ("" → inherit the product's). */
  reorderLevel: string;
  /** Per-variant suggested reorder qty ("" → inherit the product's). */
  reorderQty: string;
  /** Set when editing an existing variant so the backend updates instead of cloning. */
  variantId?: number;
}

interface LowerUnitRow {
  rowId: string;
  unitId: string;
  perBase: string;
  buyPrice: string;
  sellPrice: string;
}

const emptyLowerUnit = (): LowerUnitRow => ({
  rowId: newVariantRowId(),
  unitId: "",
  perBase: "",
  buyPrice: "",
  sellPrice: "",
});

const newVariantRowId = (): string =>
  typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `v-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const emptyVariant = (): VariantRow => ({
  rowId: newVariantRowId(),
  slot1: "",
  slot2: "",
  slot3: "",
  slot4: "",
  barcode: "",
  buyPrice: "",
  sellPrice: "",
  unitPrices: {},
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
    rowId: newVariantRowId(),
    slot1: pick("slot1") || pick("size") || others[0] || "",
    slot2: pick("slot2") || pick("color") || others[1] || "",
    slot3: pick("slot3") || others[2] || "",
    slot4: pick("slot4") || others[3] || "",
    barcode: v.barcode ?? "",
    buyPrice: v.buyPrice != null ? String(v.buyPrice) : "",
    sellPrice: v.sellPrice != null ? String(v.sellPrice) : "",
    unitPrices: Object.fromEntries(
      Object.entries(v.unitPrices ?? {}).map(([unitId, price]: [string, any]) => [
        unitId,
        {
          buyPrice:
            price?.buyPrice != null ? String(price.buyPrice) : "",
          sellPrice:
            price?.sellPrice != null ? String(price.sellPrice) : "",
        },
      ]),
    ),
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
  // Row that should receive focus after a duplicate is inserted.
  const pendingVariantFocus = useRef<string | null>(null);
  // AI product assistant: only for owners with the permission + an enabled AI
  // entitlement, and only on the add flow (never clobber an existing product).
  const canUseAi =
    !isEdit &&
    activeMembership?.aiEnabled === true &&
    hasPermission("ai.product-assist");
  const [aiSuggestBusy, setAiSuggestBusy] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);
  const [addingCategory, setAddingCategory] = useState(false);
  const [addingUnit, setAddingUnit] = useState(false);

  const [categories, setCategories] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [lowerUnits, setLowerUnits] = useState<LowerUnitRow[]>([]);
  const [defaultSaleUnitId, setDefaultSaleUnitId] = useState("");
  const [unitsOpen, setUnitsOpen] = useState(false);
  const [showCatForm, setShowCatForm] = useState(false);
  const [newCat, setNewCat] = useState("");
  // Creating a category/unit happens in its own small prompt (Modal) so both
  // dropdowns keep one row instead of growing an inline input beside them.
  const [showUnitForm, setShowUnitForm] = useState(false);
  const [newUnit, setNewUnit] = useState("");
  const [form, setForm] = useState<any>({
    brand: "",
    baseName: "",
    imageUrl: null,
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
      imageUrl: editing.imageUrl ?? null,
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
    const editingUnits = Array.isArray(editing.units) ? editing.units : [];
    setLowerUnits(
      editingUnits
        .filter((u: any) => !u.isBase)
        .map((u: any) => ({
          rowId: newVariantRowId(),
          unitId: String(u.unitId),
          perBase: String(u.perBase ?? ""),
          buyPrice: u.buyPrice != null ? String(u.buyPrice) : "",
          sellPrice: u.sellPrice != null ? String(u.sellPrice) : "",
        })),
    );
    setDefaultSaleUnitId(
      String(
        editingUnits.find((u: any) => u.isDefaultSale)?.unitId ??
          editing.unitId ??
          "",
      ),
    );
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
    const pUnits = Array.isArray(p.units) ? p.units : [];
    setLowerUnits(
      pUnits
        .filter((u: any) => !u.isBase)
        .map((u: any) => ({
          rowId: newVariantRowId(),
          unitId: String(u.unitId),
          perBase: String(u.perBase ?? ""),
          buyPrice: u.buyPrice != null ? String(u.buyPrice) : "",
          sellPrice: u.sellPrice != null ? String(u.sellPrice) : "",
        })),
    );
    setDefaultSaleUnitId(
      String(
        pUnits.find((u: any) => u.isDefaultSale)?.unitId ?? p.unitId ?? "",
      ),
    );
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
        (v: any) => v.slot1 || v.slot2 || v.slot3 || v.slot4 || v.barcode,
      )
      .map((v: any) => ({
        slot1: v.slot1 ?? "",
        slot2: v.slot2 ?? "",
        slot3: v.slot3 ?? "",
        slot4: v.slot4 ?? "",
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

    if (!form.unitId) {
      toast.error(t("pf.unitRequired"));
      return;
    }

    // --- Client-side pricing + stock-target rules (custom i18n toasts, never
    // native HTML tooltips) ---------------------------------------------
    if (form.hasVariants) {
      if (activeVariants.length === 0) {
        toast.error(t("pf.needVariant"));
        return;
      }
      // A duplicated row is meant to be edited. Block two identical rows so a
      // forgotten edit cannot silently create two variants with the same specs.
      const seenVariantKeys = new Set<string>();
      for (const v of activeVariants) {
        const key = [v.slot1, v.slot2, v.slot3, v.slot4]
          .map((value) => value.trim().toLowerCase())
          .join("|");
        if (!key.replace(/\|/g, "").trim()) continue;
        if (seenVariantKeys.has(key)) {
          toast.error(t("pf.variantDuplicateAttrs"));
          return;
        }
        seenVariantKeys.add(key);
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
      imageUrl: form.imageUrl ?? null,
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
    if (form.unitId) {
      payload.units = [
        {
          unitId: Number(form.unitId),
          perBase: 1,
          isBase: true,
          isDefaultSale: defaultSaleUnitId === String(form.unitId),
        },
        ...lowerUnits
          .filter((u) => u.unitId && Number(u.perBase) > 0)
          .map((u) => ({
            unitId: Number(u.unitId),
            perBase: Number(u.perBase),
            isDefaultSale: defaultSaleUnitId === u.unitId,
            buyPrice:
              u.buyPrice !== "" && u.buyPrice !== undefined
                ? Number(u.buyPrice)
                : null,
            sellPrice:
              u.sellPrice !== "" && u.sellPrice !== undefined
                ? Number(u.sellPrice)
                : null,
          })),
      ];
    }
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
            barcode: v.barcode?.trim() || undefined,
            buyPrice:
              v.buyPrice !== "" && v.buyPrice !== undefined
                ? Number(v.buyPrice)
                : undefined,
            sellPrice:
              v.sellPrice !== "" && v.sellPrice !== undefined
                ? Number(v.sellPrice)
                : undefined,
            unitPrices: Object.fromEntries(
              Object.entries(v.unitPrices ?? {})
                .map(([unitId, price]) => [
                  unitId,
                  {
                    ...(price.buyPrice !== ""
                      ? { buyPrice: Number(price.buyPrice) }
                      : {}),
                    ...(price.sellPrice !== ""
                      ? { sellPrice: Number(price.sellPrice) }
                      : {}),
                  },
                ])
                .filter(([, price]) => Object.keys(price).length > 0),
            ),
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
    setSavingProduct(true);
    try {
      const res = isEdit
        ? await api.put(`/products/${editing.id}`, payload)
        : await api.post("/products", payload);
      if (isEdit) onProductUpdated?.(res.data);
      else onProductCreated?.(res.data);
    } catch (err: any) {
      markHandled(err);
      toast.error(err?.response?.data?.message || t("pf.saveError"));
    } finally {
      setSavingProduct(false);
    }
  };

  // Called from the prompt modal (button or Enter). No <form> wraps the prompt
  // because it is rendered inside the product <form>, so Enter is handled
  // explicitly and must stop the product's implicit submission.
  const handleAddCategory = async () => {
    if (!newCat.trim()) return;
    setAddingCategory(true);
    try {
      const res = await api.post("/categories", { name: newCat.trim() });
      setCategories([...categories, res.data]);
      setForm({ ...form, categoryId: String(res.data.id) });
      setNewCat("");
      setShowCatForm(false);
    } finally {
      setAddingCategory(false);
    }
  };

  const handleAddUnit = async () => {
    if (!newUnit.trim()) return;
    setAddingUnit(true);
    try {
      const res = await api.post("/units", { name: newUnit.trim() });
      setUnits([...units, res.data]);
      setForm({ ...form, unitId: String(res.data.id) });
      setNewUnit("");
      setShowUnitForm(false);
    } finally {
      setAddingUnit(false);
    }
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

  const updateVariantUnitPrice = (
    index: number,
    unitId: string,
    field: "buyPrice" | "sellPrice",
    value: string,
  ) => {
    setVariants((prev) =>
      prev.map((v, i) => {
        if (i !== index) return v;
        const current = v.unitPrices?.[unitId] ?? {
          buyPrice: "",
          sellPrice: "",
        };
        return {
          ...v,
          unitPrices: {
            ...(v.unitPrices ?? {}),
            [unitId]: { ...current, [field]: value },
          },
        };
      }),
    );
  };

  // Total Quantity = sum of the variant initial quantities (variants) or the
  // single initial quantity input (plain products).
  const totalQuantity = form.hasVariants
    ? variants.reduce((s, v) => s + (Number(v.quantity) || 0), 0)
    : Number(form.quantity) || 0;

  // Rows the user actually filled (attribute slots / barcode). The SKU is
  // generated by the backend, so an empty starter row is ignored for both
  // validation and submission.
  const activeVariants = variants.filter(
    (v) =>
      v.slot1.trim() ||
      v.slot2.trim() ||
      v.slot3.trim() ||
      v.slot4.trim() ||
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

  const addLowerUnitRow = () => {
    const used = new Set([
      String(form.unitId),
      ...lowerUnits.map((u) => u.unitId),
    ]);
    const next = units.find((u: any) => !used.has(String(u.id)));
    setLowerUnits([
      ...lowerUnits,
      { ...emptyLowerUnit(), unitId: next ? String(next.id) : "" },
    ]);
  };

  const updateLowerUnit = (
    rowId: string,
    field: keyof LowerUnitRow,
    value: string,
  ) => {
    setLowerUnits((prev) =>
      prev.map((u) => (u.rowId === rowId ? { ...u, [field]: value } : u)),
    );
  };

  const removeLowerUnit = (rowId: string) => {
    setLowerUnits((prev) => prev.filter((u) => u.rowId !== rowId));
    const removed = lowerUnits.find((u) => u.rowId === rowId);
    if (removed && defaultSaleUnitId === removed.unitId) {
      setDefaultSaleUnitId(String(form.unitId));
    }
  };

  const handleBaseUnitChange = (value: string) => {
    const previous = form.unitId;
    setForm((f: any) => ({ ...f, unitId: value }));
    setDefaultSaleUnitId(value);

    if (!isEdit) {
      setLowerUnits([]);
      return;
    }

    // The previous base becomes a lower unit under the new base. Existing lower
    // units keep their rows, but every conversion must be re-entered because the
    // reference unit changed.
    setLowerUnits((prev) => {
      const next = prev
        .filter((u) => u.unitId !== value)
        .map((u) => ({ ...u, perBase: "" }));
      if (
        previous &&
        previous !== value &&
        !next.some((u) => u.unitId === previous)
      ) {
        next.push({ ...emptyLowerUnit(), unitId: previous, perBase: "" });
      }
      return next;
    });
  };

  const addVariantRow = () => setVariants([...variants, emptyVariant()]);

  /**
   * Duplicate a variant row directly below its source.
   *
   * Specs, prices and reorder settings are copied because variants usually
   * share them. The variant id, barcode and initial stock are deliberately
   * cleared:
   *  - a copied id would update the original variant instead of creating one,
   *  - barcodes are unique per tenant,
   *  - copying stock would deposit the same quantity twice.
   */
  const duplicateVariant = (index: number) => {
    const source = variants[index];
    if (!source) return;
    const copy: VariantRow = {
      ...source,
      rowId: newVariantRowId(),
      variantId: undefined,
      barcode: "",
      quantity: "",
    };
    pendingVariantFocus.current = copy.rowId;
    setVariants((prev) => {
      const next = [...prev];
      next.splice(index + 1, 0, copy);
      return next;
    });
    toast.success(t("pf.variantDuplicated"));
  };

  // Focus the first attribute of a freshly duplicated row after React paints it.
  useEffect(() => {
    const rowId = pendingVariantFocus.current;
    if (!rowId) return;
    const input = document.querySelector<HTMLInputElement>(
      `[data-variant-row="${rowId}"] [data-variant-field="slot1"]`,
    );
    pendingVariantFocus.current = null;
    if (!input) return;
    input.focus();
    input.select();
  }, [variants]);

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

  const baseUnit = units.find((u: any) => String(u.id) === form.unitId);
  const baseDisplayRow = form.unitId
    ? {
        rowId: "base",
        unitId: form.unitId,
        perBase: 1,
        isBase: true,
        buyPrice: "",
        sellPrice: "",
        unit: baseUnit,
      }
    : null;
  const lowerDisplayRows = form.unitId
    ? [...lowerUnits]
        .sort((a, b) => Number(a.perBase) - Number(b.perBase))
        .map((u) => ({
          ...u,
          isBase: false,
          unit: units.find((x: any) => String(x.id) === u.unitId),
        }))
    : [];
  const unitDisplayRows = baseDisplayRow
    ? [baseDisplayRow, ...lowerDisplayRows]
    : [];
  const sortedUnitRows = [...unitDisplayRows].sort(
    (a, b) => Number(b.perBase) - Number(a.perBase),
  );
  const maxPerBase = Math.max(
    1,
    ...sortedUnitRows.map((r) => Number(r.perBase) || 1),
  );
  const stockUnitRow = sortedUnitRows.find(
    (r) => Number(r.perBase) === maxPerBase,
  );
  const unitChainValid =
    sortedUnitRows.length > 0 &&
    sortedUnitRows.every((r, i) => {
      if (i === sortedUnitRows.length - 1) return true;
      const larger = Number(r.perBase);
      const smaller = Number(sortedUnitRows[i + 1].perBase);
      return larger > 0 && smaller > 0 && larger % smaller === 0;
    });

  return (
    <form
      onSubmit={handleSubmit}
      className="grid grid-cols-2 gap-3"
    >
      <AiAutofillCapture
        enabled={canUseAi}
        className="col-span-2"
        analyze={async (images) => {
          const res = await api.post(
            "/ai/product/analyze-photo",
            {
              base64Image: images[0],
              ...(images[1] ? { base64Image2: images[1] } : {}),
            },
            { timeout: 60000 },
          );
          return res.data;
        }}
        onResult={applyAiSuggestion}
        banner={t("pf.aiBanner")}
        errorMessage={t("pf.aiPhotoError")}
      />

      {duplicate && (
        <div className="col-span-2 border border-amber-300 bg-amber-50 rounded-lg p-3 text-sm text-amber-800">
          <p className="font-semibold">
            {t("pf.dupExists", { name: `${duplicate.brand} ${duplicate.baseName}` })}
          </p>
          <p className="text-xs text-amber-700 mt-1">
            {t("pf.dupHint")}
          </p>
        </div>
      )}

      {/* --- 1. Basic Info --- */}
      <div className="col-span-2">
        <CatalogImageInput
          value={form.imageUrl}
          onChange={(f) => setForm({ ...form, imageUrl: f })}
          label={t("catalog.image")}
        />
      </div>
      <div className="min-w-0">
        <label className={LABEL} title={t("pf.brand")}>
          {t("pf.brand")}
        </label>
        <input
          value={form.brand}
          onChange={(e) => setForm({ ...form, brand: e.target.value })}
          className="border p-2 rounded-lg w-full text-sm"
          required
        />
      </div>
      <div className="min-w-0">
        <label className={LABEL} title={t("pf.baseName")}>
          {t("pf.baseName")}
        </label>
        <input
          value={form.baseName}
          onChange={(e) => setForm({ ...form, baseName: e.target.value })}
          className="border p-2 rounded-lg w-full text-sm"
          required
        />
      </div>
      {/* --- 1b. Category + Unit: one row, each creatable from its own prompt --- */}
      <div className="min-w-0">
        <label className={LABEL} title={t("pf.category")}>
          {t("pf.category")}
        </label>
        <div className="flex gap-2">
          <select
            value={form.categoryId}
            onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
            className="border p-2 rounded-lg flex-1 min-w-0 bg-white text-sm"
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
            onClick={() => setShowCatForm(true)}
            title={t("menu.newCategory")}
            aria-label={t("menu.newCategory")}
            className="shrink-0 w-9 rounded-lg bg-blue-600 text-white hover:bg-blue-700 flex items-center justify-center"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>
      <div className="min-w-0">
        <label className={LABEL} title={t("pf.baseUnit")}>
          {t("pf.baseUnit")}
          <span className="ml-0.5 text-red-500">*</span>
        </label>
        <div className="flex gap-2">
          <select
            value={form.unitId}
            onChange={(e) => handleBaseUnitChange(e.target.value)}
            className="border p-2 rounded-lg flex-1 min-w-0 bg-white text-sm"
            required
            aria-required="true"
          >
            <option value="">{t("pf.select")}</option>
            {units.map((u: any) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setShowUnitForm(true)}
            title={t("menu.newUnit")}
            aria-label={t("menu.newUnit")}
            className="shrink-0 w-9 rounded-lg bg-blue-600 text-white hover:bg-blue-700 flex items-center justify-center"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>
      {isEdit && (
        <p className="col-span-2 -mt-1 text-[11px] text-amber-700">
          {t("pf.baseUnitChangeHint")}
        </p>
      )}

      {/* i18n-ignore — 1b. Multi-unit conversion ladder ---------------------------------
          The product's base/main unit is the reference. Only units lower than
          it can be added; `perBase` says how many of that unit are in ONE base
          unit. Stock is stored in the unit with the largest perBase. --- */}
      {form.unitId && (
        <div className="col-span-2 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <button
              type="button"
              onClick={() => setUnitsOpen((open) => !open)}
              aria-expanded={unitsOpen}
              aria-label={
                unitsOpen
                  ? t("pf.collapseUnits")
                  : t("pf.expandUnits")
              }
              className="flex flex-1 items-start gap-2 text-left"
            >
              {unitsOpen ? (
                <ChevronDown
                  className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
                  aria-hidden
                />
              ) : (
                <ChevronRight
                  className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
                  aria-hidden
                />
              )}
              <span className="text-sm font-semibold">
                {t("pf.unitsTitle")}
              </span>
            </button>
            {unitsOpen && (
              <button
                type="button"
                onClick={addLowerUnitRow}
                className="text-xs font-semibold text-blue-600 hover:text-blue-800"
              >
                {t("pf.addLowerUnit")}
              </button>
            )}
          </div>

          {unitsOpen && (
            <>
          <div className="mt-3 space-y-2">
            {lowerDisplayRows.map((row) => {
              const used = new Set([
                String(form.unitId),
                ...lowerUnits.map((r) => String(r.unitId)),
              ]);
              const options = units.filter(
                (u: any) =>
                  String(u.id) === String(row.unitId) ||
                  !used.has(String(u.id)),
              );
              return (
                <div
                  key={row.rowId}
                  className={`grid gap-2 rounded-lg border p-2 sm:grid-cols-[1.2fr_1fr_auto_1fr_1fr_auto] sm:items-end ${
                    row.isBase
                      ? "border-blue-200 bg-blue-50/50"
                      : "border-gray-200 bg-gray-50/50"
                  }`}
                >
                  <div className="min-w-0">
                    <label className="block text-[11px] font-medium text-gray-500">
                      {row.isBase
                        ? t("pf.baseUnit")
                        : t("pf.lowerUnit")}
                    </label>
                    {row.isBase ? (
                      <div className="truncate rounded-lg border border-blue-200 bg-white px-2 py-2 text-sm font-medium text-gray-700">
                        {row.unit?.name ?? "—"}
                      </div>
                    ) : (
                      <select
                        value={row.unitId}
                        onChange={(e) =>
                          updateLowerUnit(row.rowId, "unitId", e.target.value)
                        }
                        className="w-full rounded-lg border bg-white p-2 text-sm"
                      >
                        <option value="">{t("pf.selectUnit")}</option>
                        {options.map((u: any) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div className="min-w-0">
                    <label className="block text-[11px] font-medium text-gray-500">
                      {t("pf.perBase", { unit: baseUnit?.name ?? "" })}
                    </label>
                    {row.isBase ? (
                      <div className="rounded-lg border border-blue-200 bg-white px-2 py-2 text-sm tabular-nums text-gray-700">
                        1
                      </div>
                    ) : (
                      <input
                        type="number"
                        min="2"
                        step="1"
                        value={row.perBase}
                        onChange={(e) =>
                          updateLowerUnit(row.rowId, "perBase", e.target.value)
                        }
                        className="w-full rounded-lg border p-2 text-sm tabular-nums"
                        placeholder={t("pf.perBasePh")}
                      />
                    )}
                  </div>

                  <label className="flex items-center gap-1 text-[11px] text-gray-600 sm:pb-2">
                    <input
                      type="radio"
                      name="defaultSaleUnit"
                      checked={defaultSaleUnitId === String(row.unitId)}
                      onChange={() =>
                        setDefaultSaleUnitId(String(row.unitId))
                      }
                      className="accent-blue-600"
                    />
                    {t("pf.defaultSale")}
                  </label>

                  {row.isBase ? null : form.hasVariants ? (
                    <div className="text-[11px] text-gray-400 sm:col-span-2 sm:pb-2">
                      {t("pf.priceInVariant")}
                    </div>
                  ) : (
                    <>
                      <div className="min-w-0">
                        <label className="block text-[11px] font-medium text-gray-500">
                          {t("pf.pricePerUnit", {
                            price: t("pf.sellPrice"),
                            unit: row.unit?.name ?? "",
                          })}
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.sellPrice}
                          onChange={(e) =>
                            updateLowerUnit(row.rowId, "sellPrice", e.target.value)
                          }
                          className="w-full rounded-lg border p-2 text-sm"
                          placeholder={
                            form.currentSellPrice && row.perBase
                              ? pricePerUnitFromBase(
                                  Number(form.currentSellPrice),
                                  row,
                                ).toFixed(2)
                              : t("pf.auto")
                          }
                        />
                      </div>
                      <div className="min-w-0">
                        <label className="block text-[11px] font-medium text-gray-500">
                          {t("pf.pricePerUnit", {
                            price: t("pf.buyPrice"),
                            unit: row.unit?.name ?? "",
                          })}
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.buyPrice}
                          onChange={(e) =>
                            updateLowerUnit(row.rowId, "buyPrice", e.target.value)
                          }
                          className="w-full rounded-lg border p-2 text-sm"
                          placeholder={
                            form.currentBuyPrice && row.perBase
                              ? pricePerUnitFromBase(
                                  Number(form.currentBuyPrice),
                                  row,
                                ).toFixed(2)
                              : t("pf.auto")
                          }
                        />
                      </div>
                    </>
                  )}

                  <div className="flex justify-end sm:pb-1">
                    {!row.isBase ? (
                      <button
                        type="button"
                        onClick={() => removeLowerUnit(row.rowId)}
                        className="px-2 py-1 text-xs text-red-500 hover:text-red-700"
                        aria-label={t("pf.removeUnit")}
                      >
                        {t("pf.remove")}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {lowerDisplayRows.length === 0 && (
              <p className="rounded-lg border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-400">
                {t("pf.noLowerUnits")}
              </p>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
            <span className="text-gray-500">
              {t("pf.stockUnit")}:{" "}
              <strong className="text-gray-800">
                {stockUnitRow?.unit?.name ?? "—"}
              </strong>
            </span>
            {unitChainValid ? (
              <span className="text-emerald-700">
                {[...sortedUnitRows]
                  .reverse()
                  .map(
                    (r) =>
                      `${r.perBase} ${r.unit?.name ?? t("pf.lowerUnit")}`,
                  )
                  .join(" = ")}
              </span>
            ) : (
              <span className="font-medium text-amber-700">
                {t("pf.unitChainInvalid")}
              </span>
            )}
            {defaultSaleUnitId !== form.unitId && (
              <button
                type="button"
                onClick={() => setDefaultSaleUnitId(form.unitId)}
                className="font-medium text-blue-600 hover:text-blue-800"
              >
                {t("pf.useBaseAsDefault")}
              </button>
            )}
          </div>
            </>
          )}
        </div>
      )}

      {/* --- 1c. New category / unit prompts. They sit inside the product <form>
           (as the scanner does) and carry no <form> of their own, so Enter is
           handled explicitly and every button is type="button" — otherwise the
           key or the click would submit the product. --- */}
      <Modal
        isOpen={showCatForm}
        onClose={() => {
          setShowCatForm(false);
          setNewCat("");
        }}
        title={t("menu.newCategory")}
        size="sm"
      >
        <div className="space-y-3">
          <input
            autoFocus
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddCategory();
              }
            }}
            placeholder={t("cat.newNamePh")}
            className="border p-2 rounded-lg w-full text-sm"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={handleAddCategory}
              loading={addingCategory}
              variant="emerald"
              shape="rounded-lg"
              className="flex-1 !p-2 !text-sm"
            >
              {t("common.add")}
            </Button>
            <button
              type="button"
              onClick={() => {
                setShowCatForm(false);
                setNewCat("");
              }}
              className="bg-gray-200 text-gray-700 p-2 rounded-lg flex-1 text-sm"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      </Modal>
      <Modal
        isOpen={showUnitForm}
        onClose={() => {
          setShowUnitForm(false);
          setNewUnit("");
        }}
        title={t("menu.newUnit")}
        size="sm"
      >
        <div className="space-y-3">
          <input
            autoFocus
            value={newUnit}
            onChange={(e) => setNewUnit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddUnit();
              }
            }}
            placeholder={t("menu.unitNamePlaceholder")}
            className="border p-2 rounded-lg w-full text-sm"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={handleAddUnit}
              loading={addingUnit}
              variant="emerald"
              shape="rounded-lg"
              className="flex-1 !p-2 !text-sm"
            >
              {t("common.add")}
            </Button>
            <button
              type="button"
              onClick={() => {
                setShowUnitForm(false);
                setNewUnit("");
              }}
              className="bg-gray-200 text-gray-700 p-2 rounded-lg flex-1 text-sm"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      </Modal>

      {/* --- 2. Has Variants / Perishable toggles --- */}
      <div className="col-span-2 flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={!!form.hasVariants} onChange={(e) => setForm({ ...form, hasVariants: e.target.checked })} className="rounded" /> {t("pf.hasVariants")}
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={!!form.isPerishable} onChange={(e) => setForm({ ...form, isPerishable: e.target.checked })} className="rounded" /> {t("pf.perishable")}
        </label>
      </div>


      {/* --- 3. Variant Builder (4-slot rows + per-row barcode tools) --- */}
      {form.hasVariants && (
        <div className="col-span-2 border rounded-lg p-3 space-y-3">
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
            <div
              key={v.rowId}
              data-variant-row={v.rowId}
              className="border rounded-lg p-3 space-y-2 bg-gray-50/50"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-gray-500">
                  {t("pf.variantLabel", { n: i + 1 })}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => duplicateVariant(i)}
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                    title={t("pf.duplicateVariantTitle")}
                    aria-label={t("pf.duplicateVariantAria", { n: i + 1 })}
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                    {t("pf.duplicateVariant")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setVariants(variants.filter((_, idx) => idx !== i))}
                    className="text-red-500 text-xs"
                  >
                    {t("pf.remove")}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="min-w-0">
                  <label className={LABEL_XS} title={t("pf.slot1Label")}>
                    {t("pf.slot1Label")}
                  </label>
                  <input data-variant-field="slot1" placeholder={t("pf.slot1Ph")} value={v.slot1} onChange={(e) => updateVariant(i, "slot1", e.target.value)} className="border p-2 rounded-lg text-sm w-full" />
                </div>
                <div className="min-w-0">
                  <label className={LABEL_XS} title={t("pf.slot2Label")}>
                    {t("pf.slot2Label")}
                  </label>
                  <input placeholder={t("pf.slot2Ph")} value={v.slot2} onChange={(e) => updateVariant(i, "slot2", e.target.value)} className="border p-2 rounded-lg text-sm w-full" />
                </div>
                <div className="min-w-0">
                  <label className={LABEL_XS} title={t("pf.slot3Label")}>
                    {t("pf.slot3Label")}
                  </label>
                  <input placeholder={t("pf.slot3Ph")} value={v.slot3} onChange={(e) => updateVariant(i, "slot3", e.target.value)} className="border p-2 rounded-lg text-sm w-full" />
                </div>
                <div className="min-w-0">
                  <label className={LABEL_XS} title={t("pf.slot4Label")}>
                    {t("pf.slot4Label")}
                  </label>
                  <input placeholder={t("pf.slot4Ph")} value={v.slot4} onChange={(e) => updateVariant(i, "slot4", e.target.value)} className="border p-2 rounded-lg text-sm w-full" />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div className="col-span-2 sm:col-span-3 min-w-0">
                  <label className={LABEL_XS} title={t("pf.barcode")}>
                    {t("pf.barcode")}
                  </label>
                  <div className="flex flex-wrap gap-1">
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
                <div className="min-w-0">
                  <label className={LABEL_XS} title={t("pf.initialQty")}>
                    {t("pf.initialQty")}
                  </label>
                  {v.variantId ? (
                    // Existing variants keep their stock in the inventory rows —
                    // this field only seeds a NEW variant, so typing here looked
                    // like it "restored" stock while changing nothing. Show the
                    // number beside the hint instead of a three-line note.
                    <div
                      className="border p-2 rounded-lg text-sm bg-gray-50 text-gray-500 tabular-nums"
                      title={t("pf.useAdjustForStock")}
                    >
                      {formatBaseQuantity(Number(v.quantity) || 0, unitDisplayRows as any)}
                    </div>
                  ) : (
                    <UnitQuantityInput
                      units={unitDisplayRows}
                      value={Number(v.quantity) || 0}
                      onChange={(qty) => updateVariant(i, "quantity", String(qty))}
                      inputClassName="w-full"
                    />
                  )}
                </div>
                <div className="min-w-0">
                  <label className={LABEL_XS} title={t("pf.buyPrice")}>
                    {t("pf.pricePerUnit", {
                      price: t("pf.buyPrice"),
                      unit: baseUnit?.name ?? "",
                    })}
                  </label>
                  <input type="number" placeholder="e.g. 12.50" value={v.buyPrice} onChange={(e) => updateVariant(i, "buyPrice", e.target.value)} className="border p-2 rounded-lg text-sm w-full" />
                </div>
                <div className="min-w-0">
                  <label className={LABEL_XS} title={t("pf.sellPrice")}>
                    {t("pf.pricePerUnit", {
                      price: t("pf.sellPrice"),
                      unit: baseUnit?.name ?? "",
                    })}
                  </label>
                  <input type="number" placeholder="e.g. 19.99" value={v.sellPrice} onChange={(e) => updateVariant(i, "sellPrice", e.target.value)} className="border p-2 rounded-lg text-sm w-full" />
                </div>
                <div className="min-w-0">
                  <label className={LABEL_XS} title={t("pf.variantLowStock")}>
                    {t("pf.variantLowStock")}
                  </label>
                  <input type="number" min="0" placeholder={String(form.reorderLevel ?? 0)} value={v.reorderLevel} onChange={(e) => updateVariant(i, "reorderLevel", e.target.value)} className="border p-2 rounded-lg text-sm w-full" />
                </div>
                <div className="col-span-2 min-w-0">
                  <label className={LABEL_XS} title={t("pf.variantReorderQty")}>
                    {t("pf.variantReorderQty")}
                  </label>
                  <input type="number" min="0" placeholder={t("pf.inherit")} value={v.reorderQty} onChange={(e) => updateVariant(i, "reorderQty", e.target.value)} className="border p-2 rounded-lg text-sm w-full" />
                </div>
              </div>

              {lowerDisplayRows.filter((r) => r.unitId && Number(r.perBase) > 1).length > 0 && (
                <div className="rounded-lg border border-gray-200 bg-white p-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    {t("pf.variantUnitPrices")}
                  </p>
                  <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                    {lowerDisplayRows
                      .filter((r) => r.unitId && Number(r.perBase) > 1)
                      .map((r) => {
                        const price = v.unitPrices?.[r.unitId] ?? {
                          buyPrice: "",
                          sellPrice: "",
                        };
                        const baseBuy =
                          Number(v.buyPrice) || Number(form.currentBuyPrice) || 0;
                        const baseSell =
                          Number(v.sellPrice) || Number(form.currentSellPrice) || 0;
                        const derivedBuy = baseBuy
                          ? pricePerUnitFromBase(baseBuy, r).toFixed(2)
                          : "";
                        const derivedSell = baseSell
                          ? pricePerUnitFromBase(baseSell, r).toFixed(2)
                          : "";
                        return (
                          <div
                            key={r.unitId}
                            className="rounded-md border border-gray-100 bg-gray-50/60 p-1.5"
                          >
                            <p className="truncate text-[11px] font-medium text-gray-700">
                              {r.unit?.name ?? t("pf.lowerUnit")}
                            </p>
                            <div className="mt-1 grid grid-cols-2 gap-1">
                              <div>
                                <label className="block text-[9px] text-gray-400">
                                  {t("pf.buyPrice")}
                                </label>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={price.buyPrice}
                                  onChange={(e) =>
                                    updateVariantUnitPrice(
                                      i,
                                      r.unitId,
                                      "buyPrice",
                                      e.target.value,
                                    )
                                  }
                                  placeholder={derivedBuy || t("pf.auto")}
                                  className="w-full rounded border p-1 text-xs"
                                />
                              </div>
                              <div>
                                <label className="block text-[9px] text-gray-400">
                                  {t("pf.sellPrice")}
                                </label>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={price.sellPrice}
                                  onChange={(e) =>
                                    updateVariantUnitPrice(
                                      i,
                                      r.unitId,
                                      "sellPrice",
                                      e.target.value,
                                    )
                                  }
                                  placeholder={derivedSell || t("pf.auto")}
                                  className="w-full rounded border p-1 text-xs"
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          ))}
          <button type="button" onClick={addVariantRow} className="text-sm text-blue-600">
            {t("pf.addVariant")}
          </button>
        </div>
      )}


      {/* --- 4. Batch / Expiry (perishable) --- */}
      {form.isPerishable && (
        <div className="col-span-2 border rounded-lg p-3 space-y-3">
          <h3 className="font-semibold text-sm">{t("pf.batchTitle")}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <div className="min-w-0">
              <label className={LABEL_SM} title={t("pf.batchNumber")}>{t("pf.batchNumber")}</label>
              <input value={batch.batchNumber} onChange={(e) => setBatch({ ...batch, batchNumber: e.target.value })} placeholder={t("pf.batchNumberPh")} className="border p-2 rounded-lg text-sm w-full" />
            </div>
            <div className="min-w-0">
              <label className={LABEL_SM} title={t("pf.manufactureDate")}>{t("pf.manufactureDate")}</label>
              <input type="date" value={batch.manufactureDate} onChange={(e) => setBatch({ ...batch, manufactureDate: e.target.value })} className="border p-2 rounded-lg text-sm w-full" />
            </div>
            <div className="min-w-0">
              <label className={LABEL_SM} title={t("pf.expiryDate")}>{t("pf.expiryDate")}</label>
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
      <div className="col-span-2 border-t pt-4 mt-2">
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
              className="border p-2 rounded-lg flex-1 min-w-0 text-sm"
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
              className="border p-2 rounded-lg flex-1 min-w-0 text-sm"
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
      <div className="min-w-0">
        <label className={LABEL} title={t("pf.store")}>
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
            <label className={LABEL} title={t("pf.buyPrice")}>
              {t("pf.pricePerUnit", {
                price: t("pf.buyPrice"),
                unit: baseUnit?.name ?? "",
              })}
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.currentBuyPrice === 0 ? "" : form.currentBuyPrice}
              onChange={(e) =>
                setForm({ ...form, currentBuyPrice: e.target.value })
              }
              className="border p-2 rounded-lg w-full text-sm"
            />
          </div>
          <div>
            <label className={LABEL} title={t("pf.sellPrice")}>
              {t("pf.pricePerUnit", {
                price: t("pf.sellPrice"),
                unit: baseUnit?.name ?? "",
              })}
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.currentSellPrice === 0 ? "" : form.currentSellPrice}
              onChange={(e) =>
                setForm({ ...form, currentSellPrice: e.target.value })
              }
              className="border p-2 rounded-lg w-full text-sm"
            />
          </div>
        </>
      )}
      <div>
        <label className={LABEL} title={t("pf.totalQuantity")}>
          {t("pf.totalQuantity")}
        </label>
        {form.hasVariants ? (
          <div className="border p-2 rounded-lg w-full text-sm bg-gray-50 font-medium">
            {t("pf.sumOfVariants", {
              n: formatBaseQuantity(totalQuantity, unitDisplayRows as any),
            })}
          </div>
        ) : (
          <UnitQuantityInput
            units={unitDisplayRows}
            value={Number(form.quantity) || 0}
            onChange={(quantity) => setForm({ ...form, quantity })}
            inputClassName="w-full"
          />
        )}
      </div>
      <div>
        <label className={LABEL} title={t("pf.lowStockLevel")}>
          {t("pf.lowStockLevel")}
        </label>
        <input type="number" min="0" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} className="border p-2 rounded-lg w-full text-sm" placeholder={t("pf.zeroNoAlert")} />
        <p className="text-[11px] text-gray-400 mt-0.5">{t("pf.lowStockHint")}</p>
      </div>
      <div>
        <label className={LABEL} title={t("pf.suggestedReorder")}>
          {t("pf.suggestedReorder")}
        </label>
        <input type="number" min="0" value={form.reorderQty} onChange={(e) => setForm({ ...form, reorderQty: e.target.value })} className="border p-2 rounded-lg w-full text-sm" placeholder={t("pf.optional")} />
      </div>

      {!form.hasVariants && (
        <div className="col-span-2">
          <label className={LABEL} title={t("pf.barcodeField")}>
            {t("pf.barcodeField")}
          </label>
          <div className="flex flex-wrap gap-2">
            <input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder={t("pf.optional")} className="border p-2 rounded-lg flex-1 min-w-0 text-sm" />
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
      <div className="col-span-2 flex gap-2 mt-2">
        <Button
          type="submit"
          loading={savingProduct}
          variant="emerald"
          shape="rounded-lg"
          className="flex-1 !p-2 !text-sm"
        >
          {isEdit ? t("pf.updateProduct") : t("pf.saveProduct")}
        </Button>
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

