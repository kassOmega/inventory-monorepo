"use client";

import PublicHeader from "@/app/components/PublicHeader";
import AiAssistWidget from "@/app/components/AiAssistWidget";
import { useAuth } from "@/context/AuthContext";
import Link from "next/link";
import { useTranslation } from "react-i18next";

const MODULES: [string, string][] = [
  ["landing.mInventory", "landing.mInventoryD"],
  ["landing.mSales", "landing.mSalesD"],
  ["landing.mProducts", "landing.mProductsD"],
  ["landing.mLocations", "landing.mLocationsD"],
  ["landing.mRestock", "landing.mRestockD"],
  ["landing.mRequests", "landing.mRequestsD"],
  ["landing.mCustomers", "landing.mCustomersD"],
  ["landing.mHospitality", "landing.mHospitalityD"],
  ["landing.mFinance", "landing.mFinanceD"],
  ["landing.mTaxes", "landing.mTaxesD"],
  ["landing.mReports", "landing.mReportsD"],
  ["landing.mUsers", "landing.mUsersD"],
];

const RETAIL_STEPS = [
  "landing.retailStep1",
  "landing.retailStep2",
  "landing.retailStep3",
  "landing.retailStep4",
  "landing.retailStep5",
  "landing.retailStep6",
];

const HOSP_STEPS = [
  "landing.hospStep1",
  "landing.hospStep2",
  "landing.hospStep3",
  "landing.hospStep4",
  "landing.hospStep5",
];

const AUDIENCES: [string, string][] = [
  ["landing.whoRetail", "landing.whoRetailD"],
  ["landing.whoDist", "landing.whoDistD"],
  ["landing.whoHosp", "landing.whoHospD"],
];

const BENEFITS = [
  "landing.bRealtime",
  "landing.bAccountable",
  "landing.bMoney",
  "landing.bBilingual",
  "landing.bFiscal",
  "landing.bReports",
];

export default function LandingPage() {
  const { t } = useTranslation();
  const { user, isLoading } = useAuth();

  return (
    <div className="min-h-screen bg-white text-gray-800">
      <PublicHeader showLinks />
      <section id="top" className="bg-slate-900 text-white">
        <div className="mx-auto max-w-5xl px-4 py-20 text-center sm:py-24">
          <div className="mb-5 flex flex-wrap items-center justify-center gap-2 text-xs font-medium">
            <span className="rounded-full bg-white/10 px-3 py-1">
              {t("landing.heroChip1")}
            </span>
            <span className="rounded-full bg-white/10 px-3 py-1">
              {t("landing.heroChip2")}
            </span>
            <span className="rounded-full bg-white/10 px-3 py-1">
              {t("landing.heroChip3")}
            </span>
          </div>
          <h1 className="mx-auto max-w-3xl text-3xl font-bold leading-tight sm:text-5xl">
            {t("landing.heroTitle")}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-gray-300 sm:text-lg">
            {t("landing.heroSub")}
          </p>
          {!isLoading && !user && (
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/signup"
                className="rounded-xl bg-emerald-500 px-6 py-3 font-semibold text-white hover:bg-emerald-400"
              >
                {t("landing.getStarted")}
              </Link>
              <Link
                href="/login"
                className="rounded-xl border border-white/30 px-6 py-3 font-semibold text-white hover:bg-white/10"
              >
                {t("landing.signIn")}
              </Link>
            </div>
          )}
        </div>
      </section>

      <section id="modules" className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-2xl font-bold sm:text-3xl">
          {t("landing.modulesTitle")}
        </h2>
        <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map(([title, desc]) => (
            <div
              key={title}
              className="rounded-xl border border-gray-200 bg-white p-2 shadow-sm transition hover:border-emerald-300 hover:shadow-md"
            >
              <h3 className="text-base font-semibold text-gray-900">
                {t(title)}
              </h3>
              <p className="mt-1.5 text-sm text-gray-500">{t(desc)}</p>
            </div>
          ))}
        </div>
      </section>
      <section id="how" className="bg-gray-50 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-2xl font-bold sm:text-3xl">
            {t("landing.howTitle")}
          </h2>
          <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-lg font-semibold">
                {t("landing.retailTitle")}
              </h3>
              <ol className="space-y-3">
                {RETAIL_STEPS.map((step, idx) => (
                  <li key={step} className="flex gap-3 text-sm text-gray-600">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                      {idx + 1}
                    </span>
                    <span>{t(step)}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="mb-4 text-lg font-semibold">
                {t("landing.hospTitle")}
              </h3>
              <ol className="space-y-3">
                {HOSP_STEPS.map((step, idx) => (
                  <li key={step} className="flex gap-3 text-sm text-gray-600">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                      {idx + 1}
                    </span>
                    <span>{t(step)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      <section id="who" className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-2xl font-bold sm:text-3xl">
          {t("landing.whoTitle")}
        </h2>
        <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-3">
          {AUDIENCES.map(([title, desc]) => (
            <div
              key={title}
              className="rounded-xl border border-gray-200 p-2 text-center shadow-sm"
            >
              <h3 className="text-base font-semibold text-gray-900">
                {t(title)}
              </h3>
              <p className="mt-2 text-sm text-gray-500">{t(desc)}</p>
            </div>
          ))}
        </div>
      </section>
      <section id="benefits" className="bg-slate-900 py-16 text-white">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-2xl font-bold sm:text-3xl">
            {t("landing.helpTitle")}
          </h2>
          <ul className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {BENEFITS.map((b) => (
              <li
                key={b}
                className="rounded-xl border border-white/10 bg-white/5 p-2 text-sm leading-relaxed text-gray-200"
              >
                <span className="mr-2 text-emerald-400">✓</span>
                {t(b)}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h2 className="text-2xl font-bold sm:text-3xl">
          {t("landing.ctaTitle")}
        </h2>
        <p className="mt-3 text-gray-500">{t("landing.ctaSub")}</p>
        {!isLoading && !user && (
          <Link
            href="/signup"
            className="mt-6 inline-block rounded-xl bg-emerald-600 px-6 py-3 font-semibold text-white hover:bg-emerald-500"
          >
            {t("landing.getStarted")}
          </Link>
        )}
      </section>

      <footer className="border-t border-gray-200 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-sm text-gray-400 sm:flex-row">
          <div>
            <p className="font-semibold text-gray-700">
              {t("app.nameFull")} — {t("landing.footerTag")}
            </p>
            <p className="mt-1">
              © {new Date().getFullYear()} {t("app.name")}.{" "}
              {t("landing.rights")}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login" className="hover:text-gray-600">
              {t("landing.signIn")}
            </Link>
            <Link href="/signup" className="hover:text-gray-600">
              {t("landing.getStarted")}
            </Link>
          </div>
        </div>
      </footer>
      <AiAssistWidget />
    </div>
  );
}
