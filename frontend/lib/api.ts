import axios from "axios";
import i18n from "./i18n";
import { STORAGE_KEY_GLOBAL, normalizeLocale } from "./locale";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000",
  headers: { "Content-Type": "application/json" },
  timeout: 30000,
});

// ---------------------------------------------------------------------------
// Global in-flight request tracking (used by the top LoadingBar).
// ---------------------------------------------------------------------------
let pendingCount = 0;
const pendingListeners = new Set<(count: number) => void>();

function updatePending(delta: number) {
  pendingCount = Math.max(0, pendingCount + delta);
  pendingListeners.forEach((cb) => cb(pendingCount));
}

/** Subscribe to in-flight request count changes. Returns an unsubscribe fn. */
export function onApiPendingChange(cb: (count: number) => void) {
  pendingListeners.add(cb);
  cb(pendingCount);
  return () => {
    pendingListeners.delete(cb);
  };
}

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
    const orgId = localStorage.getItem("activeOrganizationId");
    if (orgId) config.headers["X-Tenant-Id"] = orgId;
    // Advertise the active UI locale so the backend can (a) resolve localized
    // entity data and (b) localize error/notification messages for this request.
    let locale: string | null = null;
    try {
      locale = localStorage.getItem(STORAGE_KEY_GLOBAL);
    } catch {
      // ignore storage errors
    }
    const lang = normalizeLocale(locale);
    config.headers["Accept-Language"] = lang;
    config.headers["x-locale"] = lang;
  }
  updatePending(1);
  return config;
});

api.interceptors.response.use(
  (res) => {
    updatePending(-1);
    return res;
  },
  (err) => {
    updatePending(-1);
    // Surface API errors in the UI unless the caller already handled them
    // (pages that show their own toast call markHandled(err) in catch). A 401
    // from the background /auth/me session check is expected when logged out.
    const isSessionCheck =
      err?.config?.method?.toLowerCase() === "get" &&
      String(err?.config?.url ?? "").includes("/auth/me");
    if (!err?.handled && !isSessionCheck) {
      setTimeout(() => {
        if (!err?.handled) emitApiError(err);
      }, 0);
    }
    return Promise.reject(err);
  },
);

// ---------------------------------------------------------------------------
// Global API error reporting
// ---------------------------------------------------------------------------

// Extract a human-friendly message from an API error.
export function getApiErrorMessage(err: any): string {
  const status = err?.response?.status;
  const data = err?.response?.data;
  let message = data?.message;
  if (Array.isArray(message)) message = message.join(", ");
  if (typeof message === "string" && message.trim()) {
    // Replace the generic Nest 403/401 messages with clearer guidance, but keep
    // specific backend messages (e.g. "Only the dispatching store can...").
    if (status === 403 && (message === "Forbidden resource" || message === "Forbidden")) {
      return tL("errors.noPermission");
    }
    if (status === 401 && message === "Unauthorized") {
      return tL("errors.sessionExpired");
    }
    return message;
  }
  if (status === 403) return tL("errors.noPermission");
  if (status === 401) return tL("errors.sessionExpired");
  if (err?.code === "ECONNABORTED") return tL("errors.timedOut");
  if (!err?.response) return err?.message || tL("errors.network");
  return tL("errors.requestFailed", { status: String(status) });
}

// Localized catalog lookup for the generic fallback strings above (reads the
// currently active i18next language, so it always matches the UI language).
function tL(key: string, vars?: Record<string, string>): string {
  return i18n.t(key, { defaultValue: key, ...vars });
}

// Mark an error as already handled so the global handler doesn't toast twice.
export function markHandled(err: any) {
  if (err && typeof err === "object") err.handled = true;
}

type ApiErrorListener = (message: string, err: any) => void;
const errorListeners = new Set<ApiErrorListener>();

export function onApiError(listener: ApiErrorListener) {
  errorListeners.add(listener);
  return () => {
    errorListeners.delete(listener);
  };
}

function emitApiError(err: any) {
  const message = getApiErrorMessage(err);
  errorListeners.forEach((listener) => listener(message, err));
}

export default api;

