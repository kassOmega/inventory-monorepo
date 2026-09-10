"use client";

import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import LandingPage from "@/app/components/LandingPage";

export default function Home() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  // The marketing landing page is only for guests ("unauthorized" visitors).
  // Once authenticated, open the dashboard instead — landing never flashes
  // after login.
  useEffect(() => {
    if (!isLoading && user) router.replace("/dashboard");
  }, [isLoading, user, router]);

  if (isLoading || user) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-100">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" />
      </div>
    );
  }

  return <LandingPage />;
}
