"use client";
import CreditSaleForm from "@/app/components/CreditSaleForm";
import Modal from "@/app/components/Modal";
import Loading from "@/app/components/Loading";
import RowActionsMenu from "@/app/components/RowActionsMenu";
import { useToast } from "@/app/components/ToastProvider";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useAuth } from "@/context/AuthContext";
import api, { markHandled } from "@/lib/api";
import { fmtCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/datetime";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatBusinessNumber } from "@/lib/bizNumber";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export default function CustomerDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const isOwner = user?.isSuperuser === true;
  const [customer, setCustomer] = useState<any>(null);
  const [locations, setLocations] = useState<any[]>([]);
  const [shopFilter, setShopFilter] = useState(
    isOwner ? "" : String(user?.locationId || ""),
  );
  const [productSearch, setProductSearch] = useState("");
  const [tab, setTab] = useState<"sales" | "payments">("sales");
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
          i.product?.baseName?.toLowerCase().includes(term),
      );
    });
  }, [customer, productSearch]);

  const groupedSales = useMemo(() => {
    // Normalize to a local calendar-day key (YYYY-MM-DD) so every credit sale
    // made on the same date shares one group header, regardless of browser
    // locale or time formatting.
    const dayKey = (cs: any) => {
      const d = new Date(cs.sale?.saleDate ?? cs.createdAt);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };

    const groups: Record<string, any[]> = {};
    [...filteredSales]
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .forEach((cs) => {
        const key = dayKey(cs);
        if (!groups[key]) groups[key] = [];
        groups[key].push(cs);
      });

    // Newest date first
    const result: {
      key: string;
      date: string;
      sales: any[];
      dayTotal: number;
      accumulated: number;
    }[] = [];
    let running = 0;
    Object.entries(groups)
      .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
      .forEach(([key, sales]) => {
        const dayTotal = sales.reduce((s, cs) => s + cs.totalAmount, 0);
        running += dayTotal;
        const formatted = formatDate(`${key}T00:00:00`);
        result.push({
          key,
          date: formatted,
          sales,
          dayTotal,
          accumulated: running,
        });
      });
    return result;
  }, [filteredSales]);

  // Credit sales that still have an outstanding balance and can be linked to a
  // payment (must have a real Sale behind them, not just a legacy record).
  const payableSales = (customer?.creditSales || []).filter(
    (cs: any) => cs.sale?.id && (cs.sale.remainingAmount ?? 0) > 0,
  );

  if (!customer) return <Loading className="py-24" />;

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
        <div className="flex gap-2">
          <button
            onClick={() => setShowSaleModal(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 whitespace-nowrap"
          >
            + {t("credits.sale")}
          </button>
          <button
            onClick={() => setShowPayModal(true)}
            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 whitespace-nowrap"
          >
            {t("credits.recordPayment")}
          </button>
        </div>
      </div>

      {/* Inline Payment Form */}

      <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-6">
        {[
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
          },
        ].map((k) => (
          <div
            key={k.label}
            className="bg-white rounded-xl shadow-sm border p-3 sm:p-4 text-center"
          >
            <p className="text-[10px] sm:text-xs font-semibold text-gray-400 uppercase tracking-wider">
              {k.label}
            </p>
            <p className={"text-sm sm:text-lg font-bold mt-1 " + k.color}>
              {k.value}
            </p>
          </div>
        ))}
      </div>

      <div className="flex gap-0.5 sm:gap-1 mb-4 border-b overflow-x-auto pb-px">
        {["sales", "payments"].map((tb) => (
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
            {tb === "sales" ? t("credits.creditSales") : t("credits.paymentHistory")}
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
          <input
            placeholder={t("restock.searchProduct")}
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            className="border p-2 rounded-lg flex-1 text-sm"
          />
        )}
      </div>

      {tab === "sales" && (
        <div className="space-y-4">
          {groupedSales.map(({ date, sales, dayTotal, accumulated }) => (
            <div
              key={date}
              className="bg-white rounded-xl shadow-sm border overflow-hidden"
            >
              <div className="px-3 sm:px-4 py-2.5 bg-gray-50 border-b text-xs sm:text-sm font-semibold text-gray-700 flex justify-between">
                <span>
                  {sales.length === 1
                    ? t("credits.salesGroupHeader", { date, count: sales.length })
                    : t("credits.salesGroupHeaderPlural", { date, count: sales.length })}{" "}
                  · {fmtCurrency(dayTotal)}
                </span>
                <span className="text-gray-500 font-normal">
                  {t("credits.accLabel")} {fmtCurrency(accumulated)}
                </span>
              </div>
              {sales.map((cs: any) => (
                <div
                  key={cs.id}
                  className="border-b last:border-b-0"
                  title={cs.publicId ?? undefined}
                >
                  <div className="px-3 sm:px-4 py-1.5 text-[10px] sm:text-xs text-gray-400 bg-gray-50/50 flex justify-between items-center">
                    <span>
                      {formatBusinessNumber("CR", cs.number) && (
                        <span className="font-medium text-gray-500 mr-1">
                          {formatBusinessNumber("CR", cs.number)} ·
                        </span>
                      )}
                      {cs.shop?.name || t("status.shop")} · {cs.items.length}{" "}
                      {cs.items.length > 1 ? t("credits.items") : t("credits.item")} ·{" "}
                      {t("credits.remaining")}: {fmtCurrency(cs.sale?.remainingAmount ?? cs.totalAmount)}
                    </span>
                    <RowActionsMenu
                      items={[
                        {
                          label: t("common.delete"),
                          color: "text-red-500",
                          onClick: () => handleDeleteSale(cs.id),
                        },
                      ]}
                    />
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs sm:text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="p-2 sm:p-3 font-medium text-gray-500">
                            {t("common.product")}
                          </th>
                          <th className="p-2 sm:p-3 text-center w-16 font-medium text-gray-500">
                            {t("common.qty")}
                          </th>
                          <th className="p-2 sm:p-3 text-right w-24 font-medium text-gray-500">
                            {t("common.price")}
                          </th>
                          <th className="p-2 sm:p-3 text-right w-24 font-medium text-gray-500">
                            {t("credits.subtotal")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {cs.items.map((item: any, i: number) => (
                          <tr
                            key={`${cs.id}-${i}`}
                            className="border-b last:border-b-0"
                          >
                            <td className="p-2 sm:p-3">
                              {item.product?.brand} {item.product?.baseName}
                            </td>
                            <td className="p-2 sm:p-3 text-center">
                              {item.quantity}
                            </td>
                            <td className="p-2 sm:p-3 text-right">
                              {fmtCurrency(item.unitPrice)}
                            </td>
                            <td className="p-2 sm:p-3 text-right font-medium">
                              {fmtCurrency(item.quantity * item.unitPrice)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          ))}
          {groupedSales.length === 0 && (
            <p className="text-center text-gray-400 py-8 text-sm">
              {t("credits.noCreditSales")}
            </p>
          )}
        </div>
      )}

      {tab === "payments" && (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="p-2 sm:p-3 md:p-4">{t("common.date")}</th>
                  <th className="p-2 sm:p-3 md:p-4 text-right">{t("credits.amount")}</th>
                  <th className="p-2 sm:p-3 md:p-4">{t("common.notes")}</th>
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
                onClick={async () => {
                  if (!newMethodName.trim()) return;
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
              value={payNotes}
              onChange={(e) => setPayNotes(e.target.value)}
              placeholder="e.g. Paid via CBE"
              className="border p-2 rounded-lg w-full text-sm"
            />
          </div>
          <button
            type="submit"
            className="bg-green-600 text-white p-2 rounded-lg text-sm font-medium mt-2 hover:bg-green-700"
          >
            {t("credits.recordPayment")}
          </button>
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
              placeholder="e.g. Paid via CBE"
              className="border p-2 rounded-lg w-full text-sm"
            />
          </div>
          <button
            type="submit"
            className="bg-green-600 text-white p-2 rounded-lg text-sm font-medium mt-2 hover:bg-green-700"
          >
            {t("credits.updatePayment")}
          </button>
        </form>
      </Modal>

      <Modal
        isOpen={showSaleModal}
        onClose={() => setShowSaleModal(false)}
        title={t("credits.addCreditSale")}
      >
        <CreditSaleForm
          customerId={Number(id)}
          customerName={customer?.name || ""}
          onCreated={() => { setShowSaleModal(false); fetchCustomer(); }}
          onCancel={() => setShowSaleModal(false)}
        />
      </Modal>
    </div>
  );
}
