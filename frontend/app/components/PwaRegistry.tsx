"use client";

import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

// Public VAPID key (must match the backend's VAPID_PUBLIC_KEY — a mismatch
// makes the push service reject every send with a 401).
const VAPID_PUBLIC =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
  "BJlyIPasYpzqihbUZwAvqWvjjqyGQ4xOd8NgbF1bWusj4fhue_YF-FH5XuWGVwadwaCeYPPtu1GKEVwCyA-sVK0";

// Fingerprint used to detect VAPID key rotation and re-subscribe automatically.
const VAPID_FINGERPRINT_STORAGE = "push-vapid-fingerprint";
const currentVapidFingerprint = VAPID_PUBLIC.slice(-32);

// System-alert permission is requested exactly once per device. Browsers only
// honour the request from inside a real user gesture and a denial can never be
// undone from JavaScript, so there is deliberately no "enable notifications"
// button: the first tap/key press anywhere in the dashboard triggers it.
const PROMPT_ATTEMPTED_STORAGE = "push-prompt-attempted-at";
// The "system alerts are blocked" hint is shown once per device.
const BLOCKED_HINT_STORAGE = "push-blocked-hint-seen";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const raw = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(raw);
  return new Uint8Array([...rawData].map((c) => c.charCodeAt(0)));
}

