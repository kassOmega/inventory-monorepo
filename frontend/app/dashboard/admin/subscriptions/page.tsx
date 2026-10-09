"use client";

// Platform-admin subscription management:
//   1. Default prices per business type × term (inline editable).
//   2. Per-business subscription: price override, free/lifetime grants, expiry.
//   3. Receipt review queue (AI decision + approve / reject).
import api from "@/lib/api";
import Button from "@/app/components/Button";
import Modal from "@/app/components/Modal";
import Loading from "@/app/components/Loading";
import { useToast } from "@/app/components/ToastProvider";
import { verticalLabel } from "@/lib/verticals";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { fmtCurrency } from "@/lib/currency";
import {
  BUSINESS_TYPES,
  SUBSCRIPTION_TERMS,
  daysLeftFor,
  effectiveStatus,
  needsReview,
  paymentStatusClass,
  statusClass,
  statusLabel,
  termLabel,
} from "@/lib/subscriptions";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type Tab = "prices" | "tenants" | "review";

interface Plan {
  id: number;
  businessType: string | null;
  term: string;
  price: number;
  currency: string;
  active: boolean;
}
interface OrgSub {
  id: number;
  name: string;
  businessType: string;
  subscription: {
    status: string;
    term: string | null;
    expiresAt: string | null;
    daysLeft: number | null;
    freeForever: boolean;
    lifetime: boolean;
    isTrial?: boolean;
    priceOverride: number | null;
    readOnly: boolean;
    note: string | null;
  };
}
interface Payment {
  id: number;
  term: string;
  amount: number;
  currency: string;
  status: string;
  aiDecision: string | null;
  aiResult: {
    confidence?: number;
    reasons?: string[];
    extracted?: Record<string, unknown>;
  } | null;
  payerName: string | null;
  fileName: string;
  mimeType: string;
  createdAt: string;
  organization: { id: number; name: string; businessType: string };
  bankAccount: { bankName: string; accountName: string; accountNumber: string } | null;
  submittedBy: { name: string; email: string } | null;
}

