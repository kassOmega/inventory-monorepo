"use client";

import { useAuth } from "@/context/AuthContext";
import { VERTICAL_LABELS, HOSPITALITY_SERVICES, DEFAULT_HOSPITALITY_SERVICES } from "@/lib/verticals";
import api, { getApiErrorMessage, markHandled } from "@/lib/api";
import PublicHeader from "@/app/components/PublicHeader";
import AiAssistWidget from "@/app/components/AiAssistWidget";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export default function SignupPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { login } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Optional inline business creation (max 2 businesses per owner).
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("RETAIL");
  // Hospitality-only: the service lines offered (multi-select). Pre-selected
  // with the defaults so an owner who skips the step still gets a working setup.
  const [hospitalityServices, setHospitalityServices] = useState<string[]>(
    DEFAULT_HOSPITALITY_SERVICES,
  );
  const [standalone, setStandalone] = useState(false);
  const [tradeLicense, setTradeLicense] = useState<File | null>(null);
  const [tinCertificate, setTinCertificate] = useState<File | null>(null);
  const [nationalId, setNationalId] = useState<File | null>(null);

  // The business form is hidden until the client opts in, so a plain account
  // signup stays short. Choosing "Yes" expands the inline business creation.
  const [wantBusiness, setWantBusiness] = useState(false);

  // Allowed document formats (kept in sync with the backend upload filter).
  const ALLOWED_DOC_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
    "application/pdf",
  ]);
  const ALLOWED_DOC_EXTS = new Set([
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".heic",
    ".heif",
    ".pdf",
  ]);

  // Persist the created account across a failed-upload retry so the signup POST
  // is not repeated, and remember which documents already uploaded successfully
  // so a retry never creates duplicate document rows.
  const createdRef = useRef<{
    token: string;
    user: any;
    orgId?: number;
  } | null>(null);
  const uploadedRef = useRef<Set<string>>(new Set());

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError(t("auth.passwordsDontMatch"));
      return;
    }

    // Reject unsupported files BEFORE the account is created, so a bad file can
    // never leave a half-created account behind.
    for (const [label, file] of [
      ["auth.docNationalId", nationalId],
      ["auth.docTradeLicense", tradeLicense],
      ["auth.docTinCertificate", tinCertificate],
    ] as [string, File | null][]) {
      if (!file) continue;
      const ext = "." + (file.name.split(".").pop() ?? "").toLowerCase();
      if (!ALLOWED_DOC_TYPES.has(file.type) && !ALLOWED_DOC_EXTS.has(ext)) {
        setError(
          t("auth.unsupportedFile", { file: file.name, doc: t(label) }),
        );
        return;
      }
    }

    setLoading(true);
    try {
      // Create the account once; reuse it when retrying after a failed upload.
      if (!createdRef.current) {
        const res = await api.post("/auth/signup", {
          name,
          email,
          phone,
          password,
          business: businessName.trim()
            ? {
                name: businessName.trim(),
                businessType,
                standalone,
                ...(businessType === "HOSPITALITY" ? { hospitalityServices } : {}),
              }
            : undefined,
        });

        if (res.data?.access_token) {
          createdRef.current = {
            token: res.data.access_token,
            user: res.data.user,
            orgId: res.data?.business?.id,
          };
          uploadedRef.current.clear();
          // Put the session into localStorage so the uploads below are
          // authorized, but do NOT call login() yet — login() navigates to the
          // dashboard, and we must not leave this form until every document has
          // actually been uploaded.
          localStorage.setItem("token", res.data.access_token);
          localStorage.setItem("user", JSON.stringify(res.data.user));
        } else {
          router.push("/login?created=1");
          return;
        }
      }

      const orgId = createdRef.current?.orgId;
      const pending: {
        key: string;
        url: string;
        documentType: string;
        file: File;
      }[] = [];
      if (nationalId && !uploadedRef.current.has("nid")) {
        pending.push({
          key: "nid",
          url: "/verification/user/documents",
          documentType: "NATIONAL_ID",
          file: nationalId,
        });
      }
      if (orgId) {
        if (tradeLicense && !uploadedRef.current.has("trade")) {
          pending.push({
            key: "trade",
            url: `/verification/business/${orgId}/documents`,
            documentType: "TRADE_LICENSE",
            file: tradeLicense,
          });
        }
        if (tinCertificate && !uploadedRef.current.has("tin")) {
          pending.push({
            key: "tin",
            url: `/verification/business/${orgId}/documents`,
            documentType: "TIN_CERTIFICATE",
            file: tinCertificate,
          });
        }
      }

      // Upload documents one at a time. On ANY failure, stop and stay on the
      // form with a clear message — never navigate away while a document may
      // still be missing, otherwise users assume it was accepted.
      for (const up of pending) {
        try {
          const form = new FormData();
          form.append("documentType", up.documentType);
          form.append("file", up.file);
          await api.post(up.url, form, {
            headers: { "Content-Type": "multipart/form-data" },
          });
          uploadedRef.current.add(up.key);
        } catch (err: any) {
          markHandled(err);
          setError(
            t("auth.uploadFailed", {
              file: up.file.name,
              reason: getApiErrorMessage(err),
            }),
          );
          return;
        }
      }

      // All documents uploaded (or none were selected). Only now finalize the
      // session and navigate — so a failed upload can never redirect the user
      // into thinking their document was accepted.
      login(createdRef.current.token, createdRef.current.user);
    } catch (err: any) {
      markHandled(err);
      setError(
        err?.response?.data?.message ?? t("auth.signupFailed"),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-gray-100">
      <PublicHeader showAuthActions={false} />
      <div className="mx-auto my-auto flex w-full flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-4xl">
        <div className="bg-white shadow-lg rounded-xl p-6 sm:p-8 border border-gray-200 mb-6">
          <div className="text-center mb-6 sm:mb-8">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">
              {t("app.name")}
            </h1>
            <p className="text-gray-500 mt-2 text-sm sm:text-base">
              {t("auth.createAccount")}
            </p>
            <p className="text-gray-400 mt-1 text-xs">
              {t("auth.reviewNote")}
            </p>
          </div>

          {error && (
            <div className="bg-red-50 text-red-500 p-3 rounded mb-4 text-sm text-center">
              {error}
            </div>
          )}

          <form onSubmit={handleSignup}>
            <div className="grid md:grid-cols-2 gap-5">
            <div className="space-y-4 sm:space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("auth.fullName")}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full p-2.5 sm:p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("auth.email")}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full p-2.5 sm:p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("auth.phoneNumber")}
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t("auth.phoneHint")}
                className="w-full p-2.5 sm:p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("auth.password")}
              </label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full p-2.5 sm:p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition text-sm pr-10"
                  minLength={8}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
                >
                  {showPw ? t("auth.hidePassword") : t("auth.showPassword")}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("auth.confirmPassword")}
              </label>
              <input
                type={showPw ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full p-2.5 sm:p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition text-sm"
                minLength={8}
                required
              />
            </div>
            <label className="block border border-dashed border-gray-300 rounded-lg p-3 bg-gray-50 cursor-pointer">
              <span className="text-xs font-medium text-gray-600">
                {t("auth.docNationalId")}{" "}
                <span className="text-gray-400">
                  {t("auth.nidHint")}
                </span>
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
                onChange={(e) => setNationalId(e.target.files?.[0] ?? null)}
                className="mt-1 block w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-blue-600 file:text-white file:text-xs file:font-medium"
              />
              {nationalId && (
                <span className="block text-[11px] text-blue-600 mt-1">
                  📄 {nationalId.name}
                </span>
              )}
            </label>
            </div>

            {/* Optional inline business creation (max 2 per owner) — hidden until
                the client opts in, so a plain account signup stays short. */}
            <div className="space-y-4 sm:space-y-5 border-t md:border-t-0 md:border-l border-gray-200 md:pl-5 pt-4 md:pt-0">
              <div>
                <h3 className="text-sm font-semibold text-gray-800">{t("auth.businessTitle")}</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {t("auth.businessPrompt")}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setWantBusiness(false)}
                  className={`rounded-lg border p-2.5 text-sm font-medium transition ${
                    !wantBusiness
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-gray-300 text-gray-600 hover:border-gray-400"
                  }`}
                >
                  {t("auth.noLater")}
                </button>
                <button
                  type="button"
                  onClick={() => setWantBusiness(true)}
                  className={`rounded-lg border p-2.5 text-sm font-medium transition ${
                    wantBusiness
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-gray-300 text-gray-600 hover:border-gray-400"
                  }`}
                >
                  {t("auth.yesAddBusiness")}
                </button>
              </div>
              {wantBusiness && (
                <div className="space-y-4 sm:space-y-5 pt-1">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("auth.businessName")}
                </label>
                <input
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g. Meron Trading"
                  className="w-full p-2.5 sm:p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("auth.businessType")}
                </label>
                <select
                  value={businessType}
                  onChange={(e) => setBusinessType(e.target.value)}
                  className="w-full p-2.5 sm:p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition text-sm bg-white"
                >
                  {Object.entries(VERTICAL_LABELS).map(([value]) => (
                    <option key={value} value={value}>
                      {t(`verticals.${value.toLowerCase()}`)}
                    </option>
                  ))}
                </select>
              </div>
              {businessType === "HOSPITALITY" && (
                <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 sm:p-4">
                  <p className="block text-sm font-medium text-gray-700 mb-1">
                    {t("hospitalityServices.title")}
                  </p>
                  <p className="text-[11px] text-gray-500 mb-3">
                    {t("hospitalityServices.hint")}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {HOSPITALITY_SERVICES.map((svc) => {
                      const checked = hospitalityServices.includes(svc.value);
                      return (
                        <label
                          key={svc.value}
                          className={`flex items-start gap-2 rounded-lg border p-2.5 cursor-pointer transition ${
                            checked
                              ? "border-blue-600 bg-white ring-1 ring-blue-500"
                              : "border-gray-200 bg-white hover:border-gray-300"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setHospitalityServices((prev) =>
                                prev.includes(svc.value)
                                  ? prev.filter((v) => v !== svc.value)
                                  : [...prev, svc.value],
                              )
                            }
                            className="mt-0.5 accent-blue-600"
                          />
                          <span>
                            <span className="block text-sm font-medium text-gray-800">
                              {t(`hospitalityServices.${svc.i18nKey}`, { defaultValue: svc.label })}
                            </span>
                            <span className="block text-[11px] text-gray-400">
                              {t(`hospitalityServices.${svc.i18nKey}_DESC`, { defaultValue: svc.description })}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {hospitalityServices.length === 0 && (
                    <p className="text-[11px] text-amber-600 mt-2">
                      Pick at least one service — otherwise Food &amp; Beverage and
                      Accommodation are enabled by default.
                    </p>
                  )}
                </div>
              )}
              <div>
                <p className="block text-sm font-medium text-gray-700 mb-1">
                  {t("auth.isStandaloneShop")}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setStandalone(true)}
                    className={`rounded-lg border p-2.5 text-left text-sm transition ${
                      standalone
                        ? "border-blue-600 bg-blue-50 ring-1 ring-blue-500"
                        : "border-gray-200 bg-white hover:border-gray-300"
                    }`}
                  >
                    <span className="flex items-center gap-2 font-medium text-gray-800">
                      <span
                        className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${
                          standalone ? "border-blue-600" : "border-gray-300"
                        }`}
                      >
                        {standalone && <span className="h-2 w-2 rounded-full bg-blue-600" />}
                      </span>
                      {t("common.yes")}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setStandalone(false)}
                    className={`rounded-lg border p-2.5 text-left text-sm transition ${
                      !standalone
                        ? "border-blue-600 bg-blue-50 ring-1 ring-blue-500"
                        : "border-gray-200 bg-white hover:border-gray-300"
                    }`}
                  >
                    <span className="flex items-center gap-2 font-medium text-gray-800">
                      <span
                        className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${
                          !standalone ? "border-blue-600" : "border-gray-300"
                        }`}
                      >
                        {!standalone && <span className="h-2 w-2 rounded-full bg-blue-600" />}
                      </span>
                      {t("common.no")}
                    </span>
                  </button>
                </div>
                <p className="text-[11px] text-gray-400 mt-1.5 leading-relaxed">
                  {t("auth.standaloneShopHelp")}
                </p>
              </div>
              <label className="block border border-dashed border-gray-300 rounded-lg p-3 bg-gray-50 cursor-pointer">
                <span className="text-xs font-medium text-gray-600">
                  {t("auth.docTradeLicense")} <span className="text-gray-400">{t("auth.tradeLicenseRequired")}</span>
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
                  onChange={(e) => setTradeLicense(e.target.files?.[0] ?? null)}
                  className="mt-1 block w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-blue-600 file:text-white file:text-xs file:font-medium"
                />
                {tradeLicense && (
                  <span className="block text-[11px] text-blue-600 mt-1">📄 {tradeLicense.name}</span>
                )}
              </label>
              <label className="block border border-dashed border-gray-300 rounded-lg p-3 bg-gray-50 cursor-pointer">
                <span className="text-xs font-medium text-gray-600">
                  {t("auth.docTinCertificate")} <span className="text-gray-400">{t("common.optional")}</span>
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
                  onChange={(e) => setTinCertificate(e.target.files?.[0] ?? null)}
                  className="mt-1 block w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-blue-600 file:text-white file:text-xs file:font-medium"
                />
                {tinCertificate && (
                  <span className="block text-[11px] text-blue-600 mt-1">📄 {tinCertificate.name}</span>
                )}
              </label>
                </div>
              )}
            </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full mt-6 bg-blue-600 text-white p-2.5 sm:p-3 rounded-lg hover:bg-blue-700 font-semibold transition shadow-md text-sm sm:text-base disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading
                ? t("auth.creatingAccount")
                : wantBusiness
                  ? t("auth.createAccountAndBusiness")
                  : t("auth.createAccount")}
            </button>
          </form>

          <p className="text-center text-xs text-gray-400 mt-5">
            {t("auth.haveAccount")}{" "}
            <Link href="/login" className="text-blue-600 hover:underline">
              {t("auth.signIn")}
            </Link>
          </p>
        </div>
        </div>
      </div>
      <AiAssistWidget />
    </div>
  );
}
