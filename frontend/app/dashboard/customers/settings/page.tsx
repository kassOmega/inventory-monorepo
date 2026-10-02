"use client";
// Loyalty programme settings (one row per organization). Off by default: points
// only start accruing once the owner turns this on and sets a rate.
import Loading from "@/app/components/Loading";
import { useToast } from "@/app/components/ToastProvider";
import api, { markHandled } from "@/lib/api";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export default function LoyaltySettingsPage() {
  const { t } = useTranslation();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  // Stored as points per 1.00 of sale value; shown as "per 100" because that is
  // how a rate like "1 point per 100 birr" is actually spoken.
  const [pointsPer100, setPointsPer100] = useState("1");
  const [valuePerPoint, setValuePerPoint] = useState("0");
  const [minRedeemPoints, setMinRedeemPoints] = useState("0");

  useEffect(() => {
    api
      .get("/customers/loyalty-program")
      .then((r) => {
        setEnabled(r.data?.enabled === true);
        setPointsPer100(
          String(
            Math.round((r.data?.pointsPerCurrency ?? 0.01) * 100 * 100) / 100,
          ),
        );
        setValuePerPoint(String(r.data?.valuePerPoint ?? 0));
        setMinRedeemPoints(String(r.data?.minRedeemPoints ?? 0));
      })
      .catch((err: any) => {
        markHandled(err);
        toast.error(t("crm.loadFailed"));
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const per100 = Number(pointsPer100);
      await api.put("/customers/loyalty-program", {
        enabled,
        pointsPerCurrency:
          Number.isFinite(per100) && per100 >= 0 ? per100 / 100 : 0,
        valuePerPoint: Number(valuePerPoint) || 0,
        minRedeemPoints: Math.max(0, Math.round(Number(minRedeemPoints) || 0)),
      });
      toast.success(t("crm.programSaved"));
    } catch (err: any) {
      markHandled(err);
      toast.error(t("crm.programSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading className="py-24" />;

  const label = "block text-sm font-medium text-gray-500 mb-1";
  const input = "border p-2 rounded-lg w-full text-sm bg-white";

  return (
    <div className="max-w-xl">
      <Link
        href="/dashboard/customers"
        className="text-xs text-blue-600 hover:underline"
      >
        ← {t("crm.title")}
      </Link>
      <h1 className="text-xl sm:text-2xl font-bold text-gray-800 mb-1">
        {t("crm.programTitle")}
      </h1>
      <p className="text-xs sm:text-sm text-gray-500 mb-4">
        {t("crm.programEnabledHint")}
      </p>

      <form
        onSubmit={save}
        className="bg-white rounded-xl shadow-sm border p-4 grid grid-cols-1 sm:grid-cols-2 gap-4"
      >
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700 sm:col-span-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          {t("crm.programEnabled")}
        </label>

        <div>
          <label className={label}>{t("crm.pointsPer100")}</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={pointsPer100}
            onChange={(e) => setPointsPer100(e.target.value)}
            className={input}
          />
        </div>
        <div>
          <label className={label}>{t("crm.valuePerPoint")}</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={valuePerPoint}
            onChange={(e) => setValuePerPoint(e.target.value)}
            className={input}
          />
        </div>
        <div>
          <label className={label}>{t("crm.minRedeemPoints")}</label>
          <input
            type="number"
            min="0"
            step="1"
            value={minRedeemPoints}
            onChange={(e) => setMinRedeemPoints(e.target.value)}
            className={input}
          />
        </div>
        <p className="text-[11px] text-gray-500 sm:col-span-2">
          {t("crm.redeemLaterHint")}
        </p>

        <button
          type="submit"
          disabled={saving}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 sm:col-span-2"
        >
          {saving ? t("common.saving") : t("crm.saveSettings")}
        </button>
      </form>
    </div>
  );
}
