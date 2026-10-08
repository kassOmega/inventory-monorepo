"use client";
// app/components/PurchaseForm.tsx
//
// The single form behind EVERY purchase — the paid (quick) flow and the credit
// (taken from a vendor) flow. `mode` decides only two things: whether the money
// leaves the till now (PAID) or becomes a payable to the vendor (CREDIT), and
// therefore whether a vendor is required. The batch itself is typed the same way
// in both: a purchase exists to be resold, so every line carries the buy price
// *and* the sell price it is expected to fetch. Everything else is shared, so a
// shopkeeper learns one form.
//
//   <PurchaseForm isOpen={open} onClose={close} mode="PAID" onSaved={refresh} />
//   <PurchaseForm isOpen={open} onClose={close} mode="CREDIT"
//                 defaultVendorId={c.id} onSaved={refreshCustomer} />
//
// It owns its reference data (payment methods, vendors, shops) and its own
// Modal, so a caller only has to say *why* it is opening the form. The
// idempotency key survives a failed submit, so a retry cannot book twice.
import api, { markHandled } from "@/lib/api";
import Modal from "./Modal";
import Loading from "./Loading";
import SearchableSelect from "./SearchableSelect";
import CustomerForm from "./CustomerForm";
import { useSingleLocationAutofill } from "@/lib/singleLocation";
import { newClientRef } from "@/lib/clientRef";
import { fmtCurrency } from "@/lib/currency";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "./ToastProvider";

/** PAID = settled from the till up front, CREDIT = owed to the vendor. */
export type PurchaseMode = "PAID" | "CREDIT";

/** One bought line: what, how many and at what buying price. */
interface CartLine {
  productName: string;
  quantity: number;
  unitPrice: number;
  sellPrice: number;
}

interface Props {
  isOpen: boolean;
  /** Called for every way out of the modal: ✕, backdrop or Cancel. */
  onClose: () => void;
  /** Which settlement the form opens with. */
  mode: PurchaseMode;
  /** Hide the switch: the caller's button already chose the settlement. */
  hideModeSwitch?: boolean;
  /** Pre-selected vendor — the credit pages open the form for one vendor. */
  defaultVendorId?: number | string | null;
  /** Called with the created rows once the request succeeds. */
  onSaved?: (purchases: any[]) => void;
}

/** A pristine cart row: the form keeps at least one so it is never empty. */
const blankLine = (): CartLine => ({
  productName: "",
  quantity: 1,
  unitPrice: 0,
  sellPrice: 0,
});

export default function PurchaseForm(props: Props) {
  // The form body is remounted whenever the form opens — or switches settlement
  // — so its state is initialised from the props instead of being reset by an
  // effect: a fresh batch, or one pre-filled for a vendor.
  const openKey = props.isOpen
    ? `open-${props.mode}-${props.defaultVendorId ?? "none"}`
    : "closed";
  return <PurchaseFormModal key={openKey} {...props} />;
}

