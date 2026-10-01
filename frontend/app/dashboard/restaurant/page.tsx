"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

export default function RestaurantRedirect() {
  const router = useRouter();
  const { t } = useTranslation();
  useEffect(() => {
    router.replace("/dashboard/food/orders");
  }, [router]);
  return <p className="p-8 text-gray-400">{t("common.redirecting")}</p>;
}

