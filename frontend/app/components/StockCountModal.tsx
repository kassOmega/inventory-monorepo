"use client";
// Count one item — or several — without leaving the page you were on. The product
// page's "Adjust" opens this, pre-loaded with the item that was clicked and with
// today's numbers already in the cells (untouched, so saving without correcting
// anything changes nothing). "Add item" inside the modal adds more cards, so a shelf
// can be counted in one go; each save is a normal bulk count.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "./Modal";
import StockProductSheet from "./StockProductSheet";
import { useToast } from "./ToastProvider";
import { useAuth } from "@/context/AuthContext";
import api, { markHandled } from "@/lib/api";
import useStockSheet, { type StockSheetProduct } from "@/lib/useStockSheet";

interface StockCountModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The item the user clicked; its variants are fetched fresh. */
  productId: number | null;
  /** The variant they clicked, when the click came from a variant row. */
  variantId?: string | number | null;
  locations: { id: number; name: string; type?: string }[];
  /** The user's own location, when their role is bound to one. */
  boundLocationId?: string | null;
  /** Called after a saved count so the page behind can refresh its numbers. */
  onSaved?: () => void;
}

export default function StockCountModal({
  isOpen,
  onClose,
  productId,
  variantId,
  locations,
  boundLocationId = null,
  onSaved,
}: StockCountModalProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const { hasPermission } = useAuth();
  const sheet = useStockSheet();
  const [products, setProducts] = useState<StockSheetProduct[]>([]);
  const [productsBusy, setProductsBusy] = useState(false);
  const [categories, setCategories] = useState<{ id: number; name: string }[]>([]);
  const [note, setNote] = useState("");
  const [opened, setOpened] = useState(false);

  const canEditSellPrice = hasPermission("products.edit");

  // The picker's items and the categories behind the per-card filter.
  useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen]);

  /** Open on the clicked item, with today's numbers filled in. */
  useEffect(() => {
    if (!isOpen || !productId || !locations.length || opened) return;
    setOpened(true);
    void sheet.prefillProduct(Number(productId), {
      variantId,
      locationIds: locations.map((l) => l.id),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, productId, variantId, locations, opened]);

  // A closed modal forgets the session, so each open starts clean.
  useEffect(() => {
    if (isOpen) return;
    sheet.resetSheet();
    setNote("");
    setOpened(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleSave = async () => {
    const res = await sheet.save(note);
    if (res.ok) {
      toast.success(t("sc.saved"));
      onSaved?.();
      return;
    }
    if (res.reason === "empty") toast.error(t("sc.nothingToSave"));
    else if (res.reason === "invalid") toast.error(t("sc.fixRows"));
    else toast.error(res.message || t("sc.saveFailed"));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("sc.nameCount")}
      size="wide"
    >
      <StockProductSheet
        sheet={sheet}
        kind="count"
        embedded
        locations={locations}
        products={products}
        productsBusy={productsBusy}
        categories={categories}
        boundLocationId={boundLocationId}
        note={note}
        onNoteChange={setNote}
        saving={sheet.saving}
        onSave={() => void handleSave()}
        canEditSellPrice={canEditSellPrice}
      />
    </Modal>
  );
}
