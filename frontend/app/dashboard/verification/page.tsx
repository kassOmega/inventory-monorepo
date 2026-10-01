"use client";

import { useAuth } from "@/context/AuthContext";
import { verticalLabel } from "@/lib/verticals";
import api from "@/lib/api";
import { statusLabel } from "@/lib/statusLabel";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface VerificationDocument {
  id: string;
  documentType: string;
  mimeType: string;
  fileName: string;
  status: string;
  aiResult: {
    decision?: string;
    confidence?: number;
    reasons?: string[];
  } | null;
  createdAt: string;
}

interface BusinessVerification {
  id: number;
  name: string;
  businessType: string;
  verificationStatus: string;
  verificationNote: string | null;
  verificationAttempts: number;
  documents: VerificationDocument[];
}

interface VerificationState {
  user: {
    id: number;
    name: string;
    email: string;
    isOwnerAccount: boolean;
    verificationStatus: string;
    verificationNote: string | null;
    verificationAttempts: number;
    documents: VerificationDocument[];
  };
  businesses: BusinessVerification[];
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800 border-amber-200",
  SUBMITTED: "bg-sky-100 text-sky-800 border-sky-200",
  APPROVED: "bg-emerald-100 text-emerald-800 border-emerald-200",
  REJECTED: "bg-rose-100 text-rose-800 border-rose-200",
  FLAGGED: "bg-orange-100 text-orange-800 border-orange-200",
  BLOCKED: "bg-red-200 text-red-900 border-red-300",
};

// Values are catalog keys under `verification.*` — resolve them with `t()`.
const DOC_LABELS: Record<string, string> = {
  NATIONAL_ID: "verification.docNationalId",
  TRADE_LICENSE: "verification.docTradeLicense",
  TIN_CERTIFICATE: "verification.docTin",
};

// A document can only be (re-)submitted when nothing is pending review.
const UPLOADABLE_STATES = ["PENDING", "REJECTED"];
const REVIEWING_STATES = ["SUBMITTED", "FLAGGED"];

export default function VerificationPage() {
  const { refreshUser } = useAuth();
  const { t } = useTranslation();
  const [data, setData] = useState<VerificationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await api.get("/verification/me");
      setData(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("verification.loadFail"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(""), 4000);
  };

  const loadPreview = useCallback(
    async (doc: VerificationDocument) => {
      if (previews[doc.id]) return;
      try {
        const res = await api.get(`/verification/documents/${doc.id}/file`, {
          responseType: "blob",
        });
        const url = URL.createObjectURL(res.data);
        setPreviews((prev) => ({ ...prev, [doc.id]: url }));
      } catch {
        // ignore preview failures
      }
    },
    [previews],
  );

  const upload = async (opts: {
    url: string;
    documentType: string;
    file: File;
    key: string;
  }) => {
    setError("");
    setUploading(opts.key);
    try {
      const form = new FormData();
      form.append("documentType", opts.documentType);
      form.append("file", opts.file);
      await api.post(opts.url, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      flash(t("verification.uploaded"));
      await load();
      await refreshUser();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("verification.uploadFail"));
    } finally {
      setUploading(null);
    }
  };

  const blocked = data?.user.verificationStatus === "BLOCKED";

  if (loading) return <p className="text-gray-500">{t("common.loading")}</p>;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">{t("verification.title")}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {t("verification.subtitle")}
        </p>
      </div>

      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}
      {msg && <div className="bg-green-50 text-green-700 p-3 rounded text-sm">{msg}</div>}

      {blocked && (
        <div className="bg-red-100 border border-red-300 rounded-lg p-4 text-red-800">
          <p className="font-semibold">{t("verification.blockedTitle")}</p>
          <p className="text-sm mt-1">
            {data?.user.verificationNote ??
              t("verification.blockedDefaultNote")}{" "}
            {t("verification.contactAdmin")}
          </p>
        </div>
      )}

      {/* ---- User account verification ---- */}
      {data && (
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-semibold text-gray-800">{t("verification.yourAccount")}</h2>
              <p className="text-xs text-gray-400">{data.user.email}</p>
            </div>
            <StatusBadge status={data.user.verificationStatus} />
          </div>

          {data.user.verificationNote && !blocked && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded p-2 mt-3">
              {data.user.verificationNote}
            </p>
          )}

          {data.user.isOwnerAccount &&
            !blocked &&
            UPLOADABLE_STATES.includes(data.user.verificationStatus) && (
              <div className="mt-4">
                <UploadForm
                  label={t(DOC_LABELS.NATIONAL_ID)}
                  uploading={uploading === "user-national-id"}
                  onSubmit={(file) =>
                    upload({
                      url: "/verification/user/documents",
                      documentType: "NATIONAL_ID",
                      file,
                      key: "user-national-id",
                    })
                  }
                />
              </div>
            )}

          {data.user.isOwnerAccount &&
            REVIEWING_STATES.includes(data.user.verificationStatus) && (
              <p className="text-xs text-blue-600 bg-blue-50 rounded p-2 mt-3">
                {t("verification.userUnderReview")}
              </p>
            )}

          <DocList docs={data.user.documents} previews={previews} onPreview={loadPreview} />
        </section>
      )}

      {/* ---- Business verification ---- */}
      {data?.businesses.map((b) => (
        <BusinessCard
          key={b.id}
          business={b}
          blocked={blocked}
          uploading={uploading}
          previews={previews}
          onPreview={loadPreview}
          onUpload={upload}
        />
      ))}

      {data && data.businesses.length === 0 && (
        <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 text-center text-gray-400 text-sm">
          {data.user.isOwnerAccount
            ? t("verification.emptyOwner")
            : t("verification.emptyStaff")}
        </section>
      )}
    </div>
  );
}


