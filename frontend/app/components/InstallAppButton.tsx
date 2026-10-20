"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  detectInstallEnvironment,
  trackInstallEvent,
  type BeforeInstallPromptEvent,
  type InstallEnvironment,
} from "@/lib/install";

type InstallVariant = "sidebar" | "header" | "cta" | "primary";

/** Presentation per surface; the sidebar keeps the original dashboard styling. */
const VARIANT_CLASSES: Record<InstallVariant, string> = {
  sidebar:
    "w-full text-left text-sm py-2 px-4 rounded text-blue-300 hover:bg-gray-800",
  header:
    "inline-flex items-center rounded-lg border border-white/30 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/10",
  cta: "inline-flex items-center rounded-xl border border-white/30 px-6 py-3 font-semibold text-white hover:bg-white/10",
  primary:
    "inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300",
};

/**
 * "Download the app" — installs the PWA where the browser supports a native
 * prompt (Android/Chrome/Edge) and shows the correct manual steps everywhere
 * else (notably Safari on iPhone/iPad, which has no install API).
 *
 * `alwaysVisible` is used on public pages so a logged-out visitor always gets a
 * button: when the browser never fires `beforeinstallprompt` the button still
 * shows and explains the right manual steps instead of silently disappearing.
 */
export default function InstallAppButton({
  variant = "sidebar",
  alwaysVisible = false,
  showInstalledState = false,
}: {
  variant?: InstallVariant;
  alwaysVisible?: boolean;
  /** On the /install page, show a confirmation instead of hiding the button. */
  showInstalledState?: boolean;
}) {
  const { t } = useTranslation();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [environment, setEnvironment] = useState<InstallEnvironment | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const detected = detectInstallEnvironment();
    let adoptedPrompt: BeforeInstallPromptEvent | null = null;

    const adoptPrompt = (promptEvent: BeforeInstallPromptEvent | null) => {
      if (!promptEvent || adoptedPrompt === promptEvent) return;
      adoptedPrompt = promptEvent;
      setDeferred(promptEvent);
      trackInstallEvent("install_prompt_available", {
        platform: detected.platform,
        browser: detected.browser,
      });
    };

    // Deferred one tick so the effect never sets state during the commit.
    const initial = window.setTimeout(() => {
      setEnvironment(detected);
      setIsStandalone(detected.isStandalone);
      adoptPrompt(window.__kassInstallPrompt ?? null);
    }, 0);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      // The early bootstrap listener has already stored this event and emitted
      // `kass:install-prompt-ready`; avoid adopting it twice.
      if (window.__kassInstallPrompt === promptEvent) return;
      window.__kassInstallPrompt = promptEvent;
      adoptPrompt(promptEvent);
    };
    const onPromptReady = () => {
      adoptPrompt(window.__kassInstallPrompt ?? null);
    };
    const onInstalled = () => {
      window.__kassInstallPrompt = null;
      adoptedPrompt = null;
      setDeferred(null);
      setIsStandalone(true);
      trackInstallEvent("app_installed", {
        platform: detected.platform,
        browser: detected.browser,
      });
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("kass:install-prompt-ready", onPromptReady);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.clearTimeout(initial);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("kass:install-prompt-ready", onPromptReady);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (isStandalone) {
    if (!showInstalledState) return null;
    return (
      <div className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-200">
        <span aria-hidden>✓</span>
        {t("install.installed")}
      </div>
    );
  }

  // Public pages and the dashboard sidebar pass alwaysVisible so the install
  // option stays discoverable even when the browser has no native prompt.
  const showButton = alwaysVisible || !!deferred || !!environment?.isIos;
  if (!showButton) return null;

  const env = environment ?? detectInstallEnvironment();
  const isIos = env.isIos;
  const isAndroid = env.isAndroid;
  const unsupported =
    !isIos && !isAndroid && !env.isChromium && env.platform !== "macos";

  const helpTitle = (() => {
    if (isIos) return t("install.iosTitle");
    if (unsupported) return t("install.browserUnsupportedTitle");
    if (isAndroid) return t("install.androidTitle");
    if (env.platform === "macos") return t("install.macosTitle");
    if (env.platform === "windows") return t("install.windowsTitle");
    if (env.platform === "linux") return t("install.linuxTitle");
    return t("install.desktopTitle");
  })();

  const helpSteps: string[] = (() => {
    if (isIos) {
      return [
        t("install.iosStep1"),
        t("install.iosStep2"),
        t("install.iosStep3"),
      ];
    }
    if (unsupported) return [];
    if (isAndroid) {
      return [
        t("install.androidStep1"),
        t("install.androidStep2"),
        t("install.androidStep3"),
      ];
    }
    if (env.platform === "macos") {
      return [t("install.macosStep1"), t("install.macosStep2")];
    }
    if (env.platform === "windows") {
      return [
        t("install.windowsStep1"),
        t("install.windowsStep2"),
        t("install.windowsStep3"),
      ];
    }
    if (env.platform === "linux") {
      return [
        t("install.linuxStep1"),
        t("install.linuxStep2"),
        t("install.linuxStep3"),
      ];
    }
    return [
      t("install.desktopStep1"),
      t("install.desktopStep2"),
      t("install.desktopStep3"),
    ];
  })();

  const helpNote = isIos
    ? env.browser === "safari"
      ? t("install.ios26")
      : t("install.iosSafariOnly")
    : unsupported
      ? t("install.browserUnsupported")
      : "";

  const handleInstall = async () => {
    trackInstallEvent("install_button_click", {
      platform: env.platform,
      browser: env.browser,
      standalone: isStandalone,
    });

    const promptEvent = deferred ?? window.__kassInstallPrompt ?? null;
    if (!promptEvent) {
      trackInstallEvent("install_help_opened", {
        platform: env.platform,
        browser: env.browser,
      });
      setShowHelp(true);
      return;
    }

    try {
      trackInstallEvent("install_prompt_shown", {
        platform: env.platform,
        browser: env.browser,
      });
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      trackInstallEvent(
        choice.outcome === "accepted"
          ? "install_prompt_accepted"
          : "install_prompt_dismissed",
        { platform: env.platform, browser: env.browser },
      );
      window.__kassInstallPrompt = null;
      setDeferred(null);
    } catch {
      // Some browsers invalidate the prompt if it is reused; fall back to steps.
      window.__kassInstallPrompt = null;
      setDeferred(null);
      setShowHelp(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleInstall}
        className={VARIANT_CLASSES[variant]}
      >
        <span aria-hidden className="mr-1.5">
          📥
        </span>
        {t("install.label")}
      </button>
      {showHelp && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowHelp(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-6 text-gray-800 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-help-title"
          >
            <h3 id="install-help-title" className="text-lg font-semibold">
              {helpTitle}
            </h3>
            <p className="mt-1 text-sm text-gray-500">{t("install.note")}</p>

            {helpSteps.length > 0 ? (
              <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-gray-600">
                {helpSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            ) : null}

            {helpNote ? (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {helpNote}
              </p>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <Link
                href="/install"
                onClick={() => setShowHelp(false)}
                className="text-sm font-medium text-blue-700 hover:underline"
              >
                {t("install.details")}
              </Link>
              <button
                type="button"
                onClick={() => setShowHelp(false)}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
              >
                {t("install.close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
