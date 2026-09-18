"use client";
// Stock In (restock) — receive items across locations. This sheet ADDS to what is
// on hand; it never sets a count (that is Stock Count). Each item is one card: pick
// a category, pick the item, then type what arrived per location. Per-line costs
// can be corrected by the owner, and POST /restock/batch decides per location
// whether the stock lands directly, waits for the receiver to confirm, or becomes
// a request for the owner to approve.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "@/app/components/Modal";
import ProductForm from "@/app/components/ProductForm";
import StockProductSheet, {
  defaultLocationColumns,
  lowStockColumns,
} from "@/app/components/StockProductSheet";
import StockTabs from "@/app/components/StockTabs";
import { useToast } from "@/app/components/ToastProvider";
import { useAuth } from "@/context/AuthContext";
import api, { markHandled } from "@/lib/api";
import useStockSheet, { type StockSheetProduct } from "@/lib/useStockSheet";

export default function StockInPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { user, hasPermission } = useAuth();
  const sheet = useStockSheet();

  const isOwner = user?.isSuperuser === true;
  const canRestock = hasPermission("restock.create");
  const canViewReports = hasPermission("reports.view");
  // Prices on a restock stay owner-only (unchanged rule, enforced by the API).
  const canEditPrice = isOwner;
  const canAllLocations = isOwner || hasPermission("inventory.all-locations");
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
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [showProductModal, setShowProductModal] = useState(false);

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

  // The picker list: every product, filtered per card by its category.
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

  /** Quick add: what is below its alert level — the usual reason to restock. */
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

  /**
   * The page owns this save (not the hook) because the errors come back keyed by
   * the index of the items that were sent — the same order as `touchedRows`. The
   * receiving location of each line is in the line itself, so no batch-level
   * location has to be chosen first.
   */
  const handleSave = async () => {
    const items = sheet.buildRestockItems();
    if (items.length === 0) {
      toast.error(t("sc.nothingToSave"));
      return;
    }
    const filled = sheet.touchedRows;
    setSaving(true);
    sheet.setRowErrors({});
    try {
      const res = await api.post("/restock/batch", {
        ...(note.trim() ? { vendor: note.trim() } : {}),
        items,
      });
      setResult(res.data ?? null);
      toast.success(t("sc.saved"));
      await sheet.refreshStock();
    } catch (err: any) {
      markHandled(err);
      const errors = err?.response?.data?.errors;
      if (Array.isArray(errors)) {
        const mapped: Record<string, string> = {};
        for (const e of errors) {
          const row = filled[e.index];
          if (row) mapped[row.key] = e.message ?? "rejected";
        }
        sheet.setRowErrors(mapped);
        toast.error(t("sc.fixRows"));
      } else {
        toast.error(
          err?.response?.data?.message || t("restock.errorRestocking"),
        );
      }
    } finally {
      setSaving(false);
    }
  };

  if (!canRestock) {
    return (
      <div className="bg-white rounded-xl shadow-sm border p-6 text-sm text-gray-500">
        {t("sc.noPermission")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <StockTabs />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">
            {t("nav.restock")}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{t("sc.inSubtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowProductModal(true)}
          className="text-sm text-blue-700 hover:underline"
        >
          + {t("products.addNewTitle")}
        </button>
      </div>

      <StockProductSheet
        sheet={sheet}
        kind="in"
        locations={locations}
        products={products}
        productsBusy={productsBusy}
        categories={categories}
        boundLocationId={boundLocationId || null}
        note={note}
        onNoteChange={setNote}
        saving={saving}
        onSave={() => void handleSave()}
        onScanCode={handleScan}
        onAddLowStock={canViewReports ? addLowStockItems : undefined}
        lowStockLocationId={lowStockScope}
        onLowStockLocationChange={setLowStockLocationId}
        presetBusy={presetBusy}
        canEditPrice={canEditPrice}
      />

      {/* What the last submission did, per receiving location. */}
      {result?.byLocation && (
        <div className="bg-white rounded-xl shadow-sm border p-4 space-y-1">
          <p className="text-sm font-medium text-gray-700">
            {isOwner ? t("restock.submittedOwner") : t("restock.submittedStaff")}
          </p>
          {result.byLocation.map((loc: any) => (
            <p key={loc.locationId} className="text-xs text-gray-500">
              {loc.locationName} — {loc.items} ·{" "}
              {loc.mode === "direct"
                ? t("restock.modeDirect")
                : loc.mode === "deposit"
                  ? t("restock.modeDeposit")
                  : t("restock.modePending")}
              {loc.requestId ? ` · #${loc.requestId}` : ""}
              {loc.journalRef ? ` · ${loc.journalRef}` : ""}
            </p>
          ))}
        </div>
      )}

      <Modal
        isOpen={showProductModal}
        onClose={() => setShowProductModal(false)}
        title={t("products.addNewTitle")}
      >
        <ProductForm
          onProductCreated={(product: any) => {
            setShowProductModal(false);
            sheet.registerProducts([product]);
            const columns = defaultLocationColumns(locations, boundLocationId);
            if (columns.length) sheet.addProduct(product, columns);
          }}
          onCancel={() => setShowProductModal(false)}
        />
      </Modal>
    </div>
  );
}

