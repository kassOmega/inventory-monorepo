"use client";

import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import LanguageSwitcher from "@/app/components/LanguageSwitcher";
import { useTranslation } from "react-i18next";

/**
 * Shared public header (dark slate) used by the landing, login and signup
 * pages so the brand + language switch stay consistent everywhere.
 */
export default function PublicHeader({
  showLinks = false,
  showAuthActions = true,
}: {
  showLinks?: boolean;
  showAuthActions?: boolean;
}) {
  const { t } = useTranslation();
  const { user, isLoading } = useAuth();

  return (
    <header className="sticky top-0 z-40 bg-slate-900 text-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <a href="/" className="text-lg font-bold tracking-tight">
          {t("app.name")}
        </a>
        {showLinks && (
          <nav className="hidden items-center gap-6 text-sm text-gray-300 md:flex">
            <a href="#modules" className="hover:text-white">{t("landing.navModules")}</a>
            <a href="#how" className="hover:text-white">{t("landing.navHow")}</a>
            <a href="#who" className="hover:text-white">{t("landing.navWho")}</a>
            <a href="#benefits" className="hover:text-white">{t("landing.navFeatures")}</a>
          </nav>
        )}
        <div className="flex items-center gap-3">
          <LanguageSwitcher variant="light" />
          {showAuthActions && !isLoading && user && (
            <Link
              href="/dashboard"
              className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-400"
            >
              {t("landing.openDashboard")}
            </Link>
          )}
          {showAuthActions && !isLoading && !user && (
            <>
              <Link
                href="/login"
                className="hidden rounded-lg px-3 py-1.5 text-sm text-gray-200 hover:text-white sm:block"
              >
                {t("landing.signIn")}
              </Link>
              <Link
                href="/signup"
                className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-400"
              >
                {t("landing.getStarted")}
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
