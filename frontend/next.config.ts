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
let apiOrigin = "http://localhost:3000";
try {
  apiOrigin = new URL(apiBaseUrl).origin;
} catch {
  // keep the fallback origin
}

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
      `connect-src 'self' ${apiOrigin}`,
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
  outputFileTracingRoot: __dirname,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

module.exports = withPWA(nextConfig);
