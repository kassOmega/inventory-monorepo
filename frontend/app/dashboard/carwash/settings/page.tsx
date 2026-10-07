"use client";

import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";

export default function CarWashSettingsPage() {
  const { hasPermission } = useAuth();
  const { t } = useTranslation();
  const [slotMinutes, setSlotMinutes] = useState("30");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const canEdit = hasPermission("carwash.settings.edit");

  useEffect(() => {
    api.get("/carwash/settings").then((r) => setSlotMinutes(String(r.data?.slotMinutes ?? 30))).catch(() => undefined);
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaved(false);
    try {
      await api.patch("/carwash/settings", { slotMinutes: Number(slotMinutes) || 30 });
      setSaved(true);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("carwash.failedSave"));
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">{t("carwash.settings")}</h1>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}
      {saved && <div className="bg-green-50 text-green-700 p-3 rounded text-sm">{t("carwash.settingsSaved")}</div>}

      <form onSubmit={save} className="bg-white p-4 rounded-lg border border-gray-200 grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="text-sm text-gray-600">
          {t("carwash.bookingSlot")}
          <input value={slotMinutes} onChange={(e) => setSlotMinutes(e.target.value)} type="number" min="5" disabled={!canEdit} className="border border-gray-300 rounded p-2 text-sm w-full mt-1" />
        </label>
        {canEdit && <button type="submit" className="bg-blue-600 text-white rounded px-4 py-2 text-sm font-medium self-end">{t("carwash.saveSettings")}</button>}
      </form>
    </div>
  );
}
