"use client";

// Platform-admin management of the bank accounts tenants pay subscription fees
// into. Accounts may target a specific business type; when none exist for a
// type, the general accounts are shown to those tenants.
import api from "@/lib/api";
import Button from "@/app/components/Button";
import Loading from "@/app/components/Loading";
import Modal from "@/app/components/Modal";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useToast } from "@/app/components/ToastProvider";
import { verticalLabel } from "@/lib/verticals";
import { BUSINESS_TYPES } from "@/lib/subscriptions";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface Bank {
  id: number;
  bankName: string;
  accountName: string;
  accountNumber: string;
  branch: string | null;
  businessType: string | null;
  active: boolean;
  sortOrder: number;
}

const EMPTY = {
  bankName: "",
  accountName: "",
  accountNumber: "",
  branch: "",
  businessType: "",
  active: true,
  sortOrder: 0,
};

export default function AdminBankAccountsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Bank | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get("/admin/bank-accounts");
      setBanks(r.data);
      setError("");
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("adm.sub.loadFail"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => {
    setEditing(null);
    setForm({ ...EMPTY });
    setModalOpen(true);
  };

  const openEdit = (b: Bank) => {
    setEditing(b);
    setForm({
      bankName: b.bankName,
      accountName: b.accountName,
      accountNumber: b.accountNumber,
      branch: b.branch ?? "",
      businessType: b.businessType ?? "",
      active: b.active,
      sortOrder: b.sortOrder,
    });
    setModalOpen(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        bankName: form.bankName,
        accountName: form.accountName,
        accountNumber: form.accountNumber,
        branch: form.branch || null,
        businessType: form.businessType || null,
        active: form.active,
        sortOrder: Number(form.sortOrder) || 0,
      };
      if (editing) await api.patch(`/admin/bank-accounts/${editing.id}`, body);
      else await api.post("/admin/bank-accounts", body);
      setModalOpen(false);
      toast.success(t("adm.sub.saved"));
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? t("adm.sub.saveFail"));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (b: Bank) => {
    setBusyId(b.id);
    try {
      await api.patch(`/admin/bank-accounts/${b.id}`, {
        ...b,
        active: !b.active,
      });
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? t("adm.sub.saveFail"));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (b: Bank) => {
    if (!(await confirm(t("adm.sub.accountDeleteConfirm")))) return;
    setBusyId(b.id);
    try {
      await api.delete(`/admin/bank-accounts/${b.id}`);
      toast.success(t("common.success"));
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? t("adm.sub.saveFail"));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <Loading className="py-24" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-800">{t("adm.sub.bank")}</h1>
        <Button onClick={openNew}>+ {t("adm.sub.bankAdd")}</Button>
      </div>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2">{t("subscription.bank")}</th>
              <th className="px-3 py-2">{t("subscription.accountName")}</th>
              <th className="px-3 py-2">{t("subscription.accountNumber")}</th>
              <th className="px-3 py-2">{t("adm.sub.forType")}</th>
              <th className="px-3 py-2">{t("adm.sub.status")}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {banks.map((b) => (
              <tr key={b.id}>
                <td className="px-3 py-2 font-medium text-gray-800">
                  {b.bankName}
                  {b.branch && (
                    <span className="block text-[11px] text-gray-400">{b.branch}</span>
                  )}
                </td>
                <td className="px-3 py-2">{b.accountName}</td>
                <td className="px-3 py-2 font-mono text-xs">{b.accountNumber}</td>
                <td className="px-3 py-2 text-gray-500">
                  {b.businessType ? verticalLabel(b.businessType) : t("adm.sub.forTypeAll")}
                </td>
                <td className="px-3 py-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busyId === b.id}
                    onClick={() => toggleActive(b)}
                    className={`!rounded-full !text-xs ${b.active ? "!bg-green-100 !text-green-700" : "!bg-gray-200 !text-gray-500"}`}
                  >
                    {b.active ? t("adm.sub.active") : t("adm.sub.inactive")}
                  </Button>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button
                    onClick={() => openEdit(b)}
                    className="text-xs text-blue-600 hover:underline mr-3"
                  >
                    {t("common.edit")}
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busyId === b.id}
                    onClick={() => remove(b)}
                    className="!px-0 text-xs text-red-600 hover:underline"
                  >
                    {t("common.del")}
                  </Button>
                </td>
              </tr>
            ))}
            {banks.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-gray-400">
                  {t("adm.sub.bankEmpty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? t("adm.sub.bankEdit") : t("adm.sub.bankAdd")}
      >
        <form onSubmit={save} className="space-y-3 text-sm">
          <label className="block text-gray-600">
            {t("subscription.bank")}
            <input
              value={form.bankName}
              onChange={(e) => setForm({ ...form, bankName: e.target.value })}
              placeholder={t("adm.sub.bankNamePh")}
              className="border border-gray-300 rounded-lg p-2 text-sm w-full mt-1"
              required
            />
          </label>
          <label className="block text-gray-600">
            {t("subscription.accountName")}
            <input
              value={form.accountName}
              onChange={(e) => setForm({ ...form, accountName: e.target.value })}
              placeholder={t("adm.sub.accountNamePh")}
              className="border border-gray-300 rounded-lg p-2 text-sm w-full mt-1"
              required
            />
          </label>
          <label className="block text-gray-600">
            {t("subscription.accountNumber")}
            <input
              value={form.accountNumber}
              onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
              placeholder={t("adm.sub.accountNumberPh")}
              className="border border-gray-300 rounded-lg p-2 text-sm w-full mt-1"
              required
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-gray-600">
              {t("subscription.branch")}
              <input
                value={form.branch}
                onChange={(e) => setForm({ ...form, branch: e.target.value })}
                placeholder={t("adm.sub.branchPh")}
                className="border border-gray-300 rounded-lg p-2 text-sm w-full mt-1"
              />
            </label>
            <label className="block text-gray-600">
              {t("adm.sub.forType")}
              <select
                value={form.businessType}
                onChange={(e) => setForm({ ...form, businessType: e.target.value })}
                className="border border-gray-300 rounded-lg p-2 text-sm w-full mt-1 bg-white"
              >
                <option value="">{t("adm.sub.forTypeAll")}</option>
                {BUSINESS_TYPES.map((bt) => (
                  <option key={bt} value={bt}>
                    {verticalLabel(bt)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-gray-600">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
              className="rounded"
            />
            {t("adm.sub.active")}
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-3 py-2 text-sm text-gray-600"
            >
              {t("common.cancel")}
            </button>
            <Button type="submit" loading={saving}>
              {t("common.save")}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
