"use client";

import { VERTICAL_LABELS } from "@/lib/verticals";
import { statusLabel } from "@/lib/statusLabel";
import { formatDateTime } from "@/lib/datetime";
import api from "@/lib/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

interface AdminDoc {
  id: string;
  documentType: string;
  mimeType: string;
  size: number;
  status: string;
  aiResult: {
    decision?: string;
    confidence?: number;
    reasons?: string[];
    detectedType?: string;
  } | null;
  createdAt: string;
}

interface AdminUser {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  isPlatformAdmin: boolean;
  status: string;
  verificationStatus: string;
  verificationNote: string | null;
  verificationAttempts: number;
  createdAt: string;
  verificationDocs: AdminDoc[];
}

interface AdminOrg {
  id: number;
  name: string;
  businessType: string;
  label?: string;
  status: string;
  verificationStatus: string;
  verificationNote: string | null;
  verificationAttempts: number;
  createdAt: string;
  memberships: { user: { id: number; name: string; email: string } }[];
  verificationDocs: AdminDoc[];
}

interface Queue {
  users: AdminUser[];
  organizations: AdminOrg[];
}

const FILTERS = ["ALL", "PENDING", "SUBMITTED", "FLAGGED", "REJECTED", "APPROVED", "BLOCKED"] as const;

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800 border-amber-200",
  SUBMITTED: "bg-sky-100 text-sky-800 border-sky-200",
  APPROVED: "bg-emerald-100 text-emerald-800 border-emerald-200",
  REJECTED: "bg-rose-100 text-rose-800 border-rose-200",
  FLAGGED: "bg-orange-100 text-orange-800 border-orange-200",
  BLOCKED: "bg-red-200 text-red-900 border-red-300",
};

// Document type → i18n key under `verif.*`; resolved with `t` at render time.
const DOC_LABEL_KEYS: Record<string, string> = {
  NATIONAL_ID: "verif.docNationalId",
  TRADE_LICENSE: "verif.docTradeLicense",
  TIN_CERTIFICATE: "verif.docTinCertificate",
};

/** Localized document label (falls back to the raw enum value). */
function docLabel(type: string, t: (key: string) => string): string {
  const key = DOC_LABEL_KEYS[type];
  return key ? t(key) : type;
}

