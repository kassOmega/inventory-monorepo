"use client";
// Generate a customer-facing price list PDF: pick products/variants from a
// searchable tree, then render a two-column (Item | Price) document in the
// browser and download it — one click, no server round-trip, no preview step
// (the app's CSP forbids framing documents anyway).
//
// Only selling information is printed: buy price, product/variant SKUs,
// barcodes and stock levels are deliberately left out, so the sheet is safe to
// hand to a customer (and to staff who may not be allowed to see cost prices).
//
// The products page mounts this only while it is open, so each open starts with
// a clean search box, selection and expansion state.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import Modal from "./Modal";
import Loading from "./Loading";
import { useToast } from "./ToastProvider";
import { useAuth } from "@/context/AuthContext";
import api, { markHandled } from "@/lib/api";
import { fmtCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/datetime";
import {
  buildPriceListPdf,
  priceListFileName,
  priceListItemLabel,
  specLabel,
  type PriceListRow,
} from "@/lib/priceListPdf";

interface PriceListModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** The catalog fields this modal reads (a subset of GET /products rows). */
interface PriceListProduct {
  id: number | string;
  brand?: string | null;
  baseName?: string | null;
  /** Sell price of a product that carries no variants of its own. */
  currentSellPrice?: number | string | null;
  variants?: PriceListVariant[];
}

interface PriceListVariant {
  id: number | string;
  /** e.g. { size: "42", color: "Black" } — never an internal code. */
  attributes?: Record<string, unknown> | null;
  sellPrice?: number | string | null;
}

/** The visible picker tree: a product plus the variants currently shown. */
interface TreeEntry {
  product: PriceListProduct;
  variants: PriceListVariant[];
}

/** One key per printed row: a variant, or the product that has no variants. */
function rowKey(productId: number | string, variantId?: number | string | null) {
  return `${productId}:${variantId ?? "none"}`;
}

/** "Brand Base Name" as shown everywhere else in the app. */
function displayName(product: PriceListProduct): string {
  return `${product?.brand ?? ""} ${product?.baseName ?? ""}`.trim();
}

/**
 * Amounts are always printed with Western digits and the ETB symbol so the
 * PDF's built-in Helvetica font can render them in any UI language
 * (Amharic "ብር" would need an embedded Ethiopic font).
 */
function money(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return fmtCurrency(value as number, 2, "en");
}

export default function PriceListModal({ isOpen, onClose }: PriceListModalProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const { activeMembership } = useAuth();

  const [products, setProducts] = useState<PriceListProduct[]>([]);
  // True from the start: the catalog is fetched as soon as this modal mounts,
  // and the page only mounts it while it is open (so every open starts with a
  // clean search box, selection and expansion state — no reset-in-effect).
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  /** Ticked rows, keyed by rowKey() so searching never loses a selection. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [includeHeader, setIncludeHeader] = useState(true);
  const [generating, setGenerating] = useState(false);
  /** Optional header lines from the tenant's fiscal config (best effort). */
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");

  // Fresh catalog on mount: the same full-list call the stock-count sheet makes.
  useEffect(() => {
    if (!isOpen) return;
    api
      .get("/products")
      .then((res) => {
        const rows = Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
        setProducts(rows as PriceListProduct[]);
      })
      .catch((err) => {
        markHandled(err);
        toast.error(t("products.priceList.failed"));
      })
      .finally(() => setLoading(false));
    // Address/phone for the optional business header. Staff without fiscal
    // access simply get the name-only header, so failures stay silent.
    api
      .get("/fiscal/config")
      .then((res) => {
        setAddress(String(res.data?.address ?? "").trim());
        setPhone(String(res.data?.phone ?? "").trim());
      })
      .catch((err) => {
        markHandled(err);
        setAddress("");
        setPhone("");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const query = search.trim().toLowerCase();

  /** The visible tree: products, and variants, after the search box. */
  const tree = useMemo(() => {
    const visible: TreeEntry[] = [];
    for (const product of products) {
      const variants: PriceListVariant[] = product.variants ?? [];
      if (!query) {
        visible.push({ product, variants });
        continue;
      }
      if (displayName(product).toLowerCase().includes(query)) {
        visible.push({ product, variants });
        continue;
      }
      const hits = variants.filter((v) =>
        specLabel(v).toLowerCase().includes(query),
      );
      if (hits.length) visible.push({ product, variants: hits });
    }
    return visible;
  }, [products, query]);

  /** Every row a product contributes (one per variant, or one for itself). */
  const keysOf = (product: PriceListProduct): string[] => {
    const variants: PriceListVariant[] = product.variants ?? [];
    return variants.length
      ? variants.map((v) => rowKey(product.id, v.id))
      : [rowKey(product.id)];
  };

  const visibleKeys = tree.flatMap(({ product }) => keysOf(product));
  const allVisibleSelected =
    visibleKeys.length > 0 && visibleKeys.every((k) => selected.has(k));
  const selectedCount = selected.size;

  const toggleRow = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleProduct = (product: PriceListProduct) => {
    const keys = keysOf(product);
    const all = keys.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => (all ? next.delete(k) : next.add(k)));
      return next;
    });
  };

  const toggleExpand = (productId: number | string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      const key = String(productId);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /** Select everything on screen, or clear the whole sheet. */
  const toggleAll = () =>
    setSelected((prev) => {
      if (allVisibleSelected) return new Set();
      const next = new Set(prev);
      visibleKeys.forEach((k) => next.add(k));
      return next;
    });

  /** The printed rows, in catalog order rather than click order. */
  const buildRows = (): PriceListRow[] => {
    const rows: PriceListRow[] = [];
    for (const product of products) {
      const name = displayName(product);
      const variants: PriceListVariant[] = product.variants ?? [];
      if (variants.length === 0) {
        if (selected.has(rowKey(product.id))) {
          rows.push({ item: name, price: money(product.currentSellPrice) });
        }
        continue;
      }
      for (const variant of variants) {
        if (selected.has(rowKey(product.id, variant.id))) {
          rows.push({
            item: priceListItemLabel(name, variant),
            price: money(variant.sellPrice),
          });
        }
      }
    }
    return rows;
  };

  /** Build the PDF, download it, and close the modal on success. */
  const handleGenerate = async () => {
    const rows = buildRows();
    if (rows.length === 0) {
      toast.error(t("products.priceList.nothingSelected"));
      return;
    }
    setGenerating(true);
    try {
      await buildPriceListPdf({
        rows,
        title: t("products.priceList.docTitle"),
        // Latin date text, so the core (non-embedded) font can render it.
        generatedOnLabel: t("products.priceList.generatedOn", {
          date: formatDate(new Date().toISOString(), "en"),
        }),
        labels: {
          // Document text is drawn with the built-in Helvetica font, which has no
          // Ethiopic glyphs: these values stay Latin until an Amharic font is
          // embedded (the `am` catalog repeats the same Latin values for exactly
          // this reason — see the note in lib/priceListPdf.ts).
          item: t("products.priceList.item"),
          price: t("products.priceList.price"),
          footer: t("products.priceList.footer"),
        },
        headerLines: includeHeader
          ? [
              activeMembership?.organizationName ?? "",
              address,
              phone ? `${t("products.priceList.phoneLabel")}: ${phone}` : "",
            ]
          : [],
        fileName: priceListFileName(),
      });
      toast.success(t("products.priceList.downloaded"));
      onClose();
    } catch (err) {
      markHandled(err);
      toast.error(t("products.priceList.failedPdf"));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("products.priceList.modalTitle")}
      size="wide"
    >
      <div className="flex flex-col gap-3">
        {/* Search + bulk selection */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("products.priceList.searchPlaceholder")}
            className="border rounded-lg px-3 py-2 text-sm w-full sm:max-w-sm"
          />
          <button
            type="button"
            onClick={toggleAll}
            disabled={visibleKeys.length === 0}
            className="border border-blue-600 text-blue-600 px-3 py-2 rounded-lg text-sm whitespace-nowrap disabled:opacity-50"
          >
            {allVisibleSelected
              ? t("products.priceList.clearAll")
              : t("products.priceList.selectAll")}
          </button>
          <span className="text-sm text-gray-500 sm:ml-auto">
            {t(
              selectedCount === 1
                ? "products.priceList.selectedOne"
                : "products.priceList.selectedPlural",
              { count: selectedCount },
            )}
          </span>
        </div>

        {/* Product / variant picker */}
        <div className="border rounded-lg max-h-[52vh] overflow-y-auto divide-y">
          {loading ? (
            <Loading className="py-10" />
          ) : tree.length === 0 ? (
            <p className="p-4 text-sm text-gray-500">
              {t("products.priceList.noProducts")}
            </p>
          ) : (
            tree.map(({ product, variants }) => {
              const variantsAll: PriceListVariant[] = product.variants ?? [];
              const keys = keysOf(product);
              const all = keys.every((k) => selected.has(k));
              const some = !all && keys.some((k) => selected.has(k));
              // A search auto-opens the matches so the hit is visible at once.
              const open = !!query || expanded.has(String(product.id));
              const toggleLabel = t(
                open ? "products.collapseVariants" : "products.expandVariants",
              );
              return (
                <div key={product.id} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleExpand(product.id)}
                      className="text-gray-400 hover:text-gray-600"
                      aria-label={toggleLabel}
                      title={toggleLabel}
                    >
                      {open ? (
                        <ChevronDown size={16} />
                      ) : (
                        <ChevronRight size={16} />
                      )}
                    </button>
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-800 cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-blue-600"
                        checked={all}
                        ref={(el) => {
                          if (el) el.indeterminate = some;
                        }}
                        onChange={() => toggleProduct(product)}
                      />
                      {displayName(product)}
                    </label>
                    {variantsAll.length === 0 && (
                      <span className="ml-auto text-sm text-gray-500">
                        {money(product.currentSellPrice)}
                      </span>
                    )}
                  </div>

                  {open && variantsAll.length > 0 && (
                    <div className="mt-1.5 ml-6 flex flex-col gap-1.5">
                      {variants.map((v) => (
                        <label
                          key={v.id}
                          className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-blue-600"
                            checked={selected.has(rowKey(product.id, v.id))}
                            onChange={() => toggleRow(rowKey(product.id, v.id))}
                          />
                          <span>{specLabel(v) || t("products.standard")}</span>
                          <span className="ml-auto text-gray-500">
                            {money(v.sellPrice)}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Business header opt-in + actions */}
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            className="h-4 w-4 accent-blue-600"
            checked={includeHeader}
            onChange={(e) => setIncludeHeader(e.target.checked)}
          />
          {t("products.priceList.includeHeader")}
        </label>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border text-gray-600 text-sm"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={selectedCount === 0 || generating || loading}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {generating && <Loading size="sm" />}
            {t("products.priceList.generatePdf")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
