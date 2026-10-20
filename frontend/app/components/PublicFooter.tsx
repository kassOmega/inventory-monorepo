"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";

// Platform-level contact details shown on public pages. Update these when the
// support channel changes.
const CONTACT_EMAIL = "kass3me@gmail.com";
const CONTACT_PHONE = "+251924232022";
const DEVELOPER = "Kassahun Takele";

/** Marketing footer for public (unauthenticated) pages. */
export default function PublicFooter() {
  const { t } = useTranslation();

  return (
    <footer className="border-t border-white/10 bg-slate-900 pt-8 pb-0 text-gray-300">
      <div className="mx-auto max-w-5xl px-4 text-center pb-8">
        <p className="text-sm text-gray-200">{t("public.footerTagline")}</p>

        <p className="mx-auto mt-2 max-w-2xl text-xs text-gray-400">
          {t("public.footerHandles")}
        </p>

        <p className="mt-4 text-xs font-medium uppercase tracking-wide text-gray-500">
          {t("public.contactUs")}
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-gray-400">
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-white">
            {CONTACT_EMAIL}
          </a>
          <a
            href={`tel:${CONTACT_PHONE.replace(/\s/g, "")}`}
            className="hover:text-white"
          >
            {CONTACT_PHONE}
          </a>
        </div>

        <Link
          href="/signup"
          className="mt-4 inline-block rounded-lg bg-emerald-500 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-400"
        >
          {t("public.footerSignup")}
        </Link>
        <Link
          href="/install"
          className="mt-2 block text-xs text-gray-400 hover:text-white"
        >
          {t("install.label")}
        </Link>

        <p className="mt-4 text-[11px] text-gray-500">
          {t("public.developedBy", { name: DEVELOPER })} · ©{" "}
          {new Date().getFullYear()} {t("app.nameFull")}
        </p>
      </div>
    </footer>
  );
}
