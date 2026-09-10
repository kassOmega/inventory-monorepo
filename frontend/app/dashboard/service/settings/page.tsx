"use client";

import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { useEffect, useState } from "react";

export default function ServiceSettingsPage() {
  const { activeOrganizationId } = useAuth();
  const [hourlyBilling, setHourlyBilling] = useState(false);
  const [appointmentSlot, setAppointmentSlot] = useState(30);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!activeOrganizationId) return;
    api
      .get(`/tenants/${activeOrganizationId}`)
      .then((r) => {
        const p = r.data?.profile;
        if (p) {
          setHourlyBilling(!!p.hourlyBilling);
          setAppointmentSlot(p.appointmentSlot ?? 30);
        }
      })
      .catch(() => {});
  }, [activeOrganizationId]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrganizationId) return;
    setError("");
    setMsg("");
    try {
      await api.patch(`/tenants/${activeOrganizationId}/profile`, {
        hourlyBilling,
        appointmentSlot: Number(appointmentSlot) || 30,
      });
      setMsg("Settings saved");
      setTimeout(() => setMsg(""), 2500);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to save settings");
    }
  };

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Service Settings</h1>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}
      {msg && <div className="bg-green-50 text-green-700 p-3 rounded text-sm">{msg}</div>}
      <form onSubmit={save} className="bg-white p-5 rounded-lg border border-gray-200 space-y-4">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={hourlyBilling} onChange={(e) => setHourlyBilling(e.target.checked)} className="rounded" />
          Bill by the hour
        </label>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Appointment slot (minutes)</label>
          <input
            type="number"
            min="5"
            step="5"
            value={appointmentSlot}
            onChange={(e) => setAppointmentSlot(Number(e.target.value))}
            className="border border-gray-300 rounded p-2 text-sm w-full"
          />
        </div>
        <button type="submit" className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium">Save Settings</button>
      </form>
    </div>
  );
}
