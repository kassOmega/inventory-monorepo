"use client";
// Stock Count — the count sheet. A count SETS what is on hand, and the selling
// price can be corrected at the same time (the buying price is not reachable from
// here at all). Each item is one card: pick a category, pick the item, then type
// what you counted per location. Reached from the Stock tab, or from the product
// page's Adjust modal (which shares the same prefill).
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import StockProductSheet, {
  defaultLocationColumns,
  lowStockColumns,
} from "@/app/components/StockProductSheet";
import StockTabs from "@/app/components/StockTabs";
import { useToast } from "@/app/components/ToastProvider";
import { useAuth } from "@/context/AuthContext";
import api, { markHandled } from "@/lib/api";
import useStockSheet, { type StockSheetProduct } from "@/lib/useStockSheet";

export default function StockCountPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { user, hasPermission } = useAuth();
  const sheet = useStockSheet();
  /** Items already opened from a deep link, so a re-render cannot duplicate them. */
  const loadedRef = useRef<Set<number>>(new Set());

  const canCount = hasPermission("products.adjust-stock");
  // Correcting a selling price rides on products.edit (owner + storekeeper).
  const canEditSellPrice = hasPermission("products.edit");
  const canViewReports = hasPermission("reports.view");
  // A user bound to one location sees only that one unless the business granted
  // them inventory.all-locations. The API enforces the same rule.
  const canAllLocations =
    user?.isSuperuser === true || hasPermission("inventory.all-locations");
  const boundLocationId =
    user?.locationType === "STORE" || user?.locationType === "SHOP"
      ? String(user?.locationId ?? "")
      : "";

  const [locations, setLocations] = useState<
    { id: number; name: string; type?: string }[]
  >([]);
  const [products, setProducts] = useState<StockSheetProduct[]>([]);
  const [productsBusy, setProductsBusy] = useState(false);
  const [categories, setCategories] = useState<{ id: number; name: string }[]>(
    [],
  );
  const [note, setNote] = useState("");
  const [presetBusy, setPresetBusy] = useState(false);
  /** Where the low-stock quick add reads from ("" = every location). */
  const [lowStockLocationId, setLowStockLocationId] = useState("");

  /** The one location this sheet is unambiguously about (own / only one). */
  const effectiveLocationId =
    boundLocationId && locations.some((l) => String(l.id) === boundLocationId)
      ? boundLocationId
      : locations.length === 1
        ? String(locations[0].id)
        : "";
  /**
   * Where the low-stock quick add reads: the location the chip names, defaulting to
   * the user's own (or the only) location — and to every location for an owner who
   * works at several, in which case each added card opens where the report says that
   * item is actually low.
   */
  const lowStockScope = lowStockLocationId || effectiveLocationId;

  useEffect(() => {
    api
      .get("/locations")
      .then((res) => {
        const usable = ((res.data ?? []) as any[]).filter(
          (l) => l.type === "STORE" || l.type === "SHOP",
        );
        setLocations(
          canAllLocations || !boundLocationId
            ? usable
            : usable.filter((l) => String(l.id) === boundLocationId),
        );
      })
      .catch((err) => markHandled(err));
  }, [canAllLocations, boundLocationId]);

  // The picker list: every product, filtered per card by its category (the same
  // bare list the sale and request forms use).
  useEffect(() => {
    setProductsBusy(true);
    api
      .get("/products")
      .then((res) => {
        const rows: StockSheetProduct[] = Array.isArray(res.data)
          ? res.data
          : (res.data?.data ?? []);
        setProducts(rows);
        sheet.registerProducts(rows);
      })
      .catch((err) => markHandled(err))
      .finally(() => setProductsBusy(false));
    api
      .get("/categories")
      .then((res) => setCategories(res.data ?? []))
      .catch((err) => markHandled(err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  /**
   * "Adjust" from a product row used to arrive here as ?productId=…; the same
   * handler is kept for deep links. The item opens as a card with today's numbers
   * already in the cells (left untouched, so a save with no corrections changes
   * nothing) and the chosen variant focused.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = Number(params.get("productId"));
    const variant = params.get("variant");
    if (!id || locations.length === 0) return;
    if (loadedRef.current.has(id)) return;
    loadedRef.current.add(id);
    void sheet.prefillProduct(id, {
      variantId: variant,
      locationIds: locations.map((l) => l.id),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations]);

  /** Quick add: the items the report says are below their alert level. */
  const addLowStockItems = async (): Promise<number> => {
    setPresetBusy(true);
    try {
      const low = await api.get("/reports/low-stock", {
        params: lowStockScope ? { locationId: lowStockScope } : {},
      });
      const rows: any[] = Array.isArray(low.data)
        ? low.data
        : (low.data?.data ?? []);
      if (!rows.length) return 0;
      const stock = await api.get("/products/stock", {
        params: {
          productIds: rows.map((r) => r.id).join(","),
          locationIds: lowStockScope || locations.map((l) => l.id).join(","),
        },
      });
      const found: StockSheetProduct[] = stock.data?.products ?? [];
      sheet.registerProducts(found);

      let prepared = 0;
      for (const row of rows) {
        const product = found.find((p) => p.id === row.id);
        if (!product) continue;
        const lowVariantIds = (row.variants ?? [])
          .map((v: any) => Number(v.variantId))
          .filter((id: number) => id > 0);
        if (product.hasVariants) {
          // Only the variants the report flagged; all of them when it lists none.
          const wanted = lowVariantIds.length
            ? (product.variants ?? []).filter((v) =>
                lowVariantIds.includes(v.id),
              )
            : (product.variants ?? []);
          if (wanted.length) {
            // The card opens exactly where the report says this item is low.
            sheet.addProduct(
              { ...product, variants: wanted },
              lowStockColumns(
                row,
                wanted.map((v) => v.id),
                lowStockScope,
              ),
            );
            prepared += 1;
          }
        } else {
          sheet.addProduct(product, lowStockColumns(row, [], lowStockScope));
          prepared += 1;
        }
      }
      return prepared;
    } catch (err) {
      markHandled(err);
      return 0;
    } finally {
      setPresetBusy(false);
    }
  };

  /** Scan-to-add: the code resolves to its item/variant and opens its card. */
  const handleScan = async (code: string): Promise<string | null> => {
    const columns = defaultLocationColumns(locations, boundLocationId);
    if (!columns.length) {
      toast.error(t("sc.pickLocationFirst"));
      return null;
    }
    try {
      const res = await api.get("/products/by-code", {
        params: { code, locationId: columns[0] },
      });
      const product = res.data?.product;
      const variant = res.data?.variant;
      if (!product) return null;
      sheet.registerProducts([product]);
      sheet.addProduct(product, columns);
      return `${product.id}|${variant?.id ?? "base"}|${columns[0]}`;
    } catch (err) {
      markHandled(err);
      return null;
    }
  };

  const handleSave = async (close: boolean) => {
    const res = await sheet.save(note);
    if (res.ok) {
      toast.success(t("sc.saved"));
      loadedRef.current.clear();
      if (close) {
        sheet.resetSheet();
        // Back to the Stock section's first tab after a finished count.
        router.push("/dashboard/inventory");
      }
      return;
    }
    if (res.reason === "empty") toast.error(t("sc.nothingToSave"));
    else if (res.reason === "invalid") toast.error(t("sc.fixRows"));
    else toast.error(res.message || t("sc.saveFailed"));
  };

  if (!canCount) {
    return (
      <div className="bg-white rounded-xl shadow-sm border p-6 text-sm text-gray-500">
        {t("sc.noPermission")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <StockTabs />
      <div>
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">
          {t("nav.stockCount")}
        </h1>
        <p className="text-sm text-gray-500 mt-1">{t("sc.countSubtitle")}</p>
      </div>

      <StockProductSheet
        sheet={sheet}
        kind="count"
        locations={locations}
        products={products}
        productsBusy={productsBusy}
        categories={categories}
        boundLocationId={boundLocationId || null}
        note={note}
        onNoteChange={setNote}
        saving={sheet.saving}
        onSave={() => void handleSave(false)}
        onSaveAndClose={() => void handleSave(true)}
        onScanCode={handleScan}
        onAddLowStock={canViewReports ? addLowStockItems : undefined}
        lowStockLocationId={lowStockScope}
        onLowStockLocationChange={setLowStockLocationId}
        presetBusy={presetBusy}
        canEditSellPrice={canEditSellPrice}
      />
    </div>
  );
}

