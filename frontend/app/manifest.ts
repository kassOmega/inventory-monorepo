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
    id: "/",
    name: APP_NAME,
    short_name: APP_SHORT_NAME,
    description: APP_DESCRIPTION,
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "any",
    lang: "en",
    dir: "ltr",
    categories: ["business", "productivity", "finance"],
    prefer_related_applications: false,
    launch_handler: { client_mode: "navigate-existing" },
    background_color: "#f3f4f6",
    theme_color: "#111827",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/maskable-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    shortcuts: [
      {
        name: "Sales",
        short_name: "Sales",
        description: "Open the sales screen",
        url: "/dashboard/sales",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Products",
        short_name: "Products",
        description: "Open the product catalogue",
        url: "/dashboard/products",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Dashboard",
        short_name: "Dashboard",
        description: "Open the business dashboard",
        url: "/dashboard",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
