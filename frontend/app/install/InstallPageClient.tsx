"use client";

import PublicFooter from "@/app/components/PublicFooter";
import PublicHeader from "@/app/components/PublicHeader";
import InstallAppButton from "@/app/components/InstallAppButton";
import { QRCodeSVG } from "qrcode.react";
import {
  Laptop,
  Monitor,
  Smartphone,
  Tablet,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  detectInstallEnvironment,
  trackInstallEvent,
  type InstallEnvironment,
} from "@/lib/install";

interface PlatformCard {
  key: string;
  icon: LucideIcon;
  title: string;
  steps: string[];
  note?: string;
}

export default function InstallPageClient() {
  const { t } = useTranslation();
  const [installUrl, setInstallUrl] = useState("");
  const [environment, setEnvironment] = useState<InstallEnvironment | null>(null);
  const [installed, setInstalled] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const detected = detectInstallEnvironment();
    // Deferred one tick so the effect never sets state during the commit.
    const initial = window.setTimeout(() => {
      setEnvironment(detected);
      setInstalled(detected.isStandalone);
      setInstallUrl(`${window.location.origin}/install`);
      trackInstallEvent("install_page_view", {
        platform: detected.platform,
        browser: detected.browser,
        standalone: detected.isStandalone,
      });
    }, 0);
    return () => window.clearTimeout(initial);
  }, []);

  const cards: PlatformCard[] = useMemo(
    () => [
      {
        key: "android",
        icon: Smartphone,
        title: t("install.androidTitle"),
        steps: [
          t("install.androidStep1"),
          t("install.androidStep2"),
          t("install.androidStep3"),
        ],
      },
      {
        key: "ios",
        icon: Tablet,
        title: t("install.iosTitle"),
        steps: [
          t("install.iosStep1"),
          t("install.iosStep2"),
          t("install.iosStep3"),
        ],
        note: t("install.ios26"),
      },
      {
        key: "windows",
        icon: Monitor,
        title: t("install.windowsTitle"),
        steps: [
          t("install.windowsStep1"),
          t("install.windowsStep2"),
          t("install.windowsStep3"),
        ],
      },
      {
        key: "macos",
        icon: Laptop,
        title: t("install.macosTitle"),
        steps: [t("install.macosStep1"), t("install.macosStep2")],
      },
      {
        key: "linux",
        icon: Terminal,
        title: t("install.linuxTitle"),
        steps: [
          t("install.linuxStep1"),
          t("install.linuxStep2"),
          t("install.linuxStep3"),
        ],
      },
    ],
    [t],
  );

  const copyLink = async () => {
    if (!installUrl) return;
    try {
      await navigator.clipboard.writeText(installUrl);
    } catch {
      // Older browsers / non-secure contexts: fall back to a temporary textarea.
      const input = document.createElement("textarea");
      input.value = installUrl;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
    }
    setCopied(true);
    trackInstallEvent("install_link_copied", {
      platform: environment?.platform,
      browser: environment?.browser,
    });
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <PublicHeader />

      <section className="bg-slate-900 text-white">
        <div className="mx-auto max-w-5xl px-4 py-12 sm:py-14">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-200">
            {t("app.nameFull")}
          </p>
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">
            {t("install.pageTitle")}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-gray-300 sm:text-base">
            {t("install.pageSubtitle")}
          </p>
          <p className="mt-4 text-xs text-blue-200">{t("install.oneTapNote")}</p>
        </div>
      </section>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:py-10">
        <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-lg font-bold">{t("install.qrTitle")}</h2>
            <p className="mt-1 text-sm text-gray-500">{t("install.qrHint")}</p>
            <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-center">
              <div
                role="img"
                aria-label={t("install.qrTitle")}
                className="flex h-[192px] w-[192px] shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white p-3"
              >
                {installUrl ? (
                  <QRCodeSVG value={installUrl} size={168} includeMargin />
                ) : (
                  <div className="h-full w-full animate-pulse rounded bg-gray-100" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="break-all rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
                  {installUrl || "…"}
                </p>
                <button
                  type="button"
                  onClick={copyLink}
                  className="mt-3 inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  {copied ? `✓ ${t("install.copied")}` : t("install.copyLink")}
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-2xl bg-slate-900 p-5 text-white shadow-sm sm:p-6">
            <h2 className="text-lg font-bold">{t("install.label")}</h2>
            <p className="mt-1 text-sm leading-relaxed text-gray-300">
              {t("install.note")}
            </p>
            <div className="mt-5">
              <InstallAppButton
                variant="primary"
                alwaysVisible
                showInstalledState
              />
            </div>
            {installed ? (
              <p className="mt-3 text-xs text-emerald-300">
                {t("install.installedHint")}
              </p>
            ) : null}
          </section>
        </div>

        <div className="mt-8">
          <h2 className="text-lg font-bold">{t("install.openGuide")}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((card) => {
              const Icon = card.icon;
              return (
                <section
                  key={card.key}
                  className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <h3 className="text-sm font-bold">{card.title}</h3>
                  </div>
                  <ol className="mt-3 list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-gray-600">
                    {card.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                  {card.note ? (
                    <p className="mt-3 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800">
                      {card.note}
                    </p>
                  ) : null}
                </section>
              );
            })}
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-blue-100 bg-blue-50 p-4 text-xs leading-relaxed text-blue-900">
          <strong>{t("install.browserUnsupportedTitle")}:</strong>{" "}
          {t("install.browserUnsupported")}
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
