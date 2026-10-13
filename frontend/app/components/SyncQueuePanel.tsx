"use client";
// app/components/SyncQueuePanel.tsx
// Review-and-resolve view for the offline mutation queue. Pending items sync
// automatically; FAILED items (a real server rejection) stay here until the user
// retries or discards them — nothing money-related is ever dropped silently.
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import Modal from "./Modal";
import { useConfirm } from "./ConfirmProvider";
import { useOfflineSync } from "@/context/OfflineSyncContext";
import { formatDateTime } from "@/lib/datetime";
import type { QueuedMutation } from "@/lib/offlineDb";

const KIND_KEY: Record<QueuedMutation["kind"], string> = {
  SALE: "sync.kindSale",
  PURCHASE: "sync.kindPurchase",
  REQUEST: "sync.kindRequest",
};

const STATUS_KEY: Record<QueuedMutation["status"], string> = {
  PENDING: "sync.statusPending",
  SYNCING: "sync.statusSyncing",
  FAILED: "sync.statusFailed",
};

/** A short "Sale • 2 items" summary built from the queued body. */
function summarize(m: QueuedMutation, t: TFunction) {
  const body = m.body as { items?: unknown[] } | null;
  const count = Array.isArray(body?.items) ? body!.items!.length : 0;
  return `${t(KIND_KEY[m.kind])} • ${t("sync.itemsCount", { count })}`;
}

export default function SyncQueuePanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const {
    items,
    pendingCount,
    failedCount,
    paused,
    retry,
    discard,
    retryFailed,
    discardFailed,
    syncNow,
  } = useOfflineSync();

  const handleDiscard = async (m: QueuedMutation) => {
    const ok = await confirm(t("sync.discardConfirm"));
    if (ok) await discard(m.id);
  };

  const handleDiscardAll = async () => {
    const ok = await confirm(t("sync.discardAllConfirm"));
    if (ok) await discardFailed();
  };

  return (
    <Modal isOpen={open} onClose={onClose} title={t("sync.queueTitle")}>
      {paused && (
        <p className="mb-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">
          {t("sync.sessionPaused")}
        </p>
      )}

      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">
          {t("sync.queueEmpty")}
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500">
              {t("sync.queueSummary", {
                pending: pendingCount,
                failed: failedCount,
              })}
            </span>
            <div className="ml-auto flex gap-2">
              {pendingCount > 0 && (
                <button
                  type="button"
                  onClick={() => void syncNow()}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  {t("sync.retryAll")}
                </button>
              )}
              {failedCount > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => void retryFailed()}
                    className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600"
                  >
                    {t("sync.retryAll")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDiscardAll()}
                    className="rounded-lg bg-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-300"
                  >
                    {t("sync.discardAll")}
                  </button>
                </>
              )}
            </div>
          </div>

          <ul className="max-h-[55vh] space-y-2 overflow-y-auto">
            {items.map((m) => (
              <li
                key={m.id}
                className="rounded-lg border border-gray-200 p-3 text-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-800">{summarize(m, t)}</p>
                    <p className="text-[11px] text-gray-400">
                      {formatDateTime(new Date(m.createdAt).toISOString())}
                    </p>
                  </div>
                  <span
                    className={
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold " +
                      (m.status === "FAILED"
                        ? "bg-red-100 text-red-700"
                        : m.status === "SYNCING"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-gray-100 text-gray-600")
                    }
                  >
                    {t(STATUS_KEY[m.status])}
                  </span>
                </div>

                {m.status === "FAILED" && m.lastError && (
                  <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">
                    {m.lastError}
                  </p>
                )}

                <div className="mt-2 flex gap-2">
                  {m.status === "FAILED" && (
                    <>
                      <button
                        type="button"
                        onClick={() => void retry(m.id)}
                        className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
                      >
                        {t("sync.retry")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDiscard(m)}
                        className="rounded-md bg-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-300"
                      >
                        {t("sync.discard")}
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
