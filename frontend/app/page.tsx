"use client";

import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import LandingPage from "@/app/components/LandingPage";

interface StartupStatus {
  stage?: string;
  ok?: boolean;
  error?: string;
  time?: string;
}

export default function Home() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [apiDown, setApiDown] = useState(false);
  const [healthChecked, setHealthChecked] = useState(false);
  const [reason, setReason] = useState("");

  // The marketing landing page is only for guests ("unauthorized" visitors).
  // Once authenticated, open the dashboard instead — landing never flashes
  // after login. But if the backend is unreachable (the container serves the
  // frontend while the API failed to boot), show a maintenance message with the
  // startup reason instead of a spinner or a broken dashboard redirect.
  useEffect(() => {
    let cancelled = false;

    async function probe() {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (!res.ok) throw new Error("health check failed");
        if (!cancelled) {
          setApiDown(false);
          setHealthChecked(true);
        }
      } catch {
        // The backend is unreachable. Try to read the exact startup reason
        // written by the container entrypoint to public/startup.json.
        let message = "";
        try {
          const statusRes = await fetch("/startup.json", {
            cache: "no-store",
          });
          if (statusRes.ok) {
            const data = (await statusRes.json()) as StartupStatus;
            message = data?.error ?? "";
          }
        } catch {
          // no status file available yet — the banner still links to /status
        }
        if (!cancelled) {
          setReason(message);
          setApiDown(true);
          setHealthChecked(true);
        }
      }
    }

    probe();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isLoading && user && healthChecked && !apiDown) {
      router.replace("/dashboard");
    }
  }, [isLoading, user, router, healthChecked, apiDown]);

  if (apiDown) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-100 px-6">
        <div className="w-full max-w-lg rounded-xl border border-amber-200 bg-amber-50 p-8 text-gray-900 shadow-sm">
          <h1 className="text-xl font-bold">Service unavailable</h1>
          <p className="mt-3 text-sm">
            {reason ||
              "The API is not responding. The system may be starting up or restarting."}
          </p>
          <a
            href="/status"
            className="mt-5 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            See startup status →
          </a>
        </div>
      </main>
    );
  }

  if (isLoading || user || !healthChecked) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-100">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" />
      </div>
    );
  }

  return <LandingPage />;
}
