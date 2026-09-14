"use client";

import FacilityDashboard from "@/app/components/FacilityDashboard";
import { useParams } from "next/navigation";

export default function CustomServicePage() {
  const params = useParams<{ key: string }>();
  return <FacilityDashboard customKey={params.key} />;
}
