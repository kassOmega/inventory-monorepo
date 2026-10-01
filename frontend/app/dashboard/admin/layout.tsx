"use client";

import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && user && !user.isPlatformAdmin) router.replace("/dashboard");
  }, [user, isLoading, router]);

  if (!user?.isPlatformAdmin) {
    return <div className="p-8 text-gray-400">{t("adm.adminOnly")}</div>;
  }

  return <>{children}</>;
}
