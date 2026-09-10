"use client";

import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { useCallback, useEffect, useRef, useState } from "react";

// Public VAPID key (must match the backend's VAPID_PUBLIC_KEY — a mismatch
// makes the push service reject every send with a 401).
const VAPID_PUBLIC =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
  "BJlyIPasYpzqihbUZwAvqWvjjqyGQ4xOd8NgbF1bWusj4fhue_YF-FH5XuWGVwadwaCeYPPtu1GKEVwCyA-sVK0";

// Fingerprint used to detect VAPID key rotation and re-subscribe automatically.
const VAPID_FINGERPRINT_STORAGE = "push-vapid-fingerprint";
const currentVapidFingerprint = VAPID_PUBLIC.slice(-32);

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const raw = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(raw);
  return new Uint8Array([...rawData].map((c) => c.charCodeAt(0)));
}

export default function PwaRegistry() {
  const { user } = useAuth();
  const [pushIssue, setPushIssue] = useState<string | null>(null);
  const [enableVisible, setEnableVisible] = useState(false);
  const subscribedOnce = useRef(false);

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

  /**
   * Evaluate the permission state and act accordingly. It never prompts by
   * itself — browsers require a user gesture for the permission dialog. When
   * permission is already granted we (re)subscribe quietly on load/focus.
   */
  const refreshPushState = useCallback(
    async (opts?: { prompt?: boolean }) => {
      if (!user || !pushSupported || typeof Notification === "undefined") return;

      const permission = Notification.permission;
      if (permission === "granted") {
        setEnableVisible(false);
        try {
          await persistSubscription();
        } catch (e: any) {
          console.error("[push] Push subscription failed:", e);
          setPushIssue(
            e?.message || "Push setup failed — check the browser console.",
          );
        }
        return;
      }

      if (permission === "denied") {
        // Do not nag automatically — only explain if the user explicitly tries
        // to enable notifications again.
        setEnableVisible(false);
        return;
      }

      // "default" (never asked / prompt suppressed): show an enable button so
      // the permission request happens inside a real click handler.
      if (opts?.prompt) {
        try {
          const next = await Notification.requestPermission();
          if (next === "granted") {
            setEnableVisible(false);
            await persistSubscription();
          } else {
            setPushIssue(
              "Notification permission was not granted. Enable it in the site's notification settings to receive push notifications.",
            );
          }
        } catch (e: any) {
          console.error("[push] Notification permission request failed:", e);
          setPushIssue(
            e?.message || "Push setup failed — check the browser console.",
          );
        }
        return;
      }
      setEnableVisible(true);
    },
    [persistSubscription, pushSupported, user],
  );

  useEffect(() => {
    if (!user) return;
    refreshPushState();

    // Retry silently (no prompt) whenever the user returns to the app or the
    // page regains focus — never re-nag after a previous success/denial.
    const retry = () => {
      if (!subscribedOnce.current) refreshPushState();
    };
    window.addEventListener("focus", retry);
    document.addEventListener("visibilitychange", retry);

    return () => {
      window.removeEventListener("focus", retry);
      document.removeEventListener("visibilitychange", retry);
    };
  }, [refreshPushState, user]);

  // Auto-dismiss the diagnostic banner after a short while.
  useEffect(() => {
    if (!pushIssue) return;
    const t = setTimeout(() => setPushIssue(null), 10000);
    return () => clearTimeout(t);
  }, [pushIssue]);

  if (!pushIssue && !enableVisible) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-2">
      {enableVisible && (
        <button
          type="button"
          onClick={() => refreshPushState({ prompt: true })}
          className="bg-blue-600 text-white text-xs sm:text-sm px-4 py-2 rounded-lg shadow-lg font-medium hover:bg-blue-700"
        >
          🔔 Enable notifications
        </button>
      )}
      {pushIssue && (
        <div className="bg-red-600 text-white text-xs sm:text-sm px-4 py-2 rounded-lg shadow-lg max-w-sm text-center">
          ⚠️ Push notifications unavailable: {pushIssue}
        </div>
      )}
    </div>
  );
}

