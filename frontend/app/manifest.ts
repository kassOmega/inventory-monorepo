import { MetadataRoute } from "next";

// The manifest is fetched once, at install time, and the OS then pins name /
// short_name — there is no per-locale variant — so it stays in the default
// language. (`lang` is set from the document instead; see app/layout.tsx.)
const APP_NAME = "Kass Inv. Platform"; // i18n-ignore — product name
const APP_SHORT_NAME = "Kass Inv."; // i18n-ignore — product name
const APP_DESCRIPTION = // i18n-ignore — default-language description
  "Inventory, sales & stock management platform";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_SHORT_NAME,
    description: APP_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#f3f4f6",
    theme_color: "#111827",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/maskable-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
