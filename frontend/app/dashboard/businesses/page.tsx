"use client";

import { useAuth } from "@/context/AuthContext";
import { VERTICAL_LABELS, HOSPITALITY_SERVICES, DEFAULT_HOSPITALITY_SERVICES } from "@/lib/verticals";
import api from "@/lib/api";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useState } from "react";

export default function BusinessesPage() {
  const { user, activeOrganizationId, switchOrganization, refreshUser } = useAuth();
  const confirm = useConfirm();
  const router = useRouter();
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [businessType, setBusinessType] = useState("RETAIL");
  const [newServices, setNewServices] = useState<string[]>(
    DEFAULT_HOSPITALITY_SERVICES,
  );
  const [tradeLicense, setTradeLicense] = useState<File | null>(null);
  const [tinCertificate, setTinCertificate] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [editing, setEditing] = useState<any>(null);
  const [editForm, setEditForm] = useState({ name: "", businessType: "RETAIL" });

  const [settingsFor, setSettingsFor] = useState<any>(null);
  const [settingsForm, setSettingsForm] = useState<any>(null);

  const [newStandalone, setNewStandalone] = useState(false);
  const [upgradeFor, setUpgradeFor] = useState<any>(null);
  const [upgradeName, setUpgradeName] = useState("");
  const [upgrading, setUpgrading] = useState(false);

  const memberships = user?.memberships ?? [];

  const ownedCount = memberships.filter((m) => m.isSystem).length;
  const businessLimitReached = ownedCount >= 2;

  const createBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await api.post("/tenants", {
        name,
        businessType,
        standalone: newStandalone,
        ...(businessType === "HOSPITALITY" ? { hospitalityServices: newServices } : {}),
      });
      const orgId = res.data.id;

      // Optionally attach verification documents at creation time. The business
      // starts PENDING verification; the AI reviewer processes the uploads.
      const uploadDoc = async (documentType: string, file: File) => {
        const form = new FormData();
        form.append("documentType", documentType);
        form.append("file", file);
        await api.post(`/verification/business/${orgId}/documents`, form, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      };
      if (tradeLicense) await uploadDoc("TRADE_LICENSE", tradeLicense);
      if (tinCertificate) await uploadDoc("TIN_CERTIFICATE", tinCertificate);

      await refreshUser();
      localStorage.setItem("activeOrganizationId", String(orgId));
      // Send the owner to the verification page for this new business.
      window.location.href = "/dashboard/verification";
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("biz.createFail"));
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (m: any) => {
    setEditing(m);
    setEditForm({ name: m.organizationName, businessType: m.businessType });
  };
  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api.patch(`/tenants/${editing.organizationId}`, {
        name: editForm.name,
        businessType: editForm.businessType,
      });
      setEditing(null);
      await refreshUser();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("biz.updateFail"));
    }
  };

  const openSettings = async (m: any) => {
    setError("");
    try {
      const r = await api.get(`/tenants/${m.organizationId}`);
      const s = r.data.settings ?? {};
      setSettingsFor(m);
      setSettingsForm({
        requireCashierConfirmation: s.requireCashierConfirmation !== false,
        enableFloatManagement: !!s.enableFloatManagement,
      });
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("biz.loadSettingsFail"));
    }
  };
  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api.patch(`/tenants/${settingsFor.organizationId}/settings`, { settings: settingsForm });
      setSettingsFor(null);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("biz.saveSettingsFail"));
    }
  };

  const deleteBusiness = async (m: any) => {
    if (!(await confirm(t("biz.confirmDelete", { name: m.organizationName })))) return;
    setError("");
    try {
      await api.delete(`/tenants/${m.organizationId}`);
      if (activeOrganizationId === m.organizationId) localStorage.removeItem("activeOrganizationId");
      await refreshUser();
      if (activeOrganizationId === m.organizationId) window.location.href = "/dashboard";
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("biz.deleteFail"));
    }
  };

  // {t("biz.upgrade")} a standalone shop to a multi-location business. The owner names the
  // current (hidden) location; all existing inventory stays with it.
  const openUpgrade = async (m: any) => {
    setError("");
    try {
      const locs = await api.get("/locations");
      const first = Array.isArray(locs.data) ? locs.data[0] : null;
      setUpgradeName(first?.name ?? t("biz.defaultLocName", { name: m.organizationName }));
    } catch {
      setUpgradeName(t("biz.defaultLocName", { name: m.organizationName }));
    }
    setUpgradeFor(m);
  };

  const confirmUpgrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!upgradeName.trim()) return;
    setUpgrading(true);
    setError("");
    try {
      await api.patch(`/tenants/${upgradeFor.organizationId}`, {
        standalone: false,
        locationName: upgradeName.trim(),
      });
      setUpgradeFor(null);
      await refreshUser();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("biz.upgradeFail"));
    } finally {
      setUpgrading(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">{t("biz.myBusinesses")}</h1>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      {memberships.length === 0 && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 p-4 rounded-lg text-sm">
          {t("biz.noBizYet")}
        </div>
      )}

      {businessLimitReached && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-lg text-sm">
          {t("biz.limitReached")}
        </div>
      )}

      {user?.isOwnerAccount && !businessLimitReached && (
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <h2 className="font-semibold text-gray-800 mb-3">
            {memberships.length === 0 ? t("biz.createFirst") : t("biz.createNew")}
          </h2>
        <form onSubmit={createBusiness} className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            placeholder={t("biz.businessName")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border border-gray-300 rounded p-2 text-sm"
            required
          />
          <select value={businessType} onChange={(e) => setBusinessType(e.target.value)} className="border border-gray-300 rounded p-2 text-sm">
            {Object.entries(VERTICAL_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          {businessType === "HOSPITALITY" && (
            <div className="md:col-span-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
              <p className="block text-sm font-medium text-gray-700 mb-1">
                {t("hospitalityServices.title")}
              </p>
              <p className="text-[11px] text-gray-500 mb-3">
                {t("hospitalityServices.hint")}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {HOSPITALITY_SERVICES.map((svc) => {
                  const checked = newServices.includes(svc.value);
                  return (
                    <label
                      key={svc.value}
                      className={`flex items-start gap-2 rounded-lg border p-2.5 cursor-pointer transition ${
                        checked
                          ? "border-blue-600 bg-white ring-1 ring-blue-500"
                          : "border-gray-200 bg-white hover:border-gray-300"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setNewServices((prev) =>
                            prev.includes(svc.value)
                              ? prev.filter((v) => v !== svc.value)
                              : [...prev, svc.value],
                          )
                        }
                        className="mt-0.5 accent-blue-600"
                      />
                      <span>
                        <span className="block text-sm font-medium text-gray-800">
                          {t(`hospitalityServices.${svc.i18nKey}`, { defaultValue: svc.label })}
                        </span>
                        <span className="block text-[11px] text-gray-400">
                          {t(`hospitalityServices.${svc.i18nKey}_DESC`, { defaultValue: svc.description })}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("biz.standaloneQuestion")}
            </label>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-1.5 text-sm text-gray-700">
                <input type="radio" checked={newStandalone} onChange={() => setNewStandalone(true)} className="accent-emerald-600" />
                {t("biz.yes")}
              </label>
              <label className="flex items-center gap-1.5 text-sm text-gray-700">
                <input type="radio" checked={!newStandalone} onChange={() => setNewStandalone(false)} className="accent-emerald-600" />
                {t("biz.no")}
              </label>
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              {t("biz.standaloneHint")}
            </p>
          </div>
          <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FileInput
              label={t("biz.tradeLicense")}
              file={tradeLicense}
              onChange={setTradeLicense}
            />
            <FileInput
              label={t("biz.tinCert")}
              file={tinCertificate}
              onChange={setTinCertificate}
            />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <button type="submit" disabled={submitting} className="bg-blue-600 text-white rounded p-2 text-sm font-medium disabled:opacity-60">
              {submitting ? t("biz.creating") : t("biz.createBusiness")}
            </button>
          </div>
        </form>
        </div>
      )}

      {memberships.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <ul className="divide-y divide-gray-100">
            {memberships.map((m) => (
              <li key={m.organizationId} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{m.organizationName}</p>
                  <p className="text-xs text-gray-400">
                    {VERTICAL_LABELS[m.businessType] ?? m.businessType} · {m.roleName ?? t("biz.member")}
                    {m.standalone && (
                      <span className="ml-1.5 bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium">
                        {t("biz.standalone")}
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] mt-0.5">
                    {m.aiEnabled === false ? (
                      <span className="text-red-600">{t("biz.aiDisabled")}</span>
                    ) : m.aiTrialEndsAt ? (
                      <span className="text-blue-600">{t("biz.aiTrialEnds", { date: m.aiTrialEndsAt })}</span>
                    ) : (
                      <span className="text-emerald-600">{t("biz.aiEnabled")}</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {activeOrganizationId === m.organizationId ? (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">{t("biz.active")}</span>
                  ) : (
                    <button onClick={() => switchOrganization(m.organizationId)} className="text-sm text-blue-600 hover:underline">
                      {t("biz.switch")}
                    </button>
                  )}
                  {m.isSystem && (
                    <>
                      {m.standalone && (
                        <button onClick={() => openUpgrade(m)} className="text-xs text-emerald-600 hover:underline">
                          {t("biz.upgrade")}
                        </button>
                      )}
                      <button onClick={() => startEdit(m)} className="text-xs text-blue-600 hover:underline">{t("roles.edit")}</button>
                      <button onClick={() => openSettings(m)} className="text-xs text-gray-600 hover:underline">{t("biz.settings")}</button>
                      {m.businessType === "HOSPITALITY" && (
                        <button
                          onClick={() => {
                            switchOrganization(m.organizationId);
                            router.push("/dashboard/businesses/settings");
                          }}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          Services
                        </button>
                      )}
                      <button onClick={() => deleteBusiness(m)} className="text-xs text-red-600 hover:underline">{t("roles.delete")}</button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-3">{t("biz.editBusiness")}</h2>
            <form onSubmit={saveEdit} className="space-y-3">
              <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} placeholder={t("biz.businessName")} className="border border-gray-300 rounded p-2 text-sm w-full" required />
              <select value={editForm.businessType} onChange={(e) => setEditForm({ ...editForm, businessType: e.target.value })} className="border border-gray-300 rounded p-2 text-sm w-full">
                {Object.entries(VERTICAL_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditing(null)} className="px-3 py-2 text-sm text-gray-600">{t("common.cancel")}</button>
                <button type="submit" className="bg-gray-800 text-white rounded px-3 py-2 text-sm font-medium">{t("biz.saveBtn")}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {settingsFor && settingsForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-3">{t("biz.settingsTitle", { name: settingsFor.organizationName })}</h2>
            <form onSubmit={saveSettings} className="space-y-3">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={settingsForm.requireCashierConfirmation} onChange={(e) => setSettingsForm({ ...settingsForm, requireCashierConfirmation: e.target.checked })} className="rounded" />
                {t("biz.requireCashier")}
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={settingsForm.enableFloatManagement} onChange={(e) => setSettingsForm({ ...settingsForm, enableFloatManagement: e.target.checked })} className="rounded" />
                {t("biz.enableFloat")}
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setSettingsFor(null)} className="px-3 py-2 text-sm text-gray-600">{t("common.cancel")}</button>
                <button type="submit" className="bg-gray-800 text-white rounded px-3 py-2 text-sm font-medium">{t("biz.saveBtn")}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {upgradeFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-md shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-1">
              {t("biz.upgradeTitle")}
            </h2>
            <p className="text-xs text-gray-500 mb-3">
              {t("biz.upgradeIntro", { name: upgradeFor.organizationName })}
            </p>
            <form onSubmit={confirmUpgrade} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("biz.currentLocationName")}
                </label>
                <input
                  value={upgradeName}
                  onChange={(e) => setUpgradeName(e.target.value)}
                  placeholder={t("biz.mainShopPh")}
                  className="border border-gray-300 rounded p-2 text-sm w-full"
                  required
                />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setUpgradeFor(null)} className="px-3 py-2 text-sm text-gray-600">
                  {t("common.cancel")}
                </button>
                <button type="submit" disabled={upgrading} className="bg-emerald-600 text-white rounded px-3 py-2 text-sm font-medium disabled:opacity-60">
                  {upgrading ? t("biz.upgrading") : t("biz.upgrade")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function FileInput({
  label,
  file,
  onChange,
}: {
  label: string;
  file: File | null;
  onChange: (f: File | null) => void;
}) {
  return (
    <label className="border border-dashed border-gray-300 rounded p-2 bg-gray-50 cursor-pointer block">
      <span className="text-xs font-medium text-gray-600">{label}</span>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
        className="block text-xs text-gray-500 mt-1 w-full"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      {file && <span className="text-[11px] text-green-600 mt-1 block">✓ {file.name}</span>}
    </label>
  );
}

