"use client";

import SearchableSelect from "@/app/components/SearchableSelect";
import { VERTICAL_LABELS } from "@/lib/verticals";
import { statusLabel } from "@/lib/statusLabel";
import api from "@/lib/api";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const addDays = (days: number) => {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const addMonths = (months: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

// AI access-window duration options. Selecting one computes the end date; the
// admin can still adjust the date manually afterwards.
const AI_TRIAL_OPTIONS = [
  { labelKey: "adm.biz.day15", value: () => addDays(15) },
  { labelKey: "adm.biz.month1", value: () => addMonths(1) },
  { labelKey: "adm.biz.month3", value: () => addMonths(3) },
];

const VERIFICATION_STATUSES = [
  "PENDING",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "FLAGGED",
  "BLOCKED",
] as const;

const VSTATUS_STYLES: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  SUBMITTED: "bg-sky-100 text-sky-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-rose-100 text-rose-800",
  FLAGGED: "bg-orange-100 text-orange-800",
  BLOCKED: "bg-red-200 text-red-900",
};

function AiTrialRadios({
  value,
  onChange,
}: {
  value: string;
  onChange: (date: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {AI_TRIAL_OPTIONS.map((opt) => {
          const computed = opt.value();
          const checked = value === computed;
          return (
            <label
              key={opt.labelKey}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border cursor-pointer transition ${
                checked
                  ? "bg-blue-50 border-blue-400 text-blue-700"
                  : "border-gray-300 text-gray-600 hover:border-blue-300"
              }`}
            >
              <input
                type="radio"
                name="aiTrialOption"
                checked={checked}
                onChange={() => onChange(computed)}
                className="accent-blue-600"
              />
              {t(opt.labelKey)}
            </label>
          );
        })}
      </div>
      <label className="flex items-center gap-2 text-xs text-gray-600">
        <span className="whitespace-nowrap">{t("adm.biz.accessEnds")}</span>
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="border border-gray-300 rounded p-2 text-sm w-full"
        />
      </label>
    </div>
  );
}

export default function AdminBusinessesPage() {
  const confirm = useConfirm();
  const { t } = useTranslation();
  // Business-type display name from the shared `verticals.*` catalog, with the
  // raw enum as the fallback for a type the catalog does not know yet.
  const verticalName = (type?: string | null) =>
    type
      ? t(`verticals.${type.toLowerCase()}`, { defaultValue: type })
      : "";
  const [orgs, setOrgs] = useState<any[]>([]);
  const [owners, setOwners] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    ownerUserId: "",
    name: "",
    businessType: "RETAIL",
    standalone: false,
    aiEnabled: true,
    aiTrialEndsAt: addDays(15),
  });
  const [tradeLicense, setTradeLicense] = useState<File | null>(null);
  const [tinCertificate, setTinCertificate] = useState<File | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    businessType: "RETAIL",
    ownerId: null as number | null,
    ownerName: "",
    ownerEmail: "",
    ownerPassword: "",
    newOwnerUserId: "",
    aiEnabled: true,
    aiTrialEndsAt: "",
  });
  // Pending verification-status selection per business (applied on "Apply").
  const [vDraft, setVDraft] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    try {
      const [o, u] = await Promise.all([api.get("/admin/organizations"), api.get("/admin/users")]);
      setOrgs(o.data);
      setOwners(u.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("adm.biz.loadFail"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const createOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const res = await api.post("/admin/organizations", {
        ownerUserId: Number(form.ownerUserId),
        name: form.name,
        businessType: form.businessType,
        standalone: form.standalone,
        aiEnabled: form.aiEnabled,
        aiTrialEndsAt: form.aiTrialEndsAt,
      });
      const orgId = res.data.id;

      // Optionally attach the trade license / TIN on the owner's behalf so
      // verification can start immediately.
      const uploadDoc = async (documentType: string, file: File) => {
        const fd = new FormData();
        fd.append("documentType", documentType);
        fd.append("file", file);
        await api.post(`/admin/verification/business/${orgId}/documents`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      };
      if (tradeLicense) await uploadDoc("TRADE_LICENSE", tradeLicense);
      if (tinCertificate) await uploadDoc("TIN_CERTIFICATE", tinCertificate);

      setForm({ ownerUserId: "", name: "", businessType: "RETAIL", standalone: false, aiEnabled: true, aiTrialEndsAt: addDays(15) });
      setTradeLicense(null);
      setTinCertificate(null);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("biz.createFail"));
    }
  };

  const toggleOrgStatus = async (id: number, status: string) => {
    await api.patch(`/admin/organizations/${id}/status`, {
      status: status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
    });
    await load();
  };

  // Admin can move a business to ANY verification status from any current one
  // (e.g. manually approve/flag/reject a business the AI flagged).
  const setVerificationStatus = async (id: number, status: string) => {
    if (!status) return;
    setError("");
    try {
      await api.post(`/admin/verification/business/${id}/status`, { status });
      await load();
      setVDraft((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("adm.biz.verifStatusFail"));
    }
  };

  const startEdit = (o: any) => {
    const owner = o.memberships?.[0]?.user;
    setEditing(o);
    setEditForm({
      name: o.name,
      businessType: o.businessType,
      ownerId: owner?.id ?? null,
      ownerName: owner?.name ?? "",
      ownerEmail: owner?.email ?? "",
      ownerPassword: "",
      newOwnerUserId: owner?.id ? String(owner.id) : "",
      aiEnabled: o.aiEnabled !== false,
      aiTrialEndsAt: o.aiTrialEndsAt ? String(o.aiTrialEndsAt).slice(0, 10) : "",
    });
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api.patch(`/admin/organizations/${editing.id}`, {
        name: editForm.name,
        businessType: editForm.businessType,
        aiEnabled: editForm.aiEnabled,
        aiTrialEndsAt: editForm.aiTrialEndsAt || null,
      });
      // Reassign the owner if a different user was picked via the dropdown.
      if (editForm.newOwnerUserId && editForm.newOwnerUserId !== String(editForm.ownerId)) {
        await api.post(`/admin/organizations/${editing.id}/owner`, {
          ownerUserId: Number(editForm.newOwnerUserId),
        });
      } else if (editForm.ownerId) {
        const payload: any = { name: editForm.ownerName, email: editForm.ownerEmail };
        if (editForm.ownerPassword) payload.password = editForm.ownerPassword;
        await api.patch(`/admin/users/${editForm.ownerId}`, payload);
      }
      setEditing(null);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("biz.updateFail"));
    }
  };

  const deleteOrg = async (id: number, name: string) => {
    if (!(await confirm(t("biz.confirmDelete", { name })))) return;
    setError("");
    try {
      await api.delete(`/admin/organizations/${id}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("biz.deleteFail"));
    }
  };

  if (loading) return <p className="text-gray-500">{t("common.loading")}</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">{t("nav.adminBusinesses")}</h1>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      <div className="bg-white p-4 rounded-lg border border-gray-200">
        <h2 className="font-semibold text-gray-800 mb-3">{t("adm.biz.createTitle")}</h2>
        <form onSubmit={createOrg} className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <SearchableSelect
            options={owners.map((u) => ({
              value: String(u.id),
              label: `${u.name} (${u.email})`,
              searchText: `${u.name} ${u.email}`,
            }))}
            value={form.ownerUserId}
            onChange={(v) => setForm({ ...form, ownerUserId: v })}
            placeholder={t("adm.biz.searchOwnerPh")}
            required
          />
          <input
            placeholder={t("biz.businessName")}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="border border-gray-300 rounded p-2 text-sm"
            required
          />
          <select
            value={form.businessType}
            onChange={(e) => setForm({ ...form, businessType: e.target.value })}
            className="border border-gray-300 rounded p-2 text-sm"
          >
            {Object.keys(VERTICAL_LABELS).map((value) => (
              <option key={value} value={value}>
                {t(`verticals.${value.toLowerCase()}`)}
              </option>
            ))}
          </select>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("biz.standaloneQuestion")}
            </label>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-1.5 text-sm text-gray-700">
                <input
                  type="radio"
                  checked={form.standalone}
                  onChange={() => setForm({ ...form, standalone: true })}
                  className="accent-emerald-600"
                />
                {t("common.yes")}
              </label>
              <label className="flex items-center gap-1.5 text-sm text-gray-700">
                <input
                  type="radio"
                  checked={!form.standalone}
                  onChange={() => setForm({ ...form, standalone: false })}
                  className="accent-emerald-600"
                />
                {t("common.no")}
              </label>
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              {t("adm.biz.standaloneHint")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={form.aiEnabled}
                onChange={(e) => setForm({ ...form, aiEnabled: e.target.checked })}
                className="rounded"
              />
              {t("biz.aiEnabled")}
            </label>
            <div className="text-xs text-gray-600">
              <span className="block mb-1">{t("adm.biz.aiWindow")}</span>
              <AiTrialRadios
                value={form.aiTrialEndsAt}
                onChange={(date) => setForm({ ...form, aiTrialEndsAt: date })}
              />
            </div>
          </div>
          <label className="border border-dashed border-gray-300 rounded p-2 bg-gray-50 cursor-pointer">
            <span className="text-xs font-medium text-gray-600">{t("adm.biz.tradeLicense")}</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
              className="block text-xs text-gray-500 mt-1 w-full"
              onChange={(e) => setTradeLicense(e.target.files?.[0] ?? null)}
            />
            {tradeLicense && <span className="text-[11px] text-green-600 mt-1 block">✓ {tradeLicense.name}</span>}
          </label>
          <label className="border border-dashed border-gray-300 rounded p-2 bg-gray-50 cursor-pointer">
            <span className="text-xs font-medium text-gray-600">{t("biz.tinCert")}</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
              className="block text-xs text-gray-500 mt-1 w-full"
              onChange={(e) => setTinCertificate(e.target.files?.[0] ?? null)}
            />
            {tinCertificate && <span className="text-[11px] text-green-600 mt-1 block">✓ {tinCertificate.name}</span>}
          </label>
          <button type="submit" className="bg-gray-800 text-white rounded p-2 text-sm font-medium md:col-span-2">
            {t("biz.createBusiness")}
          </button>
        </form>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <ul className="divide-y divide-gray-100">
          {orgs.map((o) => {
            const owner = o.memberships?.[0]?.user;
            return (
              <li key={o.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-800">{o.name}</p>
                  <p className="text-xs text-gray-400">
                    {verticalName(o.businessType) || o.businessType}
                    {owner?.name ? t("adm.ownerPrefix", { name: owner.name }) : ""}
                  </p>
                  <p className="text-[11px] mt-0.5">
                    {o.aiEnabled === false ? (
                      <span className="text-red-600">{t("biz.aiDisabled")}</span>
                    ) : o.aiTrialEndsAt ? (
                      <span className="text-blue-600">
                        {t("adm.biz.aiEnds", { date: String(o.aiTrialEndsAt).slice(0, 10) })}
                      </span>
                    ) : (
                      <span className="text-amber-600">{t("adm.biz.aiNoDate")}</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${VSTATUS_STYLES[o.verificationStatus ?? "PENDING"] ?? VSTATUS_STYLES.PENDING}`}
                    title={t("adm.biz.vstatusTitle")}
                  >
                    {statusLabel(o.verificationStatus ?? "PENDING")}
                  </span>
                  <select
                    value={vDraft[o.id] ?? o.verificationStatus ?? "PENDING"}
                    onChange={(e) => setVDraft((prev) => ({ ...prev, [o.id]: e.target.value }))}
                    className="text-xs border border-gray-300 rounded px-1 py-1 bg-white"
                    title={t("adm.biz.vstatusChange")}
                  >
                    {VERIFICATION_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {statusLabel(s)}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => setVerificationStatus(o.id, vDraft[o.id] ?? o.verificationStatus ?? "PENDING")}
                    disabled={!vDraft[o.id] || vDraft[o.id] === o.verificationStatus}
                    className="text-xs px-2 py-1 rounded bg-gray-800 text-white disabled:opacity-40"
                    title={t("adm.biz.applyTitle")}
                  >
                    {t("common.apply")}
                  </button>
                  <button onClick={() => startEdit(o)} className="text-xs text-blue-600 hover:underline">
                    {t("common.edit")}
                  </button>
                  <button onClick={() => deleteOrg(o.id, o.name)} className="text-xs text-red-600 hover:underline">
                    {t("common.delete")}
                  </button>
                  <button
                    onClick={() => toggleOrgStatus(o.id, o.status)}
                    className={`text-xs px-2 py-1 rounded-full ${
                      o.status === "ACTIVE" ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"
                    }`}
                  >
                    {o.status === "ACTIVE" ? t("status.active") : t("status.inactive")}
                  </button>
                </div>
              </li>
            );
          })}
          {orgs.length === 0 && <li className="px-4 py-3 text-gray-400 text-sm">{t("adm.noBusinesses")}</li>}
        </ul>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-4">{t("biz.editBusiness")}</h2>
            <form onSubmit={saveEdit} className="space-y-3">
              <input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                placeholder={t("biz.businessName")}
                className="border border-gray-300 rounded p-2 text-sm w-full"
                required
              />
              <select
                value={editForm.businessType}
                onChange={(e) => setEditForm({ ...editForm, businessType: e.target.value })}
                className="border border-gray-300 rounded p-2 text-sm w-full"
              >
                {Object.keys(VERTICAL_LABELS).map((value) => (
                  <option key={value} value={value}>
                    {t(`verticals.${value.toLowerCase()}`)}
                  </option>
                ))}
              </select>
              <div className="pt-2 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t("adm.biz.aiFeature")}</p>
                <label className="flex items-center gap-2 text-sm text-gray-700 mb-2">
                  <input
                    type="checkbox"
                    checked={editForm.aiEnabled}
                    onChange={(e) => setEditForm({ ...editForm, aiEnabled: e.target.checked })}
                    className="rounded"
                  />
                  {t("adm.biz.aiEnabledOnDemand")}
                </label>
                <label className="block text-xs text-gray-500 mb-1">
                  {t("adm.biz.aiWindowLabel")}
                </label>
                <AiTrialRadios
                  value={editForm.aiTrialEndsAt}
                  onChange={(date) => setEditForm({ ...editForm, aiTrialEndsAt: date })}
                />
                <p className="text-[11px] text-gray-400 mt-1">
                  {t("adm.biz.aiHint")}
                </p>
              </div>
              <div className="pt-2 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t("common.owner")}</p>
                <SearchableSelect
                  options={owners.map((u) => ({
                    value: String(u.id),
                    label: `${u.name} (${u.email})`,
                    searchText: `${u.name} ${u.email}`,
                  }))}
                  value={editForm.newOwnerUserId}
                  onChange={(v) => setEditForm({ ...editForm, newOwnerUserId: v })}
                  placeholder={t("adm.biz.searchOwnerAssignPh")}
                />
                {editForm.ownerId && (
                  <div className="space-y-3 mt-3">
                    <p className="text-[11px] text-gray-400">
                      {t("adm.biz.editOwnerHint")}
                    </p>
                    <input
                      value={editForm.ownerName}
                      onChange={(e) => setEditForm({ ...editForm, ownerName: e.target.value })}
                      placeholder={t("adm.biz.ownerNamePh")}
                      className="border border-gray-300 rounded p-2 text-sm w-full"
                      required
                    />
                    <input
                      type="email"
                      value={editForm.ownerEmail}
                      onChange={(e) => setEditForm({ ...editForm, ownerEmail: e.target.value })}
                      placeholder={t("adm.biz.ownerEmailPh")}
                      className="border border-gray-300 rounded p-2 text-sm w-full"
                      required
                    />
                    <input
                      type="password"
                      value={editForm.ownerPassword}
                      onChange={(e) => setEditForm({ ...editForm, ownerPassword: e.target.value })}
                      placeholder={t("adm.biz.ownerPasswordPh")}
                      className="border border-gray-300 rounded p-2 text-sm w-full"
                    />
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setEditing(null)} className="px-3 py-2 text-sm text-gray-600">
                  {t("common.cancel")}
                </button>
                <button type="submit" className="bg-gray-800 text-white rounded px-3 py-2 text-sm font-medium">
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
