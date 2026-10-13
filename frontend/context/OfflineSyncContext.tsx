"use client";
// context/OfflineSyncContext.tsx
// App-wide offline sync state. Mounted inside the dashboard so it can show
// toasts. It watches connectivity, exposes the queue to the UI, and replays
// queued mutations automatically when the connection (or the tab) comes back.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "./AuthContext";
import { useToast } from "@/app/components/ToastProvider";
import {
  discardAllFailed,
  discardMutation,
  flushQueue,
  listQueue,
  retryAllFailed,
  retryMutation,
  type QueuedMutation,
} from "@/lib/offlineQueue";
import { warmCatalog } from "@/lib/offlineCache";

interface OfflineSyncContextValue {
  /** Browser connectivity, kept fresh for the status indicator. */
  online: boolean;
  syncing: boolean;
  /** True when a 401 paused a flush — the session must be renewed. */
  paused: boolean;
  items: QueuedMutation[];
  pendingCount: number;
  failedCount: number;
  syncNow: () => Promise<void>;
  refresh: () => Promise<void>;
  retry: (id: string) => Promise<void>;
  discard: (id: string) => Promise<void>;
  retryFailed: () => Promise<void>;
  discardFailed: () => Promise<void>;
}

const OfflineSyncContext = createContext<OfflineSyncContextValue | undefined>(
  undefined,
);

// Connectivity is external state: read it through useSyncExternalStore instead
// of mirroring it into React state from an effect.
function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}
function getOnlineSnapshot() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export function useOfflineSync(): OfflineSyncContextValue {
  const ctx = useContext(OfflineSyncContext);
  if (!ctx)
    // i18n-ignore — developer error, never rendered to a user
    throw new Error("useOfflineSync must be used inside <OfflineSyncProvider>");
  return ctx;
}

export function OfflineSyncProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const toast = useToast();
  const { t } = useTranslation();
  // Read from the external store above; SSR/first paint agree on "online".
  const online = useSyncExternalStore(
    subscribeOnline,
    getOnlineSnapshot,
    () => true,
  );
  const [syncing, setSyncing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [items, setItems] = useState<QueuedMutation[]>([]);

  // Guards against overlapping flushes (interval + online event + focus).
  const syncingRef = useRef(false);
  const itemsRef = useRef<QueuedMutation[]>([]);

  const refresh = useCallback(async () => {
    const next = await listQueue();
    itemsRef.current = next;
    setItems(next);
  }, []);

  const syncNow = useCallback(async () => {
    if (!user || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const summary = await flushQueue();
      await refresh();
      if (summary.paused) {
        setPaused(true);
      } else if (summary.synced > 0) {
        setPaused(false);
        toast.success(t("sync.synced", { count: summary.synced }));
        window.dispatchEvent(new Event("sync:completed"));
      }
      if (summary.failed > 0) {
        toast.error(t("sync.syncFailed"));
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [user, refresh, toast, t]);

  // Connectivity: flush as soon as the browser reports it is back online. The
  // `online` flag itself comes from useSyncExternalStore above.
  useEffect(() => {
    const goOnline = () => void syncNow();
    window.addEventListener("online", goOnline);
    return () => window.removeEventListener("online", goOnline);
  }, [syncNow]);

  // On mount (and when the user changes): load the queue and drain it. Deferred
  // one tick so the effect body itself never triggers a synchronous render.
  useEffect(() => {
    const id = setTimeout(() => {
      void refresh().then(() => {
        if (typeof navigator === "undefined" || navigator.onLine) {
          void syncNow();
        }
      });
    }, 0);
    return () => clearTimeout(id);
  }, [refresh, syncNow, user?.id]);

  // A form queued a mutation: refresh so the badge appears immediately.
  useEffect(() => {
    const onQueued = () => void refresh();
    window.addEventListener("offline:queued", onQueued);
    return () => window.removeEventListener("offline:queued", onQueued);
  }, [refresh]);

  // Warm the reference catalog while online so products/categories are available
  // offline even on a page the user never opened. Deferred a tick and re-run
  // whenever connectivity returns.
  useEffect(() => {
    if (!user) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    const id = setTimeout(() => void warmCatalog(), 0);
    return () => clearTimeout(id);
  }, [user, online]);

  // Best-effort Background Sync registration (Chrome/Android). If unsupported,
  // the timer + online listener above still drain the queue.
  useEffect(() => {
    if (!user) return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const hasPending = items.some((m) => m.status !== "FAILED");
    if (!hasPending) return;
    navigator.serviceWorker.ready
      .then((reg) =>
        (
          reg as ServiceWorkerRegistration & {
            sync?: { register?: (tag: string) => Promise<void> };
          }
        ).sync?.register?.("kass-offline-sync"),
      )
      .catch(() => undefined);
  }, [user, items]);

  // The service worker woke up on Background Sync: drain now.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if ((e.data as { type?: string } | undefined)?.type === "SYNC_NOW") {
        void syncNow();
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [syncNow]);

  // Retry periodically while there is work and we are online.
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      const hasPending = itemsRef.current.some((m) => m.status !== "FAILED");
      if (hasPending) void syncNow();
    }, 20000);
    return () => clearInterval(id);
  }, [syncNow]);

  // Returning to the tab: refresh + try again.
  useEffect(() => {
    const onFocus = () => {
      void refresh();
      if (typeof navigator === "undefined" || navigator.onLine) void syncNow();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh, syncNow]);

  // Another tab changed the queue.
  useEffect(() => {
    const onStorage = () => void refresh();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);

  const retry = useCallback(
    async (id: string) => {
      await retryMutation(id);
      await refresh();
      void syncNow();
    },
    [refresh, syncNow],
  );

  const discard = useCallback(
    async (id: string) => {
      await discardMutation(id);
      await refresh();
    },
    [refresh],
  );

  const retryFailed = useCallback(async () => {
    await retryAllFailed();
    await refresh();
    void syncNow();
  }, [refresh, syncNow]);

  const discardFailed = useCallback(async () => {
    await discardAllFailed();
    await refresh();
  }, [refresh]);

  const pendingCount = items.filter((m) => m.status !== "FAILED").length;
  const failedCount = items.filter((m) => m.status === "FAILED").length;

  return (
    <OfflineSyncContext.Provider
      value={{
        online,
        syncing,
        paused,
        items,
        pendingCount,
        failedCount,
        syncNow,
        refresh,
        retry,
        discard,
        retryFailed,
        discardFailed,
      }}
    >
      {children}
    </OfflineSyncContext.Provider>
  );
}
