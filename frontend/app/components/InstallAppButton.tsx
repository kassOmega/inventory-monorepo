"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type InstallVariant = "sidebar" | "header" | "cta";

/** Presentation per surface; the sidebar keeps the original dashboard styling. */
const VARIANT_CLASSES: Record<InstallVariant, string> = {
  sidebar:
    "w-full text-left text-sm py-2 px-4 rounded text-blue-300 hover:bg-gray-800",
  header:
    "inline-flex items-center rounded-lg border border-white/30 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/10",
  cta: "inline-flex items-center rounded-xl border border-white/30 px-6 py-3 font-semibold text-white hover:bg-white/10",
};

/** iPadOS 13+ reports itself as a Mac, so touch support is the giveaway. */
function isIosLike(): boolean {
  const ua = window.navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return true;
  return /macintosh|mac os x/.test(ua) && window.navigator.maxTouchPoints > 1;
}

/** Only Safari on iOS can install a PWA (Chrome/Firefox/Edge there cannot). */
function isIosSafari(): boolean {
  if (!isIosLike()) return false;
  return !/crios|fxios|edgios|opios/.test(window.navigator.userAgent.toLowerCase());
}

function isStandaloneMode(): boolean {
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

/**
 * "Download the app" — installs the PWA (Android/Chrome "Install app", iOS
 * "Add to Home Screen"). No sign-in is required to install.
 *
 * `alwaysVisible` is used on the public pages so a logged-out visitor always
 * gets a button: when the browser never fires `beforeinstallprompt` (Firefox and
 * Safari on desktop, or any dev server without a service worker) the button
 * still shows and explains the manual steps instead of silently disappearing.
 */
export default function InstallAppButton({
  variant = "sidebar",
  alwaysVisible = false,
}: {
  variant?: InstallVariant;
  alwaysVisible?: boolean;
}) {
  const { t } = useTranslation();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [iosSafari, setIosSafari] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    setIsIos(isIosLike());
    setIosSafari(isIosSafari());
    setIsStandalone(isStandaloneMode());

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setIsStandalone(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Already installed (running standalone) — nothing left to offer.
  if (isStandalone) return null;

  // The dashboard keeps its original behaviour (only offer install once the
  // browser handed us a native prompt); public pages pass alwaysVisible.
  const showButton = alwaysVisible || !!deferred || isIos;
  if (!showButton) return null;

  const handleInstall = async () => {
    if (!deferred) {
      // No native prompt available — explain the manual route instead.
      setShowHelp(true);
      return;
    }
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
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
          className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="bg-white rounded-xl p-6 max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold mb-2 text-gray-800">
              {isIos ? t("install.iosTitle") : t("install.desktopTitle")}
            </h3>
            {isIos ? (
              <>
                <ol className="text-sm text-gray-600 list-decimal pl-4 space-y-1">
                  <li>{t("install.iosStep1")}</li>
                  <li>{t("install.iosStep2")}</li>
                  <li>{t("install.iosStep3")}</li>
                </ol>
                {!iosSafari && (
                  <p className="mt-3 text-xs text-amber-600">
                    {t("install.iosSafariOnly")}
                  </p>
                )}
              </>
            ) : (
              <>
                <ol className="text-sm text-gray-600 list-decimal pl-4 space-y-1">
                  <li>{t("install.desktopStep1")}</li>
                  <li>{t("install.desktopStep2")}</li>
                  <li>{t("install.desktopStep3")}</li>
                </ol>
                <p className="mt-3 text-xs text-gray-400">
                  {t("install.unsupported")}
                </p>
              </>
            )}
            <button
              onClick={() => setShowHelp(false)}
              className="mt-4 bg-blue-600 text-white px-4 py-2 rounded text-sm"
            >
              {t("install.close")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
