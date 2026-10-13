// lib/offlineDb.ts
// IndexedDB storage for offline support:
//   * `mutations` — writes that were made offline (or whose first response was
//     lost) and still need to reach the server. Keyed by the client-generated
//     `clientRef`, which is also the server-side idempotency key, so re-queuing
//     the same mutation is a no-op.
//   * `catalog` — reference data (products/categories/customers/payment
//     methods/locations) cached so the sale, purchase and request forms remain
//     usable with no network. Scoped per tenant+user so switching organizations
//     can never leak one business's data into another.
//
// Every helper degrades to a no-op / null when IndexedDB is unavailable (SSR,
// private browsing), so importing this module is always safe.
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export type MutationKind = "SALE" | "PURCHASE" | "REQUEST";
export type MutationStatus = "PENDING" | "SYNCING" | "FAILED";

export interface QueuedMutation {
  /** clientRef — the server-side idempotency key, so re-enqueue is a no-op. */
  id: string;
  kind: MutationKind;
  method: "POST" | "PUT";
  url: string;
  body: unknown;
  tenantId: number | null;
  userId: number | null;
  createdAt: number;
  attempts: number;
  status: MutationStatus;
  lastError?: string | null;
  lastAttemptAt?: number | null;
}

export interface CatalogRecord {
  /** `${tenantId ?? "x"}:${userId ?? "x"}:${url}` — scoped to avoid leaks. */
  key: string;
  body: unknown;
  at: number;
}

interface OfflineSchema extends DBSchema {
  mutations: { key: string; value: QueuedMutation };
  catalog: { key: string; value: CatalogRecord };
}

const DB_NAME = "kass-offline";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<OfflineSchema>> | null = null;

/** The shared IndexedDB handle, or null where IndexedDB is not available. */
export function getOfflineDb(): Promise<IDBPDatabase<OfflineSchema>> | null {
  if (typeof indexedDB === "undefined") return null;
  if (!dbPromise) {
    dbPromise = openDB<OfflineSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("mutations")) {
          db.createObjectStore("mutations", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("catalog")) {
          db.createObjectStore("catalog", { keyPath: "key" });
        }
      },
    });
  }
  return dbPromise;
}

// --- Mutation queue --------------------------------------------------------

export async function putMutation(m: QueuedMutation): Promise<void> {
  const db = await getOfflineDb();
  if (!db) return;
  await db.put("mutations", m);
}

export async function getMutation(
  id: string,
): Promise<QueuedMutation | undefined> {
  const db = await getOfflineDb();
  if (!db) return undefined;
  return db.get("mutations", id);
}

/** Every queued mutation, oldest first (sync order). */
export async function allMutations(): Promise<QueuedMutation[]> {
  const db = await getOfflineDb();
  if (!db) return [];
  const rows = await db.getAll("mutations");
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function updateMutation(
  id: string,
  patch: Partial<QueuedMutation>,
): Promise<void> {
  const db = await getOfflineDb();
  if (!db) return;
  const existing = await db.get("mutations", id);
  if (!existing) return;
  await db.put("mutations", { ...existing, ...patch });
}

export async function deleteMutation(id: string): Promise<void> {
  const db = await getOfflineDb();
  if (!db) return;
  await db.delete("mutations", id);
}

export async function clearMutations(): Promise<void> {
  const db = await getOfflineDb();
  if (!db) return;
  await db.clear("mutations");
}

// --- Reference-data catalog ------------------------------------------------

export async function putCatalog(record: CatalogRecord): Promise<void> {
  const db = await getOfflineDb();
  if (!db) return;
  await db.put("catalog", record);
}

export async function getCatalog(
  key: string,
): Promise<CatalogRecord | undefined> {
  const db = await getOfflineDb();
  if (!db) return undefined;
  return db.get("catalog", key);
}

export async function clearCatalog(): Promise<void> {
  const db = await getOfflineDb();
  if (!db) return;
  await db.clear("catalog");
}
