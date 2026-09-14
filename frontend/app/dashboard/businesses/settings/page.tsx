"use client";

import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/app/components/ConfirmProvider";
import api from "@/lib/api";
import {
  hospitalityServiceName as serviceName,
  HOSPITALITY_SERVICE_DESCRIPTIONS,
} from "@/lib/verticals";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

export default function BusinessSettingsPage() {
  const { user, activeOrganizationId, switchOrganization } = useAuth();
  const confirm = useConfirm();
  const owned = (user?.memberships ?? []).filter((m: any) => m.isSystem);
  const [orgId, setOrgId] = useState<number | null>(activeOrganizationId);
  const [services, setServices] = useState<any[]>([]);
  const [policy, setPolicy] = useState<any>({
    enablePackageRouting: false,
    enableRoomFolioCharging: false,
    allowPackagePriceCompensation: true,
    defaultExcessSettlementMode: "FLEXIBLE",
  });
  const [policySaving, setPolicySaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customForm, setCustomForm] = useState({ name: "", key: "" });

  const load = useCallback(async (id: number) => {
    setLoading(true);
    setError("");
    try {
      const [r, o] = await Promise.all([
        api.get(`/tenants/${id}/services`),
        api.get(`/tenants/${id}`),
      ]);
      setServices(Array.isArray(r.data) ? r.data : []);
      const settings = o.data?.settings ?? {};
      setPolicy({
        enablePackageRouting: settings.enablePackageRouting === true,
        enableRoomFolioCharging: settings.enableRoomFolioCharging === true,
        allowPackagePriceCompensation:
          settings.allowPackagePriceCompensation !== false,
        defaultExcessSettlementMode:
          ["FLEXIBLE", "DEFER_TO_FOLIO_ONLY", "COLLECT_NOW_ONLY"].includes(
            settings.defaultExcessSettlementMode,
          )
            ? settings.defaultExcessSettlementMode
            : "FLEXIBLE",
      });
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to load services");
    } finally {
      setLoading(false);
    }
  }, []);

  const savePolicy = async (next: any) => {
    if (!orgId) return;
    setPolicySaving(true);
    setError("");
    const prev = policy;
    setPolicy(next);
    try {
      // The settings endpoint replaces the whole object, so merge with any
      // existing settings (requireCashierConfirmation, ...) before saving.
      const org = await api.get(`/tenants/${orgId}`);
      await api.patch(`/tenants/${orgId}/settings`, {
        settings: {
          ...(org.data?.settings ?? {}),
          enablePackageRouting: next.enablePackageRouting,
          enableRoomFolioCharging: next.enableRoomFolioCharging,
          allowPackagePriceCompensation: next.allowPackagePriceCompensation,
          defaultExcessSettlementMode: next.defaultExcessSettlementMode,
        },
      });
    } catch (e: any) {
      setPolicy(prev);
      setError(e?.response?.data?.message ?? "Failed to save policy settings");
    } finally {
      setPolicySaving(false);
    }
  };

  useEffect(() => {
    if (orgId) load(orgId);
  }, [orgId, load]);

  const toggle = async (service: any) => {
    if (!orgId) return;
    setSaving(service.id);
    setError("");
    const next = services.map((s) =>
      s.id === service.id ? { ...s, isEnabled: !s.isEnabled } : s,
    );
    setServices(next);
    try {
      await api.patch(`/tenants/${orgId}/services/${service.id}`, {
        isEnabled: !service.isEnabled,
      });
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to update service");
      load(orgId);
    } finally {
      setSaving(null);
    }
  };

  const createCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !customForm.name.trim()) return;
    setError("");
    try {
      await api.post(`/tenants/${orgId}/services`, {
        name: customForm.name.trim(),
        key: customForm.key.trim() || undefined,
      });
      setCustomOpen(false);
      setCustomForm({ name: "", key: "" });
      await load(orgId);
      window.dispatchEvent(new Event("services:changed"));
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create service");
    }
  };

  const removeCustom = async (s: any) => {
    if (!orgId) return;
    if (!(await confirm(`Delete custom service "${serviceName(s)}"?`))) return;
    setError("");
    try {
      await api.delete(`/tenants/${orgId}/services/${s.id}`);
      await load(orgId);
      window.dispatchEvent(new Event("services:changed"));
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to delete service");
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Business Settings</h1>

      <div className="bg-white p-4 rounded-lg border border-gray-200">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-semibold text-gray-800">Active Services</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Enable or disable hospitality services. The sidebar only shows
              routes for services that are turned on.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/settings/hospitality-services"
              className="text-sm text-blue-600 hover:underline"
            >
              Manage services →
            </Link>
            <button
              onClick={() => {
                setCustomForm({ name: "", key: "" });
                setCustomOpen(true);
              }}
              className="bg-blue-600 text-white rounded px-3 py-2 text-sm font-medium hover:bg-blue-700"
            >
              + Add Custom Service
            </button>
            {owned.length > 1 && (
              <select
                value={orgId ?? ""}
                onChange={async (e) => {
                  const id = Number(e.target.value);
                  setOrgId(id);
                  switchOrganization(id);
                }}
                className="border border-gray-300 rounded p-2 text-sm bg-white"
              >
                {owned.map((m: any) => (
                  <option key={m.organizationId} value={m.organizationId}>
                    {m.organizationName}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm mb-3">{error}</div>}

        {loading ? (
          <p className="text-gray-500 text-sm py-6 text-center">Loading services…</p>
        ) : (
          <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
            {services.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800">
                    {serviceName(s)}
                    {s.serviceType === "CUSTOM" && (
                      <span className="ml-2 bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded text-[10px]">
                        Custom
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-400">
                    {s.customName
                      ? HOSPITALITY_SERVICE_DESCRIPTIONS[s.serviceType] ?? "Custom facility service."
                      : (HOSPITALITY_SERVICE_DESCRIPTIONS[s.serviceType] ?? "")}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {s.serviceType === "CUSTOM" && (
                    <button onClick={() => removeCustom(s)} className="text-xs text-red-600 hover:underline">
                      Del
                    </button>
                  )}
                  <button
                    role="switch"
                    aria-checked={s.isEnabled}
                    disabled={saving === s.id}
                    onClick={() => toggle(s)}
                    className={`relative w-12 h-7 rounded-full transition shrink-0 disabled:opacity-60 ${
                      s.isEnabled ? "bg-green-500" : "bg-gray-300"
                    }`}
                  >
                  <span
                    className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
                      s.isEnabled ? "left-[22px]" : "left-0.5"
                    }`}
                  />
                </button>
                </div>
              </li>
            ))}
            {services.length === 0 && (
              <li className="px-4 py-6 text-sm text-gray-400 text-center">
                No services available for this business.
              </li>
            )}
          </ul>
        )}
      </div>

      {/* --- Hospitality Packages & Guest Folio Policy --- */}
      <div className="bg-white p-4 rounded-lg border border-gray-200">
        <div className="mb-4">
          <h2 className="font-semibold text-gray-800">Hospitality Packages & Guest Folio Policy</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Off by default — the POS, kitchen and cashier keep the standard
            workflow until a feature is explicitly enabled here.
          </p>
        </div>
        <div className="space-y-3">
          <label className="flex items-start justify-between gap-3 py-2 border-b border-gray-100">
            <div>
              <p className="text-sm font-medium text-gray-800">Enable Package &amp; Entitlement Routing</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Lets waiters bill orders to guest packages with per-station
                entitlements. Off = POS ordering/checkout is unchanged.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={policy.enablePackageRouting}
              disabled={policySaving}
              onClick={() => savePolicy({ ...policy, enablePackageRouting: !policy.enablePackageRouting })}
              className={`relative w-12 h-7 rounded-full transition shrink-0 disabled:opacity-60 ${
                policy.enablePackageRouting ? "bg-green-500" : "bg-gray-300"
              }`}
            >
              <span
                className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
                  policy.enablePackageRouting ? "left-[22px]" : "left-0.5"
                }`}
              />
            </button>
          </label>

          <label className="flex items-start justify-between gap-3 py-2 border-b border-gray-100">
            <div>
              <p className="text-sm font-medium text-gray-800">Enable Room Folio Charging</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Posts net add-on charges to reception room folios for settlement
                at guest checkout.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={policy.enableRoomFolioCharging}
              disabled={policySaving}
              onClick={() => savePolicy({ ...policy, enableRoomFolioCharging: !policy.enableRoomFolioCharging })}
              className={`relative w-12 h-7 rounded-full transition shrink-0 disabled:opacity-60 ${
                policy.enableRoomFolioCharging ? "bg-green-500" : "bg-gray-300"
              }`}
            >
              <span
                className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
                  policy.enableRoomFolioCharging ? "left-[22px]" : "left-0.5"
                }`}
              />
            </button>
          </label>

          <label className="flex items-start justify-between gap-3 py-2 border-b border-gray-100">
            <div>
              <p className="text-sm font-medium text-gray-800">Allow Package Price Compensation</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Lets guests pay the difference when an item costs more than the
                allowance (e.g. 500 ETB Tibs vs 300 ETB allowance → 200 ETB
                excess). Off = over-allowance items are blocked.
              </p>
            </div>
            <button
              role="switch"
              aria-checked={policy.allowPackagePriceCompensation}
              disabled={policySaving}
              onClick={() => savePolicy({ ...policy, allowPackagePriceCompensation: !policy.allowPackagePriceCompensation })}
              className={`relative w-12 h-7 rounded-full transition shrink-0 disabled:opacity-60 ${
                policy.allowPackagePriceCompensation ? "bg-green-500" : "bg-gray-300"
              }`}
            >
              <span
                className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
                  policy.allowPackagePriceCompensation ? "left-[22px]" : "left-0.5"
                }`}
              />
            </button>
          </label>

          <div className="flex items-center justify-between gap-3 py-2">
            <div>
              <p className="text-sm font-medium text-gray-800">Default Excess Settlement Mode</p>
              <p className="text-xs text-gray-400 mt-0.5">
                How the net charge on a package order is settled: flexible
                (staff choose at POS), always defer to the folio, or always
                collect at the POS.
              </p>
            </div>
            <select
              value={policy.defaultExcessSettlementMode}
              disabled={policySaving}
              onChange={(e) => savePolicy({ ...policy, defaultExcessSettlementMode: e.target.value })}
              className="border border-gray-300 rounded p-2 text-sm bg-white"
            >
              <option value="FLEXIBLE">Flexible (staff chooses)</option>
              <option value="DEFER_TO_FOLIO_ONLY">Defer to folio only</option>
              <option value="COLLECT_NOW_ONLY">Collect now only</option>
            </select>
          </div>
        </div>
        {policySaving && <p className="text-xs text-gray-400 mt-2">Saving…</p>}
      </div>

      {customOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-3">Add Custom Service</h2>
            <p className="text-xs text-gray-400 mb-3">
              Create a custom hospitality facility (e.g. Spa, Tennis). It appears
              as a toggle here and in the sidebar with its own dashboard.
            </p>
            <form onSubmit={createCustom} className="space-y-3">
              <input
                value={customForm.name}
                onChange={(e) => setCustomForm({ ...customForm, name: e.target.value })}
                placeholder="Service name (e.g. Spa)"
                className="border border-gray-300 rounded p-2 text-sm w-full"
                required
              />
              <input
                value={customForm.key}
                onChange={(e) => setCustomForm({ ...customForm, key: e.target.value })}
                placeholder="Key (optional, e.g. spa)"
                className="border border-gray-300 rounded p-2 text-sm w-full"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setCustomOpen(false)} className="px-3 py-2 text-sm text-gray-600">
                  Cancel
                </button>
                <button type="submit" className="bg-blue-600 text-white rounded px-3 py-2 text-sm font-medium">
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
