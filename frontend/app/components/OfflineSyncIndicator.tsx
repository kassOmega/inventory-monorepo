"use client";
// app/components/OfflineSyncIndicator.tsx
// The header pill that tells the user whether they are online and whether any
// changes are waiting to sync. It stays invisible while everything is normal so
// it never adds noise; open its panel to review or retry queued items.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOfflineSync } from "@/context/OfflineSyncContext";
import SyncQueuePanel from "./SyncQueuePanel";

export default function OfflineSyncIndicator() {
  const { t } = useTranslation();
  const { online, syncing, paused, items, pendingCount, failedCount } =
    useOfflineSync();
  const [open, setOpen] = useState(false);

  const hasWork = items.length > 0;
  // Nothing to say when online, idle and empty.
  if (online && !syncing && !hasWork && !paused) return null;

  const tone = !online
    ? "bg-amber-500/90 text-white"
    : failedCount > 0 || paused
      ? "bg-red-500/90 text-white"
      : "bg-blue-500/90 text-white";

  const label = !online
    ? t("sync.offline")
    : syncing
      ? t("sync.syncing")
      : paused
        ? t("sync.paused")
        : failedCount > 0
          ? t("sync.syncFailed")
          : t("sync.pending", { count: pendingCount });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("sync.viewQueue")}
        aria-label={t("sync.viewQueue")}
        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${tone}`}
      >
        {syncing ? (
          <span
            aria-hidden
            className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white"
          />
        ) : (
          <span aria-hidden>
            {!online ? "⛔" : paused ? "🔒" : failedCount > 0 ? "⚠️" : "🔄"}
          </span>
        )}
        <span className="hidden sm:inline">{label}</span>
        {hasWork && (
          <span className="rounded-full bg-black/25 px-1.5 text-[10px] leading-4">
            {items.length}
          </span>
        )}
      </button>

      <SyncQueuePanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}
