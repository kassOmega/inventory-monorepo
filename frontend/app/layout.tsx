import { AuthProvider } from "@/context/AuthContext";
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
  appleWebApp: {
    title: APP_NAME,
    statusBarStyle: "default",
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
      <body>
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
