// lib/offlineQueue.ts
// The write side of offline support. A mutation that cannot reach the server is
// queued in IndexedDB and replayed later — one at a time, oldest first, through
// the same axios client the app uses online, so cookies, the CSRF header, the
// active tenant (`X-Tenant-Id`) and the locale header are all attached exactly
// as they would be for an interactive request.
//
// Deduplication: each queued item is keyed by its `clientRef`, which the backend
// treats as an idempotency key. A replay therefore creates nothing new — the
// backend returns the record that already exists.
import api, { getApiErrorMessage, markHandled } from "./api";
import { currentScope, isRetryableError } from "./offlineCache";
import {
  allMutations,
  deleteMutation,
  putMutation,
  updateMutation,
  type MutationKind,
  type QueuedMutation,
} from "./offlineDb";

export type { QueuedMutation, MutationKind } from "./offlineDb";

export interface EnqueueInput {
  kind: MutationKind;
  url: string;
  method?: "POST" | "PUT";
  body: unknown;
  /** Server idempotency key — also the queue primary key. */
  clientRef: string;
}

export interface SubmitResult<T> {
  queued: boolean;
  data: T;
}

/** True when a queued item belongs to the currently active tenant + user. */
export function inScope(
  m: QueuedMutation,
  tenantId: number | null,
  userId: number | null,
): boolean {
  return m.tenantId === tenantId && m.userId === userId;
}

/** Queue every item for the active scope, oldest first. */
export async function listQueue(): Promise<QueuedMutation[]> {
  const { tenantId, userId } = currentScope();
  return (await allMutations()).filter((m) => inScope(m, tenantId, userId));
}

async function enqueue(input: EnqueueInput): Promise<QueuedMutation> {
  const { tenantId, userId } = currentScope();
  const mutation: QueuedMutation = {
    id: input.clientRef,
    kind: input.kind,
    method: input.method ?? "POST",
    url: input.url,
    body: input.body,
    tenantId,
    userId,
    createdAt: Date.now(),
    attempts: 0,
    status: "PENDING",
    lastError: null,
    lastAttemptAt: null,
  };
  await putMutation(mutation);
  // Let the sync provider refresh its badge without polling.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("offline:queued"));
  }
  return mutation;
}

/**
 * Send a mutation now; if the network is unreachable, queue it and resolve with
 * a synthetic "queued" result so the caller can treat it as saved. Real API
 * errors (validation, permission, stock) are re-thrown so nothing is silently
 * lost or masked.
 */
export async function submitOrQueue<T = unknown>(
  input: EnqueueInput & { offlineData?: T },
): Promise<SubmitResult<T>> {
  try {
    const res = await api.request({
      method: input.method ?? "POST",
      url: input.url,
      data: input.body,
    });
    return { queued: false, data: res.data as T };
  } catch (err) {
    if (isRetryableError(err)) {
      // Handled here (queued) — keep the global error interceptor quiet.
      markHandled(err);
      await enqueue(input);
      const synthetic =
        input.offlineData ??
        ({
          ...(input.body as Record<string, unknown>),
          id: input.clientRef,
          _offline: true,
        } as unknown as T);
      return { queued: true, data: synthetic };
    }
    throw err;
  }
}

export interface FlushSummary {
  synced: number;
  failed: number;
  remaining: number;
  /** True when a 401 stopped the flush — the session needs re-authentication. */
  paused: boolean;
}

/**
 * Replay every PENDING mutation for the active scope, oldest first. Stops as
 * soon as the network drops again or the session expires (401), leaving the
 * remaining items safely queued. A 409 is treated as already-synced (the
 * clientRef is on the server). A non-retryable 4xx marks the item FAILED so it
 * is surfaced for the user to fix rather than retried forever.
 */
export async function flushQueue(): Promise<FlushSummary> {
  const { tenantId, userId } = currentScope();
  const pending = (await allMutations()).filter(
    (m) => inScope(m, tenantId, userId) && m.status !== "FAILED",
  );

  let synced = 0;
  let failed = 0;
  let paused = false;

  for (const m of pending) {
    if (typeof navigator !== "undefined" && !navigator.onLine) break;

    await updateMutation(m.id, {
      status: "SYNCING",
      attempts: m.attempts + 1,
      lastAttemptAt: Date.now(),
    });

    try {
      await api.request({ method: m.method, url: m.url, data: m.body });
      await deleteMutation(m.id);
      synced += 1;
      continue;
    } catch (err) {
      // Every outcome below is surfaced by the sync panel, so suppress the
      // global error toast (it would fire once per replayed item).
      markHandled(err);
      const status = (err as { response?: { status?: number } } | null)?.response
        ?.status;
      const message = getApiErrorMessage(err);

      if (isRetryableError(err)) {
        // Network likely dropped again (or a transient 5xx): keep it pending.
        await updateMutation(m.id, { status: "PENDING", lastError: message });
        break;
      }
      if (status === 401) {
        await updateMutation(m.id, { status: "PENDING", lastError: message });
        paused = true;
        break;
      }
      if (status === 409) {
        // Idempotency key already recorded server-side — nothing to create.
        await deleteMutation(m.id);
        synced += 1;
        continue;
      }
      await updateMutation(m.id, { status: "FAILED", lastError: message });
      failed += 1;
    }
  }

  const remaining = (await listQueue()).length;
  return { synced, failed, remaining, paused };
}

/** Put a FAILED item back in the queue and replay it. */
export async function retryMutation(id: string): Promise<void> {
  await updateMutation(id, { status: "PENDING", lastError: null });
}

/** Drop one queued mutation without sending it. */
export async function discardMutation(id: string): Promise<void> {
  await deleteMutation(id);
}

/** Move every FAILED item in scope back to PENDING. */
export async function retryAllFailed(): Promise<void> {
  const items = await listQueue();
  for (const m of items) {
    if (m.status === "FAILED") {
      await updateMutation(m.id, { status: "PENDING", lastError: null });
    }
  }
}

/** Remove every FAILED item in scope. */
export async function discardAllFailed(): Promise<void> {
  const items = await listQueue();
  for (const m of items) {
    if (m.status === "FAILED") await deleteMutation(m.id);
  }
}
