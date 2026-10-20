// Platform detection and lightweight install analytics for the PWA.
//
// Installation itself is always controlled by the browser/OS. This module only
// helps the UI show the right instructions for the device in front of the user.

export type InstallPlatform =
  | "ios"
  | "ipados"
  | "android"
  | "windows"
  | "macos"
  | "linux"
  | "other";

export type InstallBrowser =
  | "safari"
  | "chrome"
  | "edge"
  | "firefox"
  | "samsung"
  | "opera"
  | "other";

export interface InstallEnvironment {
  platform: InstallPlatform;
  browser: InstallBrowser;
  isIos: boolean;
  isAndroid: boolean;
  isMacSafari: boolean;
  isChromium: boolean;
  isStandalone: boolean;
  isMobile: boolean;
}

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    /**
     * Captured by the early bootstrap script in app/layout.tsx. Chrome can fire
     * `beforeinstallprompt` before React mounts; storing it on `window` means
     * the install button can still use it afterwards.
     */
    __kassInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

/** iPadOS 13+ reports itself as a Mac, so touch support is the giveaway. */
function isIosLike(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return true;
  return /macintosh|mac os x/.test(ua) && window.navigator.maxTouchPoints > 1;
}

function detectBrowser(ua: string): InstallBrowser {
  if (/edg|edgios|edga/.test(ua)) return "edge";
  if (/opr\/|opios/.test(ua)) return "opera";
  if (/samsungbrowser/.test(ua)) return "samsung";
  if (/fxios|firefox/.test(ua)) return "firefox";
  if (/crios|chrome|chromium/.test(ua)) return "chrome";
  if (/safari/.test(ua)) return "safari";
  return "other";
}

function detectPlatform(ua: string, iosLike: boolean): InstallPlatform {
  if (iosLike) {
    return /ipad/.test(ua) || (/macintosh|mac os x/.test(ua) && window.navigator.maxTouchPoints > 1)
      ? "ipados"
      : "ios";
  }
  if (/android/.test(ua)) return "android";
  if (/windows|win32|win64/.test(ua)) return "windows";
  if (/macintosh|mac os x/.test(ua)) return "macos";
  if (/linux|x11/.test(ua)) return "linux";
  return "other";
}

export function isStandaloneMode(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

export function detectInstallEnvironment(): InstallEnvironment {
  if (typeof window === "undefined") {
    return {
      platform: "other",
      browser: "other",
      isIos: false,
      isAndroid: false,
      isMacSafari: false,
      isChromium: false,
      isStandalone: false,
      isMobile: false,
    };
  }

  const ua = window.navigator.userAgent.toLowerCase();
  const iosLike = isIosLike();
  const platform = detectPlatform(ua, iosLike);
  const browser = detectBrowser(ua);
  const isIos = platform === "ios" || platform === "ipados";
  const isAndroid = platform === "android";
  const isChromium =
    browser === "chrome" ||
    browser === "edge" ||
    browser === "samsung" ||
    browser === "opera";

  return {
    platform,
    browser,
    isIos,
    isAndroid,
    isMacSafari: platform === "macos" && browser === "safari",
    isChromium,
    isStandalone: isStandaloneMode(),
    isMobile: isIos || isAndroid,
  };
}

export type InstallEventName =
  | "install_button_click"
  | "install_prompt_available"
  | "install_prompt_shown"
  | "install_prompt_accepted"
  | "install_prompt_dismissed"
  | "install_help_opened"
  | "install_page_view"
  | "install_link_copied"
  | "app_installed";

/**
 * Fire an install analytics event without making installation depend on it.
 *
 * The event is always dispatched as a DOM CustomEvent (`kass:install`) so the
 * host app can plug in its own analytics. If
 * NEXT_PUBLIC_INSTALL_ANALYTICS_ENDPOINT is set, it is also queued as a
 * best-effort beacon/fetch. Analytics failures are intentionally swallowed.
 */
export function trackInstallEvent(
  event: InstallEventName,
  data: Record<string, unknown> = {},
): void {
  if (typeof window === "undefined") return;

  const payload = {
    event,
    path: window.location.pathname,
    at: new Date().toISOString(),
    ...data,
  };

  try {
    window.dispatchEvent(new CustomEvent("kass:install", { detail: payload }));
  } catch {
    // Never let analytics break the install flow.
  }

  if (process.env.NODE_ENV !== "production") {
    console.debug("[install]", payload);
  }

  const endpoint = process.env.NEXT_PUBLIC_INSTALL_ANALYTICS_ENDPOINT;
  if (!endpoint) return;

  try {
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Analytics must never interfere with the app.
  }
}