/** Human-readable message for an unknown thrown value. */
function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export default function PwaRegistry() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [pushIssue, setPushIssue] = useState<string | null>(null);
  const [blockedHint, setBlockedHint] = useState(false);
  const subscribedOnce = useRef(false);
  const prompting = useRef(false);

  // Register the service worker once (production only, unless explicitly enabled).
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (
      process.env.NODE_ENV !== "production" &&
      !process.env.NEXT_PUBLIC_ENABLE_PUSH
    ) {
      // Development: the app never registers a worker here, but a stale worker
      // from an earlier production build may still be controlling the page and
      // serving an outdated shell (breaking hard refreshes). Remove it.
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => {
          for (const reg of regs) reg.unregister();
        })
        .catch(() => undefined);
      if (window.caches) {
        caches
          .keys()
          .then((names) =>
            Promise.all(
              names
                .filter(
                  (name) =>
                    name.startsWith("workbox-precache-") ||
                    name.startsWith("next-pwa-"),
                )
                .map((name) => caches.delete(name)),
            ),
          )
          .catch(() => undefined);
      }
      return;
    }
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((err) => console.error("[push] Service worker registration failed:", err));
  }, []);

  // Push is only available when the service worker + PushManager exist and the
  // environment explicitly enables it (production, or dev with the env flag).
  const pushSupported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    (process.env.NODE_ENV === "production" ||
      !!process.env.NEXT_PUBLIC_ENABLE_PUSH);

  /** Create/reuse the browser subscription and store it on the backend. */
  const persistSubscription = useCallback(async () => {
    const reg = await navigator.serviceWorker.ready;

    // Key rotation self-healing: if the VAPID key changed since the last
    // subscription (or we have never recorded one), drop the old subscription
    // so a fresh one is created with the current key.
    const existing = await reg.pushManager.getSubscription();
    const storedFp = localStorage.getItem(VAPID_FINGERPRINT_STORAGE);
    if (existing && storedFp !== currentVapidFingerprint) {
      console.info("[push] VAPID key changed — unsubscribing stale subscription.");
      await existing.unsubscribe();
    }

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
    });
    localStorage.setItem(VAPID_FINGERPRINT_STORAGE, currentVapidFingerprint);
    await api.post("/push/subscribe", sub.toJSON());
    subscribedOnce.current = true;
    setPushIssue(null);
    console.info(`[push] Subscription active for user ${user?.id}.`);
  }, [user]);

  /** The browser will not ask again — explain how to allow system alerts. */
  const showBlockedHintOnce = useCallback(() => {
    if (localStorage.getItem(BLOCKED_HINT_STORAGE)) return;
    setBlockedHint(true);
  }, []);

  /**
   * Ask the browser for notification permission. This MUST run synchronously
   * from inside a user-gesture handler (pointerdown / keydown / touchstart):
   * Chrome quietly drops requests made outside one, and Firefox/Safari ignore
   * them completely. Runs at most once per device.
   */
  const promptOnce = useCallback(async () => {
    if (!user || !pushSupported || typeof Notification === "undefined") return;
    if (Notification.permission !== "default") return;
    if (prompting.current) return;
    prompting.current = true;
    try {
      const next = await Notification.requestPermission();
      localStorage.setItem(PROMPT_ATTEMPTED_STORAGE, String(Date.now()));
      if (next === "granted") {
        await persistSubscription();
      } else {
        // "default" here means the prompt was dismissed, "denied"/"blocked"
        // means it was refused — either way we never ask again.
        showBlockedHintOnce();
      }
    } catch (e) {
      console.error("[push] Notification permission request failed:", e);
      setPushIssue(
        errorMessage(e, "Push setup failed — check the browser console."),
      );
    } finally {
      prompting.current = false;
    }
  }, [persistSubscription, pushSupported, showBlockedHintOnce, user]);

  /**
   * Never prompts: (re)subscribes quietly when permission is already granted and
   * surfaces the blocked hint when the browser refuses to ask again.
   */
  const evaluatePushState = useCallback(async () => {
    if (!user || !pushSupported || typeof Notification === "undefined") return;

    const permission = Notification.permission as string;
    if (permission === "granted") {
      try {
        await persistSubscription();
      } catch (e) {
        console.error("[push] Push subscription failed:", e);
        setPushIssue(
          errorMessage(e, "Push setup failed — check the browser console."),
        );
      }
      return;
    }

    if (permission === "denied" || permission === "blocked") {
      showBlockedHintOnce();
    }
  }, [persistSubscription, pushSupported, showBlockedHintOnce, user]);

  // Request permission on the user's very first interaction with the app.
  useEffect(() => {
    if (!user || !pushSupported || typeof Notification === "undefined") return;
    if (Notification.permission !== "default") return;
    if (localStorage.getItem(PROMPT_ATTEMPTED_STORAGE)) return;

    const events: Array<keyof DocumentEventMap> = [
      "pointerdown",
      "keydown",
      "touchstart",
    ];
    const opts: AddEventListenerOptions = { capture: true, passive: true };
    let armed = true;
    function onFirstInteraction() {
      detach();
      void promptOnce();
    }
    function detach() {
      if (!armed) return;
      armed = false;
      for (const name of events) {
        document.removeEventListener(name, onFirstInteraction, opts);
      }
    }

    for (const name of events) {
      document.addEventListener(name, onFirstInteraction, opts);
    }
    return detach;
  }, [promptOnce, pushSupported, user]);

  useEffect(() => {
    if (!user) return;
    // Deferred one tick so the effect never sets state during the commit.
    const initial = setTimeout(() => void evaluatePushState(), 0);

    // Retry silently (no prompt) whenever the user returns to the app or the
    // page regains focus — never re-nag after a previous success/denial.
    const retry = () => {
      if (!subscribedOnce.current) evaluatePushState();
    };
    window.addEventListener("focus", retry);
    document.addEventListener("visibilitychange", retry);

    return () => {
      clearTimeout(initial);
      window.removeEventListener("focus", retry);
      document.removeEventListener("visibilitychange", retry);
    };
  }, [evaluatePushState, user]);

  // Auto-dismiss the diagnostic banner after a short while.
  useEffect(() => {
    if (!pushIssue) return;
    const timer = setTimeout(() => setPushIssue(null), 10000);
    return () => clearTimeout(timer);
  }, [pushIssue]);

  const dismissBlockedHint = () => {
    localStorage.setItem(BLOCKED_HINT_STORAGE, String(Date.now()));
    setBlockedHint(false);
  };

  if (!pushIssue && !blockedHint) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-2 px-3 w-[calc(100%-1.5rem)] sm:w-auto">
      {blockedHint && (
        <div className="bg-slate-800 text-white text-xs sm:text-sm px-4 py-3 rounded-lg shadow-lg max-w-md flex items-start gap-3">
          <span aria-hidden>🔕</span>
          <p className="flex-1">{t("notifications.blockedHint")}</p>
          <button
            type="button"
            onClick={dismissBlockedHint}
            aria-label={t("notifications.dismiss")}
            className="flex-shrink-0 text-slate-300 hover:text-white text-lg leading-none"
          >
            ×
          </button>
        </div>
      )}
      {pushIssue && (
        <div className="bg-red-600 text-white text-xs sm:text-sm px-4 py-2 rounded-lg shadow-lg max-w-sm text-center">
          ⚠️ Push notifications unavailable: {pushIssue}
        </div>
      )}
    </div>
  );
}

