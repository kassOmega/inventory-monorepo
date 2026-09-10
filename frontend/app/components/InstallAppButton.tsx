"use client";
import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function InstallAppButton() {
  const [deferred, setDeferred] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const ua = window.navigator.userAgent.toLowerCase();
    setIsIos(/iphone|ipad|ipod/.test(ua));
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    setIsStandalone(standalone);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setIsStandalone(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (isStandalone) return null;

  const handleInstall = async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  };

  const showButton = !!deferred || (isIos && !isStandalone);
  if (!showButton) return null;

  return (
    <>
      <button
        onClick={deferred ? handleInstall : () => setShowHelp(true)}
        className="w-full text-left text-sm py-2 px-4 rounded text-blue-300 hover:bg-gray-800"
      >
        Install App
      </button>
      {showHelp && (
        <div
          className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="bg-white rounded-xl p-6 max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold mb-2 text-gray-800">
              Install on iPhone / iPad
            </h3>
            <ol className="text-sm text-gray-600 list-decimal pl-4 space-y-1">
              <li>Tap the Share button in Safari.</li>
              <li>Scroll and tap Add to Home Screen.</li>
              <li>Tap Add.</li>
            </ol>
            <button
              onClick={() => setShowHelp(false)}
              className="mt-4 bg-blue-600 text-white px-4 py-2 rounded text-sm"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
