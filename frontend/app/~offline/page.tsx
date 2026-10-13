"use client";
// app/~offline/page.tsx
// The document fallback served by the service worker when a navigation fails
// offline and no cached page matches (next-pwa detects this exact path and
// precaches it). It replaces the browser's generic "You're offline" page with a
// branded one that reassures the user their queued changes are safe.
import { useTranslation } from "react-i18next";

export default function OfflinePage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-6">
      <div className="w-full max-w-sm text-center">
        {/* Plain <img>: next/image would need the network to optimize. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icon-192.png"
          alt=""
          width={72}
          height={72}
          className="mx-auto mb-4 rounded-2xl shadow-sm"
        />
        <h1 className="text-xl font-bold text-gray-800">
          {t("offline.title")}
        </h1>
        <p className="mt-2 text-sm text-gray-600">{t("offline.body")}</p>
        <p className="mt-2 text-xs text-gray-400">{t("offline.queuedSafe")}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          {t("offline.retry")}
        </button>
      </div>
    </div>
  );
}
