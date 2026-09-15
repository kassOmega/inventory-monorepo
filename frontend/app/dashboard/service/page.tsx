"use client";

import ServiceDashboard from "@/app/components/ServiceDashboard";

export default function ServiceOverviewPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Services & Consulting</h1>
      <ServiceDashboard />
    </div>
  );
}
