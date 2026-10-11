"use client";

import { useAuth } from "@/context/AuthContext";
import { VERTICAL_LABELS, verticalLabel, HOSPITALITY_SERVICES, DEFAULT_HOSPITALITY_SERVICES, hospitalityServiceName as serviceName, hospitalityServiceDescription } from "@/lib/verticals";
import api from "@/lib/api";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import SubscriptionCard from "@/app/components/SubscriptionCard";
import { useState } from "react";
import Button from "@/app/components/Button";

export default function BusinessesPage() {
  const { user, activeOrganizationId, switchOrganization, refreshUser } = useAuth();
  const confirm = useConfirm();
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
  const [savingSettings, setSavingSettings] = useState(false);
  const [services, setServices] = useState<any[]>([]);
  const [serviceSaving, setServiceSaving] = useState<number | null>(null);
  const [publicConfig, setPublicConfig] = useState({
    showPublicPrices: true,
    showPublicBusinessInfo: true,
    showPriceListBusinessInfo: true,
  });
  const [publicSaving, setPublicSaving] = useState(false);
  const [policy, setPolicy] = useState({
    enablePackageRouting: false,
    enableRoomFolioCharging: false,
    allowPackagePriceCompensation: true,
    defaultExcessSettlementMode: "FLEXIBLE",
  });
  const [policySaving, setPolicySaving] = useState(false);
  const [settingsBusinessType, setSettingsBusinessType] = useState("RETAIL");
  const [customOpen, setCustomOpen] = useState(false);
  const [customForm, setCustomForm] = useState({ name: "", key: "" });

  const [newStandalone, setNewStandalone] = useState(false);
  const [upgradeFor, setUpgradeFor] = useState<any>(null);
  const [upgradeName, setUpgradeName] = useState("");
  const [upgrading, setUpgrading] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  // The active business's subscription (shown as a card near the top).
  const [subscription, setSubscription] = useState<any>(null);

  useEffect(() => {
    if (!activeOrganizationId) {
      setSubscription(null);
      return;
    }
    api
      .get("/subscriptions/me")
      .then((r) => setSubscription(r.data))
      .catch(() => setSubscription(null));
  }, [activeOrganizationId]);

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
    setSavingEdit(true);
    try {
      await api.patch(`/tenants/${editing.organizationId}`, {
        name: editForm.name,
        businessType: editForm.businessType,
      });
      setEditing(null);
      await refreshUser();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("biz.updateFail"));
    } finally {
      setSavingEdit(false);
    }
  };

  const closeSettings = () => {
    setSettingsFor(null);
    setSettingsForm(null);
    setCustomOpen(false);
  };

  const openSettings = async (m: any) => {
    setError("");
    switchOrganization(m.organizationId);
    try {
      const [cash, servicesRes, orgRes] = await Promise.all([
        api.get("/cashier/settings"),
        api.get(`/tenants/${m.organizationId}/services`),
        api.get(`/tenants/${m.organizationId}`),
      ]);
      const s = orgRes.data?.settings ?? {};
      const bt = orgRes.data?.businessType ?? "RETAIL";
      setSettingsFor(m);
      setSettingsForm({
        requireCashierConfirmation: cash.data.requireCashierConfirmation,
        enableFloatManagement: cash.data.enableFloatManagement,
      });
      setServices(Array.isArray(servicesRes.data) ? servicesRes.data : []);
      setSettingsBusinessType(bt);
      setPolicy({
        enablePackageRouting: s.enablePackageRouting === true,
        enableRoomFolioCharging: s.enableRoomFolioCharging === true,
        allowPackagePriceCompensation: s.allowPackagePriceCompensation !== false,
        defaultExcessSettlementMode: [
          "FLEXIBLE",
          "DEFER_TO_FOLIO_ONLY",
          "COLLECT_NOW_ONLY",
        ].includes(s.defaultExcessSettlementMode)
          ? s.defaultExcessSettlementMode
          : "FLEXIBLE",
      });
      setPublicConfig({
        showPublicPrices: s.showPublicPrices ?? bt !== "RETAIL",
        showPublicBusinessInfo: s.showPublicBusinessInfo ?? true,
        showPriceListBusinessInfo: s.showPriceListBusinessInfo ?? true,
      });
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("biz.loadSettingsFail"));
    }
  };

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSavingSettings(true);
    try {
      await api.put("/cashier/settings", {
        requireCashierConfirmation: settingsForm.requireCashierConfirmation,
        enableFloatManagement: settingsForm.enableFloatManagement,
      });
      closeSettings();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("biz.saveSettingsFail"));
    } finally {
      setSavingSettings(false);
    }
  };

  const toggleService = async (service: any) => {
    if (!settingsFor) return;
    const prev = services;
    setServiceSaving(service.id);
    setError("");
    setServices(
      services.map((s) =>
        s.id === service.id ? { ...s, isEnabled: !s.isEnabled } : s,
      ),
    );
    try {
      await api.patch(`/tenants/${settingsFor.organizationId}/services/${service.id}`, {
        isEnabled: !service.isEnabled,
      });
      window.dispatchEvent(new Event("services:changed"));
    } catch (err: any) {
      setServices(prev);
      setError(err?.response?.data?.message ?? t("biz.set.updateServiceFail"));
    } finally {
      setServiceSaving(null);
    }
  };

  const createCustomService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settingsFor || !customForm.name.trim()) return;
    setError("");
    try {
      await api.post(`/tenants/${settingsFor.organizationId}/services`, {
        name: customForm.name.trim(),
        key: customForm.key.trim() || undefined,
      });
      setCustomOpen(false);
      setCustomForm({ name: "", key: "" });
      const r = await api.get(`/tenants/${settingsFor.organizationId}/services`);
      setServices(Array.isArray(r.data) ? r.data : []);
      window.dispatchEvent(new Event("services:changed"));
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("biz.set.createServiceFail"));
    }
  };

  const removeCustomService = async (s: any) => {
    if (!settingsFor) return;
    if (!(await confirm(t("biz.set.deleteConfirm", { name: serviceName(s) })))) return;
    setError("");
    try {
      await api.delete(`/tenants/${settingsFor.organizationId}/services/${s.id}`);
      const r = await api.get(`/tenants/${settingsFor.organizationId}/services`);
      setServices(Array.isArray(r.data) ? r.data : []);
      window.dispatchEvent(new Event("services:changed"));
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("biz.set.deleteServiceFail"));
    }
  };

  const savePublicConfig = async (next: any) => {
    if (!settingsFor) return;
    setPublicSaving(true);
    setError("");
    const prev = publicConfig;
    setPublicConfig(next);
    try {
      const org = await api.get(`/tenants/${settingsFor.organizationId}`);
      await api.patch(`/tenants/${settingsFor.organizationId}/settings`, {
        settings: {
          ...(org.data?.settings ?? {}),
          showPublicPrices: next.showPublicPrices,
          showPublicBusinessInfo: next.showPublicBusinessInfo,
          showPriceListBusinessInfo: next.showPriceListBusinessInfo,
        },
      });
    } catch (err: any) {
      setPublicConfig(prev);
      setError(err?.response?.data?.message ?? t("biz.set.savePolicyFail"));
    } finally {
      setPublicSaving(false);
    }
  };

  const savePolicy = async (next: any) => {
    if (!settingsFor) return;
    setPolicySaving(true);
    setError("");
    const prev = policy;
    setPolicy(next);
    try {
      const org = await api.get(`/tenants/${settingsFor.organizationId}`);
      await api.patch(`/tenants/${settingsFor.organizationId}/settings`, {
        settings: {
          ...(org.data?.settings ?? {}),
          enablePackageRouting: next.enablePackageRouting,
          enableRoomFolioCharging: next.enableRoomFolioCharging,
          allowPackagePriceCompensation: next.allowPackagePriceCompensation,
          defaultExcessSettlementMode: next.defaultExcessSettlementMode,
        },
      });
    } catch (err: any) {
      setPolicy(prev);
      setError(err?.response?.data?.message ?? t("biz.set.savePolicyFail"));
    } finally {
      setPolicySaving(false);
    }
  };

  const deleteBusiness = async (m: any) => {
    if (!(await confirm(t("biz.confirmDelete", { name: m.organizationName })))) return;
    setError("");
    setBusyKey(`del-${m.organizationId}`);
    try {
      await api.delete(`/tenants/${m.organizationId}`);
      if (activeOrganizationId === m.organizationId) localStorage.removeItem("activeOrganizationId");
      await refreshUser();
      if (activeOrganizationId === m.organizationId) window.location.href = "/dashboard";
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("biz.deleteFail"));
    } finally {
      setBusyKey(null);
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
      {subscription && <SubscriptionCard subscription={subscription} />}
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
            {Object.keys(VERTICAL_LABELS).map((value) => (
              <option key={value} value={value}>{t(`verticals.${value.toLowerCase()}`)}</option>
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
                          {t(`hospitalityServices.${svc.i18nKey}`)}
                        </span>
                        <span className="block text-[11px] text-gray-400">
                          {t(`hospitalityServices.${svc.i18nKey}_DESC`)}
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
            <Button type="submit" loading={submitting} className="!p-2 !text-sm">
              {submitting ? t("biz.creating") : t("biz.createBusiness")}
            </Button>
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
                    {verticalLabel(m.businessType) || m.businessType} · {m.roleName ?? t("biz.member")}
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
                      <button onClick={() => openSettings(m)} className="text-xs text-gray-600 hover:underline">
                        {t("biz.settings")}
                      </button>
                      <Button variant="ghost" size="sm" loading={busyKey === `del-${m.organizationId}`} onClick={() => deleteBusiness(m)} className="!px-0 text-xs text-red-600 hover:underline">{t("roles.delete")}</Button>
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
                {Object.keys(VERTICAL_LABELS).map((value) => (
                  <option key={value} value={value}>{t(`verticals.${value.toLowerCase()}`)}</option>
                ))}
              </select>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditing(null)} className="px-3 py-2 text-sm text-gray-600">{t("common.cancel")}</button>
                <Button type="submit" loading={savingEdit} variant="dark" className="!px-3 !text-sm">{t("biz.saveBtn")}</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {settingsFor && settingsForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-2xl shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-800">{t("biz.settingsTitle", { name: settingsFor.organizationName })}</h2>
              <button type="button" onClick={closeSettings} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>

            {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm mb-3">{error}</div>}

            <form onSubmit={saveSettings} className="space-y-3 border-b border-gray-100 pb-4 mb-4">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={settingsForm.requireCashierConfirmation} onChange={(e) => setSettingsForm({ ...settingsForm, requireCashierConfirmation: e.target.checked })} className="rounded" />
                {t("biz.requireCashier")}
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={settingsForm.enableFloatManagement} onChange={(e) => setSettingsForm({ ...settingsForm, enableFloatManagement: e.target.checked })} className="rounded" />
                {t("biz.enableFloat")}
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={closeSettings} className="px-3 py-2 text-sm text-gray-600">{t("common.cancel")}</button>
                <Button type="submit" loading={savingSettings} variant="dark" className="!px-3 !text-sm">{t("biz.saveBtn")}</Button>
              </div>
            </form>

            {settingsBusinessType === "HOSPITALITY" && (
            <div className="mb-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">{t("biz.set.activeServices")}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{t("biz.set.activeServicesHint")}</p>
                </div>
                <button type="button" onClick={() => { setCustomForm({ name: "", key: "" }); setCustomOpen(true); }} className="text-xs bg-blue-600 text-white rounded px-2.5 py-1.5 font-medium hover:bg-blue-700 shrink-0">
                  {t("biz.set.addCustom")}
                </button>
              </div>
              <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
                {services.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800">
                        {serviceName(s)}
                        {s.serviceType === "CUSTOM" && (
                          <span className="ml-2 bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded text-[10px]">{t("biz.set.customTag")}</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-400">
                        {hospitalityServiceDescription(s.serviceType) || (s.customName ? t("biz.set.customServiceDesc") : "")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {s.serviceType === "CUSTOM" && (
                        <button type="button" onClick={() => removeCustomService(s)} className="text-xs text-red-600 hover:underline">{t("common.del")}</button>
                      )}
                      <button
                        type="button"
                        role="switch"
                        aria-checked={s.isEnabled}
                        disabled={serviceSaving === s.id}
                        onClick={() => toggleService(s)}
                        className={`relative w-12 h-7 rounded-full transition shrink-0 disabled:opacity-60 ${s.isEnabled ? "bg-green-500" : "bg-gray-300"}`}
                      >
                        <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${s.isEnabled ? "left-[22px]" : "left-0.5"}`} />
                      </button>
                    </div>
                  </li>
                ))}
                {services.length === 0 && (
                  <li className="px-3 py-6 text-sm text-gray-400 text-center">{t("biz.set.noServices")}</li>
                )}
              </ul>
            </div>
            )}

            <div className="mb-4">
              <div className="mb-2">
                <h3 className="text-sm font-semibold text-gray-800">{t("biz.set.publicTitle")}</h3>
                <p className="text-xs text-gray-400 mt-0.5">{t("biz.set.publicHint")}</p>
              </div>
              <div className="space-y-2">
                {[
                  { key: "showPublicPrices", label: t("biz.set.showPublicPrices"), hint: t("biz.set.showPublicPricesHint") },
                  { key: "showPublicBusinessInfo", label: t("biz.set.showPublicBusinessInfo"), hint: t("biz.set.showPublicBusinessInfoHint") },
                  { key: "showPriceListBusinessInfo", label: t("biz.set.showPriceListBusinessInfo"), hint: t("biz.set.showPriceListBusinessInfoHint") },
                ].map((row) => (
                  <label key={row.key} className="flex items-start justify-between gap-3 py-2 border-b border-gray-100">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{row.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{row.hint}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={(publicConfig as any)[row.key]}
                      disabled={publicSaving}
                      onClick={() => savePublicConfig({ ...publicConfig, [row.key]: !(publicConfig as any)[row.key] })}
                      className={`relative w-12 h-7 rounded-full transition shrink-0 disabled:opacity-60 ${(publicConfig as any)[row.key] ? "bg-green-500" : "bg-gray-300"}`}
                    >
                      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${(publicConfig as any)[row.key] ? "left-[22px]" : "left-0.5"}`} />
                    </button>
                  </label>
                ))}
              </div>
            </div>

            {settingsBusinessType === "HOSPITALITY" && (
              <div>
                <div className="mb-2">
                  <h3 className="text-sm font-semibold text-gray-800">{t("biz.set.policyTitle")}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{t("biz.set.policyHint")}</p>
                </div>
                <div className="space-y-2">
                  <label className="flex items-start justify-between gap-3 py-2 border-b border-gray-100">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{t("biz.set.enableRouting")}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{t("biz.set.enableRoutingHint")}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={policy.enablePackageRouting}
                      disabled={policySaving}
                      onClick={() => savePolicy({ ...policy, enablePackageRouting: !policy.enablePackageRouting })}
                      className={`relative w-12 h-7 rounded-full transition shrink-0 disabled:opacity-60 ${policy.enablePackageRouting ? "bg-green-500" : "bg-gray-300"}`}
                    >
                      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${policy.enablePackageRouting ? "left-[22px]" : "left-0.5"}`} />
                    </button>
                  </label>

                  <label className="flex items-start justify-between gap-3 py-2 border-b border-gray-100">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{t("biz.set.enableFolioCharging")}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{t("biz.set.enableFolioChargingHint")}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={policy.enableRoomFolioCharging}
                      disabled={policySaving}
                      onClick={() => savePolicy({ ...policy, enableRoomFolioCharging: !policy.enableRoomFolioCharging })}
                      className={`relative w-12 h-7 rounded-full transition shrink-0 disabled:opacity-60 ${policy.enableRoomFolioCharging ? "bg-green-500" : "bg-gray-300"}`}
                    >
                      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${policy.enableRoomFolioCharging ? "left-[22px]" : "left-0.5"}`} />
                    </button>
                  </label>

                  <label className="flex items-start justify-between gap-3 py-2 border-b border-gray-100">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{t("biz.set.allowCompensation")}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{t("biz.set.allowCompensationHint")}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={policy.allowPackagePriceCompensation}
                      disabled={policySaving}
                      onClick={() => savePolicy({ ...policy, allowPackagePriceCompensation: !policy.allowPackagePriceCompensation })}
                      className={`relative w-12 h-7 rounded-full transition shrink-0 disabled:opacity-60 ${policy.allowPackagePriceCompensation ? "bg-green-500" : "bg-gray-300"}`}
                    >
                      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${policy.allowPackagePriceCompensation ? "left-[22px]" : "left-0.5"}`} />
                    </button>
                  </label>

                  <div className="flex items-center justify-between gap-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{t("biz.set.settlementMode")}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{t("biz.set.settlementModeHint")}</p>
                    </div>
                    <select
                      value={policy.defaultExcessSettlementMode}
                      disabled={policySaving}
                      onChange={(e) => savePolicy({ ...policy, defaultExcessSettlementMode: e.target.value })}
                      className="border border-gray-300 rounded p-2 text-sm bg-white"
                    >
                      <option value="FLEXIBLE">{t("biz.set.modeFlexible")}</option>
                      <option value="DEFER_TO_FOLIO_ONLY">{t("biz.set.modeDeferFolio")}</option>
                      <option value="COLLECT_NOW_ONLY">{t("biz.set.modeCollectNow")}</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {customOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-3">{t("biz.set.addCustomTitle")}</h2>
            <p className="text-xs text-gray-400 mb-3">{t("biz.set.addCustomHint")}</p>
            <form onSubmit={createCustomService} className="space-y-3">
              <input
                value={customForm.name}
                onChange={(e) => setCustomForm({ ...customForm, name: e.target.value })}
                placeholder={t("biz.set.serviceNamePh")}
                className="border border-gray-300 rounded p-2 text-sm w-full"
                required
              />
              <input
                value={customForm.key}
                onChange={(e) => setCustomForm({ ...customForm, key: e.target.value })}
                placeholder={t("biz.set.serviceKeyPh")}
                className="border border-gray-300 rounded p-2 text-sm w-full"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setCustomOpen(false)} className="px-3 py-2 text-sm text-gray-600">
                  {t("common.cancel")}
                </button>
                <button type="submit" className="bg-blue-600 text-white rounded px-3 py-2 text-sm font-medium">
                  {t("common.create")}
                </button>
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
                <Button type="submit" loading={upgrading} variant="emerald" className="!px-3 !text-sm">
                  {upgrading ? t("biz.upgrading") : t("biz.upgrade")}
                </Button>
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

