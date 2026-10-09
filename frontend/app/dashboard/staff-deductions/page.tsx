"use client";

// Staff Loans & Penalties: pick an employee (staff member or car-wash washer),
// see and manage their loans/penalties, and configure the tenant's recovery cap.
import api from "@/lib/api";
import Button from "@/app/components/Button";
import Loading from "@/app/components/Loading";
import DeductionsPanel from "@/app/components/DeductionsPanel";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/app/components/ToastProvider";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

interface StaffOpt {
  key: string;
  userId?: number;
  washerId?: number;
  name: string;
  sub: string;
}

export default function StaffDeductionsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { hasPermission } = useAuth();
  const canView = hasPermission("deductions.view") || hasPermission("deductions.manage");
  const canManage = hasPermission("deductions.manage");

  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<StaffOpt[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [cap, setCap] = useState("");
  const [savingCap, setSavingCap] = useState(false);

  const load = useCallback(async () => {
    try {
      const [usersRes, washersRes, capRes] = await Promise.all([
        api.get("/users").catch(() => ({ data: [] })),
        api.get("/carwash/washers").catch(() => ({ data: [] })),
        api.get("/employee-deductions/cap").catch(() => ({ data: { deductionCapPercent: 30 } })),
      ]);
      const users = Array.isArray(usersRes.data) ? usersRes.data : (usersRes.data?.data ?? []);
      const washers = Array.isArray(washersRes.data) ? washersRes.data : [];
      const opts: StaffOpt[] = [
        ...users.map((u: any) => ({
          key: `u-${u.id}`,
          userId: u.id,
          name: u.name,
          sub: u.role?.name ?? "Staff",
        })),
        ...washers.map((w: any) => ({
          key: `w-${w.id}`,
          washerId: w.id,
          name: w.name,
          sub: t("deductions.source.COMMISSION"),
        })),
      ];
      setOptions(opts);
      if (opts.length > 0) setSelected((s) => s || opts[0].key);
      setCap(String(capRes.data.deductionCapPercent ?? 30));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const current = useMemo(
    () => options.find((o) => o.key === selected),
    [options, selected],
  );

  const saveCap = async () => {
    setSavingCap(true);
    try {
      await api.patch("/employee-deductions/cap", { percent: Number(cap) || 0 });
      toast.success(t("common.success"));
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? t("deductions.saveFail"));
    } finally {
      setSavingCap(false);
    }
  };

  if (!canView) {
    return <p className="text-gray-400 p-8">{t("adm.adminOnly")}</p>;
  }
  if (loading) return <Loading className="py-24" />;

  return (
    <div className="space-y-6 max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-800">{t("deductions.title")}</h1>

      {canManage && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="font-semibold text-gray-800">{t("deductions.capSetting")}</h2>
          <div className="mt-2 flex items-end gap-3 flex-wrap">
            <label className="text-sm text-gray-600">
              {t("deductions.capPercent")}
              <input
                type="number"
                min="0"
                max="100"
                value={cap}
                onChange={(e) => setCap(e.target.value)}
                className="block mt-1 w-28 border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
              />
            </label>
            <Button loading={savingCap} onClick={saveCap}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <label className="block text-sm text-gray-600 max-w-sm">
          {t("deductions.selectEmployee")}
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="mt-1 border border-gray-300 rounded-lg p-2 text-sm w-full bg-white"
          >
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.name} — {o.sub}
              </option>
            ))}
          </select>
        </label>
      </div>

      {current ? (
        <DeductionsPanel
          key={current.key}
          userId={current.userId}
          washerId={current.washerId}
          personName={current.name}
          canManage={canManage}
        />
      ) : (
        <p className="text-gray-400 text-sm">{t("common.noData")}</p>
      )}
    </div>
  );
}
