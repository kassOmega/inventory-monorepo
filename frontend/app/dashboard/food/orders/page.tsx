"use client";

import { Suspense } from "react";
import FoodServicePanel from "@/app/components/FoodServicePanel";
import { useTranslation } from "react-i18next";
import Loading from "../../../components/Loading";

export default function FoodOrdersPage() {
  const { t } = useTranslation();
  return (
    <Suspense fallback={<Loading className="py-24" />}>
      <FoodServicePanel title={t("nav.orders")} />
    </Suspense>
  );
}
