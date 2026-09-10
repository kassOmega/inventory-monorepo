import { AuthProvider } from "@/context/AuthContext";
import { LanguageProvider } from "@/context/LanguageContext";
import LoadingBar from "./components/LoadingBar";
import PwaRegistry from "./components/PwaRegistry";
import "./globals.css";

export const metadata = {
  title: "Kass Inv. Platform",
  description: "Kass Inv. — inventory, sales & stock management platform",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    title: "Kass Inv. Platform",
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
