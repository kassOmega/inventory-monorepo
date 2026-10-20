import { AuthProvider } from "@/context/AuthContext";
import Script from "next/script";
import { LanguageProvider } from "@/context/LanguageContext";
import LoadingBar from "./components/LoadingBar";
import PwaRegistry from "./components/PwaRegistry";
import "./globals.css";

// Document metadata is resolved by the server, before the client-side locale
// exists (see lib/locale.ts — the language lives in localStorage) and is what
// crawlers, link previews and the install prompt read. It therefore stays in the
// default language; the product name is never transliterated.
const APP_NAME = "Kass Inv. Platform"; // i18n-ignore — product name
const APP_DESCRIPTION = // i18n-ignore — default-language meta description
  "Kass Inv. — inventory, sales & stock management platform";

// Chrome may fire `beforeinstallprompt` before React hydrates. Capture and
// preventDefault() it here so InstallAppButton can call prompt() on a real user
// gesture later. The event is also re-broadcast for the React component.
const INSTALL_PROMPT_BOOTSTRAP = `
(function () {
  if (window.__kassInstallPrompt === undefined) window.__kassInstallPrompt = null;
  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    window.__kassInstallPrompt = event;
    window.dispatchEvent(new Event('kass:install-prompt-ready'));
  });
  window.addEventListener('appinstalled', function () {
    window.__kassInstallPrompt = null;
    window.dispatchEvent(new Event('kass:install-app-installed'));
  });
})();
`;

export const metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  applicationName: APP_NAME,
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    // Next 16 emits `mobile-web-app-capable` for appleWebApp.capable; older
    // iOS versions still look for the Apple-prefixed tag for standalone mode.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport = {
  themeColor: "#111827",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      {/* suppressHydrationWarning: browser extensions (e.g. Grammarly) inject
          attributes onto <body> after SSR, which is not an app bug. */}
      <body suppressHydrationWarning>
        <Script
          id="install-prompt-bootstrap"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: INSTALL_PROMPT_BOOTSTRAP }}
        />
        <AuthProvider>
          <LanguageProvider>
            <LoadingBar />
            <PwaRegistry />
            {children}
          </LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