export default function AdminSubscriptionsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("prices");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [plans, setPlans] = useState<Plan[]>([]);
  const [planDraft, setPlanDraft] = useState<Record<string, string>>({});
  const [savingPlan, setSavingPlan] = useState<string | null>(null);
  const [trialDays, setTrialDays] = useState("");
  const [savingTrial, setSavingTrial] = useState(false);

  const [orgs, setOrgs] = useState<OrgSub[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<OrgSub | null>(null);
  const [editForm, setEditForm] = useState({
    term: "",
    priceOverride: "",
    expiresAt: "",
    note: "",
  });
  const [savingOrg, setSavingOrg] = useState(false);

  const [payments, setPayments] = useState<Payment[]>([]);
  const [reviewFilter, setReviewFilter] = useState<"pending" | "all">("pending");
  const [reviewing, setReviewing] = useState<Payment | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [busyReview, setBusyReview] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [plansRes, orgsRes, payRes] = await Promise.all([
        api.get("/admin/subscription-plans"),
        api.get("/admin/organizations"),
        api.get("/admin/subscription-payments"),
      ]);
      setPlans(plansRes.data);
      // Trial length (platform setting) — a non-blocking extra call.
      api
        .get("/admin/subscription-settings")
        .then((r) => setTrialDays(String(r.data.trialDays ?? 0)))
        .catch(() => {});
      const orgList: OrgSub[] = orgsRes.data;
      // The list endpoint embeds each org's subscription row; normalize to the
      // shape this page renders (with derived status/daysLeft recomputed locally
      // from the expiry so the table is correct without another round-trip).
      setOrgs(
        orgList.map((o: any) => {
          const s = o.subscription ?? null;
          const row = s
            ? { status: s.status, expiresAt: s.expiresAt }
            : { status: "ACTIVE", expiresAt: null };
          const status = effectiveStatus(row);
          return {
            id: o.id,
            name: o.name,
            businessType: o.businessType,
            subscription: {
              status,
              term: s?.term ?? null,
              expiresAt: s?.expiresAt ?? null,
              daysLeft: daysLeftFor(row),
              freeForever: s?.status === "FREE",
              lifetime: s?.status === "LIFETIME",
              isTrial: s?.isTrial ?? false,
              priceOverride: s?.priceOverride ?? null,
              readOnly: status === "EXPIRED",
              note: s?.note ?? null,
            },
          };
        }),
      );
      setPayments(payRes.data);
      setError("");
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("adm.sub.loadFail"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  // --- Default prices -------------------------------------------------------
  const planKey = (businessType: string | null, term: string) =>
    `${businessType ?? "GLOBAL"}:${term}`;

  const planValue = (businessType: string | null, term: string): string => {
    const key = planKey(businessType, term);
    if (planDraft[key] !== undefined) return planDraft[key];
    const plan = plans.find(
      (p) => p.businessType === businessType && p.term === term,
    );
    return plan ? String(plan.price) : "";
  };

  const savePlan = async (businessType: string | null, term: string) => {
    const key = planKey(businessType, term);
    const raw = planValue(businessType, term);
    setSavingPlan(key);
    try {
      await api.post("/admin/subscription-plans", {
        businessType,
        term,
        price: Number(raw) || 0,
      });
      setPlanDraft((d) => {
        const next = { ...d };
        delete next[key];
        return next;
      });
      const r = await api.get("/admin/subscription-plans");
      setPlans(r.data);
      toast.success(t("adm.sub.saved"));
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? t("adm.sub.saveFail"));
    } finally {
      setSavingPlan(null);
    }
  };

  const saveTrial = async () => {
    setSavingTrial(true);
    try {
      await api.patch("/admin/subscription-settings", {
        trialDays: Number(trialDays) || 0,
      });
      toast.success(t("adm.sub.trialSaved"));
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? t("adm.sub.saveFail"));
    } finally {
      setSavingTrial(false);
    }
  };

  // --- Per-tenant -----------------------------------------------------------
  const openEdit = (o: OrgSub) => {
    setEditing(o);
    setEditForm({
      term: o.subscription.term ?? "",
      priceOverride:
        o.subscription.priceOverride != null ? String(o.subscription.priceOverride) : "",
      expiresAt: o.subscription.expiresAt
        ? String(o.subscription.expiresAt).slice(0, 10)
        : "",
      note: o.subscription.note ?? "",
    });
  };

  const patchOrg = async (body: Record<string, unknown>) => {
    if (!editing) return;
    setSavingOrg(true);
    try {
      await api.patch(`/admin/organizations/${editing.id}/subscription`, body);
      toast.success(t("adm.sub.saved"));
      setEditing(null);
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? t("adm.sub.saveFail"));
    } finally {
      setSavingOrg(false);
    }
  };

  const saveOrg = () =>
    patchOrg({
      term: editForm.term || null,
      priceOverride: editForm.priceOverride === "" ? null : Number(editForm.priceOverride),
      expiresAt: editForm.expiresAt || null,
      note: editForm.note || null,
    });

  // --- Review ---------------------------------------------------------------
  const loadReceipt = async (p: Payment) => {
    setReceiptUrl(null);
    try {
      const res = await api.get(`/subscription-payments/${p.id}/file`, {
        responseType: "blob",
      });
      setReceiptUrl(URL.createObjectURL(res.data));
    } catch {
      setReceiptUrl(null);
    }
  };

  const review = async (p: Payment, action: "approve" | "reject", note?: string) => {
    setBusyReview(true);
    try {
      await api.post(`/admin/subscription-payments/${p.id}/review`, { action, note });
      toast.success(t("common.success"));
      setReviewing(null);
      setRejectNote("");
      setReceiptUrl(null);
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? t("adm.sub.saveFail"));
    } finally {
      setBusyReview(false);
    }
  };

  const filteredOrgs = useMemo(() => {
    const q = search.toLowerCase();
    return orgs.filter((o) => !q || o.name.toLowerCase().includes(q));
  }, [orgs, search]);

  const shownPayments = useMemo(
    () =>
      reviewFilter === "pending"
        ? payments.filter((p) => needsReview(p.status))
        : payments,
    [payments, reviewFilter],
  );

  if (loading) return <Loading className="py-24" />;

  const tabs: { key: Tab; label: string }[] = [
    { key: "prices", label: t("adm.sub.defaults") },
    { key: "tenants", label: t("adm.sub.tenant") },
    { key: "review", label: t("adm.sub.review") },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">{t("adm.sub.title")}</h1>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      <div className="flex gap-1 border-b overflow-x-auto">
        {tabs.map((x) => (
          <button
            key={x.key}
            onClick={() => setTab(x.key)}
            className={
              "px-4 py-2 text-sm font-medium whitespace-nowrap rounded-t-lg transition " +
              (tab === x.key
                ? "bg-white text-blue-600 border border-b-white -mb-px shadow-sm"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-100")
            }
          >
            {x.label}
            {x.key === "review" && payments.some((p) => needsReview(p.status)) && (
              <span className="ml-1 text-[10px] bg-amber-100 text-amber-700 rounded-full px-1.5 py-0.5">
                {payments.filter((p) => needsReview(p.status)).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "prices" && (
        <div className="space-y-3">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="font-semibold text-gray-800">{t("adm.sub.trial")}</h2>
            <p className="text-xs text-gray-400 mt-0.5 mb-3">{t("adm.sub.trialHint")}</p>
            <div className="flex items-end gap-3 flex-wrap">
              <label className="text-sm text-gray-600">
                {t("adm.sub.trialDays")}
                <input
                  type="number"
                  min="0"
                  value={trialDays}
                  onChange={(e) => setTrialDays(e.target.value)}
                  className="block mt-1 w-28 border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                />
              </label>
              <Button loading={savingTrial} onClick={saveTrial}>
                {t("adm.sub.save")}
              </Button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2">{t("adm.sub.forType")}</th>
                {SUBSCRIPTION_TERMS.map((term) => (
                  <th key={term} className="px-3 py-2">
                    {termLabel(t, term)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[...BUSINESS_TYPES.map((b) => b as string | null), null].map((bt) => (
                <tr key={bt ?? "GLOBAL"}>
                  <td className="px-3 py-2 font-medium text-gray-700">
                    {bt ? verticalLabel(bt) : t("adm.sub.forTypeAll")}
                  </td>
                  {SUBSCRIPTION_TERMS.map((term) => {
                    const key = planKey(bt, term);
                    const dirty = planDraft[key] !== undefined;
                    return (
                      <td key={term} className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          value={planValue(bt, term)}
                          onChange={(e) =>
                            setPlanDraft((d) => ({ ...d, [key]: e.target.value }))
                          }
                          className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-sm"
                        />
                        {dirty && (
                          <Button
                            size="sm"
                            loading={savingPlan === key}
                            onClick={() => savePlan(bt, term)}
                            className="ml-1 !px-2 !py-1 !text-xs"
                          >
                            {t("adm.sub.save")}
                          </Button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {tab === "tenants" && (
        <div className="space-y-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("adm.sub.search")}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full sm:w-72"
          />
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2">{t("adm.sub.orgName")}</th>
                  <th className="px-3 py-2">{t("adm.sub.status")}</th>
                  <th className="px-3 py-2">{t("adm.sub.expires")}</th>
                  <th className="px-3 py-2">{t("subscription.price")}</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredOrgs.map((o) => (
                  <tr key={o.id}>
                    <td className="px-3 py-2">
                      <span className="font-medium text-gray-800">{o.name}</span>
                      <span className="block text-[11px] text-gray-400">
                        {verticalLabel(o.businessType)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${statusClass(o.subscription.status)}`}
                      >
                        {statusLabel(t, o.subscription.status)}
                      </span>
                      {o.subscription.isTrial && (
                        <span className="ml-1.5 text-[10px] font-medium text-blue-600">
                          {t("adm.sub.trialOf")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {o.subscription.expiresAt
                        ? formatDate(o.subscription.expiresAt)
                        : "—"}
                      {o.subscription.daysLeft != null && (
                        <span className="block text-[11px] text-gray-400">
                          {t("subscription.daysLeft")}: {o.subscription.daysLeft}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {o.subscription.priceOverride != null
                        ? fmtCurrency(o.subscription.priceOverride)
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => openEdit(o)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        {t("common.edit")}
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredOrgs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-gray-400">
                      {t("common.noData")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "review" && (
        <div className="space-y-3">
          <div className="flex gap-2">
            {(["pending", "all"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setReviewFilter(f)}
                className={
                  "px-3 py-1.5 rounded-lg text-xs font-medium border " +
                  (reviewFilter === f
                    ? "bg-blue-50 text-blue-700 border-blue-200"
                    : "bg-white text-gray-600 border-gray-200")
                }
              >
                {f === "pending" ? t("adm.sub.reviewPending") : t("adm.sub.reviewAll")}
              </button>
            ))}
          </div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2">{t("adm.sub.orgName")}</th>
                  <th className="px-3 py-2">{t("subscription.term")}</th>
                  <th className="px-3 py-2">{t("subscription.amount")}</th>
                  <th className="px-3 py-2">{t("adm.sub.status")}</th>
                  <th className="px-3 py-2">{t("adm.sub.submittedAt")}</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {shownPayments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2 font-medium text-gray-800">
                      {p.organization.name}
                    </td>
                    <td className="px-3 py-2">{termLabel(t, p.term)}</td>
                    <td className="px-3 py-2">
                      {fmtCurrency(p.amount)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${paymentStatusClass(p.status)}`}
                      >
                        {t(`subscription.payStatus.${p.status}`, { defaultValue: p.status })}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-xs">
                      {formatDateTime(p.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => {
                          setReviewing(p);
                          loadReceipt(p);
                        }}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        {t("common.view")}
                      </button>
                    </td>
                  </tr>
                ))}
                {shownPayments.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-gray-400">
                      {t("adm.sub.reviewEmpty")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per-tenant edit modal */}
      <Modal
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.name ?? ""}
      >
        {editing && (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                loading={savingOrg}
                onClick={() => patchOrg({ status: "FREE" })}
                className="!bg-purple-600 hover:!bg-purple-700"
              >
                {t("adm.sub.grantFree")}
              </Button>
              <Button
                size="sm"
                loading={savingOrg}
                onClick={() => patchOrg({ status: "LIFETIME" })}
                className="!bg-indigo-600 hover:!bg-indigo-700"
              >
                {t("adm.sub.grantLifetime")}
              </Button>
              {(editing.subscription.freeForever || editing.subscription.lifetime) && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={savingOrg}
                  onClick={() => patchOrg({ status: "ACTIVE" })}
                >
                  {t("adm.sub.revokeFree")}
                </Button>
              )}
            </div>

            <label className="block text-gray-600">
              {t("subscription.term")}
              <select
                value={editForm.term}
                onChange={(e) => setEditForm({ ...editForm, term: e.target.value })}
                className="border border-gray-300 rounded-lg p-2 text-sm w-full mt-1 bg-white"
              >
                <option value="">—</option>
                {SUBSCRIPTION_TERMS.map((term) => (
                  <option key={term} value={term}>
                    {termLabel(t, term)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-gray-600">
              {t("adm.sub.override")}
              <input
                type="number"
                min="0"
                value={editForm.priceOverride}
                onChange={(e) =>
                  setEditForm({ ...editForm, priceOverride: e.target.value })
                }
                placeholder={t("adm.sub.overrideHint")}
                className="border border-gray-300 rounded-lg p-2 text-sm w-full mt-1"
              />
            </label>

            <label className="block text-gray-600">
              {t("adm.sub.expiry")}
              <input
                type="date"
                value={editForm.expiresAt}
                onChange={(e) =>
                  setEditForm({ ...editForm, expiresAt: e.target.value })
                }
                className="border border-gray-300 rounded-lg p-2 text-sm w-full mt-1"
              />
            </label>

            <label className="block text-gray-600">
              {t("adm.sub.reason")}
              <input
                value={editForm.note}
                onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
                className="border border-gray-300 rounded-lg p-2 text-sm w-full mt-1"
              />
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEditing(null)}
                className="px-3 py-2 text-sm text-gray-600"
              >
                {t("common.cancel")}
              </button>
              <Button loading={savingOrg} onClick={saveOrg}>
                {t("adm.sub.apply")}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Receipt review modal */}
      <Modal
        isOpen={!!reviewing}
        onClose={() => {
          setReviewing(null);
          setReceiptUrl(null);
        }}
        title={reviewing ? `${reviewing.organization.name} · ${termLabel(t, reviewing.term)}` : ""}
      >
        {reviewing && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-gray-400">{t("subscription.amount")}</span>
                <p className="font-medium">
                  {fmtCurrency(reviewing.amount)}
                </p>
              </div>
              <div>
                <span className="text-gray-400">{t("subscription.payerName")}</span>
                <p className="font-medium">{reviewing.payerName ?? "—"}</p>
              </div>
              <div>
                <span className="text-gray-400">{t("adm.sub.submittedBy")}</span>
                <p className="font-medium">
                  {reviewing.submittedBy?.name ?? "—"}
                </p>
              </div>
              <div>
                <span className="text-gray-400">{t("adm.sub.decision")}</span>
                <p className="font-medium">{reviewing.aiDecision ?? "—"}</p>
              </div>
              {reviewing.bankAccount && (
                <div className="col-span-2">
                  <span className="text-gray-400">{t("subscription.bankAccounts")}</span>
                  <p className="font-medium">
                    {reviewing.bankAccount.bankName} · {reviewing.bankAccount.accountName} ·{" "}
                    {reviewing.bankAccount.accountNumber}
                  </p>
                </div>
              )}
            </div>

            {reviewing.aiResult?.reasons && reviewing.aiResult.reasons.length > 0 && (
              <div className="bg-amber-50 text-amber-800 rounded-lg p-2 text-xs">
                <p className="font-medium mb-1">{t("subscription.aiReasons")}</p>
                <ul className="list-disc ml-4 space-y-0.5">
                  {reviewing.aiResult.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}

            {receiptUrl ? (
              <a href={receiptUrl} target="_blank" rel="noreferrer">
                {reviewing.mimeType?.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={receiptUrl}
                    alt={t("subscription.receipt")}
                    className="max-h-72 rounded-lg border"
                  />
                ) : (
                  <span className="text-blue-600 underline">{t("subscription.receipt")}</span>
                )}
              </a>
            ) : (
              <p className="text-gray-400 text-xs">{t("common.loading")}</p>
            )}

            <input
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder={t("adm.sub.reason")}
              className="border border-gray-300 rounded-lg p-2 text-sm w-full"
            />

            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="danger"
                loading={busyReview}
                onClick={() => review(reviewing, "reject", rejectNote || undefined)}
              >
                {t("adm.sub.reject")}
              </Button>
              <Button
                variant="emerald"
                loading={busyReview}
                onClick={() => review(reviewing, "approve", rejectNote || undefined)}
              >
                {t("adm.sub.approve")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
