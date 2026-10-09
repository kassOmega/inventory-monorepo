"use client";
import PurchaseForm from "@/app/components/PurchaseForm";
import SaleForm from "@/app/components/SaleForm";
import Modal from "@/app/components/Modal";
import Button from "@/app/components/Button";
import ClearableInput from "@/app/components/ClearableInput";
import Loading from "@/app/components/Loading";
import RowActionsMenu from "@/app/components/RowActionsMenu";
import CreditLedgerList, {
  CreditLedgerEntry,
} from "@/app/components/CreditLedgerList";
import VendorPaymentModal from "@/app/components/VendorPaymentModal";
import { recordedMargin } from "@/app/components/PurchasesTable";
import PurchaseDetailModal from "@/app/components/PurchaseDetailModal";
import { useToast } from "@/app/components/ToastProvider";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useAuth } from "@/context/AuthContext";
import api, { markHandled } from "@/lib/api";
import { fmtCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/datetime";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatBusinessNumber } from "@/lib/bizNumber";
import { variantLabel } from "@/lib/variantLabel";
import { attachSaleVariants, groupSaleItemsByProduct } from "@/lib/saleItems";
import type { LedgerLine } from "@/lib/saleItems";
import {
  groupPurchasesByDayAndShop,
  purchaseLineGroup,
} from "@/lib/purchaseLedger";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export default function CustomerDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { user, hasPermission } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const isOwner = user?.isSuperuser === true;
  // Vendor paybacks are recorded with the same permission that records a
  // purchase, exactly as the purchases page does it.
  const canCreate = hasPermission("purchases.create");
  const [customer, setCustomer] = useState<any>(null);
  const [payTarget, setPayTarget] = useState<any>(null);
  // The payable whose detail modal is open — the vendor side reads its rows the
  // same way the purchases list does.
  const [viewTarget, setViewTarget] = useState<any>(null);
  const [locations, setLocations] = useState<any[]>([]);
  const [shopFilter, setShopFilter] = useState(
    isOwner ? "" : String(user?.locationId || ""),
  );
  const [productSearch, setProductSearch] = useState("");
  const [tab, setTab] = useState<"sales" | "payments" | "payables">("sales");
  // Mirror of the credit-sale modal: stock taken *from* this person, booked
  // straight from their ledger with the vendor already chosen.
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [showPayModal, setShowPayModal] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payNotes, setPayNotes] = useState("");
  const [payMethodId, setPayMethodId] = useState("");
  const [paySaleId, setPaySaleId] = useState("");
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  // The org's "Cash" method (case-insensitive) — the default payment method.
  const cashMethod = paymentMethods.find(
    (m: any) => m.name.toLowerCase() === "cash",
  );

  const [newMethodName, setNewMethodName] = useState("");
  const [editingPayment, setEditingPayment] = useState<any>(null);
  const [showEditPayModal, setShowEditPayModal] = useState(false);
  const [editPayAmount, setEditPayAmount] = useState("");
  const [editPayNotes, setEditPayNotes] = useState("");
  const [editPayMethodId, setEditPayMethodId] = useState("");
  const [editPaySaleId, setEditPaySaleId] = useState("");
  const [editNewMethodName, setEditNewMethodName] = useState("");
  const [showSaleModal, setShowSaleModal] = useState(false);
  const [recordingPayment, setRecordingPayment] = useState(false);
  const [updatingPayment, setUpdatingPayment] = useState(false);
  const [creatingMethod, setCreatingMethod] = useState(false);

  const fetchCustomer = async () => {
    const params = new URLSearchParams();
    if (shopFilter) params.set("shopId", shopFilter);
    const res = await api.get(`/customers/${id}?${params}`);
    setCustomer(res.data);
  };

  useEffect(() => {
    if (isOwner)
      api
        .get("/locations")
        .then((r) =>
          setLocations(r.data.filter((l: any) => l.type === "SHOP")),
        );
    fetchCustomer();
    api.get("/payment-methods").then((r) => {
      setPaymentMethods(r.data);
      const cash = (r.data as any[]).find(
        (m: any) => m.name.toLowerCase() === "cash",
      );
      const cashId = cash ? String(cash.id) : "";
      // Cash is the default + initially selected payment method.
      setPayMethodId((prev) => prev || cashId);
      setEditPayMethodId((prev) => prev || cashId);
    });
  }, [id, shopFilter]);

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecordingPayment(true);
    try {
      await api.post("/credit-payments", {
        customerId: customer?.id ?? Number(id),
        amount: Number(payAmount),
        notes: payNotes || undefined,
        paymentMethodId: payMethodId ? Number(payMethodId) : undefined,
        saleId: paySaleId ? Number(paySaleId) : undefined,
      });
      setShowPayModal(false);
      setPayAmount("");
      setPayNotes("");
      setPayMethodId("");
      setPaySaleId("");

      fetchCustomer();
    } catch (err: any) {
      markHandled(err);
      toast.error(t("credits.failedRecordPayment"));
    } finally {
      setRecordingPayment(false);
    }
  };

  const handleDeleteSale = async (id: number) => {
    const ok = await confirm(t("credits.deleteSaleConfirm"));
    if (!ok) return;
    try {
      await api.delete(`/credit-sales/${id}`);
      fetchCustomer();
    } catch (err: any) {
      markHandled(err);
      toast.error(t("credits.failedDeleteSale"));
    }
  };

  const handleDeletePayment = async (ref: number | string) => {
    const ok = await confirm(t("credits.deletePaymentConfirm"));
    if (!ok) return;
    try {
      await api.delete(`/credit-payments/${ref}`);
      fetchCustomer();
    } catch (err: any) {
      markHandled(err);
      toast.error(t("credits.failedDeletePayment"));
    }
  };

  const startEditPayment = (cp: any) => {
    setEditingPayment(cp);
    setEditPayAmount(String(cp.amount));
    setEditPayNotes(cp.notes || "");
    setEditPayMethodId(cp.paymentMethodId ? String(cp.paymentMethodId) : "");
    setEditPaySaleId(cp.saleId ? String(cp.saleId) : "");
    setShowEditPayModal(true);
  };

  const handleUpdatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdatingPayment(true);
    try {
      await api.put(
        `/credit-payments/${editingPayment.publicId ?? editingPayment.id}`,
        {
          amount: Number(editPayAmount),
          notes: editPayNotes || undefined,
          paymentMethodId: editPayMethodId ? Number(editPayMethodId) : undefined,
          saleId: editPaySaleId ? Number(editPaySaleId) : null,
        },
      );
      setShowEditPayModal(false);
      setEditingPayment(null);
      setEditPayAmount("");
      setEditPayNotes("");
      setEditPayMethodId("");
      setEditPaySaleId("");
      fetchCustomer();
    } catch (err: any) {
      markHandled(err);
      toast.error(t("credits.failedUpdatePayment"));
    } finally {
      setUpdatingPayment(false);
    }
  };

  // Filter credit sales by product search, then group by date
  const filteredSales = useMemo(() => {
    return (customer?.creditSales || []).filter((cs: any) => {
      if (!productSearch) return true;
      const term = productSearch.toLowerCase();
      return cs.items.some(
        (i: any) =>
          i.product?.brand?.toLowerCase().includes(term) ||
          i.product?.baseName?.toLowerCase().includes(term) ||
          (i.variant?.sku || "").toLowerCase().includes(term) ||
          variantLabel(i.variant).toLowerCase().includes(term),
      );
    });
  }, [customer, productSearch]);

  // One credit sale, as the shared ledger list reads it: the CR number, shop,
  // item count and balance in the meta strip, and the sale's own items — folds
  // and all — in the table under it. The list groups these by day and carries
  // the running total, exactly as it does for the payables tab.
  const salesEntries: CreditLedgerEntry[] = filteredSales.map((cs: any) => ({
    key: cs.id,
    title: cs.publicId ?? undefined,
    date: cs.sale?.saleDate ?? cs.createdAt,
    sortAt: cs.createdAt,
    total: cs.totalAmount,
    strip: (
      <>
        {formatBusinessNumber("CR", cs.number) && (
          <span className="font-medium text-gray-500 mr-1">
            {formatBusinessNumber("CR", cs.number)} ·
          </span>
        )}
        {cs.shop?.name || t("status.shop")} · {cs.items.length}{" "}
        {cs.items.length > 1 ? t("credits.items") : t("credits.item")} ·{" "}
        {t("credits.remaining")}:{" "}
        {fmtCurrency(cs.sale?.remainingAmount ?? cs.totalAmount)}
      </>
    ),
    actions: [
      {
        label: t("common.delete"),
        color: "text-red-500",
        onClick: () => handleDeleteSale(cs.id),
      },
    ],
    groups: groupSaleItemsByProduct<LedgerLine>(
      attachSaleVariants(cs.items, cs.sale?.items ?? []),
    ),
  }));

  // Credit sales that still have an outstanding balance and can be linked to a
  // payment (must have a real Sale behind them, not just a legacy record).
  const payableSales = (customer?.creditSales || []).filter(
    (cs: any) => cs.sale?.id && (cs.sale.remainingAmount ?? 0) > 0,
  );

  // What is still owed on one purchase row.
  const remainingOn = (p: any) =>
    Math.max(0, (p.totalCost ?? 0) - (p.amountPaid ?? 0));

  // Every payback we already made, right under the item it settled — the same
  // indented `↳` sub-rows the credit-sales tab uses for its variant lines, so
  // the balance is never a mystery.
  const paybackRows = (p: any) =>
    (p.payments ?? []).map((pay: any) => (
      <tr
        key={`pay-${pay.id}`}
        className="border-b last:border-b-0 bg-gray-50/60 text-gray-600"
      >
        <td
          className="p-2 sm:p-3 pl-8 sm:pl-10 text-[11px] sm:text-xs"
          colSpan={3}
        >
          ↳ {new Date(pay.paidAt).toLocaleDateString()}
          {pay.paymentMethod?.name ? ` · ${pay.paymentMethod.name}` : ""}
          {pay.notes ? ` · ${pay.notes}` : ""}
        </td>
        <td className="p-2 sm:p-3 text-right text-[11px] sm:text-xs font-medium text-green-600">
          {fmtCurrency(pay.amount)}
        </td>
      </tr>
    ));

  // What we took from this vendor, one entry per shop per day — the same
  // day-header + item-table shape the Credit Sales tab uses for what we sold, so
  // the two sides of the ledger read identically. An entry lists every product
  // taken from that shop that day, each payback under the row it settled.
  const payableEntries: CreditLedgerEntry[] = groupPurchasesByDayAndShop(
    customer?.vendorPurchases ?? [],
  ).map((group) => ({
    key: group.key,
    date: group.createdAt,
    total: group.totalCost,
    strip: (
      <>
        {group.shopName || t("status.shop")} · {group.lines.length}{" "}
        {group.lines.length > 1 ? t("credits.items") : t("credits.item")} ·{" "}
        {t("credits.remaining")}: {fmtCurrency(group.remaining)}
      </>
    ),
    // Read the line, then settle it: the same two moves the Credit Sales header
    // offers on the other side of the ledger. An entry can hold several
    // purchases, so each item names the product it acts on.
    actions: [
      ...group.lines.map((p: any) => ({
        label: `${t("common.view")} · ${p.productName}`,
        onClick: () => setViewTarget(p),
      })),
      ...(canCreate
        ? group.lines
            .filter((p: any) => remainingOn(p) > 0)
            .map((p: any) => ({
              label: `${t("purchases.recordPayment")} · ${p.productName}`,
              color: "text-green-600",
              onClick: () => setPayTarget(p),
            }))
        : []),
    ],
    groups: group.lines.map(purchaseLineGroup),
    subRows: (line) => paybackRows(line.items[0]),
    // Each row still names the record behind it, as the purchases list did.
    lineTitle: (_line, index) => group.lines[index]?.publicId ?? undefined,
    onLineClick: (line) => setViewTarget(line.items[0]),
  }));

  // The money side of everything taken from this vendor, summed from the very
  // rows the list groups below (so the strip and the list can never disagree)
  // plus the margin those rows recorded — the sell side of a credit purchase is
  // only booked once the goods are resold.
  const vendorLedger = useMemo(() => {
    const rows = customer?.vendorPurchases ?? [];
    const taken = rows.reduce((s: number, p: any) => s + (p.totalCost ?? 0), 0);
    const paid = rows.reduce((s: number, p: any) => s + (p.amountPaid ?? 0), 0);
    const margin = rows.reduce((s: number, p: any) => s + recordedMargin(p), 0);
    return { taken, paid, outstanding: Math.max(0, taken - paid), margin };
  }, [customer]);

  if (!customer) return <Loading className="py-24" />;

  /**
   * The four headline figures. The first two are gross — everything invoiced on
   * credit and everything collected — while the last two are the netted pair:
   * this person is also one of our vendors, so the two sides cancel and only
   * one of those two is ever non-zero.
   */
  const kpis: {
    label: string;
    value: string;
    color: string;
    hint?: string;
  }[] = [
    {
      label: t("credits.totalCredits"),
      value: fmtCurrency(customer.totalCredits),
      color: "text-gray-800",
    },
    {
      label: t("credits.totalPaid"),
      value: fmtCurrency(customer.totalPaid),
      color: "text-green-600",
    },
    {
      label: t("credits.remaining"),
      value: fmtCurrency(customer.remaining),
      color: customer.remaining > 0 ? "text-red-500" : "text-green-600",
      hint: t("credits.netHint"),
    },
    {
      label: t("credits.remainingToPay"),
      value: fmtCurrency(customer.remainingToPay ?? 0),
      color:
        (customer.remainingToPay ?? 0) > 0
          ? "text-amber-600"
          : "text-green-600",
      hint: t("credits.netHint"),
    },
  ];

  return (
    <div>
      <div className="flex justify-between items-start md:items-center mb-6 gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/credits"
            className="text-gray-400 hover:text-gray-600 text-lg"
          >
            ←
          </Link>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">
            {customer.name}
            {(customer.numberLabel ??
              formatBusinessNumber("CUST", customer.number)) && (
              <span
                className="block text-xs font-normal text-gray-400"
                title={customer.publicId ?? undefined}
              >
                {customer.numberLabel ??
                  formatBusinessNumber("CUST", customer.number)}
              </span>
            )}
          </h1>
        </div>
        {/* Three buttons wrap rather than squeeze on a phone: the ledger of a
            person who is both a customer and a vendor carries all three. */}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            onClick={() => setShowSaleModal(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 whitespace-nowrap"
          >
            + {t("credits.sale")}
          </button>
          {canCreate && (
            <button
              onClick={() => setShowPurchaseModal(true)}
              className="bg-white text-blue-700 border border-blue-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-50 whitespace-nowrap"
            >
              + {t("credits.purchase")}
            </button>
          )}
          <button
            onClick={() => setShowPayModal(true)}
            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 whitespace-nowrap"
          >
            {t("credits.recordPayment")}
          </button>
        </div>
      </div>

      {/* Gross on the left, netted on the right — see the `kpis` comment. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {kpis.map((k) => (
          <div
            key={k.label}
            title={k.hint}
            // `min-w-0` + `overflow-hidden`: a currency value too long for the
            // card breaks onto a second line instead of widening the grid (and
            // with it the whole page) on a phone.
            className="bg-white rounded-xl shadow-sm border p-3 sm:p-4 text-center min-w-0 overflow-hidden"
          >
            <p className="text-[10px] sm:text-xs font-semibold text-gray-400 uppercase tracking-wider">
              {k.label}
            </p>
            <p
              className={
                "text-xs sm:text-lg font-bold mt-1 leading-tight break-words " +
                k.color
              }
              title={k.value}
            >
              {k.value}
            </p>
          </div>
        ))}
      </div>

      <div className="flex gap-0.5 sm:gap-1 mb-4 border-b overflow-x-auto pb-px">
        {["sales", "payments", "payables"].map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb as any)}
            className={
              "px-3 sm:px-4 py-2 whitespace-nowrap text-xs sm:text-sm font-medium rounded-t-lg transition " +
              (tab === tb
                ? "bg-white text-blue-600 border border-b-white -mb-px shadow-sm"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-100")
            }
          >
            {tb === "sales"
              ? t("credits.creditSales")
              : tb === "payments"
                ? t("credits.paymentHistory")
                : t("credits.payables")}
          </button>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        {isOwner && (
          <select
            value={shopFilter}
            onChange={(e) => setShopFilter(e.target.value)}
            className="border p-2 rounded-lg bg-white text-sm"
          >
            <option value="">{t("credits.allShops")}</option>
            {locations.map((l: any) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        {tab === "sales" && (
          <ClearableInput
            placeholder={t("restock.searchProduct")}
            value={productSearch}
            onChange={setProductSearch}
            className="flex-1"
            inputClassName="border p-2 rounded-lg w-full text-sm"
          />
        )}
      </div>

      {tab === "sales" && (
        <CreditLedgerList
          entries={salesEntries}
          dayLabel={(date, count) =>
            count === 1
              ? t("credits.salesGroupHeader", { date, count })
              : t("credits.salesGroupHeaderPlural", { date, count })
          }
          emptyLabel={t("credits.noCreditSales")}
        />
      )}

      {tab === "payments" && (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm min-w-[640px]">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="p-2 sm:p-3 md:p-4 whitespace-nowrap">{t("common.date")}</th>
                  <th className="p-2 sm:p-3 md:p-4 text-right whitespace-nowrap">{t("credits.amount")}</th>
                  <th className="p-2 sm:p-3 md:p-4 whitespace-nowrap">{t("common.notes")}</th>
                  <th className="p-2 sm:p-3 md:p-4">{t("credits.method")}</th>
                  <th className="p-2 sm:p-3 md:p-4 text-right">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {customer.creditPayments?.map((cp: any) => (
                  <tr key={cp.id} className="border-b hover:bg-gray-50">
                    <td className="p-2 sm:p-3 md:p-4 text-gray-600">
                      {formatDate(cp.paidAt)}
                    </td>
                    <td className="p-2 sm:p-3 md:p-4 text-right text-green-600 font-semibold">
                      {fmtCurrency(cp.amount)}
                    </td>
                    <td className="p-2 sm:p-3 md:p-4 text-gray-500">
                      {cp.notes || "\u2014"}
                    </td>
                    <td className="p-2 sm:p-3 md:p-4 text-gray-600">
                      {cp.paymentMethod?.name || t("sales.cash")}
                    </td>
                    <td className="p-2 sm:p-3 md:p-4">
                      <RowActionsMenu
                        items={[
                          { label: t("common.edit"), onClick: () => startEditPayment(cp) },
                          {
                            label: t("common.delete"),
                            color: "text-red-500",
                            onClick: () => handleDeletePayment(cp.publicId ?? cp.id),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
                {(!customer.creditPayments ||
                  customer.creditPayments.length === 0) && (
                  <tr>
                    <td
                      colSpan={5}
                      className="p-6 text-center text-gray-400 text-sm"
                    >
                      {t("credits.noPayments")}
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-semibold border-t">
                  <td className="p-2 sm:p-3 md:p-4 text-right text-xs sm:text-sm" colSpan={2}>
                    {t("credits.totalPaid")}
                  </td>
                  <td className="p-2 sm:p-3 md:p-4 text-right text-green-600" colSpan={3}>
                    {fmtCurrency(customer.totalPaid)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
      {tab === "payables" && (
        <div className="space-y-4">
          {/* One line, not a card wall: the same payables the groups below list,
              read at a glance. The page's own cards cover the customer side. */}
          <div className="bg-white rounded-xl shadow-sm border px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm overflow-hidden">
            <span className="min-w-0">
              <span className="text-gray-400">{t("credits.takenOnCredit")}</span>{" "}
              <strong className="text-gray-800">
                {fmtCurrency(vendorLedger.taken)}
              </strong>
            </span>
            <span className="min-w-0">
              <span className="text-gray-400">{t("credits.paidToVendor")}</span>{" "}
              <strong className="text-green-600">
                {fmtCurrency(vendorLedger.paid)}
              </strong>
            </span>
            <span className="min-w-0">
              <span className="text-gray-400">{t("credits.remainingToPay")}</span>{" "}
              <strong className="text-red-600">
                {fmtCurrency(vendorLedger.outstanding)}
              </strong>
            </span>
            <span
              className="min-w-0"
              title={t("purchases.recordedMarginHint")}
            >
              <span className="text-gray-400">
                {t("purchases.recordedMargin")}
              </span>{" "}
              <strong
                className={
                  vendorLedger.margin >= 0 ? "text-green-700" : "text-red-700"
                }
              >
                ~{fmtCurrency(vendorLedger.margin)}
              </strong>
            </span>
          </div>

          {/* The same list the Credit Sales tab draws, fed the shop-days of what
              we took: a header per day, then one entry per shop per day with its
              products in the item table and each payback under its own row. */}
          <CreditLedgerList
            entries={payableEntries}
            dayLabel={(date, count) =>
              count === 1
                ? t("credits.payablesGroupHeader", { date, count })
                : t("credits.payablesGroupHeaderPlural", { date, count })
            }
            emptyLabel={t("credits.noPayables")}
          />
        </div>
      )}



      <Modal
        isOpen={showPayModal}
        onClose={() => setShowPayModal(false)}
        title={t("credits.recordPayment")}
      >
        <form onSubmit={handleRecordPayment} className="grid grid-cols-1 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("credits.amount")}
            </label>
            <input
              type="number"
              step="0.01"
              min="1"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              className="border p-2 rounded-lg w-full text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("credits.saleOptional")}
            </label>
            <select
              value={paySaleId}
              onChange={(e) => setPaySaleId(e.target.value)}
              className="border p-2 rounded-lg w-full bg-white text-sm"
            >
              <option value="">{t("credits.notLinked")}</option>
              {payableSales.map((cs: any) => (
                <option key={cs.id} value={cs.sale.id}>
                  {t("credits.creditOption", {
                    id: cs.id,
                    amount: fmtCurrency(cs.sale.remainingAmount || 0),
                  })}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("credits.method")}
            </label>
            <div className="flex gap-2">
              <select
                value={payMethodId}
                onChange={(e) => setPayMethodId(e.target.value)}
                className="border p-2 rounded-lg flex-1 bg-white text-sm"
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
              <input
                placeholder={t("credits.methodPlaceholder")}
                value={newMethodName}
                onChange={(e) => setNewMethodName(e.target.value)}
                className="border p-2 rounded-lg w-24 text-sm"
              />
              <button
                type="button"
                disabled={creatingMethod}
                onClick={async () => {
                  if (!newMethodName.trim()) return;
                  setCreatingMethod(true);
                  try {
                    const r = await api.post("/payment-methods", {
                      name: newMethodName.trim(),
                    });
                    setPaymentMethods([...paymentMethods, r.data]);
                    setPayMethodId(String(r.data.id));
                    setNewMethodName("");
                  } catch (err: any) {
                    markHandled(err);
                    toast.error(
                      err?.response?.data?.message ??
                        t("credits.failedAddMethod"),
                    );
                  } finally {
                    setCreatingMethod(false);
                  }
                }}
                className="bg-gray-200 px-2 rounded-lg text-xs inline-flex items-center justify-center disabled:opacity-60"
              >
                {creatingMethod ? (
                  <Loading
                    size="sm"
                    className="border-gray-400/40 border-t-gray-600"
                  />
                ) : (
                  "+"
                )}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("common.notes")}
            </label>
            <input
              value={payNotes}
              onChange={(e) => setPayNotes(e.target.value)}
              placeholder={t("common.notesPh")}
              className="border p-2 rounded-lg w-full text-sm"
            />
          </div>
          <Button
            type="submit"
            loading={recordingPayment}
            variant="emerald"
            shape="rounded-lg"
            className="mt-2 !p-2 !text-sm font-medium"
          >
            {t("credits.recordPayment")}
          </Button>
        </form>
      </Modal>

      <Modal
        isOpen={showEditPayModal}
        onClose={() => { setShowEditPayModal(false); setEditingPayment(null); }}
        title={t("credits.editPayment")}
      >
        <form onSubmit={handleUpdatePayment} className="grid grid-cols-1 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("credits.amount")}
            </label>
            <input
              type="number"
              step="0.01"
              min="1"
              value={editPayAmount}
              onChange={(e) => setEditPayAmount(e.target.value)}
              className="border p-2 rounded-lg w-full text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("credits.saleOptional")}
            </label>
            <select
              value={editPaySaleId}
              onChange={(e) => setEditPaySaleId(e.target.value)}
              className="border p-2 rounded-lg w-full bg-white text-sm"
            >
              <option value="">{t("credits.notLinked")}</option>
              {payableSales.map((cs: any) => (
                <option key={cs.id} value={cs.sale.id}>
                  {t("credits.creditOption", {
                    id: cs.id,
                    amount: fmtCurrency(cs.sale.remainingAmount || 0),
                  })}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("credits.method")}
            </label>
            <div className="flex gap-2">
              <select
                value={editPayMethodId}
                onChange={(e) => setEditPayMethodId(e.target.value)}
                className="border p-2 rounded-lg flex-1 bg-white text-sm"
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
              <input
                placeholder={t("credits.methodPlaceholder")}
                value={editNewMethodName}
                onChange={(e) => setEditNewMethodName(e.target.value)}
                className="border p-2 rounded-lg w-24 text-sm"
              />
              <button
                type="button"
                onClick={async () => {
                  if (!editNewMethodName.trim()) return;
                  try {
                    const r = await api.post("/payment-methods", {
                      name: editNewMethodName.trim(),
                    });
                    setPaymentMethods([...paymentMethods, r.data]);
                    setEditPayMethodId(String(r.data.id));
                    setEditNewMethodName("");
                  } catch (err: any) {
                    markHandled(err);
                    toast.error(
                      err?.response?.data?.message ??
                        t("credits.failedAddMethod"),
                    );
                  }
                }}
                className="bg-gray-200 px-2 rounded-lg text-xs"
              >
                +
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("common.notes")}
            </label>
            <input
              value={editPayNotes}
              onChange={(e) => setEditPayNotes(e.target.value)}
              placeholder={t("common.notesPh")}
              className="border p-2 rounded-lg w-full text-sm"
            />
          </div>
          <Button
            type="submit"
            loading={updatingPayment}
            variant="emerald"
            shape="rounded-lg"
            className="mt-2 !p-2 !text-sm font-medium"
          >
            {t("credits.updatePayment")}
          </Button>
        </form>
      </Modal>

      <SaleForm
        isOpen={showSaleModal}
        onClose={() => setShowSaleModal(false)}
        title={t("credits.addCreditSale")}
        defaultSaleType="CREDITED"
        defaultCustomerId={Number(id)}
        defaultCustomerName={customer?.name ?? ""}
        creditCustomersOnly
        onSaved={() => {
          setShowSaleModal(false);
          fetchCustomer();
        }}
      />

      {/* The other direction on the same ledger: stock taken from this person as
          a vendor. CREDIT is the default (that is what a payable is) and the
          vendor is already known, but the switch stays available: a shopkeeper
          who paid this supplier from the till should not have to leave the
          customer's page to record it. */}
      <PurchaseForm
        isOpen={showPurchaseModal}
        onClose={() => setShowPurchaseModal(false)}
        mode="CREDIT"
        defaultVendorId={customer?.id ?? null}
        onSaved={() => {
          setShowPurchaseModal(false);
          fetchCustomer();
        }}
      />

      {/* Paying this vendor back is the same modal the purchases page uses. */}
      <VendorPaymentModal
        isOpen={!!payTarget}
        onClose={() => setPayTarget(null)}
        purchase={payTarget}
        onSaved={fetchCustomer}
      />

      {/* A payables row carries the same record a purchases row does, so it opens
          the same detail modal. */}
      <PurchaseDetailModal
        purchase={viewTarget}
        onClose={() => setViewTarget(null)}
      />
    </div>
  );
}
