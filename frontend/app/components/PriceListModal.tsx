"use client";
// Generate a customer-facing price list PDF: pick products/variants from a
// searchable tree, then render a two-column (Item | Price) document in the
// browser — one click, no server round-trip, no preview step (the app's CSP
// forbids framing documents anyway).
//
// The document can leave the app two ways, and both build the very same bytes:
// Download saves it to the device, while Share hands it to the OS share sheet
// (WhatsApp/Telegram/…) without saving anything — that button only appears on
// platforms that support file sharing (see lib/shareFile.ts).
//
// Only selling information is printed: buy price, product/variant SKUs,
// barcodes and stock levels are deliberately left out, so the sheet is safe to
// hand to a customer (and to staff who may not be allowed to see cost prices).
// Per product the brand can be dropped from the printed lines (never from the
// picker, where it identifies the product), and the optional header carries the
// business name, address and contact number.
//
// The products page mounts this only while it is open, so each open starts with
// a clean search box, selection and expansion state.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Share2 } from "lucide-react";
import Modal from "./Modal";
import ClearableInput from "./ClearableInput";
import Loading from "./Loading";
import { useToast } from "./ToastProvider";
import { useAuth } from "@/context/AuthContext";
import api, { markHandled } from "@/lib/api";
import { fmtCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/datetime";
import { canShareFiles, shareFile } from "@/lib/shareFile";
import {
  buildPriceListPdf,
  priceListFileName,
  priceListItemLabel,
  priceListProductName,
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
  const { activeMembership, user } = useAuth();

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
  /**
   * Products whose brand is left off the printed lines, by product id. Empty by
   * default, so the sheet is unchanged unless the user unticks a Brand box (an
   * exclusion set keeps that default even for products loaded later).
   */
  const [noBrand, setNoBrand] = useState<Set<string>>(new Set());
  /** Optional header lines from the tenant's fiscal config (best effort). */
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  /**
   * The signed-in user's own number, seeded from the session and refreshed from
   * /auth/profile: the cached user object in context can be older than the
   * number saved on the profile page.
   */
  const [userPhone, setUserPhone] = useState(() =>
    String(user?.phone ?? "").trim(),
  );
  // Asked once per mount: the answer only changes with the browser/platform,
  // and it decides whether a Share action exists at all.
  const shareSupported = useMemo(() => canShareFiles(), []);

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
    // The user's own contact number for the header's "Contact" line. The
    // session copy above can lag behind the profile page, so this refresh is
    // best effort: on failure the seeded value simply stays.
    api
      .get("/auth/profile")
      .then((res) => setUserPhone(String(res.data?.phone ?? "").trim()))
      .catch(markHandled);
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

  /** Whether a product's brand appears on its printed lines (default: yes). */
  const brandShown = (product: PriceListProduct) =>
    !noBrand.has(String(product.id));

  const toggleBrand = (productId: number | string) =>
    setNoBrand((prev) => {
      const next = new Set(prev);
      const key = String(productId);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /** The printed rows, in catalog order rather than click order. */
  const buildRows = (): PriceListRow[] => {
    const rows: PriceListRow[] = [];
    for (const product of products) {
      // The brand can be dropped per product; the picker above keeps showing it
      // (displayName) so rows stay identifiable while the user is choosing.
      const name = priceListProductName(product, brandShown(product));
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

  /**
   * The document options shared by Download and Share, so both actions always
   * produce identical bytes. The Contact line is dropped when there is no
   * number on file or when it merely repeats the business number above it.
   */
  const buildDocOptions = (rows: PriceListRow[]) => {
    const contact = userPhone && userPhone !== phone ? userPhone : "";
    return {
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
            contact ? `${t("products.priceList.contactLabel")}: ${contact}` : "",
          ]
        : [],
    };
  };

  /**
   * Build the PDF and hand it over: "download" saves it to the device, "share"
   * passes the very same bytes to the OS share sheet without saving anything.
   * Either way the modal closes once the user is done — a dismissed share sheet
   * closes it too, quietly, because cancelling is not a failure.
   */
  const handleGenerate = async (action: "download" | "share" = "download") => {
    const rows = buildRows();
    if (rows.length === 0) {
      toast.error(t("products.priceList.nothingSelected"));
      return;
    }
    setGenerating(true);
    try {
      if (action === "share") {
        const doc = await buildPriceListPdf(buildDocOptions(rows));
        // Memory to share sheet, never to the file system.
        const file = new File([doc.output("blob")], priceListFileName(), {
          type: "application/pdf",
        });
        const outcome = await shareFile(file, t("products.priceList.docTitle"));
        if (outcome === "shared") toast.success(t("products.priceList.shared"));
        onClose();
        return;
      }
      await buildPriceListPdf({
        ...buildDocOptions(rows),
        fileName: priceListFileName(),
      });
      toast.success(t("products.priceList.downloaded"));
      onClose();
    } catch (err) {
      markHandled(err);
      toast.error(
        t(
          action === "share"
            ? "products.shareFailed"
            : "products.priceList.failedPdf",
        ),
      );
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
          <ClearableInput
            value={search}
            onChange={setSearch}
            placeholder={t("products.priceList.searchPlaceholder")}
            className="w-full sm:max-w-sm"
            inputClassName="border rounded-lg px-3 py-2 text-sm w-full"
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
                    {/* Printed-brand opt-out, per product, ticked by default. */}
                    <label
                      className={`flex items-center gap-1 text-xs text-gray-500 cursor-pointer ${
                        variantsAll.length === 0 ? "ml-3" : "ml-auto"
                      }`}
                      title={t("products.priceList.brandHint")}
                    >
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-blue-600"
                        checked={brandShown(product)}
                        onChange={() => toggleBrand(product.id)}
                      />
                      {t("products.priceList.brandToggle")}
                    </label>
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

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border text-gray-600 text-sm"
          >
            {t("common.cancel")}
          </button>
          {/* Share leads where the platform can carry the file (phones); the
              download keeps the same styling when it cannot. */}
          {shareSupported && (
            <button
              type="button"
              onClick={() => handleGenerate("share")}
              disabled={selectedCount === 0 || generating || loading}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {generating && <Loading size="sm" />}
              <Share2 size={16} />
              {t("products.shareLabel")}
            </button>
          )}
          <button
            type="button"
            onClick={() => handleGenerate("download")}
            disabled={selectedCount === 0 || generating || loading}
            className={
              shareSupported
                ? "flex items-center gap-2 border border-blue-600 text-blue-600 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                : "flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            }
          >
            {generating && <Loading size="sm" />}
            {t("products.priceList.generatePdf")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
