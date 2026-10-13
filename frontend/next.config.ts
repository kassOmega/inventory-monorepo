/* eslint-disable @typescript-eslint/no-require-imports -- this file is a CommonJS Next config */
const fs = require("fs");
const path = require("path");
const nodeCrypto = require("node:crypto");

/**
 * Route shells that must be available offline. Their HTML documents are
 * precached so an offline navigation that falls back to a hard load never hits
 * the /~offline page. Keep in sync with lib/offlineNav.ts (OFFLINE_ROUTES).
 */
const OFFLINE_ROUTE_SHELLS = [
  "/dashboard",
  "/dashboard/sales",
  "/dashboard/purchases",
  "/dashboard/requests",
  "/dashboard/products",
];

/** md5 revision for a public file (what Workbox would compute itself). */
function fileRevision(file: string): string {
  return nodeCrypto.createHash("md5").update(fs.readFileSync(file)).digest("hex");
}

/**
 * Precache entries for everything under public/ (the plugin's own default). We
 * have to build this ourselves because supplying `additionalManifestEntries`
 * replaces the plugin's default public glob.
 */
function publicManifestEntries(): Array<{ url: string; revision: string }> {
  const publicDir = path.join(__dirname, "public");
  const entries: Array<{ url: string; revision: string }> = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "noprecache") walk(full);
        continue;
      }
      // Generated worker/service-worker files are never precached.
      if (/^(workbox|fallback|swe-worker|worker)-.*\.js(\.map)?$/.test(entry.name))
        continue;
      if (entry.name === "sw.js" || entry.name === "sw.js.map") continue;
      entries.push({
        url: "/" + path.relative(publicDir, full).split(path.sep).join("/"),
        revision: fileRevision(full),
      });
    }
  };
  if (fs.existsSync(publicDir)) walk(publicDir);
  return entries;
}

// A per-build revision forces Workbox to re-fetch the shells on every deploy
// (revision:null would treat them as immutable and could leave stale HTML that
// references removed chunk files).
const BUILD_REVISION = String(Date.now());
const PRECACHE_MANIFEST_ENTRIES = [
  ...publicManifestEntries(),
  ...OFFLINE_ROUTE_SHELLS.map((url) => ({ url, revision: BUILD_REVISION })),
];

const withPWA = require("@ducanh2912/next-pwa").default({
  dest: "public", // The service worker will be generated here
  customWorkerDir: "worker",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: false, // serve fresh shell online
  reloadOnOnline: true,
  // The service worker is production-only unless explicitly opted into in dev
  // (set NEXT_PUBLIC_ENABLE_PWA=true). Dev SW caching can go stale on HMR, so it
  // stays off by default and is only for testing the offline behaviour locally.
  disable:
    process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_ENABLE_PWA !== "true",
  // Serve the branded app/~offline page when an offline navigation cannot be
  // answered from the cache, instead of the browser's generic offline page.
  fallbacks: { document: "/~offline" },
  // Take over + clean up as soon as a new build ships so stale precaches never
  // serve an old shell (which breaks hard refreshes with chunk 404s).
  skipWaiting: true,
  clientsClaim: true,
  cleanupOutdatedCaches: true,
  workboxOptions: {
    disableDevLogs: true,
    // Public assets + the offline route shells (see above).
    additionalManifestEntries: PRECACHE_MANIFEST_ENTRIES,
  },
});

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000";
// When the API base is absolute (e.g. https://api.example.com) the browser
// talks to a different origin, so it must be allow-listed in connect-src.
// A relative base (e.g. "/api", used by the combined Docker image where the
// backend is reverse-proxied under this same origin) is already covered by
// `'self'`, so no extra origin is added.
let apiOrigin: string | null = null;
if (/^https?:\/\//i.test(apiBaseUrl)) {
  try {
    apiOrigin = new URL(apiBaseUrl).origin;
  } catch {
    apiOrigin = null;
  }
}

// Set by the Docker build: the backend runs inside the same container, so
// Next.js proxies /api/* to it (single origin => no CORS, no extra ports).
const apiProxyTarget = process.env.API_PROXY_TARGET;

const isDev = process.env.NODE_ENV === "development";
const scriptSrc = isDev
  ? "'self' 'unsafe-inline' 'unsafe-eval'"
  : "'self' 'unsafe-inline'";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    // The app itself scans product barcodes / QR codes with the device camera,
    // so `camera` must be allowed for our own origin (`self`). An empty
    // allowlist (the previous `camera=()`) denies the document itself and makes
    // every getUserMedia() call reject with NotAllowedError — which is what the
    // scanner reports as "Unable to access the camera".
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      ["connect-src", "'self'", apiOrigin].filter(Boolean).join(" "),
      `script-src ${scriptSrc}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join("; "),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // `standalone` is only enabled for the Docker build so the Vercel deployment
  // keeps using its own builder untouched.
  output: process.env.NEXT_OUTPUT_STANDALONE === "true" ? "standalone" : undefined,
  outputFileTracingRoot: __dirname,
  async rewrites() {
    // In dev the Next.js app runs on 3001 while the API runs on 3000, so
    // browser-loaded assets such as `/api/public/image/<file>` must be proxied
    // to the backend. The backend controllers are mounted at the root (no
    // `/api` prefix), so `/api/*` is stripped in the destination.
    const target =
      apiProxyTarget || (/^https?:\/\//i.test(apiBaseUrl) ? apiBaseUrl : null);
    if (!target) return [];
    return [
      {
        source: "/api/:path*",
        destination: `${target.replace(/\/$/, "")}/:path*`,
      },
    ];
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  // Roles & Permissions is now the "Roles" tab of the Users page; keep the old
  // route working for bookmarks. 307 (not 308) keeps the move reversible.
  async redirects() {
    return [
      {
        source: "/dashboard/roles",
        destination: "/dashboard/users?tab=roles",
        permanent: false,
      },
    ];
  },
};

module.exports = withPWA(nextConfig);