export default function AdminVerificationPage() {
  const { t } = useTranslation();
  // Business-type display name from the shared `verticals.*` catalog, with the
  // static English label as the fallback for an unknown type.
  const verticalName = (type?: string | null) =>
    type
      ? t(`verticals.${type.toLowerCase()}`, {
          defaultValue: VERTICAL_LABELS[type] ?? type,
        })
      : "";
  const [queue, setQueue] = useState<Queue>({ users: [], organizations: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<{
    kind: "user" | "business";
    id: number;
    name: string;
  } | null>(null);
  const [reason, setReason] = useState("");
  const [requesting, setRequesting] = useState<{
    kind: "user" | "business";
    id: number;
    name: string;
  } | null>(null);
  const [requestedDocs, setRequestedDocs] = useState<string[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});

  // Detail modal: full account info + inline document previews + status change.
  const [detail, setDetail] = useState<{
    kind: "user" | "business";
    account: AdminUser | AdminOrg;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get(
        `/admin/verification${filter !== "ALL" ? `?status=${filter}` : ""}`,
      );
      setQueue(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("adm.verif.loadFail"));
    } finally {
      setLoading(false);
    }
  }, [filter, t]);

  useEffect(() => {
    load();
  }, [load]);

  const pendingCount = useMemo(
    () =>
      queue.users.filter((u) => ["SUBMITTED", "FLAGGED"].includes(u.verificationStatus))
        .length +
      queue.organizations.filter((o) =>
        ["SUBMITTED", "FLAGGED"].includes(o.verificationStatus),
      ).length,
    [queue],
  );

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("adm.verif.actionFail"));
    } finally {
      setBusy(false);
    }
  };

  const approveUser = (id: number) =>
    act(() => api.post(`/admin/verification/user/${id}/approve`));

  const approveBusiness = (id: number) =>
    act(() => api.post(`/admin/verification/business/${id}/approve`));

  const submitReject = async () => {
    if (!rejecting || !reason.trim()) return;
    const body = { reason: reason.trim() };
    await act(() =>
      rejecting.kind === "user"
        ? api.post(`/admin/verification/user/${rejecting.id}/reject`, body)
        : api.post(`/admin/verification/business/${rejecting.id}/reject`, body),
    );
    setRejecting(null);
    setReason("");
  };

  const submitRequestDocs = async () => {
    if (!requesting || requestedDocs.length === 0) return;
    await act(() =>
      api.post(
        `/admin/verification/${requesting.kind}/${requesting.id}/request-documents`,
        { documents: requestedDocs },
      ),
    );
    setRequesting(null);
    setRequestedDocs([]);
  };

  const loadPreview = useCallback(
    async (doc: AdminDoc) => {
      if (previews[doc.id]) return;
      try {
        const res = await api.get(`/verification/documents/${doc.id}/file`, {
          responseType: "blob",
        });
        const url = URL.createObjectURL(res.data);
        setPreviews((prev) => ({ ...prev, [doc.id]: url }));
      } catch {
        // ignore
      }
    },
    [previews],
  );

  // Admin can move an account to ANY status from its current one. On failure
  // the modal stays open and the error is shown inside it.
  const applyStatus = async (status: string, note: string) => {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      await api.post(
        `/admin/verification/${detail.kind}/${detail.account.id}/status`,
        { status, note: note.trim() || undefined },
      );
      await load();
      setDetail(null);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("adm.verif.statusFail"));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="text-gray-500">{t("common.loading")}</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">{t("adm.verif.title")}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {t("adm.verif.subtitle", { count: pendingCount })}
        </p>
      </div>

      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full border transition ${
              filter === f
                ? "bg-gray-800 text-white border-gray-800"
                : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
            }`}
          >
            {f === "ALL" ? t("common.all") : statusLabel(f)}
          </button>
        ))}
      </div>

      <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <h2 className="font-semibold text-gray-800 px-5 py-3 border-b border-gray-100">
          {t("adm.verif.ownerAccounts", { count: queue.users.length })}
        </h2>
        {queue.users.length === 0 && (
          <p className="text-gray-400 text-sm p-5">{t("adm.verif.noAccounts")}</p>
        )}
        {queue.users.map((u) => (
          <AccountRow
            key={u.id}
            title={u.name}
            subtitle={`${u.email}${u.phone ? ` · ${u.phone}` : ""}`}
            attempts={u.verificationAttempts}
            note={u.verificationNote}
            status={u.verificationStatus}
            docs={u.verificationDocs}
            previews={previews}
            onPreview={loadPreview}
            onDetails={() => setDetail({ kind: "user", account: u })}
            onApprove={() => approveUser(u.id)}
            onReject={() => setRejecting({ kind: "user", id: u.id, name: u.name })}
            onRequestDocs={() => {
              setRequestedDocs([]);
              setRequesting({ kind: "user", id: u.id, name: u.name });
            }}
            busy={busy}
          />
        ))}
      </section>

      <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <h2 className="font-semibold text-gray-800 px-5 py-3 border-b border-gray-100">
          {t("adm.verif.businesses", { count: queue.organizations.length })}
        </h2>
        {queue.organizations.length === 0 && (
          <p className="text-gray-400 text-sm p-5">{t("adm.verif.noBusinesses")}</p>
        )}
        {queue.organizations.map((o) => (
          <AccountRow
            key={o.id}
            title={o.name}
            subtitle={`${o.label ?? (verticalName(o.businessType) || o.businessType)} · ${o.memberships?.[0]?.user?.name ?? t("adm.verif.noOwner")}`}
            attempts={o.verificationAttempts}
            note={o.verificationNote}
            status={o.verificationStatus}
            docs={o.verificationDocs}
            previews={previews}
            onPreview={loadPreview}
            onDetails={() => setDetail({ kind: "business", account: o })}
            onApprove={() => approveBusiness(o.id)}
            onReject={() => setRejecting({ kind: "business", id: o.id, name: o.name })}
            onRequestDocs={() => {
              setRequestedDocs([]);
              setRequesting({ kind: "business", id: o.id, name: o.name });
            }}
            busy={busy}
          />
        ))}
      </section>

      {rejecting && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-1">{t("adm.verif.rejectTitle")}</h2>
            <p className="text-xs text-gray-500 mb-3">
              {t("adm.verif.rejectHint", { name: rejecting.name })}
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("adm.verif.rejectPh")}
              className="border border-gray-300 rounded p-2 text-sm w-full h-24"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setRejecting(null)}
                className="px-3 py-2 text-sm text-gray-600"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={submitReject}
                disabled={!reason.trim() || busy}
                className="bg-red-600 text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {t("adm.verif.rejectBtn")}
              </button>
            </div>
          </div>
        </div>
      )}

      {requesting && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-1">{t("adm.verif.requestTitle")}</h2>
            <p className="text-xs text-gray-500 mb-3">
              {t("adm.verif.requestHint", { name: requesting.name })}
            </p>
            <div className="space-y-2">
              {Object.keys(DOC_LABEL_KEYS).map((value) => (
                <label
                  key={value}
                  className="flex items-center gap-2 text-sm text-gray-700"
                >
                  <input
                    type="checkbox"
                    checked={requestedDocs.includes(value)}
                    onChange={(e) =>
                      setRequestedDocs((prev) =>
                        e.target.checked
                          ? [...prev, value]
                          : prev.filter((d) => d !== value),
                      )
                    }
                    className="rounded"
                  />
                  {docLabel(value, t)}
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setRequesting(null)}
                className="px-3 py-2 text-sm text-gray-600"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={submitRequestDocs}
                disabled={requestedDocs.length === 0 || busy}
                className="bg-sky-600 text-white rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {t("adm.verif.sendRequest")}
              </button>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <DetailModal
          kind={detail.kind}
          account={detail.account}
          busy={busy}
          error={error}
          onClose={() => setDetail(null)}
          onApply={applyStatus}
        />
      )}
    </div>
  );
}


function AccountRow({
  title,
  subtitle,
  status,
  note,
  attempts,
  docs,
  previews,
  onPreview,
  onDetails,
  onApprove,
  onReject,
  onRequestDocs,
  busy,
}: {
  title: string;
  subtitle: string;
  status: string;
  note: string | null;
  attempts: number;
  docs: AdminDoc[];
  previews: Record<string, string>;
  onPreview: (doc: AdminDoc) => void;
  onDetails: () => void;
  onApprove: () => void;
  onReject: () => void;
  onRequestDocs: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.PENDING;
  return (
    <div className="px-5 py-4 border-b border-gray-100 last:border-0">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-gray-800">{title}</p>
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${style}`}>
              {statusLabel(status)}
            </span>
            {attempts > 0 && (
              <span className="text-[11px] text-gray-400">{t("adm.verif.rejections", { count: attempts })}</span>
            )}
          </div>
          <p className="text-xs text-gray-400">{subtitle}</p>
          {note && <p className="text-xs text-amber-700 mt-1">{note}</p>}
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={onDetails}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            title={t("adm.verif.detailsTitle")}
          >
            {t("adm.verif.details")}
          </button>
          <button
            onClick={onReject}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
            title={t("adm.verif.rejectAttr")}
          >
            {t("adm.verif.rejectBtn")}
          </button>
          <button
            onClick={onApprove}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            title={t("adm.verif.approveAttr")}
          >
            {t("adm.verif.approve")}
          </button>
        </div>
        <button
          onClick={onRequestDocs}
          disabled={busy}
          className="text-xs px-3 py-1.5 rounded border border-sky-200 text-sky-600 hover:bg-sky-50 disabled:opacity-50 flex-shrink-0"
          title={t("adm.verif.requestDocsAttr")}
        >
          {t("adm.verif.requestDocs")}
        </button>
      </div>

      {docs.length > 0 && (
        <div className="mt-3 space-y-2">
          {docs.map((d) => {
            const ai = d.aiResult;
            return (
              <div
                key={d.id}
                className="flex items-center gap-3 text-xs border border-gray-100 rounded p-2 flex-wrap"
              >
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLES[d.status] ?? STATUS_STYLES.PENDING}`}>
                  {statusLabel(d.status)}
                </span>
                <span className="text-gray-600">{docLabel(d.documentType, t)}</span>
                {ai && (
                  <span className="text-gray-500">
                    {t("adm.verif.aiLabel")} {ai.decision ?? "—"}
                    {ai.confidence != null ? ` (${Math.round(ai.confidence * 100)}%)` : ""}
                  </span>
                )}
                <button
                  onClick={() => onPreview(d)}
                  className="text-blue-600 hover:underline ml-auto"
                >
                  {previews[d.id] ? t("common.view") : t("common.preview")}
                </button>
                {previews[d.id] && (
                  <a href={previews[d.id]} target="_blank" rel="noreferrer">
                    {t("adm.verif.open")}
                  </a>
                )}
                {ai?.reasons && ai.reasons.length > 0 && (
                  <p className="w-full text-gray-400">{ai.reasons.join(" · ")}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DetailModal({
  kind,
  account,
  busy,
  error,
  onClose,
  onApply,
}: {
  kind: "user" | "business";
  account: AdminUser | AdminOrg;
  busy: boolean;
  error: string;
  onClose: () => void;
  onApply: (status: string, note: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(account.verificationStatus);
  const [note, setNote] = useState("");

  const isUser = kind === "user";
  const user = account as AdminUser;
  const org = account as AdminOrg;
  const docs = account.verificationDocs ?? [];
  // Business-type display name, localized via `verticals.*`.
  const verticalName = (type?: string | null) =>
    type
      ? t(`verticals.${type.toLowerCase()}`, {
          defaultValue: VERTICAL_LABELS[type] ?? type,
        })
      : "";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <div>
            <h2 className="text-lg font-bold text-gray-800">
              {isUser ? "👤" : "🏢"} {account.name}
            </h2>
            <p className="text-xs text-gray-500">
              {isUser
                ? `${user.email}${user.phone ? ` · ${user.phone}` : ""} · ${t("adm.verif.ownerAccountNum", { id: user.id })}`
                : `${org.label ?? (verticalName(org.businessType) || org.businessType)} · ${t("adm.verif.businessNum", { id: org.id })} · ${org.memberships?.[0]?.user?.name ?? t("adm.verif.noOwner")}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_STYLES[account.verificationStatus] ?? STATUS_STYLES.PENDING}`}
            >
              {statusLabel(account.verificationStatus)}
            </span>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              aria-label={t("common.close")}
            >
              ×
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-400">{t("adm.verif.created")}</p>
              <p className="text-gray-700">{formatDateTime(account.createdAt)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-400">{t("adm.verif.rejectionsLabel")}</p>
              <p className="text-gray-700">{account.verificationAttempts}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-400">{t("common.status")}</p>
              <p className="text-gray-700">{statusLabel(account.verificationStatus)}</p>
            </div>
            {account.verificationNote && (
              <div className="col-span-full">
                <p className="text-[11px] uppercase tracking-wide text-gray-400">{t("adm.verif.note")}</p>
                <p className="text-amber-700 text-xs bg-amber-50 border border-amber-100 rounded p-2">
                  {account.verificationNote}
                </p>
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-800 mb-2">
              {t("adm.verif.documents", { count: docs.length })}
            </h3>
            {docs.length === 0 && (
              <p className="text-xs text-gray-400">{t("adm.verif.noDocs")}</p>
            )}
            <div className="space-y-3">
              {docs.map((d) => {
                const ai = d.aiResult;
                return (
                  <div key={d.id} className="border border-gray-200 rounded-lg p-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLES[d.status] ?? STATUS_STYLES.PENDING}`}>
                        {statusLabel(d.status)}
                      </span>
                      <span className="text-sm font-medium text-gray-700">
                        {docLabel(d.documentType, t)}
                      </span>
                      <span className="text-[11px] text-gray-400">
                        {formatDateTime(d.createdAt)}
                      </span>
                    </div>
                    {ai && (
                      <div className="mt-1.5 text-xs text-gray-500 space-y-0.5">
                        <p>
                          <span className={ai.decision === "CLEAR" ? "text-emerald-600 font-semibold" : "text-orange-600 font-semibold"}>
                            {t("adm.verif.aiLabel")} {ai.decision ?? "—"}
                          </span>
                          {ai.confidence != null
                            ? ` (${t("adm.verif.confidence", { percent: Math.round(ai.confidence * 100) })})`
                            : ""}
                          {ai.detectedType
                            ? ` · ${t("adm.verif.detected", { type: ai.detectedType.replace(/_/g, " ") })}`
                            : ""}
                        </p>
                        {ai.reasons && ai.reasons.length > 0 && (
                          <p className="text-gray-400">{ai.reasons.join(" · ")}</p>
                        )}
                      </div>
                    )}
                    <div className="mt-2">
                      <DocPreview doc={d} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Change status — allowed from ANY current status */}
          <div className="border-t border-gray-100 pt-4">
            {error && (
              <div className="bg-red-50 text-red-600 p-3 rounded text-sm mb-3">
                {error}
              </div>
            )}
            <h3 className="text-sm font-semibold text-gray-800 mb-2">
              {t("adm.biz.vstatusChange")}
            </h3>
            <p className="text-xs text-gray-400 mb-3">
              {t("adm.verif.changeHint")}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="border border-gray-300 rounded-lg p-2 text-sm w-full bg-white"
              >
                {FILTERS.map((s) => (
                  <option key={s} value={s}>
                    {s === "ALL" ? t("common.all") : statusLabel(s)}
                  </option>
                ))}
              </select>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("adm.verif.notePh")}
                className="border border-gray-300 rounded-lg p-2 text-sm w-full"
                maxLength={500}
              />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={onClose}
                disabled={busy}
                className="px-4 py-2 text-sm text-gray-600 disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => onApply(status, note)}
                disabled={busy || status === account.verificationStatus}
                className="bg-gray-800 text-white rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {busy ? t("adm.verif.applying") : t("adm.verif.applyStatus")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DocPreview({ doc }: { doc: AdminDoc }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    api
      .get(`/verification/documents/${doc.id}/file`, { responseType: "blob" })
      .then((res) => {
        if (!cancelled) setUrl(URL.createObjectURL(res.data));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [doc.id]);

  const mime = (doc.mimeType || "").toLowerCase();
  const unrenderable = mime.includes("heic") || mime.includes("heif");

  if (failed)
    return (
      <p className="text-xs text-gray-400">
        {t("adm.verif.previewUnavailable")}
      </p>
    );
  if (!url) return <p className="text-xs text-gray-400">{t("adm.verif.loadingPreview")}</p>;

  return (
    <div>
      {mime.startsWith("image/") && !unrenderable ? (
        <img
          src={url}
          alt={docLabel(doc.documentType, t)}
          className="max-h-72 rounded border border-gray-200 object-contain bg-gray-50"
        />
      ) : unrenderable ? (
        <div className="flex items-center gap-3 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded p-2">
          <span>{t("adm.verif.heicNote")}</span>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 hover:underline"
          >
            {t("adm.verif.openOriginal")}
          </a>
        </div>
      ) : (
        <iframe
          src={url}
          title={docLabel(doc.documentType, t)}
          className="w-full h-72 rounded border border-gray-200 bg-gray-50"
        />
      )}
    </div>
  );
}


