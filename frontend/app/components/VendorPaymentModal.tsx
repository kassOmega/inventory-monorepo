"use client";
// app/components/VendorPaymentModal.tsx
//
// Pay a vendor back for one credit purchase. The modal carries the whole
// settlement in one place: what was taken, what has already been handed over,
// what is still owed, the history behind those numbers — and the form that
// clears the next slice. Every payment here moves Accounts Payable down.
import api, { markHandled } from "@/lib/api";
import Loading from "./Loading";
import Modal from "./Modal";
import RowActionsMenu from "./RowActionsMenu";
import { useConfirm } from "./ConfirmProvider";
import { useToast } from "./ToastProvider";
import { fmtCurrency } from "@/lib/currency";
import { statusLabel } from "@/lib/statusLabel";
import { newClientRef } from "@/lib/clientRef";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** The credit purchase being settled (null while closed). */
  purchase: any | null;
  /** Called after a successful payment or correction, so the list refreshes. */
  onSaved?: () => void;
}

export default function VendorPaymentModal({
  isOpen,
  onClose,
  purchase,
  onSaved,
}: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [methodId, setMethodId] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  // Idempotency key: one per modal open, reused while the same payment retries.
  const clientRef = useRef<string>(newClientRef());

  const payments = useMemo(
    () => (purchase?.payments ?? []).slice(),
    [purchase],
  );
  const paidBack = payments.reduce(
    (s: number, p: any) => s + (p.amount ?? 0),
    0,
  );
  const remaining = Math.max(0, (purchase?.totalCost ?? 0) - paidBack);

  useEffect(() => {
    if (!isOpen) return;
    api
      .get("/payment-methods")
      .then((r) => {
        const rows = Array.isArray(r.data) ? r.data : (r.data?.data ?? []);
        setPaymentMethods(rows);
        const cash = rows.find((m: any) => m.name.toLowerCase() === "cash");
        setMethodId(cash ? String(cash.id) : "");
      })
      .catch(() => {});
  }, [isOpen]);

  // The amount that would settle the item, offered by default.
  useEffect(() => {
    if (!isOpen || !purchase) return;
    setAmount(remaining > 0 ? remaining.toFixed(2) : "");
    setNotes("");
    clientRef.current = newClientRef();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, purchase?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!purchase) return;
    setSaving(true);
    try {
      await api.post(
        `/purchases/${purchase.publicId ?? purchase.id}/payments`,
        {
          amount: Number(amount),
          paymentMethodId: methodId ? Number(methodId) : undefined,
          notes: notes || undefined,
          clientRef: clientRef.current,
        },
      );
      toast.success(t("purchases.paymentRecorded"));
      clientRef.current = newClientRef();
      onSaved?.();
      onClose();
    } catch (err: any) {
      markHandled(err);
      toast.error(err?.response?.data?.message ?? t("purchases.failedPayment"));
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePayment = async (payment: any) => {
    const ok = await confirm(t("purchases.deletePaymentConfirm"));
    if (!ok) return;
    try {
      await api.delete(`/purchases/payments/${payment.publicId ?? payment.id}`);
      toast.success(t("purchases.paymentDeleted"));
      onSaved?.();
      onClose();
    } catch (err: any) {
      markHandled(err);
      toast.error(
        err?.response?.data?.message ?? t("purchases.failedDeletePayment"),
      );
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("purchases.recordPayment")}
    >
      {purchase && (
        <div className="grid grid-cols-1 gap-4">
          <div className="bg-gray-50 border rounded-lg p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <div>
              <div className="text-[11px] text-gray-500">
                {t("purchases.vendor")}
              </div>
              <div className="text-sm font-semibold text-gray-800 truncate">
                {purchase.vendorCustomer?.name ?? "—"}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-gray-500">
                {t("purchases.totalCost")}
              </div>
              <div className="text-sm font-semibold text-gray-800">
                {fmtCurrency(purchase.totalCost)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-gray-500">
                {t("purchases.paidAmount")}
              </div>
              <div className="text-sm font-semibold text-green-600">
                {fmtCurrency(paidBack)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-gray-500">
                {t("purchases.remaining")}
              </div>
              <div className="text-sm font-bold text-red-500">
                {fmtCurrency(remaining)}
              </div>
            </div>
          </div>

          {/* Everything paid so far, so a correction is one tap away. */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-gray-600">
                {t("purchases.paymentHistory")}
              </span>
              <span className="text-xs text-gray-400">
                {statusLabel(purchase.paymentStatus)}
              </span>
            </div>
            <div className="border rounded-lg divide-y">
              {payments.map((p: any) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between px-3 py-2 text-xs sm:text-sm gap-2"
                >
                  <span className="text-gray-500">
                    {new Date(p.paidAt).toLocaleDateString()}
                    {p.paymentMethod?.name ? ` · ${p.paymentMethod.name}` : ""}
                    {p.notes ? ` · ${p.notes}` : ""}
                  </span>
                  <span className="flex items-center gap-2">
                    <strong className="text-green-600">
                      {fmtCurrency(p.amount)}
                    </strong>
                    <RowActionsMenu
                      items={[
                        {
                          label: t("common.delete"),
                          color: "text-red-500",
                          onClick: () => handleDeletePayment(p),
                        },
                      ]}
                    />
                  </span>
                </div>
              ))}
              {payments.length === 0 && (
                <div className="px-3 py-4 text-center text-gray-400 text-xs">
                  {t("purchases.noPayments")}
                </div>
              )}
            </div>
          </div>

          {remaining > 0 && (
            <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">
                  {t("purchases.paymentAmount")}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={remaining}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="border p-2 rounded-lg w-full text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">
                  {t("purchases.paymentMethod")}
                </label>
                <select
                  value={methodId}
                  onChange={(e) => setMethodId(e.target.value)}
                  className="border p-2 rounded-lg w-full text-sm"
                >
                  {paymentMethods.map((m: any) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
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
              <div className="flex gap-2 mt-1">
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                >
                  {saving ? (
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
          )}
        </div>
      )}
    </Modal>
  );
}
