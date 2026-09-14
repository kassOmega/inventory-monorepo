"use client";

// Single-modal front-desk checkout:
//   1. Summary — the consolidated bill (room + package lines, each with the
//                staff member who posted it) and the balance due.
//   2. Payment — split payments (method + amount + reference) with live
//                remaining / over-collection validation.
//   3. Confirm — one atomic POST that settles the stay folio + every linked
//                package folio, frees the room and produces the receipt.
// Leaving a balance is allowed only via the in-modal force confirmation.

import api from "@/lib/api";
import FolioReceipt from "@/app/components/FolioReceipt";
import Modal from "@/app/components/Modal";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const round2 = (n: number) => Math.round(n * 100) / 100;

const money = (n: number | undefined | null) =>
  n == null
    ? "0.00"
    : Number(n).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

interface PaymentRow {
  amount: string;
  paymentMethodId: string;
  transactionReference: string;
}

const emptyRow = (): PaymentRow => ({
  amount: "",
  paymentMethodId: "",
  transactionReference: "",
});

export default function CheckoutModal({
  reservationId,
  onClose,
  onDone,
  onError,
}: {
  reservationId: number;
  onClose: () => void;
  /** Called after a successful checkout so the host page can refresh. */
  onDone?: (result: any) => void;
  onError?: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [preview, setPreview] = useState<any>(null);
  const [methods, setMethods] = useState<any[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([emptyRow()]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const [force, setForce] = useState(false);
  const [receipt, setReceipt] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLocalError("");
    try {
      const [p, m] = await Promise.all([
        api.get(`/hotel/reservations/${reservationId}/checkout-preview`),
        // Front-desk staff may read the org's payment methods; a missing
        // permission must never block the checkout itself.
        api.get("/payment-methods").catch(() => ({ data: [] })),
      ]);
      setPreview(p.data);
      setMethods(Array.isArray(m.data) ? m.data : []);
    } catch (e: any) {
      setLocalError(
        e?.response?.data?.message ?? t("hotel.failedLoadCheckout"),
      );
    } finally {
      setLoading(false);
    }
  }, [reservationId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const bill = preview?.bill;
  const lines: any[] = bill?.lines ?? [];
  const reservation = preview?.reservation;
  const stayDue = Number(preview?.reservationBalanceDue ?? 0);
  const packagesDue = (preview?.packageGuests ?? []).reduce(
    (s: number, g: any) => s + Number(g.balance ?? 0),
    0,
  );
  const totalDue = round2(stayDue + packagesDue);

  const paid = useMemo(
    () => round2(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)),
    [payments],
  );
  const remaining = round2(totalDue - paid);
  const overpaid = round2(paid - totalDue) > 0.01;

  const setPayment = (index: number, patch: Partial<PaymentRow>) =>
    setPayments((rows) =>
      rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );

  const goToPayment = () => {
    setLocalError("");
    setPayments([
      { ...emptyRow(), amount: totalDue > 0 ? String(totalDue) : "" },
    ]);
    setStep(2);
  };

  const goToConfirm = () => {
    setLocalError("");
    if (overpaid) {
      setLocalError(t("hotel.checkoutOverpaid"));
      return;
    }
    if (remaining > 0.01 && !force) {
      setLocalError(
        t("hotel.checkoutBalanceRemains", { amount: money(remaining) }),
      );
      return;
    }
    setStep(3);
  };

  const submit = async () => {
    setBusy(true);
    setLocalError("");
    try {
      const r = await api.post(
        `/hotel/reservations/${reservationId}/checkout`,
        {
          payments: payments
            .filter((p) => Number(p.amount) > 0)
            .map((p) => ({
              amount: Number(p.amount),
              paymentMethodId: p.paymentMethodId
                ? Number(p.paymentMethodId)
                : undefined,
              transactionReference: p.transactionReference || undefined,
            })),
          force,
        },
      );
      setReceipt(r.data);
      onDone?.(r.data);
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? t("hotel.failedCheckOut");
      setLocalError(msg);
      onError?.(msg);
    } finally {
      setBusy(false);
    }
  };

  const steps = [
    t("hotel.checkoutStepSummary"),
    t("hotel.checkoutStepPayment"),
    t("hotel.checkoutStepConfirm"),
  ];

  return (
    <Modal isOpen onClose={onClose} title={t("hotel.checkoutTitle")}>
      {loading ? (
        <p className="text-gray-500 text-sm py-8 text-center">
          {t("hotel.checkoutLoading")}
        </p>
      ) : receipt ? (
        <div className="space-y-4">
          <div className="bg-green-50 text-green-700 rounded p-3 text-sm">
            {t("hotel.checkoutDone")}
          </div>
          <FolioReceipt
            bill={receipt.bill}
            totals={{
              charges: receipt.bill?.totals?.charges,
              payments: receipt.bill?.totals?.payments,
              outstanding: receipt.totals?.outstanding,
            }}
            settledBy={receipt.settledBy}
            forced={receipt.forced}
            onClose={onClose}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {steps.map((label, i) => (
              <div key={label} className="flex items-center gap-2">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full font-semibold ${
                    step === i + 1
                      ? "bg-blue-600 text-white"
                      : step > i + 1
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {i + 1}
                </span>
                <span
                  className={
                    step === i + 1
                      ? "text-gray-800 font-medium"
                      : "text-gray-400"
                  }
                >
                  {label}
                </span>
                {i < steps.length - 1 && (
                  <span className="text-gray-300">›</span>
                )}
              </div>
            ))}
          </div>

          {localError && (
            <div className="bg-red-50 text-red-600 p-3 rounded text-sm">
              {localError}
            </div>
          )}

          <div className="border border-gray-100 rounded p-3">
            <h3 className="font-semibold text-gray-800">
              {reservation?.guestName}
              {reservation?.roomNumber
                ? ` · ${t("hotel.roomPrefix", { number: reservation.roomNumber })}`
                : ""}
            </h3>
            <p className="text-xs text-gray-500">
              {reservation?.checkIn?.slice(0, 10)} →{" "}
              {reservation?.checkOut?.slice(0, 10)} ·{" "}
              {t("hotel.nightsCount", { count: reservation?.nights ?? 0 })}
            </p>
          </div>

          {step === 1 && (
            <div className="space-y-3">
              <div className="overflow-x-auto border border-gray-100 rounded">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-left text-xs text-gray-500">
                    <tr>
                      <th className="px-3 py-2">{t("hotel.billService")}</th>
                      <th className="px-3 py-2">{t("hotel.billItem")}</th>
                      <th className="px-3 py-2">{t("hotel.billStaff")}</th>
                      <th className="px-3 py-2 text-right">
                        {t("hotel.billAmount")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l: any) => (
                      <tr key={l.id} className="border-t">
                        <td className="px-3 py-1.5 text-gray-600">
                          {l.serviceLabel}
                        </td>
                        <td className="px-3 py-1.5 text-gray-800">
                          {l.description}
                          {l.source === "PACKAGE" && l.guestName && (
                            <span className="text-xs text-gray-400">
                              {" "}
                              · {l.guestName}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-gray-600">
                          {l.staffName ?? "—"}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          {l.type === "PAYMENT" ? "-" : ""}
                          {money(l.amount)}
                        </td>
                      </tr>
                    ))}
                    {lines.length === 0 && (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-3 py-6 text-center text-gray-400"
                        >
                          {t("hotel.billNoLines")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-gray-50 rounded p-3">
                <div>
                  <p className="text-xs text-gray-400">{t("hotel.billRoom")}</p>
                  <p className="font-semibold text-gray-800">
                    {money(bill?.totals?.roomCharges)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">
                    {t("hotel.billPackage")}
                  </p>
                  <p className="font-semibold text-gray-800">
                    {money(bill?.totals?.packageCharges)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">
                    {t("hotel.billAdvance")}
                  </p>
                  <p className="font-semibold text-gray-800">
                    {money(bill?.totals?.advanceDeposits)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">
                    {t("hotel.balanceDue")}
                  </p>
                  <p className="font-bold text-amber-600">{money(totalDue)}</p>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between bg-gray-50 rounded p-3 text-sm">
                <span className="text-gray-500">{t("hotel.balanceDue")}</span>
                <span className="font-bold text-amber-600">
                  {money(totalDue)}
                </span>
              </div>

              {payments.map((p, i) => (
                <div
                  key={i}
                  className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-start border border-gray-100 rounded p-2"
                >
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={t("orders.amount")}
                    value={p.amount}
                    onChange={(e) => setPayment(i, { amount: e.target.value })}
                    className="border border-gray-300 rounded p-2 text-sm sm:col-span-3"
                  />
                  <select
                    value={p.paymentMethodId}
                    onChange={(e) =>
                      setPayment(i, { paymentMethodId: e.target.value })
                    }
                    className="border border-gray-300 rounded p-2 text-sm sm:col-span-4 bg-white"
                  >
                    <option value="">{t("hotel.paymentMethodOptional")}</option>
                    {methods.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <input
                    placeholder={t("hotel.referenceOptional")}
                    value={p.transactionReference}
                    onChange={(e) =>
                      setPayment(i, { transactionReference: e.target.value })
                    }
                    className="border border-gray-300 rounded p-2 text-sm sm:col-span-4"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setPayments((rows) =>
                        rows.length === 1
                          ? [emptyRow()]
                          : rows.filter((_, idx) => idx !== i),
                      )
                    }
                    className="text-red-600 text-sm sm:col-span-1 py-2"
                    aria-label={t("hotel.removePayment")}
                  >
                    ×
                  </button>
                </div>
              ))}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setPayments((rows) => [...rows, emptyRow()])}
                  className="text-blue-600 text-sm hover:underline"
                >
                  + {t("hotel.splitPayment")}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setPayments((rows) => {
                      const first = rows[0] ?? emptyRow();
                      return [{ ...first, amount: String(totalDue) }];
                    })
                  }
                  className="text-gray-600 text-sm hover:underline"
                >
                  {t("hotel.payFullAmount")}
                </button>
              </div>

              <div className="grid grid-cols-3 gap-3 bg-gray-50 rounded p-3 text-sm">
                <div>
                  <p className="text-xs text-gray-400">{t("hotel.billPaid")}</p>
                  <p className="font-semibold text-gray-800">{money(paid)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">
                    {t("hotel.remaining")}
                  </p>
                  <p
                    className={`font-semibold ${
                      remaining > 0.01 ? "text-amber-600" : "text-green-600"
                    }`}
                  >
                    {money(Math.max(0, remaining))}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">
                    {t("hotel.overCollected")}
                  </p>
                  <p
                    className={`font-semibold ${
                      overpaid ? "text-red-600" : "text-gray-400"
                    }`}
                  >
                    {money(Math.max(0, round2(paid - totalDue)))}
                  </p>
                </div>
              </div>

              {remaining > 0.01 && (
                <label className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 rounded p-3">
                  <input
                    type="checkbox"
                    checked={force}
                    onChange={(e) => setForce(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>{t("hotel.forceCheckoutHint")}</span>
                </label>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <div className="bg-gray-50 rounded p-3 text-sm space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-gray-500">
                    {t("hotel.billCharges")}
                  </span>
                  <span className="font-medium">
                    {money(bill?.totals?.charges)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">
                    {t("hotel.billPaidNow")}
                  </span>
                  <span className="font-medium">{money(paid)}</span>
                </div>
                <div className="flex justify-between border-t border-gray-200 pt-1.5">
                  <span className="font-semibold">
                    {t("hotel.billOutstanding")}
                  </span>
                  <span
                    className={`font-bold ${
                      Math.max(0, remaining) > 0
                        ? "text-amber-600"
                        : "text-green-600"
                    }`}
                  >
                    {money(Math.max(0, remaining))}
                  </span>
                </div>
              </div>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• {t("hotel.checkoutWillSettle")}</li>
                {(preview?.packageGuests ?? []).length > 0 && (
                  <li>• {t("hotel.checkoutWillCheckOutGuests")}</li>
                )}
                <li>• {t("hotel.checkoutWillReleaseRoom")}</li>
              </ul>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 text-sm text-gray-600"
            >
              {t("common.cancel")}
            </button>
            {step > 1 && (
              <button
                type="button"
                onClick={() => {
                  setLocalError("");
                  setStep((s) => (s === 3 ? 2 : 1));
                }}
                className="px-3 py-2 text-sm text-gray-600 border border-gray-200 rounded"
              >
                {t("common.back")}
              </button>
            )}
            {step === 1 && (
              <button
                type="button"
                onClick={goToPayment}
                className="bg-blue-600 text-white rounded px-3 py-2 text-sm font-medium hover:bg-blue-700"
              >
                {t("hotel.continueToPayment")}
              </button>
            )}
            {step === 2 && (
              <button
                type="button"
                onClick={goToConfirm}
                className="bg-blue-600 text-white rounded px-3 py-2 text-sm font-medium hover:bg-blue-700"
              >
                {t("hotel.continueToConfirm")}
              </button>
            )}
            {step === 3 && (
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className="bg-emerald-600 text-white rounded px-3 py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-60"
              >
                {busy ? t("hotel.checkingOut") : t("hotel.confirmCheckout")}
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
