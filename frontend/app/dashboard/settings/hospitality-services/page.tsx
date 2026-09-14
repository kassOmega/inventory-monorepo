"use client";

import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/app/components/ConfirmProvider";
import GuestIdTypesCard from "@/app/components/GuestIdTypesCard";
import api from "@/lib/api";
import {
  HOSPITALITY_SERVICES,
  hospitalityServiceName,
} from "@/lib/verticals";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const POLICY_DEFAULT = {
  enablePackageRouting: false,
  enableRoomFolioCharging: false,
  allowPackagePriceCompensation: true,
  defaultExcessSettlementMode: "FLEXIBLE",
};

/**
 * Hospitality Services settings — owner-only, hospitality businesses only.
 * Lets the owner upgrade/toggle the service lines as the business expands
 * (e.g. add ACCOMMODATION to an existing restaurant). Toggling a service
 * dispatches `services:changed` so the dashboard sidebar updates immediately.
 */
export default function HospitalityServicesSettingsPage() {
  const { t } = useTranslation();
  const { user, activeOrganizationId, switchOrganization } = useAuth();
  const confirm = useConfirm();

  const owned = (user?.memberships ?? []).filter((m: any) => m.isSystem);
  const [orgId, setOrgId] = useState<number | null>(activeOrganizationId);
  const current = owned.find((m: any) => m.organizationId === orgId) ?? owned[0];
  const isHospitality = current?.businessType === "HOSPITALITY";

  const [services, setServices] = useState<any[]>([]);
  const [policy, setPolicy] = useState<any>(POLICY_DEFAULT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [policySaving, setPolicySaving] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [customForm, setCustomForm] = useState({ name: "", key: "" });

  const load = useCallback(async (id: number) => {
    setLoading(true);
    setError("");
    try {
      const [svc, org] = await Promise.all([
        api.get(`/tenants/${id}/services`),
        api.get(`/tenants/${id}`),
      ]);
      setServices(Array.isArray(svc.data) ? svc.data : []);
      const settings = org.data?.settings ?? {};
      setPolicy({
        enablePackageRouting: settings.enablePackageRouting === true,
        enableRoomFolioCharging: settings.enableRoomFolioCharging === true,
        allowPackagePriceCompensation:
          settings.allowPackagePriceCompensation !== false,
        defaultExcessSettlementMode: [
          "FLEXIBLE",
          "DEFER_TO_FOLIO_ONLY",
          "COLLECT_NOW_ONLY",
        ].includes(settings.defaultExcessSettlementMode)
          ? settings.defaultExcessSettlementMode
          : "FLEXIBLE",
      });
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to load hospitality services");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (orgId) load(orgId);
  }, [orgId, load]);

  const busy = saving !== null || policySaving;

  const toggle = async (service: any) => {
    if (!orgId) return;
    setSaving(service.id);
    setError("");
    const nextEnabled = !service.isEnabled;
    setServices((prev) =>
      prev.map((s) => (s.id === service.id ? { ...s, isEnabled: nextEnabled } : s)),
    );
    try {
      await api.patch(`/tenants/${orgId}/services/${service.id}`, {
        isEnabled: nextEnabled,
      });
      window.dispatchEvent(new Event("services:changed"));
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Failed to update service");
      await load(orgId);
    } finally {
      setSaving(null);
    }
  };

  const savePolicy = async (next: any) => {
    if (!orgId) return;
    setPolicySaving(true);
    setError("");
    const prev = policy;
    setPolicy(next);
    try {
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
    if (!(await confirm(`Delete custom service "${hospitalityServiceName(s)}"?`))) return;
    setError("");
    try {
      await api.delete(`/tenants/${orgId}/services/${s.id}`);
      await load(orgId);
      window.dispatchEvent(new Event("services:changed"));
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to delete service");
    }
  };

  // Canonical service order (spec order), with owner-created customs last.
  const ordered = [
    ...HOSPITALITY_SERVICES.map((o) =>
      services.find((s) => s.serviceType === o.value),
    ).filter(Boolean),
    ...services.filter((s) => s.serviceType === "CUSTOM"),
  ];
  const enabledCount = services.filter((s) => s.isEnabled).length;

  if (!owned.length) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-800">
          {t("nav.hospitalityServices")}
        </h1>
        <p className="text-sm text-gray-500">
          Only the business owner can manage hospitality services.
        </p>
        <Link href="/dashboard" className="text-sm text-blue-600 hover:underline">
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  if (!isHospitality) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-800">
          {t("nav.hospitalityServices")}
        </h1>
        <div className="bg-amber-50 text-amber-800 p-3 rounded text-sm">
          Hospitality services only apply to a Hospitality business. The active
          business is a {current?.businessType ?? "different"} type.
        </div>
        <Link href="/dashboard/businesses" className="text-sm text-blue-600 hover:underline">
          ← Switch business
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">
            {t("nav.hospitalityServices")}
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Turn service lines on as your business expands. The sidebar only
            shows the modules for the services you enable.
          </p>
        </div>
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

      {error && (
        <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>
      )}

      <div className="bg-white p-4 rounded-lg border border-gray-200">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-semibold text-gray-800">
              {t("hospitalityServices.title")}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {enabledCount} of {services.length} service lines active.
            </p>
          </div>
          <button
            onClick={() => {
              setCustomForm({ name: "", key: "" });
              setCustomOpen(true);
            }}
            className="bg-blue-600 text-white rounded px-3 py-2 text-sm font-medium hover:bg-blue-700"
          >
            + Add Custom Service
          </button>
        </div>

        {loading ? (
          <p className="text-gray-500 text-sm py-6 text-center">Loading…</p>
        ) : (
          <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
            {ordered.map((s: any) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800">
                    {hospitalityServiceName(s)}
                    {s.serviceType === "CUSTOM" && (
                      <span className="ml-2 bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded text-[10px]">
                        Custom
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-400">
                    {t(`hospitalityServices.${s.serviceType}_DESC`, {
                      defaultValue: "",
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {s.serviceType === "CUSTOM" && (
                    <button
                      onClick={() => removeCustom(s)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Del
                    </button>
                  )}
                  <button
                    role="switch"
                    aria-label={`Toggle ${hospitalityServiceName(s)}`}
                    aria-checked={s.isEnabled}
                    disabled={busy || saving === s.id}
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
            {ordered.length === 0 && (
              <li className="px-4 py-6 text-sm text-gray-400 text-center">
                No services available for this business.
              </li>
            )}
          </ul>
        )}
      </div>

      {/* Guest ID Types — configured once here so every hospitality setting lives
          on one page; the hotel page and the check-in modal just read the active
          list. `key` refetches when the owner switches business above. */}
      <GuestIdTypesCard
        key={orgId ?? "active"}
        orgId={orgId}
        note={t("hospitalityServices.guestIdTypesNote")}
      />

      <div className="bg-white p-4 rounded-lg border border-gray-200">
        <div className="mb-4">
          <h2 className="font-semibold text-gray-800">
            Hospitality Packages &amp; Guest Folio Policy
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Off by default — the POS, kitchen and cashier keep the standard
            workflow until a feature is explicitly enabled here.
          </p>
        </div>
        <div className="space-y-3">
          <PolicyToggle
            title="Enable Package & Entitlement Routing"
            hint="Lets staff bill orders to guest packages with per-station entitlements. Off = POS ordering/checkout is unchanged."
            checked={policy.enablePackageRouting}
            disabled={busy}
            onChange={(v) => savePolicy({ ...policy, enablePackageRouting: v })}
          />
          <PolicyToggle
            title="Enable Room Folio Charging"
            hint="Posts net add-on charges to reception room folios for settlement at guest checkout."
            checked={policy.enableRoomFolioCharging}
            disabled={busy}
            onChange={(v) => savePolicy({ ...policy, enableRoomFolioCharging: v })}
          />
          <PolicyToggle
            title="Allow Package Price Compensation"
            hint="Lets guests pay the difference when an item costs more than the allowance. Off = over-allowance items are blocked."
            checked={policy.allowPackagePriceCompensation}
            disabled={busy}
            onChange={(v) =>
              savePolicy({ ...policy, allowPackagePriceCompensation: v })
            }
          />
          <div className="flex items-center justify-between gap-3 py-2">
            <div>
              <p className="text-sm font-medium text-gray-800">
                Default Excess Settlement Mode
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                How the net charge on a package order is settled: flexible
                (staff choose at POS), always defer to the folio, or always
                collect at the POS.
              </p>
            </div>
            <select
              value={policy.defaultExcessSettlementMode}
              disabled={busy}
              onChange={(e) =>
                savePolicy({ ...policy, defaultExcessSettlementMode: e.target.value })
              }
              className="border border-gray-300 rounded p-2 text-sm bg-white"
            >
              <option value="FLEXIBLE">Flexible (staff chooses)</option>
              <option value="DEFER_TO_FOLIO_ONLY">Defer to folio only</option>
              <option value="COLLECT_NOW_ONLY">Collect now only</option>
            </select>
          </div>
        </div>
      </div>

      {customOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-3">Add Custom Service</h2>
            <p className="text-xs text-gray-400 mb-3">
              Create a custom hospitality facility (e.g. Tennis, Laundry). It
              appears as a toggle here and in the sidebar with its own dashboard.
            </p>
            <form onSubmit={createCustom} className="space-y-3">
              <input
                value={customForm.name}
                onChange={(e) => setCustomForm({ ...customForm, name: e.target.value })}
                placeholder="Service name (e.g. Tennis)"
                className="border border-gray-300 rounded p-2 text-sm w-full"
                required
              />
              <input
                value={customForm.key}
                onChange={(e) => setCustomForm({ ...customForm, key: e.target.value })}
                placeholder="Key (optional, e.g. tennis)"
                className="border border-gray-300 rounded p-2 text-sm w-full"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCustomOpen(false)}
                  className="px-3 py-2 text-sm text-gray-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-blue-600 text-white rounded px-3 py-2 text-sm font-medium"
                >
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

function PolicyToggle({
  title,
  hint,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-3 py-2 border-b border-gray-100">
      <div>
        <p className="text-sm font-medium text-gray-800">{title}</p>
        <p className="text-xs text-gray-400 mt-0.5">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-label={title}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative w-12 h-7 rounded-full transition shrink-0 disabled:opacity-60 ${
          checked ? "bg-green-500" : "bg-gray-300"
        }`}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </button>
    </label>
  );
}

