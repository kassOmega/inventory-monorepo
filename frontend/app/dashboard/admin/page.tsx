"use client";

import { VERTICAL_LABELS } from "@/lib/verticals";
import api from "@/lib/api";
import { useEffect, useState } from "react";

export default function AdminOverview() {
  const [owners, setOwners] = useState(0);
  const [businesses, setBusinesses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [u, o] = await Promise.all([api.get("/admin/users"), api.get("/admin/organizations")]);
        setOwners(u.data.length);
        setBusinesses(o.data);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <p className="text-gray-500">Loading…</p>;

  const active = businesses.filter((b) => b.status === "ACTIVE").length;
  const inactive = businesses.length - active;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Overview</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <p className="text-xs text-gray-500">Owner Accounts</p>
          <p className="text-2xl font-bold text-gray-800">{owners}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <p className="text-xs text-gray-500">Businesses</p>
          <p className="text-2xl font-bold text-gray-800">{businesses.length}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <p className="text-xs text-gray-500">Active</p>
          <p className="text-2xl font-bold text-green-600">{active}</p>
        </div>
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <p className="text-xs text-gray-500">Inactive</p>
          <p className="text-2xl font-bold text-gray-500">{inactive}</p>
        </div>
      </div>

      <div className="bg-white p-4 rounded-lg border border-gray-200">
        <h2 className="font-semibold text-gray-800 mb-3">Recent Businesses</h2>
        <ul className="divide-y divide-gray-100 text-sm">
          {businesses.slice(0, 8).map((o) => {
            const owner = o.memberships?.[0]?.user;
            return (
              <li key={o.id} className="py-2 flex justify-between">
                <div>
                  <p className="font-medium text-gray-800">{o.name}</p>
                  <p className="text-xs text-gray-400">
                    {VERTICAL_LABELS[o.businessType] ?? o.businessType} · Owner: {owner?.name ?? "—"}
                  </p>
                </div>
                <span className={`text-xs ${o.status === "ACTIVE" ? "text-green-600" : "text-gray-400"}`}>
                  {o.status}
                </span>
              </li>
            );
          })}
          {businesses.length === 0 && <li className="text-gray-400 py-2">No businesses yet.</li>}
        </ul>
      </div>
    </div>
  );
}
