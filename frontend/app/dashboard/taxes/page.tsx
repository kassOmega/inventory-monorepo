"use client";

import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useState } from "react";

export default function TaxesPage() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const confirm = useConfirm();
  const canManage = hasPermission("finance.manage");
  const [settings, setSettings] = useState({
    taxEnabled: false,
    taxInclusive: true,
    taxId: "",
  });
  const [rates, setRates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get("/taxes");
      setSettings({ ...r.data.settings, taxId: r.data.settings.taxId ?? "" });
      setRates(r.data.rates);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("taxes.failedLoad"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveSettings = async (patch: any) => {
    setError("");
    try {
      await api.patch("/taxes/settings", patch);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("taxes.failedSaveSettings"));
    }
  };

  const openNew = () =>
    setForm({
      id: null,
      name: "",
      code: "",
      rate: "15",
      direction: "OUTPUT",
      isDefault: false,
      enabled: true,
    });
  const openEdit = (m: any) =>
    setForm({
      id: m.id,
      name: m.name,
      code: m.code ?? "",
      rate: String(m.rate),
      direction: m.direction,
      isDefault: m.isDefault,
      enabled: m.enabled,
    });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const payload = {
        name: form.name,
        code: form.code || undefined,
        rate: Number(form.rate),
        direction: form.direction,
        isDefault: form.isDefault,
        enabled: form.enabled,
      };
      if (form.id) await api.patch(`/taxes/${form.id}`, payload);
      else await api.post("/taxes", payload);
      setForm(null);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("taxes.failedSaveRate"));
    }
  };

  const remove = async (m: any) => {
    if (m.isDefault) return;
    if (!(await confirm(t("taxes.deleteConfirm", { name: m.name })))) return;
    try {
      await api.delete(`/taxes/${m.id}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("taxes.failedDeleteRate"));
    }
  };

  const toggleEnabled = async (m: any) => {
    try {
      await api.patch(`/taxes/${m.id}`, { enabled: !m.enabled });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("taxes.failedUpdateRate"));
    }
  };

  // Tenant fiscal hardware & MoR registration settings.
  const [fiscal, setFiscal] = useState<any>(null);

  const loadFiscal = useCallback(async () => {
    try {
      const r = await api.get("/fiscal/config");
      setFiscal(r.data);
    } catch {
      setFiscal(null);
    }
  }, []);

  useEffect(() => {
    loadFiscal();
  }, [loadFiscal]);

  const saveFiscal = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const r = await api.put("/fiscal/config", {
        tin: fiscal.tin,
        taxName: fiscal.taxName,
        address: fiscal.address || null,
        phone: fiscal.phone || null,
        agentUrl: fiscal.agentUrl,
        agentApiKey: fiscal.agentApiKey || null,
        printerVendor: fiscal.printerVendor,
        comPort: fiscal.comPort || null,
        baudRate: fiscal.baudRate != null && fiscal.baudRate !== ""
          ? Number(fiscal.baudRate)
          : null,
        enableFiscal: fiscal.enableFiscal,
        morLiveUrl: fiscal.morLiveUrl || null,
        morClientId: fiscal.morClientId || null,
        morClientSecret: fiscal.morClientSecret || null,
        morCertificate: fiscal.morCertificate || null,
        terminalId: fiscal.terminalId || null,
        branchCode: fiscal.branchCode || null,
      });
      setFiscal(r.data);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("taxes.failedSaveFiscal"));
    }
  };

  if (loading)
    return <p className="text-gray-500 p-6">{t("taxes.loading")}</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">{t("taxes.title")}</h1>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      {/* Company tax settings */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="font-semibold text-gray-800 mb-3">{t("taxes.settingsTitle")}</h2>
        <div className="space-y-3 text-sm">
          <label className="flex items-center justify-between gap-3 border border-gray-200 rounded-lg p-3">
            <div>
              <p className="font-medium text-gray-800">{t("taxes.enableTax")}</p>
              <p className="text-xs text-gray-500">
                {t("taxes.enableTaxHint")}
              </p>
            </div>
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={settings.taxEnabled}
              onChange={(e) => saveSettings({ taxEnabled: e.target.checked })}
              disabled={!canManage}
            />
          </label>
          <label className="flex items-center justify-between gap-3 border border-gray-200 rounded-lg p-3">
            <div>
              <p className="font-medium text-gray-800">{t("taxes.pricesIncludeTax")}</p>
              <p className="text-xs text-gray-500">
                {t("taxes.pricesIncludeTaxHint")}
              </p>
            </div>
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={settings.taxInclusive}
              onChange={(e) => saveSettings({ taxInclusive: e.target.checked })}
              disabled={!canManage}
            />
          </label>
          <div className="border border-gray-200 rounded-lg p-3">
            <label className="block font-medium text-gray-800 mb-1">
              {t("taxes.vatTin")}
            </label>
            <div className="flex gap-2">
              <input
                value={settings.taxId}
                onChange={(e) => setSettings({ ...settings, taxId: e.target.value })}
                placeholder={t("taxes.regNumberPh")}
                className="border border-gray-300 rounded p-2 text-sm w-full"
                disabled={!canManage}
              />
              <button
                onClick={() => saveSettings({ taxId: settings.taxId || null })}
                disabled={!canManage}
                className="bg-gray-800 text-white rounded px-3 py-2 text-sm font-medium disabled:opacity-40"
              >
                {t("common.save")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Fiscal printer & MoR registration */}
      {fiscal && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h2 className="font-semibold text-gray-800 mb-3">
            {t("taxes.fiscalTitle")}
          </h2>
          <p className="text-xs text-gray-400 mb-3">
            {t("taxes.fiscalHint")}
          </p>
          <form onSubmit={saveFiscal} className="space-y-3 text-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">{t("taxes.tinLabel")}</label>
                <input value={fiscal.tin} onChange={(e) => setFiscal({ ...fiscal, tin: e.target.value })} className="border border-gray-300 rounded p-2 w-full" disabled={!canManage} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">{t("taxes.legalName")}</label>
                <input value={fiscal.taxName} onChange={(e) => setFiscal({ ...fiscal, taxName: e.target.value })} className="border border-gray-300 rounded p-2 w-full" disabled={!canManage} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">{t("taxes.addressLabel")}</label>
                <input value={fiscal.address ?? ""} onChange={(e) => setFiscal({ ...fiscal, address: e.target.value })} className="border border-gray-300 rounded p-2 w-full" disabled={!canManage} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">{t("taxes.telephone")}</label>
                <input value={fiscal.phone ?? ""} onChange={(e) => setFiscal({ ...fiscal, phone: e.target.value })} className="border border-gray-300 rounded p-2 w-full" disabled={!canManage} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">{t("taxes.agentUrl")}</label>
                <input value={fiscal.agentUrl} onChange={(e) => setFiscal({ ...fiscal, agentUrl: e.target.value })} placeholder={t("taxes.agentUrlPh")} className="border border-gray-300 rounded p-2 w-full" disabled={!canManage} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">{t("taxes.agentApiKey")}</label>
                <input value={fiscal.agentApiKey ?? ""} onChange={(e) => setFiscal({ ...fiscal, agentApiKey: e.target.value })} type="password" className="border border-gray-300 rounded p-2 w-full" disabled={!canManage} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1">{t("taxes.printerVendor")}</label>
                <select value={fiscal.printerVendor} onChange={(e) => setFiscal({ ...fiscal, printerVendor: e.target.value })} className="border border-gray-300 rounded p-2 w-full bg-white" disabled={!canManage}>
                  <option value="GENERIC">GENERIC</option>
                  <option value="BMC">BMC</option>
                  <option value="DAISY">DAISY</option>
                  <option value="FISCAT">FISCAT</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">{t("taxes.comPort")}</label>
                  <input value={fiscal.comPort ?? "COM1"} onChange={(e) => setFiscal({ ...fiscal, comPort: e.target.value })} className="border border-gray-300 rounded p-2 w-full" disabled={!canManage} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">{t("taxes.baudRate")}</label>
                  <input type="number" value={fiscal.baudRate ?? 9600} onChange={(e) => setFiscal({ ...fiscal, baudRate: e.target.value })} className="border border-gray-300 rounded p-2 w-full" disabled={!canManage} />
                </div>
              </div>
            </div>

            {/* MoR E-Invoicing & Security credentials */}
            <div className="border-t border-gray-200 pt-3">
              <p className="font-medium text-gray-800 mb-1">
                {t("taxes.morTitle")}
              </p>
              <p className="text-xs text-gray-400 mb-3">
                {t("taxes.morHint")}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">{t("taxes.morLiveUrl")}</label>
                  <input value={fiscal.morLiveUrl ?? ""} onChange={(e) => setFiscal({ ...fiscal, morLiveUrl: e.target.value })} placeholder={t("taxes.morLiveUrlPh")} className="border border-gray-300 rounded p-2 w-full" disabled={!canManage} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">{t("taxes.branchCode")}</label>
                  <input value={fiscal.branchCode ?? ""} onChange={(e) => setFiscal({ ...fiscal, branchCode: e.target.value })} placeholder={t("taxes.branchCodePh")} className="border border-gray-300 rounded p-2 w-full" disabled={!canManage} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">{t("taxes.terminalId")}</label>
                  <input value={fiscal.terminalId ?? ""} onChange={(e) => setFiscal({ ...fiscal, terminalId: e.target.value })} placeholder={t("taxes.terminalIdPh")} className="border border-gray-300 rounded p-2 w-full" disabled={!canManage} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">{t("taxes.morClientId")}</label>
                  <input value={fiscal.morClientId ?? ""} onChange={(e) => setFiscal({ ...fiscal, morClientId: e.target.value })} placeholder={t("taxes.morClientIdPh")} className="border border-gray-300 rounded p-2 w-full" disabled={!canManage} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">{t("taxes.morClientSecret")}</label>
                  <input value={fiscal.morClientSecret ?? ""} onChange={(e) => setFiscal({ ...fiscal, morClientSecret: e.target.value })} type="password" placeholder={t("taxes.morSecretPh")} autoComplete="new-password" className="border border-gray-300 rounded p-2 w-full" disabled={!canManage} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-500 mb-1">{t("taxes.certificate")}</label>
                  <input value={fiscal.morCertificate ?? ""} onChange={(e) => setFiscal({ ...fiscal, morCertificate: e.target.value })} placeholder={t("taxes.certificatePh")} className="border border-gray-300 rounded p-2 w-full font-mono text-xs" disabled={!canManage} />
                  <div className="flex gap-3 mt-1">
                    <label className="text-xs text-blue-600 hover:underline cursor-pointer">
                      {fiscal.morCertificate ? t("taxes.replaceCert") : t("taxes.uploadCert")}
                      <input
                        type="file"
                        accept=".p12,.pfx"
                        className="hidden"
                        disabled={!canManage}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          const reader = new FileReader();
                          reader.onload = () =>
                            setFiscal({ ...fiscal, morCertificate: String(reader.result ?? "") });
                          reader.readAsDataURL(f);
                        }}
                      />
                    </label>
                    {fiscal.morCertificate && canManage && (
                      <button
                        type="button"
                        onClick={() => setFiscal({ ...fiscal, morCertificate: "" })}
                        className="text-xs text-red-500 hover:underline"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <label className="flex items-center gap-2">
              <input type="checkbox" checked={fiscal.enableFiscal} onChange={(e) => setFiscal({ ...fiscal, enableFiscal: e.target.checked })} className="rounded" disabled={!canManage} />
              {t("taxes.enableFiscal")}
            </label>
            {canManage && (
              <div className="flex justify-end">
                <button type="submit" className="bg-gray-800 text-white rounded px-3 py-2 text-sm font-medium">
                  {t("taxes.saveFiscalSettings")}
                </button>
              </div>
            )}
          </form>
        </div>
      )}

      {/* Tax rates */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-800">{t("taxes.ratesTitle")}</h2>
          {canManage && (
            <button onClick={openNew} className="text-sm text-blue-600 hover:underline">
              {t("taxes.addRate")}
            </button>
          )}
        </div>
        {settings.taxEnabled && rates.length === 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-3">
            {t("taxes.ratesEmptyHint")}
          </p>
        )}
        <ul className="divide-y divide-gray-100 text-sm">
          {rates.map((m) => (
            <li key={m.id} className="py-2.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-gray-800 font-medium">
                  {m.name}
                  {m.isDefault && (
                    <span className="ml-2 text-xs px-2 py-0.5 rounded bg-violet-100 text-violet-700">
                      {t("taxes.default")}
                    </span>
                  )}
                  <span
                    className={`ml-2 text-xs px-2 py-0.5 rounded ${
                      m.direction === "OUTPUT"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {m.direction === "OUTPUT" ? t("taxes.onSales") : t("taxes.onPurchases")}
                  </span>
                  <span
                    className={`ml-2 text-xs px-2 py-0.5 rounded ${
                      m.enabled
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-200 text-gray-500"
                    }`}
                  >
                    {m.enabled ? t("taxes.enabled") : t("taxes.disabled")}
                  </span>
                </p>
                <p className="text-xs text-gray-500">
                  {m.rate}%{m.code ? ` · ${t("taxes.codeSuffix")} ${m.code}` : ""}
                </p>
              </div>
              {canManage && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => toggleEnabled(m)}
                    className="text-xs text-gray-600 hover:underline"
                  >
                    {m.enabled ? t("taxes.disable") : t("taxes.enable")}
                  </button>
                  <button onClick={() => openEdit(m)} className="text-xs text-blue-600 hover:underline">
                    {t("common.edit")}
                  </button>
                  <button
                    onClick={() => remove(m)}
                    disabled={m.isDefault}
                    title={m.isDefault ? t("taxes.setDefaultFirst") : undefined}
                    className="text-xs text-red-600 hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {t("common.del")}
                  </button>
                </div>
              )}
            </li>
          ))}
          {rates.length === 0 && <li className="text-gray-400 py-2">{t("taxes.noRates")}</li>}
        </ul>
      </div>

      {form && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-3">
              {form.id ? t("taxes.editRateTitle") : t("taxes.addRateTitle")}
            </h2>
            <form onSubmit={save} className="space-y-3">
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t("taxes.namePh")}
                className="border border-gray-300 rounded p-2 text-sm w-full"
                required
              />
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder={t("taxes.codePh")}
                className="border border-gray-300 rounded p-2 text-sm w-full"
              />
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={form.rate}
                onChange={(e) => setForm({ ...form, rate: e.target.value })}
                placeholder={t("taxes.ratePh")}
                className="border border-gray-300 rounded p-2 text-sm w-full"
                required
              />
              <select
                value={form.direction}
                onChange={(e) => setForm({ ...form, direction: e.target.value })}
                className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
              >
                <option value="OUTPUT">{t("taxes.outputOption")}</option>
                <option value="INPUT">{t("taxes.inputOption")}</option>
              </select>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.isDefault}
                  onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                  className="rounded"
                />
                {t("taxes.setDefaultRate")}
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                  className="rounded"
                />
                {t("taxes.enabledLabel")}
              </label>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setForm(null)}
                  className="px-3 py-2 text-sm text-gray-600"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  className="bg-gray-800 text-white rounded px-3 py-2 text-sm font-medium"
                >
                  {t("common.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

