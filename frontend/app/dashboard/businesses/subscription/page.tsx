"use client";

// Client subscription page: shows the current state, the price for each term,
// the admin's bank accounts to pay into, and a receipt upload that the AI
// reviews (auto-extending the subscription or flagging it for an admin).
import api from "@/lib/api";
import Button from "@/app/components/Button";
import Loading from "@/app/components/Loading";
import SubscriptionCard, { type SubscriptionView } from "@/app/components/SubscriptionCard";
import { useToast } from "@/app/components/ToastProvider";
import { useAuth } from "@/context/AuthContext";
import { fmtCurrency } from "@/lib/currency";
import { formatDateTime } from "@/lib/datetime";
import {
  SUBSCRIPTION_TERMS,
  paymentStatusClass,
  termLabel,
} from "@/lib/subscriptions";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface Price {
  term: string;
  amount: number;
  currency: string;
}
interface Bank {
  id: number;
  bankName: string;
  accountName: string;
  accountNumber: string;
  branch: string | null;
}
interface Payment {
  id: number;
  term: string;
  amount: number;
  status: string;
  aiDecision: string | null;
  createdAt: string;
}

export default function SubscriptionPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { activeOrganizationId } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [me, setMe] = useState<SubscriptionView | null>(null);
  const [prices, setPrices] = useState<Price[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  const [term, setTerm] = useState<string>("MONTHLY");
  const [bankId, setBankId] = useState<string>("");
  const [payerName, setPayerName] = useState("");
  const [transactionRef, setTransactionRef] = useState("");
  const [amount, setAmount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [meRes, priceRes, bankRes, payRes] = await Promise.all([
        api.get("/subscriptions/me"),
        api.get("/subscriptions/pricing"),
        api.get("/subscriptions/bank-accounts"),
        api.get("/subscriptions/payments"),
      ]);
      setMe(meRes.data);
      setPrices(priceRes.data);
      setBanks(bankRes.data);
      setPayments(payRes.data);
      // Default the payer to the business owner's name (anyone may pay for the
      // business, but this is the common case and what the AI expects).
      setPayerName((prev) => prev || meRes.data?.ownerName || "");
      if (bankRes.data.length > 0) setBankId(String(bankRes.data[0].id));
      const price = priceRes.data.find((p: Price) => p.term === "MONTHLY");
      if (price) setAmount(String(price.amount));
      setError("");
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("adm.sub.loadFail"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
    // activeOrganizationId drives the tenant-scoped calls; refetch on switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrganizationId]);

  // Keep the amount in sync with the chosen term's price (until the user edits).
  useEffect(() => {
    const p = prices.find((x) => x.term === term);
    if (p) setAmount(String(p.amount));
  }, [term, prices]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      toast.error(t("subscription.receipt"));
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("term", term);
      if (bankId) fd.append("bankAccountId", bankId);
      if (payerName.trim()) fd.append("payerName", payerName.trim());
      if (transactionRef.trim()) fd.append("transactionRef", transactionRef.trim());
      if (amount) fd.append("amount", amount);
      fd.append("file", file);
      await api.post("/subscriptions/payments", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success(t("subscription.submitted"));
      setFile(null);
      setPayerName("");
      setTransactionRef("");
      await load();
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      const isDup =
        err?.response?.status === 400 &&
        typeof msg === "string" &&
        msg.toLowerCase().includes("transaction reference");
      toast.error(isDup ? t("subscription.duplicateRef") : (msg ?? t("adm.sub.saveFail")));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Loading className="py-24" />;

  const notBilled = me?.freeForever || me?.lifetime;

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-800">{t("subscription.title")}</h1>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      {me && <SubscriptionCard subscription={me} />}

      {!notBilled && (
        <>
          {/* Pay-to accounts */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="font-semibold text-gray-800 mb-3">
              {t("subscription.bankAccounts")}
            </h2>
            {banks.length === 0 ? (
              <p className="text-sm text-gray-400">{t("adm.sub.bankEmpty")}</p>
            ) : (
              <ul className="space-y-2">
                {banks.map((b) => (
                  <li
                    key={b.id}
                    className="flex flex-wrap items-center justify-between gap-2 border border-gray-100 rounded-lg p-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-800">
                        {b.bankName}
                        {b.branch ? ` · ${b.branch}` : ""}
                      </p>
                      <p className="text-xs text-gray-500">
                        {b.accountName} · <span className="font-mono">{b.accountNumber}</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(b.accountNumber).catch(() => {});
                        toast.success(t("subscription.copy"));
                      }}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      {t("subscription.copy")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Submission form */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="font-semibold text-gray-800 mb-1">
              {t("subscription.submitReceipt")}
            </h2>
            <p className="text-xs text-gray-400 mb-3">{t("subscription.payHint")}</p>
            <form onSubmit={submit} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block text-xs font-medium text-gray-500">
                  {t("subscription.chooseTerm")}
                  <select
                    value={term}
                    onChange={(e) => setTerm(e.target.value)}
                    className="mt-1 border border-gray-300 rounded-lg p-2 text-sm w-full bg-white"
                  >
                    {SUBSCRIPTION_TERMS.map((tm) => {
                      const p = prices.find((x) => x.term === tm);
                      return (
                        <option key={tm} value={tm}>
                          {termLabel(t, tm)}
                          {p ? ` — ${fmtCurrency(p.amount)}` : ""}
                        </option>
                      );
                    })}
                  </select>
                </label>

                <label className="block text-xs font-medium text-gray-500">
                  {t("subscription.chooseAccount")}
                  <select
                    value={bankId}
                    onChange={(e) => setBankId(e.target.value)}
                    className="mt-1 border border-gray-300 rounded-lg p-2 text-sm w-full bg-white"
                  >
                    {banks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.bankName} · {b.accountNumber}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-xs font-medium text-gray-500">
                  {t("subscription.amount")}
                  <input
                    type="number"
                    min="0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="mt-1 border border-gray-300 rounded-lg p-2 text-sm w-full"
                  />
                </label>

                <label className="block text-xs font-medium text-gray-500">
                  {t("subscription.payerName")}
                  <input
                    value={payerName}
                    onChange={(e) => setPayerName(e.target.value)}
                    placeholder={t("subscription.payerNamePh")}
                    className="mt-1 border border-gray-300 rounded-lg p-2 text-sm w-full"
                  />
                </label>

                <label className="block text-xs font-medium text-gray-500">
                  {t("subscription.transactionRef")}
                  <input
                    value={transactionRef}
                    onChange={(e) => setTransactionRef(e.target.value)}
                    placeholder={t("subscription.transactionRefPh")}
                    className="mt-1 border border-gray-300 rounded-lg p-2 text-sm w-full"
                  />
                </label>
              </div>

              <label className="block text-xs font-medium text-gray-500">
                {t("subscription.receipt")}
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="mt-1 block w-full text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-blue-600 file:text-white file:text-xs file:font-medium"
                />
                <span className="text-[11px] text-gray-400">
                  {t("subscription.receiptHint")}
                </span>
              </label>

              <div className="flex justify-end">
                <Button type="submit" loading={submitting}>
                  {t("subscription.submitReceipt")}
                </Button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* History */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="font-semibold text-gray-800 mb-3">{t("subscription.history")}</h2>
        {payments.length === 0 ? (
          <p className="text-sm text-gray-400">{t("subscription.noPayments")}</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm text-gray-800">
                    {termLabel(t, p.term)} · {fmtCurrency(p.amount)}
                  </p>
                  <p className="text-[11px] text-gray-400">
                    {formatDateTime(p.createdAt)}
                  </p>
                </div>
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${paymentStatusClass(p.status)}`}
                >
                  {t(`subscription.payStatus.${p.status}`, { defaultValue: p.status })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
