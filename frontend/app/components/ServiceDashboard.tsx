"use client";

import api from "@/lib/api";
import Link from "next/link";
import { useEffect, useState } from "react";

// Shared SERVICE-vertical overview (stat tiles + quick actions). Used by
// `/dashboard/service` and by the dashboard home for SERVICE staff — mirrors how
// ManufacturingDashboard / HospitalityDashboard are consumed.
interface ServiceDashboardData {
  todayBookings?: number;
  openTickets?: number;
  paidToday?: number;
  activeServices?: number;
}

export default function ServiceDashboard() {
  const [data, setData] = useState<ServiceDashboardData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get("/service/dashboard")
      .then((r) => setData(r.data))
      .catch((e: unknown) => {
        const msg = (e as { response?: { data?: { message?: string } } })
          ?.response?.data?.message;
        setError(msg ?? "Failed to load");
      });
  }, []);

  const cards = [
    { label: "Bookings Today", value: data?.todayBookings ?? 0, href: "/dashboard/service/bookings" },
    { label: "Open Tickets", value: data?.openTickets ?? 0, href: "/dashboard/service/tickets" },
    { label: "Paid Today (ETB)", value: (data?.paidToday ?? 0).toLocaleString(), href: "/dashboard/service/tickets" },
    { label: "Active Services", value: data?.activeServices ?? 0, href: "/dashboard/service/catalog" },
  ];

  return (
    <div className="space-y-6">
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="bg-white p-4 rounded-lg border border-gray-200 hover:border-blue-300 transition"
          >
            <p className="text-xs text-gray-500">{c.label}</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{c.value}</p>
          </Link>
        ))}
      </div>
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-800 mb-2">Quick Actions</h2>
        <div className="flex gap-2 flex-wrap text-sm">
          <Link href="/dashboard/service/bookings" className="px-3 py-2 rounded bg-blue-600 text-white">New Booking</Link>
          <Link href="/dashboard/service/tickets" className="px-3 py-2 rounded bg-gray-800 text-white">New Ticket</Link>
          <Link href="/dashboard/service/catalog" className="px-3 py-2 rounded border border-gray-300 text-gray-700">Manage Catalog</Link>
        </div>
      </div>
    </div>
  );
}
