"use client";

import { useAuth } from "@/context/AuthContext";
import {
  isAlertSoundOn,
  setAlertSoundOn,
  subscribeAlertSound,
} from "@/lib/alertSound";
import api from "@/lib/api";
import { timeAgo } from "@/lib/datetime";
import {
  notificationIcon,
  notificationLink,
} from "@/lib/notificationLink";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  /** Optional deep link supplied by the backend (in-app + push). */
  link?: string | null;
  tenantId: number | null;
  productId: number | null;
  locationId: number | null;
  product: { brand: string; baseName: string } | null;
  location: { name: string } | null;
  targetRole: string | null;
  targetLocationId: number | null;
  isRead: boolean;
  createdAt: string;
}

// How often to poll for notifications.
const POLL_INTERVAL_MS = 15000;

export default function NotificationBell() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  // Alert-sound preference lives in localStorage; mirror it without an effect.
  const soundOn = useSyncExternalStore(
    subscribeAlertSound,
    isAlertSoundOn,
    () => true,
  );
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await api.get("/notifications/unread-count");
      setUnreadCount(res.data.count);
    } catch (err) {
      console.error("Failed to fetch notification count:", err);
    }
  }, []);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await api.get("/notifications");
      setNotifications(res.data);
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchUnreadCount();
    fetchNotifications();

    // Poll-based updates only. EventSource cannot attach the Bearer token used
    // by this app's API, so opening /notifications/stream would 401 on every
    // attempt. Polling + tab-visibility refreshes keep the bell in sync.
    const interval = setInterval(() => {
      fetchUnreadCount();
      fetchNotifications();
    }, POLL_INTERVAL_MS);

    // Refresh immediately when the user returns to the tab.
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchUnreadCount();
        fetchNotifications();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, [user, fetchUnreadCount, fetchNotifications]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleToggle = () => {
    setIsOpen(!isOpen);
    if (!isOpen) fetchNotifications();
  };

  const handleMarkAsRead = async (n: Notification) => {
    try {
      await api.patch(`/notifications/${n.id}/read`);
      setNotifications((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // ignore
    }
    const link = notificationLink(n);
    if (link) router.push(link);
  };

  const handleMarkAllAsRead = async () => {
    try {
      await api.patch("/notifications/read-all");
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch {
      // ignore
    }
  };

  const formatTime = (dateStr: string) => timeAgo(dateStr);

  if (!user) return null;

  // Resolve which business a notification belongs to (tenantId = organization id).
  const businessName = (tenantId: number | null) =>
    user?.memberships?.find((m) => m.organizationId === tenantId)
      ?.organizationName ?? null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={handleToggle}
        className="relative p-2 text-gray-300 hover:text-white transition-colors"
        aria-label={t("notifications.title")}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 00-5-5.917V4a1 1 0 10-2 0v1.083A6 6 0 006 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0a3 3 0 11-6 0m6 0H9"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 sm:w-80 bg-white rounded-xl shadow-lg border border-gray-200 z-50 max-h-96 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between p-3 border-b">
            <h3 className="font-semibold text-gray-800">{t("notifications.title")}</h3>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setAlertSoundOn(!soundOn)}
                title={
                  soundOn
                    ? t("notifications.soundOn")
                    : t("notifications.soundOff")
                }
                aria-label={
                  soundOn
                    ? t("notifications.soundOn")
                    : t("notifications.soundOff")
                }
                className="text-sm leading-none"
              >
                {soundOn ? "🔔" : "🔕"}
              </button>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllAsRead}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                >
                  {t("notifications.markAllAsRead")}
                </button>
              )}
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {notifications.length === 0 ? (
              <div className="p-6 text-center text-gray-400">
                <p className="text-lg mb-1">🔔</p>
                <p className="text-sm">{t("notifications.noNotifications")}</p>
              </div>
            ) : (
              notifications.map((notif) => (
                <div
                  key={notif.id}
                  className={`px-4 py-3 border-b last:border-b-0 cursor-pointer transition-colors hover:bg-gray-50 ${notif.isRead ? "opacity-60" : "bg-blue-50/50"}`}
                  onClick={() => handleMarkAsRead(notif)}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-lg mt-0.5">
                      {notificationIcon(notif.type)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">
                        {notif.title}
                      </p>
                      <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">
                        {notif.message}
                      </p>
                      {businessName(notif.tenantId) && (
                        <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                          🏢 {businessName(notif.tenantId)}
                        </p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        {formatTime(notif.createdAt)}
                      </p>
                    </div>
                    {!notif.isRead && (
                      <span className="w-2 h-2 bg-blue-500 rounded-full mt-1.5 flex-shrink-0" />
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
