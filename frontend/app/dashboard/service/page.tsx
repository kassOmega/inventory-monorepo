"use client";

import ServiceDashboard from "@/app/components/ServiceDashboard";
import { useTranslation } from "react-i18next";

export default function ServiceOverviewPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">{t("svc.title")}</h1>
      <ServiceDashboard />
    </div>
  );
}
