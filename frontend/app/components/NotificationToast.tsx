"use client";

import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  productId: number | null;
  locationId: number | null;
  isRead: boolean;
  createdAt: string;
}

// How often to poll for new notifications.
const POLL_INTERVAL_MS = 15000;
// How long each popup stays on screen before auto-dismissing.
const POPUP_TTL_MS = 8000;

function getIcon(type: string) {
  switch (type) {
    case "LOW_STOCK":
      return "⚠️";
    case "REQUEST_STATUS":
      return "📦";
    default:
      return "🔔";
  }
}

function getLink(n: Notification) {
  if (n.type === "REQUEST_STATUS") return "/dashboard/requests";
  if (n.type === "LOW_STOCK") return "/dashboard/reports?tab=low-stock";
  return null;
}

/**
 * Popup that appears the moment a NEW notification arrives (via polling or
 * returning to the tab). Existing notifications are seeded silently so the
 * popup only fires for genuinely new ones.
 */
export default function NotificationToast() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const [popups, setPopups] = useState<Notification[]>([]);
  const seenIds = useRef<Set<number>>(new Set());
  const initialized = useRef(false);

  const checkForNew = useCallback(async () => {
    if (!user) return;
    try {
      const res = await api.get("/notifications");
      const list: Notification[] = res.data || [];

      // First load: remember what already exists so we don't popup for old items.
      if (!initialized.current) {
        list.forEach((n) => seenIds.current.add(n.id));
        initialized.current = true;
        return;
      }

      const fresh = list
        .filter((n) => !seenIds.current.has(n.id))
        .sort((a, b) => a.id - b.id)
        .slice(0, 3);

      if (fresh.length === 0) return;

      fresh.forEach((n) => seenIds.current.add(n.id));
      setPopups((prev) => [...prev, ...fresh]);

      // Auto-dismiss each popup after the TTL.
      fresh.forEach((n) => {
        setTimeout(
          () => setPopups((prev) => prev.filter((p) => p.id !== n.id)),
          POPUP_TTL_MS,
        );
      });

      // When the tab is in the background, also fire a system notification
      // (the user may not be looking at the app).
      if (
        typeof document !== "undefined" &&
        document.hidden &&
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        const latest = fresh[fresh.length - 1];
        new Notification(latest.title, { body: latest.message });
      }
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    checkForNew();

    // Poll-based updates only. EventSource cannot attach the Bearer token used
    // by this app's API, so opening /notifications/stream would 401 on every
    // attempt. Polling + tab-visibility refreshes keep the toast in sync.
    const interval = setInterval(checkForNew, POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === "visible") checkForNew();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, [user, checkForNew]);

  if (popups.length === 0) return null;

  return (
    <div className="fixed top-2 right-2 left-2 sm:top-4 sm:right-4 sm:left-auto z-[100] max-w-sm flex flex-col gap-2">
      {popups.map((n) => {
        const link = getLink(n);
        return (
          <div
            key={n.id}
            onClick={() => {
              if (link) router.push(link);
              setPopups((prev) => prev.filter((p) => p.id !== n.id));
            }}
            className="bg-amber-50 border border-amber-300 rounded-xl shadow-lg p-4 flex items-start gap-3 cursor-pointer"
          >
            <span className="text-2xl flex-shrink-0">{getIcon(n.type)}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-900">{n.title}</p>
              <p className="text-xs text-amber-700 mt-0.5 line-clamp-2">
                {n.message}
              </p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setPopups((prev) => prev.filter((p) => p.id !== n.id));
              }}
              className="flex-shrink-0 text-amber-400 hover:text-amber-600 text-lg leading-none"
              aria-label={t("notifications.dismiss")}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

