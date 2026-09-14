const withPWA = require("@ducanh2912/next-pwa").default({
  dest: "public", // The service worker will be generated here
  customWorkerDir: "worker",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: false, // serve fresh shell online
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
  // Take over + clean up as soon as a new build ships so stale precaches never
  // serve an old shell (which breaks hard refreshes with chunk 404s).
  skipWaiting: true,
  clientsClaim: true,
  cleanupOutdatedCaches: true,
  workboxOptions: {
    disableDevLogs: true,
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
    if (!apiProxyTarget) return [];
    return [
      {
        source: "/api/:path*",
        destination: `${apiProxyTarget.replace(/\/$/, "")}/:path*`,
      },
    ];
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

module.exports = withPWA(nextConfig);
