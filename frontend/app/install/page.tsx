import type { Metadata } from "next";
import InstallPageClient from "./InstallPageClient";

export const metadata: Metadata = {
  title: "Download the app — Kass Inv. Platform", // i18n-ignore — page metadata
  description: // i18n-ignore — page metadata
    "Install Kass Inv. on Android, iPhone/iPad, Windows, macOS or Linux. No app store required.",
};

export default function InstallPage() {
  return <InstallPageClient />;
}
