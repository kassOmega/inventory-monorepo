// lib/offlineCache.ts
// Offline-aware reads for reference data. `cachedGet` behaves exactly like
// `api.get` while online (and refreshes the cache), but when the network is
// unreachable it serves the last successful body for the same tenant + user, so
// the sale/purchase/request forms stay usable offline.
//
// Real API errors (4xx: auth, permission, validation) are re-thrown instead of
// falling back to stale data, so a signed-out or forbidden user is never shown
// someone else's cached catalog as if it were live.
//
// `warmCatalog()` additionally caches the core reference lists under stable
// keys (independent of the exact query the caller used), so the products and
// categories are available offline even on a page the user never opened while
// online. `cachedGet` falls back to that list when the exact URL is not cached.
import api from "./api";
import { clearCatalog, getCatalog, putCatalog } from "./offlineDb";

export interface OfflineScope {
  tenantId: number | null;
  userId: number | null;
}

/** The active tenant + user from storage (the same source the API uses). */
export function currentScope(): OfflineScope {
  if (typeof window === "undefined") return { tenantId: null, userId: null };
  let tenantId: number | null = null;
  let userId: number | null = null;
  try {
    const org = localStorage.getItem("activeOrganizationId");
    tenantId = org ? Number(org) : null;
    const raw = localStorage.getItem("user");
    userId = raw ? (JSON.parse(raw)?.id ?? null) : null;
  } catch {
    // Malformed storage — fall back to the global (null) scope.
  }
  return { tenantId, userId };
}

/** Cache key scoped to tenant+user+URL so org switches never cross-read. */
export function catalogKey(url: string): string {
  const { tenantId, userId } = currentScope();
  return `${tenantId ?? "x"}:${userId ?? "x"}:${url}`;
}

// --- Canonical reference lists --------------------------------------------

/** The core lists every offline-capable page needs. */
export type CatalogName =
  | "categories"
  | "products"
  | "customers"
  | "paymentMethods"
  | "locations";

const CATALOG_URLS: Record<CatalogName, string> = {
  categories: "/categories",
  products: "/products",
  customers: "/customers",
  paymentMethods: "/payment-methods",
  locations: "/locations",
};

function catalogListKey(name: CatalogName): string {
  const { tenantId, userId } = currentScope();
  return `${tenantId ?? "x"}:${userId ?? "x"}:list:${name}`;
}

/** Which canonical list a request URL belongs to (path match, query ignored). */
function catalogNameForUrl(url: string): CatalogName | undefined {
  const path = url.split("?")[0];
  return (Object.keys(CATALOG_URLS) as CatalogName[]).find((name) => {
    const base = CATALOG_URLS[name];
    return path === base || path.startsWith(base + "/");
  });
}

/**
 * True when an error means "the server may not have processed this / it can be
 * retried later": no HTTP response at all (offline, DNS, timeout, abort) or a
 * transient gateway/rate-limit status. A real 4xx is never retryable.
 */
export function isRetryableError(err: unknown): boolean {
  const response = (err as { response?: { status?: number } } | null)?.response;
  if (!response) return true;
  const status = response.status ?? 0;
  return status >= 500 || status === 408 || status === 429;
}

/** GET with an offline fallback to the last cached body for this scope. */
// i18n-ignore — code signature, not user-facing text
export async function cachedGet<T = unknown>(url: string): Promise<T> {
  try {
    const res = await api.get(url);
    await putCatalog({ key: catalogKey(url), body: res.data, at: Date.now() });
    // Refresh the canonical list only for the unfiltered endpoint, so a
    // shop-scoped `/products?locationId=` does not overwrite the full catalog.
    const name = catalogNameForUrl(url);
    if (name && !url.includes("?")) {
      await putCatalog({ key: catalogListKey(name), body: res.data, at: Date.now() });
    }
    return res.data as T;
  } catch (err) {
    if (isRetryableError(err)) {
      const cached = await getCatalog(catalogKey(url));
      if (cached) return cached.body as T;
      const name = catalogNameForUrl(url);
      if (name) {
        const list = await getCatalog(catalogListKey(name));
        if (list) return list.body as T;
      }
    }
    throw err;
  }
}

/** The last warmed canonical list for this scope, if any. */
export async function getCachedCatalog<T = unknown>(
  name: CatalogName,
): Promise<T | undefined> {
  const record = await getCatalog(catalogListKey(name));
  return record?.body as T | undefined;
}

/**
 * Fetch and cache the core reference lists while online. Best-effort: a role
 * that cannot read one list (403) simply skips it. Called once when the
 * dashboard shell mounts so offline forms/pages have products and categories
 * even if they were never opened online.
 */
export async function warmCatalog(): Promise<void> {
  await Promise.all(
    (Object.keys(CATALOG_URLS) as CatalogName[]).map(async (name) => {
      try {
        const res = await api.get(CATALOG_URLS[name]);
        await putCatalog({
          key: catalogListKey(name),
          body: res.data,
          at: Date.now(),
        });
      } catch {
        // Ignore: not every role can read every list.
      }
    }),
  );
}

/** Drop every cached reference payload (explicit logout / account switch). */
export async function clearCatalogCache(): Promise<void> {
  await clearCatalog();
}
