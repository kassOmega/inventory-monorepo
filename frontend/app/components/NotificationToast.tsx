"use client";

import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { playAlertSound } from "@/lib/alertSound";
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
// How long each transient popup stays on screen before auto-dismissing.
const POPUP_TTL_MS = 8000;
// Alert types that stay on screen until they are read.
const STICKY_TYPES = ["LOW_STOCK", "REQUEST_STATUS"];
// Favicon swap used for the unread badge.
const FAVICON_DEFAULT = "/icon.svg";
const FAVICON_BADGE = "/icon-badge.svg";

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
 * Tab-level badge: unread count in document.title plus a dot on the favicon.
 * This needs no browser permission at all, so a background tab still shows that
 * something needs attention even when the user blocked system notifications.
 */
function useTabBadge(unreadCount: number) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const base = document.title.replace(/^\(\d+\+?\)\s*/, "");
    document.title = unreadCount > 0 ? `(${unreadCount}) ${base}` : base;
  }, [unreadCount]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const links = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'),
    );
    if (links.length === 0) return;
    const svgLinks = links.filter((l) => (l.type || "").includes("svg"));
    const targets = svgLinks.length > 0 ? svgLinks : links.slice(0, 1);
    const originals = targets.map(
      (l) => l.getAttribute("href") || FAVICON_DEFAULT,
    );
    targets.forEach((l) =>
      l.setAttribute("href", unreadCount > 0 ? FAVICON_BADGE : FAVICON_DEFAULT),
    );
    return () => {
      targets.forEach((l, i) => l.setAttribute("href", originals[i]));
    };
  }, [unreadCount]);
}

/**
 * Notification surface that works without any permission:
 *  - a sticky alert bar for important unread alerts (never times out),
 *  - transient popups for other new notifications,
 *  - an unread counter in the tab title + favicon dot,
 *  - an optional chime,
 *  - and a system notification when the tab is hidden and permission was granted.
 */
export default function NotificationToast() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const [popups, setPopups] = useState<Notification[]>([]);
  const [alerts, setAlerts] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const seenIds = useRef<Set<number>>(new Set());
  const initialized = useRef(false);

  useTabBadge(user ? unreadCount : 0);

  const checkForNew = useCallback(async () => {
    if (!user) return;
    try {
      const res = await api.get("/notifications");
      const list: Notification[] = res.data || [];

      const unread = list.filter((n) => !n.isRead);
      setUnreadCount(unread.length);
      setAlerts(
        unread
          .filter((n) => STICKY_TYPES.includes(n.type))
          .sort((a, b) => b.id - a.id)
          .slice(0, 3),
      );

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
      playAlertSound();

      // Important types are already shown by the sticky bar; only the rest
      // appear as transient popups so an alert is never rendered twice.
      const transient = fresh.filter((n) => !STICKY_TYPES.includes(n.type));
      transient.forEach((n) => {
        setPopups((prev) => [...prev, n]);
        setTimeout(
          () => setPopups((prev) => prev.filter((p) => p.id !== n.id)),
          POPUP_TTL_MS,
        );
      });

      // When the tab is in the background, also fire a system notification.
      // Silently skipped when the browser has no permission — the tab title and
      // favicon badge above still flag the alert.
      if (
        typeof document !== "undefined" &&
        document.hidden &&
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        const latest = fresh[fresh.length - 1];
        try {
          new Notification(latest.title, { body: latest.message });
        } catch {
          // Some browsers require a service-worker registration for this.
        }
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
    // attempt. Polling + tab-visibility refreshes keep the alerts in sync.
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

  const markRead = async (n: Notification) => {
    try {
      await api.patch(`/notifications/${n.id}/read`);
    } catch {
      // ignore
    }
    setAlerts((prev) => prev.filter((a) => a.id !== n.id));
    setUnreadCount((prev) => Math.max(0, prev - 1));
  };

  const openAlert = async (n: Notification) => {
    await markRead(n);
    const link = getLink(n);
    if (link) router.push(link);
  };

  const markAllRead = async () => {
    try {
      await api.patch("/notifications/read-all");
    } catch {
      // ignore
    }
    setAlerts([]);
    setPopups([]);
    setUnreadCount(0);
  };

  // Everything is scoped to the signed-in user, so stale state never shows:
  // the badge is zeroed and nothing renders once the user signs out.
  if (!user || (popups.length === 0 && alerts.length === 0)) return null;

  return (
    <div className="fixed top-2 right-2 left-2 sm:top-4 sm:right-4 sm:left-auto z-[100] max-w-sm flex flex-col gap-2">
      {alerts.length > 0 && (
        <div className="bg-rose-50 border border-rose-300 rounded-xl shadow-lg overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-rose-100/70 border-b border-rose-200">
            <p className="text-sm font-semibold text-rose-900 truncate">
              🔔 {t("notifications.alertBanner")} ({alerts.length})
            </p>
            <button
              type="button"
              onClick={markAllRead}
              className="flex-shrink-0 text-xs font-medium text-rose-700 hover:text-rose-900"
            >
              {t("notifications.markAllAsRead")}
            </button>
          </div>
          <div className="divide-y divide-rose-100">
            {alerts.map((n) => (
              <div key={n.id} className="px-4 py-3 flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => openAlert(n)}
                  className="flex-1 min-w-0 text-left"
                >
                  <p className="text-sm font-semibold text-rose-900 truncate">
                    {getIcon(n.type)} {n.title}
                  </p>
                  <p className="text-xs text-rose-700 mt-0.5 line-clamp-2">
                    {n.message}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => markRead(n)}
                  aria-label={t("notifications.dismiss")}
                  className="flex-shrink-0 text-rose-400 hover:text-rose-600 text-lg leading-none"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
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
