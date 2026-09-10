"use client";

import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export default function ManufacturingSettingsPage() {
  const { t } = useTranslation();
  const { activeOrganizationId } = useAuth();
  const [trackBOM, setTrackBOM] = useState(true);
  const [trackWorkOrders, setTrackWorkOrders] = useState(true);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!activeOrganizationId) return;
    api
      .get(`/tenants/${activeOrganizationId}`)
      .then((r) => {
        const p = r.data?.profile;
        if (p) {
          setTrackBOM(p.trackBOM !== false);
          setTrackWorkOrders(p.trackWorkOrders !== false);
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
        trackBOM,
        trackWorkOrders,
      });
      setMsg(t("mfg.settings.saved"));
      setTimeout(() => setMsg(""), 2500);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("mfg.settings.failed"));
    }
  };

  const labelClass = "flex items-center gap-2 text-sm text-gray-700";

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">
        {t("mfg.settings.title")}
      </h1>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}
      {msg && <div className="bg-green-50 text-green-700 p-3 rounded text-sm">{msg}</div>}
      <form onSubmit={save} className="bg-white p-5 rounded-lg border border-gray-200 space-y-4">
        <label className={labelClass}>
          <input type="checkbox" checked={trackBOM} onChange={(e) => setTrackBOM(e.target.checked)} className="rounded" />
          {t("mfg.settings.trackBomLabel")}
        </label>
        <label className={labelClass}>
          <input type="checkbox" checked={trackWorkOrders} onChange={(e) => setTrackWorkOrders(e.target.checked)} className="rounded" />
          {t("mfg.settings.trackWorkOrdersLabel")}
        </label>
        <button type="submit" className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium">
          {t("mfg.settings.save")}
        </button>
      </form>
    </div>
  );
}