function PurchaseFormModal({
  isOpen,
  onClose,
  mode: initialMode,
  hideModeSwitch = false,
  defaultVendorId = null,
  onSaved,
}: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const toast = useToast();
  const isOwner = user?.isSuperuser === true;

  const [mode, setMode] = useState<PurchaseMode>(initialMode);
  const [lines, setLines] = useState<CartLine[]>(() => [blankLine()]);
  const [vendorId, setVendorId] = useState(
    defaultVendorId ? String(defaultVendorId) : "",
  );
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [ownerShopId, setOwnerShopId] = useState("");
  const [notes, setNotes] = useState("");
  const [vendors, setVendors] = useState<any[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [shops, setShops] = useState<any[]>([]);
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(false);

  // Idempotency key: fresh per form open, kept while the same batch is retried.
  const clientRef = useRef<string>(newClientRef());

  const isCredit = mode === "CREDIT";
  const cashMethod = paymentMethods.find(
    (m: any) => m.name.toLowerCase() === "cash",
  );
  // Autofill the sole shop when the business has only one.
  useSingleLocationAutofill(locations, ownerShopId, setOwnerShopId);

  // Pickers load for an open form; the body mounts per open, so a closed form
  // fetches nothing and an open one loads exactly once.
  useEffect(() => {
    if (!isOpen) return;
    // Vendors are customers — reuse the same directory the pickers use.
    api
      .get("/customers")
      .then((r) =>
        setVendors(Array.isArray(r.data) ? r.data : (r.data?.data ?? [])),
      )
      .catch(() => {});
    api
      .get("/payment-methods")
      .then((r) => {
        setPaymentMethods(r.data);
        const cash = (r.data as any[]).find(
          (m: any) => m.name.toLowerCase() === "cash",
        );
        // Cash is the default + initially selected payment method.
        setPaymentMethodId((prev) => prev || (cash ? String(cash.id) : ""));
      })
      .catch(() => {});
    if (isOwner) {
      api
        .get("/locations")
        .then((r) => {
          setLocations(r.data);
          setShops(r.data.filter((l: any) => l.type === "SHOP"));
        })
        .catch(() => {});
    }
  }, [isOpen, isOwner]);

  /** What one line costs as typed, and what it is expected to earn on resale. */
  const lineCost = (line: CartLine) =>
    (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
  const lineMargin = (line: CartLine) =>
    (Number(line.quantity) || 0) *
    ((Number(line.sellPrice) || 0) - (Number(line.unitPrice) || 0));
  /** A margin carrying its sign (+12.00 / −3.00): colour alone is never a cue. */
  const signedMargin = (value: number) =>
    `${value < 0 ? "−" : "+"}${fmtCurrency(Math.abs(value))}`;

  // Both settlements resell what they buy, so both sides are totalled on every
  // keystroke — the shopkeeper sees the expected profit before submitting.
  const totals = useMemo(
    () =>
      lines.reduce(
        (acc, line) => {
          const qty = Number(line.quantity) || 0;
          acc.cost += qty * (Number(line.unitPrice) || 0);
          acc.revenue += qty * (Number(line.sellPrice) || 0);
          return acc;
        },
        { cost: 0, revenue: 0 },
      ),
    [lines],
  );

  const setLine = (index: number, patch: Partial<CartLine>) =>
    setLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    const items = lines.filter((line) => line.productName.trim());
    if (!items.length) {
      setErrorMsg(t("purchases.itemsRequired"));
      return;
    }
    if (isCredit && !vendorId) {
      setErrorMsg(t("purchases.vendorRequired"));
      return;
    }
    // Whatever settles the buy side, the batch is bought to be resold — so a
    // missing sell price is caught here, in the shopkeeper's own words.
    if (items.some((line) => !(Number(line.sellPrice) > 0))) {
      setErrorMsg(t("purchases.sellPriceRequired"));
      return;
    }

    setLoading(true);
    try {
      const res = await api.post("/purchases/bulk", {
        paymentType: mode,
        items: items.map((line) => ({
          productName: line.productName.trim(),
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          // Sent for both settlements: the API stores the expected sell price
          // either way (it only books revenue/profit on an approved PAID flip).
          sellPrice: Number(line.sellPrice),
        })),
        vendorCustomerId: vendorId ? Number(vendorId) : undefined,
        paymentMethodId:
          !isCredit && paymentMethodId ? Number(paymentMethodId) : undefined,
        shopId: isOwner && ownerShopId ? Number(ownerShopId) : undefined,
        notes: notes || undefined,
        clientRef: clientRef.current,
      });
      const rows = Array.isArray(res.data) ? res.data : [res.data];
      toast.success(
        isCredit ? t("purchases.createdCredit") : t("purchases.createdPaid"),
      );
      onSaved?.(rows);
      onClose();
    } catch (err: any) {
      markHandled(err);
      setErrorMsg(err?.response?.data?.message ?? t("purchases.failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("purchases.newPurchase")}>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4">
        {/* Owner Shop Selector — must be first */}
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

        {/* How the buy side settles — the one choice that changes the rest of
            the form: PAID leaves the till now, CREDIT becomes a payable. It is
            asked first, because it is what the shopkeeper already decided on
            the way to the counter. */}
        {!hideModeSwitch && (
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">
              {t("purchases.modeLabel")}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(["PAID", "CREDIT"] as PurchaseMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={
                    "px-3 py-2 rounded-lg text-sm font-medium border transition " +
                    (mode === m
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-600 hover:bg-gray-50")
                  }
                >
                  {m === "PAID"
                    ? t("purchases.modePaid")
                    : t("purchases.modeCredit")}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Cart: one row per bought item; a retried batch reuses the same key. */}
        <div className="space-y-2">
          {lines.map((line, index) => (
            <div
              key={index}
              className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-end border rounded-lg p-2"
            >
              <div className="col-span-2 sm:col-span-4">
                <label className="block text-[11px] font-medium text-gray-500 mb-1">
                  {t("purchases.productName")}
                </label>
                <input
                  value={line.productName}
                  onChange={(e) =>
                    setLine(index, { productName: e.target.value })
                  }
                  placeholder={t("purchases.productNamePlaceholder")}
                  className="border p-2 rounded-lg w-full text-sm"
                  required
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-medium text-gray-500 mb-1">
                  {t("purchases.quantity")}
                </label>
                <input
                  type="number"
                  min="1"
                  value={line.quantity}
                  onChange={(e) =>
                    setLine(index, { quantity: Number(e.target.value) })
                  }
                  className="border p-2 rounded-lg w-full text-sm"
                  required
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-medium text-gray-500 mb-1">
                  {t("purchases.buyPriceBirr")}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={line.unitPrice}
                  onChange={(e) =>
                    setLine(index, { unitPrice: Number(e.target.value) })
                  }
                  className="border p-2 rounded-lg w-full text-sm"
                  required
                />
              </div>
              {/* Asked in both settlements: the batch is bought to be resold,
                  and this is what makes the line's margin visible up front. */}
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-medium text-gray-500 mb-1">
                  {t("purchases.sellPriceBirr")}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={line.sellPrice}
                  onChange={(e) =>
                    setLine(index, { sellPrice: Number(e.target.value) })
                  }
                  className="border p-2 rounded-lg w-full text-sm"
                  required
                />
              </div>
              <div className="sm:col-span-2 flex items-center justify-end gap-2">
                <div className="flex flex-col items-end leading-tight">
                  <span className="text-xs text-gray-500 whitespace-nowrap">
                    {fmtCurrency(lineCost(line))}
                  </span>
                  {/* Live margin for this line, recomputed on every keystroke. */}
                  <span
                    className={
                      "text-[11px] font-semibold whitespace-nowrap " +
                      (lineMargin(line) >= 0 ? "text-green-700" : "text-red-600")
                    }
                  >
                    {signedMargin(lineMargin(line))}
                  </span>
                </div>
                {lines.length > 1 && (
                  <button
                    type="button"
                    title={t("purchases.removeItem")}
                    aria-label={t("purchases.removeItem")}
                    onClick={() =>
                      setLines((prev) => prev.filter((_, i) => i !== index))
                    }
                    className="text-red-500 hover:text-red-700 text-sm px-1"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setLines((prev) => [...prev, blankLine()])}
            className="text-sm text-blue-600 hover:underline"
          >
            {t("purchases.addItem")}
          </button>
        </div>

        {/* Who the goods came from — asked for both settlements. A paid batch is
            not a payable, but the vendor is still worth recording (it is what
            the payables ledger, the filter and the detail view key off), so the
            field is offered always and only *required* when money is still owed. */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-gray-600">
              {isCredit
                ? t("purchases.vendor")
                : t("purchases.vendorOptional")}
            </label>
            <button
              type="button"
              onClick={() => setShowVendorModal(true)}
              className="text-xs text-blue-600 hover:underline"
            >
              {t("purchases.newVendor")}
            </button>
          </div>
          <SearchableSelect
            options={vendors.map((v: any) => ({
              value: String(v.id),
              label: v.phone ? `${v.name} — ${v.phone}` : v.name,
              searchText: `${v.name ?? ""} ${v.phone ?? ""}`,
            }))}
            value={vendorId}
            onChange={setVendorId}
            placeholder={t("purchases.selectVendor")}
            required={isCredit}
          />
          {!isCredit && (
            <p className="text-[11px] text-gray-500 mt-1">
              {t("purchases.vendorPaidHint")}
            </p>
          )}
        </div>
        {/* What the batch costs and what it is expected to earn on resale — the
            same three numbers for both settlements, live on every keystroke. */}
        <div className="bg-gray-50 border rounded-lg p-3 grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-[11px] text-gray-500">
              {t("purchases.totalCost")}
            </div>
            <div className="text-sm font-bold text-gray-800">
              {fmtCurrency(totals.cost)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-gray-500">
              {t("purchases.revenue")}
            </div>
            <div className="text-sm font-bold text-gray-800">
              {fmtCurrency(totals.revenue)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-gray-500">
              {t("purchases.profit")}
            </div>
            <div
              className={
                "text-sm font-bold " +
                (totals.revenue - totals.cost >= 0
                  ? "text-green-700"
                  : "text-red-700")
              }
            >
              {fmtCurrency(totals.revenue - totals.cost)}
            </div>
          </div>
        </div>

        {/* Only a paid batch leaves the till now, so only it needs a method. */}
        {!isCredit && (
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("purchases.paymentMethod")}
            </label>
            <select
              value={paymentMethodId}
              onChange={(e) => setPaymentMethodId(e.target.value)}
              className="border p-2 rounded-lg w-full text-sm"
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
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-500 mb-1">
            {t("purchases.notesOptional")}
          </label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="border p-2 rounded-lg w-full text-sm"
          />
        </div>

        {errorMsg && (
          <p className="text-red-500 text-sm bg-red-50 p-2 rounded-lg">
            {errorMsg}
          </p>
        )}

        <div className="flex gap-2 mt-2">
          <button
            type="submit"
            disabled={loading}
            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <Loading size="sm" />
                {t("purchases.saving")}
              </span>
            ) : (
              t("common.submit")
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-300"
          >
            {t("common.cancel")}
          </button>
        </div>
      </form>

      {/* A brand-new vendor is just a new customer — one form, reused. */}
      <Modal
        isOpen={showVendorModal}
        onClose={() => setShowVendorModal(false)}
        title={t("purchases.newVendorTitle")}
      >
        <CustomerForm
          onCancel={() => setShowVendorModal(false)}
          onCreated={(v: any) => {
            setVendors((prev) => [v, ...prev]);
            setVendorId(String(v.id));
            setShowVendorModal(false);
          }}
        />
      </Modal>
    </Modal>
  );
}


