"use client";
// Customer profile: the CRM heart of the app. One screen shows who the customer
// is, what they have bought, the interaction timeline and the loyalty ledger —
// all fed by the endpoints in src/customers.
import { useConfirm } from "@/app/components/ConfirmProvider";
import CustomerForm from "@/app/components/CustomerForm";
import Loading from "@/app/components/Loading";
import Modal from "@/app/components/Modal";
import { useToast } from "@/app/components/ToastProvider";
import { useAuth } from "@/context/AuthContext";
import api, { markHandled } from "@/lib/api";
import { formatBusinessNumber } from "@/lib/bizNumber";
import { fmtCurrency } from "@/lib/currency";
import { formatDate, formatDateTime } from "@/lib/datetime";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const NOTE_KINDS = ["NOTE", "CALL", "VISIT", "COMPLAINT", "FOLLOW_UP"] as const;

export default function CustomerProfilePage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("customers.manage");

  const [customer, setCustomer] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);

  // Timeline composer
  const [noteKind, setNoteKind] = useState<string>("NOTE");
  const [noteBody, setNoteBody] = useState("");
  const [noteFollowUp, setNoteFollowUp] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  // Loyalty adjustment
  const [pointsDelta, setPointsDelta] = useState("");
  const [pointsReason, setPointsReason] = useState("");
  const [savingPoints, setSavingPoints] = useState(false);

  const customerRef = customer?.publicId ?? customer?.id ?? id;

  const fetchCustomer = useCallback(async () => {
    try {
      const res = await api.get(`/customers/${id}`);
      setCustomer(res.data);
    } catch (err: any) {
      markHandled(err);
      toast.error(t("crm.notFound"));
      router.push("/dashboard/customers");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    fetchCustomer();
  }, [fetchCustomer]);

  const addNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteBody.trim()) return;
    setSavingNote(true);
    try {
      await api.post(`/customers/${id}/notes`, {
        kind: noteKind,
        body: noteBody.trim(),
        ...(noteFollowUp ? { followUpAt: noteFollowUp } : {}),
      });
      setNoteBody("");
      setNoteFollowUp("");
      setNoteKind("NOTE");
      toast.success(t("crm.entryAdded"));
      fetchCustomer();
    } catch (err: any) {
      markHandled(err);
      toast.error(t("crm.entryFailed"));
    } finally {
      setSavingNote(false);
    }
  };

  const removeNote = async (noteId: number) => {
    const ok = await confirm(t("crm.deleteEntryConfirm"));
    if (!ok) return;
    try {
      await api.delete(`/customers/${id}/notes/${noteId}`);
      toast.success(t("crm.entryDeleted"));
      fetchCustomer();
    } catch (err: any) {
      markHandled(err);
      toast.error(t("crm.entryDeleteFailed"));
    }
  };

  const adjustPoints = async (e: React.FormEvent) => {
    e.preventDefault();
    const points = Number(pointsDelta);
    if (!Number.isFinite(points) || points === 0) return;
    setSavingPoints(true);
    try {
      await api.post(`/customers/${id}/loyalty/adjust`, {
        points,
        ...(pointsReason.trim() ? { reason: pointsReason.trim() } : {}),
      });
      setPointsDelta("");
      setPointsReason("");
      toast.success(t("crm.pointsAdjusted"));
      fetchCustomer();
    } catch (err: any) {
      markHandled(err);
      // The API explains an over-redemption ("only N points …").
      toast.error(
        err?.response?.data?.message ?? t("crm.pointsAdjustFailed"),
      );
    } finally {
      setSavingPoints(false);
    }
  };

  const setArchived = async (archived: boolean) => {
    const ok = await confirm(
      archived ? t("crm.archiveConfirm") : t("crm.restoreConfirm"),
    );
    if (!ok) return;
    try {
      await api.put(`/customers/${customerRef}/archived`, { archived });
      toast.success(archived ? t("crm.archivedDone") : t("crm.restoredDone"));
      fetchCustomer();
    } catch (err: any) {
      markHandled(err);
      toast.error(t("crm.archiveFailed"));
    }
  };

  if (loading) return <Loading className="py-24" />;
  if (!customer) return null;

  const stats: [string, string][] = [
    [t("crm.totalSpent"), fmtCurrency(customer.stats?.totalSpent ?? 0)],
    [t("crm.salesCount"), String(customer.stats?.salesCount ?? 0)],
    [t("crm.averageOrder"), fmtCurrency(customer.stats?.averageOrder ?? 0)],
    [
      t("crm.lastPurchase"),
      customer.stats?.lastPurchaseAt
        ? formatDate(customer.stats.lastPurchaseAt)
        : t("crm.never"),
    ],
    [t("crm.balance"), fmtCurrency(customer.remaining ?? 0)],
    [
      t("crm.pointsBalance"),
      `${customer.loyaltyPoints ?? 0} ${t("crm.points")}`,
    ],
  ];

  const noteKindLabel = (kind: string) =>
    t(`crm.entryKind${String(kind).toUpperCase()}`);
  const entryLabel = (type: string) => t(`crm.entry${type}`);

  return (
    <div>
      {/* HEADER */}
      <div className="flex justify-between items-start md:items-center mb-4 gap-3">
        <div>
          <Link
            href="/dashboard/customers"
            className="text-xs text-blue-600 hover:underline"
          >
            ← {t("crm.title")}
          </Link>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">
            {customer.name}
          </h1>
          <span className="flex flex-wrap items-center gap-1 mt-1 text-xs text-gray-500">
            {customer.numberLabel && <span>{customer.numberLabel}</span>}
            {customer.phone && <span>· {customer.phone}</span>}
            {customer.email && <span>· {customer.email}</span>}
            {customer.canTakeCredit === false ? (
              <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-600">
                {t("crm.creditBlocked")}
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded bg-green-50 text-green-700">
                {t("crm.creditAllowed")}
              </span>
            )}
            {customer.isArchived && (
              <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                {t("crm.archivedBadge")}
              </span>
            )}
            {(customer.tags ?? []).map((tag: string) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700"
              >
                {tag}
              </span>
            ))}
          </span>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/dashboard/credits/${customer.publicId ?? customer.id}`}
            className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-300 whitespace-nowrap"
          >
            {t("crm.viewCredits")}
          </Link>
          {canManage && (
            <button
              onClick={() => setShowEdit(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 whitespace-nowrap"
            >
              {t("crm.editProfile")}
            </button>
          )}
          {canManage && (
            <button
              onClick={() => setArchived(!customer.isArchived)}
              className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-300 whitespace-nowrap"
            >
              {customer.isArchived ? t("crm.restore") : t("crm.archive")}
            </button>
          )}
        </div>
      </div>

      {/* STATS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3 mb-4">
        {stats.map(([label, value]) => (
          <div key={label} className="bg-white rounded-xl shadow-sm border p-3">
            <p className="text-[11px] text-gray-500">{label}</p>
            <p className="text-base sm:text-lg font-bold text-gray-800">
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* BODY */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-4">
          {/* Profile details */}
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <h2 className="text-sm font-semibold text-gray-800 mb-3">
              {t("crm.profileTitle")}
            </h2>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-[11px] text-gray-500">{t("crm.address")}</dt>
                <dd className="text-gray-800">{customer.address || "—"}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-gray-500">
                  {t("crm.birthday")}
                </dt>
                <dd className="text-gray-800">
                  {customer.birthday ? formatDate(customer.birthday) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-gray-500">{t("crm.source")}</dt>
                <dd className="text-gray-800">
                  {customer.source
                    ? t(`crm.source${customer.source}`)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-gray-500">
                  {t("crm.creditLimit")}
                </dt>
                <dd className="text-gray-800">
                  {customer.creditLimit != null
                    ? fmtCurrency(customer.creditLimit)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-gray-500">
                  {t("crm.preferredLanguage")}
                </dt>
                <dd className="text-gray-800">
                  {customer.preferredLanguage === "am"
                    ? t("language.amharic")
                    : customer.preferredLanguage === "en"
                      ? t("language.english")
                      : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-gray-500">
                  {t("crm.customerNumber")}
                </dt>
                <dd className="text-gray-800">
                  {customer.numberLabel ??
                    formatBusinessNumber("CUST", customer.number) ??
                    "—"}
                </dd>
              </div>
            </dl>
            {customer.notes && (
              <p className="mt-3 text-sm text-gray-600 border-t pt-3">
                {customer.notes}
              </p>
            )}
          </div>

          {/* Recent purchases */}
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <h2 className="text-sm font-semibold text-gray-800 mb-3">
              {t("crm.recentSales")}
            </h2>
            <div className="space-y-2">
              {(customer.recentSales ?? []).map((s: any) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between text-sm border-b last:border-0 pb-2 last:pb-0"
                >
                  <div>
                    <p className="text-gray-800">{s.invoiceNumber}</p>
                    <p className="text-[11px] text-gray-400">
                      {formatDateTime(s.saleDate)} · {s.saleType}
                    </p>
                  </div>
                  <span className="font-medium text-gray-800">
                    {fmtCurrency(s.totalAmount)}
                  </span>
                </div>
              ))}
              {(customer.recentSales ?? []).length === 0 && (
                <p className="text-sm text-gray-400">{t("crm.noSales")}</p>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT */}
        <div className="space-y-4">
          {/* Interaction timeline */}
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <h2 className="text-sm font-semibold text-gray-800">
              {t("crm.timeline")}
            </h2>
            <p className="text-[11px] text-gray-500 mb-3">
              {t("crm.timelineHint")}
            </p>

            {canManage && (
              <form
                onSubmit={addNote}
                className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3 border-b pb-3"
              >
                <select
                  value={noteKind}
                  onChange={(e) => setNoteKind(e.target.value)}
                  className="border p-2 rounded-lg text-sm bg-white"
                >
                  {NOTE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {noteKindLabel(kind)}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={noteFollowUp}
                  onChange={(e) => setNoteFollowUp(e.target.value)}
                  className="border p-2 rounded-lg text-sm"
                  title={t("crm.followUpAt")}
                />
                <textarea
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                  placeholder={t("crm.entryBody")}
                  rows={2}
                  className="border p-2 rounded-lg text-sm sm:col-span-2"
                />
                <button
                  type="submit"
                  disabled={savingNote}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 sm:col-span-2"
                >
                  {savingNote ? t("common.saving") : t("crm.addEntry")}
                </button>
              </form>
            )}

            <div className="space-y-3">
              {(customer.customerNotes ?? []).map((n: any) => (
                <div
                  key={n.id}
                  className="border-l-2 border-blue-200 pl-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-gray-500">
                      {noteKindLabel(n.kind)} ·{" "}
                      {n.user?.name ? `${n.user.name} · ` : ""}
                      {formatDateTime(n.createdAt)}
                    </span>
                    {canManage && (
                      <button
                        onClick={() => removeNote(n.id)}
                        className="text-[11px] text-red-500 hover:underline"
                      >
                        {t("crm.deleteEntry")}
                      </button>
                    )}
                  </div>
                  <p className="text-gray-800 whitespace-pre-wrap">{n.body}</p>
                  {n.followUpAt && (
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      {t("crm.followUpAt")}: {formatDate(n.followUpAt)}
                    </p>
                  )}
                </div>
              ))}
              {(customer.customerNotes ?? []).length === 0 && (
                <p className="text-sm text-gray-400">{t("crm.noEntries")}</p>
              )}
            </div>
          </div>

          {/* LOYALTY */}
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <h2 className="text-sm font-semibold text-gray-800">
              {t("crm.loyaltyHistory")}
            </h2>
            <p className="text-[11px] text-gray-500 mb-3">
              {t("crm.pointsBalance")}: {customer.loyaltyPoints ?? 0}{" "}
              {t("crm.points")}
              {customer.loyaltyProgram?.enabled === false &&
                ` · ${t("crm.programEnabled")}: ${t("common.no")}`}
            </p>

            {canManage && (
              <form
                onSubmit={adjustPoints}
                className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3 border-b pb-3"
              >
                <input
                  type="number"
                  value={pointsDelta}
                  onChange={(e) => setPointsDelta(e.target.value)}
                  placeholder={t("crm.pointsDelta")}
                  className="border p-2 rounded-lg text-sm"
                />
                <input
                  value={pointsReason}
                  onChange={(e) => setPointsReason(e.target.value)}
                  placeholder={t("crm.pointsReason")}
                  className="border p-2 rounded-lg text-sm"
                />
                <button
                  type="submit"
                  disabled={savingPoints}
                  className="bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50 sm:col-span-2"
                >
                  {savingPoints ? t("common.saving") : t("crm.adjustPoints")}
                </button>
              </form>
            )}

            <div className="space-y-2">
              {(customer.loyaltyEntries ?? []).map((entry: any) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between text-sm border-b last:border-0 pb-2 last:pb-0"
                >
                  <div>
                    <p className="text-gray-800">
                      {entryLabel(entry.type)}
                      {entry.sale ? ` · ${entry.sale.invoiceNumber}` : ""}
                    </p>
                    <p className="text-[11px] text-gray-400">
                      {formatDateTime(entry.createdAt)}
                      {entry.reason ? ` · ${entry.reason}` : ""}
                    </p>
                  </div>
                  <span
                    className={`font-medium ${
                      entry.points >= 0 ? "text-green-600" : "text-red-500"
                    }`}
                  >
                    {entry.points > 0 ? `+${entry.points}` : entry.points}
                  </span>
                </div>
              ))}
              {(customer.loyaltyEntries ?? []).length === 0 && (
                <p className="text-sm text-gray-400">{t("crm.noPoints")}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* EDIT */}
      <Modal
        isOpen={showEdit}
        onClose={() => setShowEdit(false)}
        title={t("crm.editProfile")}
      >
        <CustomerForm
          initialData={customer}
          showSections
          onCreated={() => {}}
          onUpdated={() => {
            setShowEdit(false);
            toast.success(t("crm.customerSaved"));
            fetchCustomer();
          }}
          onCancel={() => setShowEdit(false)}
        />
      </Modal>
    </div>
  );
}