function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.PENDING;
  return (
    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${style}`}>
      {statusLabel(status)}
    </span>
  );
}

function UploadForm({
  label,
  uploading,
  onSubmit,
}: {
  label: string;
  uploading: boolean;
  onSubmit: (file: File) => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="border border-dashed border-gray-300 rounded-lg p-3 bg-gray-50">
      <p className="text-xs font-medium text-gray-600 mb-2">{label}</p>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onSubmit(file);
          e.target.value = "";
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="text-sm bg-blue-600 text-white rounded px-3 py-2 hover:bg-blue-700 disabled:opacity-60"
      >
        {uploading ? t("verification.uploading") : t("verification.uploadBtn")}
      </button>
      <p className="text-[11px] text-gray-400 mt-2">
        {t("verification.uploadHint")}
      </p>
    </div>
  );
}

function DocList({
  docs,
  previews,
  onPreview,
}: {
  docs: VerificationDocument[];
  previews: Record<string, string>;
  onPreview: (doc: VerificationDocument) => void;
}) {
  const { t } = useTranslation();
  if (!docs.length) return null;
  return (
    <div className="mt-4 space-y-2">
      {docs.map((d) => (
        <div
          key={d.id}
          className="flex items-center gap-3 text-sm border border-gray-100 rounded p-2"
        >
          <StatusBadge status={d.status} />
          <span className="text-gray-600 text-xs">
            {DOC_LABELS[d.documentType]
              ? t(DOC_LABELS[d.documentType])
              : d.documentType}
          </span>
          <button
            onClick={() => onPreview(d)}
            className="text-blue-600 hover:underline text-xs ml-auto"
          >
            {previews[d.id] ? t("common.view") : t("common.preview")}
          </button>
          {previews[d.id] && (
            <a href={previews[d.id]} target="_blank" rel="noreferrer">
              {t("verification.open")}
            </a>
          )}
        </div>
      ))}
    </div>
  );
}


function BusinessCard({
  business,
  blocked,
  uploading,
  previews,
  onPreview,
  onUpload,
}: {
  business: BusinessVerification;
  blocked: boolean;
  uploading: string | null;
  previews: Record<string, string>;
  onPreview: (doc: VerificationDocument) => void;
  onUpload: (opts: {
    url: string;
    documentType: string;
    file: File;
    key: string;
  }) => void;
}) {
  const { t } = useTranslation();
  const canEdit =
    !blocked && UPLOADABLE_STATES.includes(business.verificationStatus);
  const reviewing = REVIEWING_STATES.includes(business.verificationStatus);

  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-gray-800">{business.name}</h2>
          <p className="text-xs text-gray-400">
            {verticalLabel(business.businessType)} ·{" "}
            {t("verification.businessLabel")}
          </p>
        </div>
        <StatusBadge status={business.verificationStatus} />
      </div>

      {business.verificationNote && business.verificationStatus !== "BLOCKED" && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded p-2 mt-3">
          {business.verificationNote}
        </p>
      )}

      {business.verificationStatus === "BLOCKED" && (
        <div className="bg-red-100 border border-red-300 rounded p-3 mt-3 text-red-800 text-sm">
          {t("verification.businessBlocked")}
        </div>
      )}

      {reviewing && !blocked && (
        <p className="text-xs text-blue-600 bg-blue-50 rounded p-2 mt-3">
          {t("verification.businessUnderReview")}
        </p>
      )}

      <div className="mt-4 space-y-3">
        {canEdit && (
          <UploadForm
            label={t(DOC_LABELS.TRADE_LICENSE)}
            uploading={uploading === `biz-${business.id}-trade`}
            onSubmit={(file) =>
              onUpload({
                url: `/verification/business/${business.id}/documents`,
                documentType: "TRADE_LICENSE",
                file,
                key: `biz-${business.id}-trade`,
              })
            }
          />
        )}
        {canEdit && (
          <UploadForm
            label={t(DOC_LABELS.TIN_CERTIFICATE)}
            uploading={uploading === `biz-${business.id}-tin`}
            onSubmit={(file) =>
              onUpload({
                url: `/verification/business/${business.id}/documents`,
                documentType: "TIN_CERTIFICATE",
                file,
                key: `biz-${business.id}-tin`,
              })
            }
          />
        )}
      </div>

      <DocList
        docs={business.documents}
        previews={previews}
        onPreview={onPreview}
      />
    </section>
  );
}

