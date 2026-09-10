"use client";

import { useConfirm } from "@/app/components/ConfirmProvider";
import Modal from "@/app/components/Modal";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { statusLabel } from "@/lib/statusLabel";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;

interface Account {
  id: number;
  name: string;
  code: string | null;
  type: string;
  parentId: number | null;
  isSystem: boolean;
}

const TYPE_STYLES: Record<string, string> = {
  ASSET: "bg-blue-50 text-blue-700",
  LIABILITY: "bg-amber-50 text-amber-700",
  EQUITY: "bg-purple-50 text-purple-700",
  INCOME: "bg-green-50 text-green-700",
  EXPENSE: "bg-red-50 text-red-700",
};

interface AccountForm {
  id: number | null;
  name: string;
  code: string;
  type: string;
  parentId: string; // "" means none
}

export default function AccountsPage() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("finance.manage");
  const confirm = useConfirm();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState<AccountForm | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("ALL");

  const load = useCallback(async () => {
    try {
      const res = await api.get("/finance/accounts");
      setAccounts(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("accounts.failedToLoad"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(""), 2000);
  };

  const grouped = useMemo(() => {
    const groups = ACCOUNT_TYPES.map((type) => ({
      type,
      items: accounts.filter((a) => a.type === type),
    }));
    return groups.filter((g) => g.items.length > 0);
  }, [accounts]);

  const parentName = (id: number) => accounts.find((a) => a.id === id)?.name ?? `#${id}`;

  const invalidParentIds = useMemo(() => {
    if (!form?.id) return new Set<number>();
    const set = new Set<number>([form.id]);
    const walk = (id: number) => {
      accounts.forEach((a) => {
        if (a.parentId === id && !set.has(a.id)) {
          set.add(a.id);
          walk(a.id);
        }
      });
    };
    walk(form.id);
    return set;
  }, [form?.id, accounts]);

  const parentOptions = accounts.filter((a) => !invalidParentIds.has(a.id));

  const openNew = () => setForm({ id: null, name: "", code: "", type: "EXPENSE", parentId: "" });

  const openEdit = (a: Account) =>
    setForm({
      id: a.id,
      name: a.name,
      code: a.code ?? "",
      type: a.type,
      parentId: a.parentId ? String(a.parentId) : "",
    });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!form) return;
    try {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim() || null,
        type: form.type,
        parentId: form.parentId ? Number(form.parentId) : null,
      };
      if (form.id) await api.patch(`/finance/accounts/${form.id}`, payload);
      else await api.post("/finance/accounts", payload);
      setForm(null);
      flash(t("accounts.saved"));
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("accounts.failedToSave"));
    }
  };

  const remove = async (a: Account) => {
    const ok = await confirm(t("accounts.deleteConfirm", { name: a.name }));
    if (!ok) return;
    try {
      await api.delete(`/finance/accounts/${a.id}`);
      flash(t("accounts.deleted"));
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("accounts.failedToDelete"));
    }
  };

  if (loading) return <p className="text-gray-500 p-6">{t("accounts.loading")}</p>;

  const editingSystem = form?.id ? accounts.find((a) => a.id === form.id)?.isSystem : false;
  const visibleGroups = typeFilter === "ALL" ? grouped : grouped.filter((g) => g.type === typeFilter);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{t("accounts.title")}</h1>
          <p className="text-sm text-gray-400">
            {t("accounts.subtitle")}
          </p>
        </div>
        {canManage && (
          <button
            onClick={openNew}
            className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-blue-700"
          >
            + {t("accounts.newAccount")}
          </button>
        )}
      </div>

      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}
      {msg && <div className="bg-green-50 text-green-700 p-3 rounded text-sm">{msg}</div>}

      <div className="flex flex-wrap gap-2">
        {["ALL", ...ACCOUNT_TYPES].map((f) => (
          <button
            key={f}
            onClick={() => setTypeFilter(f)}
            className={`px-3 py-1.5 rounded text-sm font-medium ${
              typeFilter === f ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {f === "ALL" ? t("common.all") : statusLabel(f)}
          </button>
        ))}
      </div>

      {visibleGroups.map((g) => (
        <section key={g.type} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50/60">
            <span className={`text-[10px] font-semibold uppercase tracking-wide rounded px-2 py-0.5 ${TYPE_STYLES[g.type]}`}>
              {statusLabel(g.type)}
            </span>
            <span className="text-xs text-gray-400">
              {g.items.length === 1 ? t("accounts.oneAccount") : t("accounts.nAccounts", { count: g.items.length })}
            </span>
          </div>
          <ul className="divide-y divide-gray-100">
            {g.items.map((a) => (
              <li key={a.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-800">{a.name}</span>
                    {a.isSystem && (
                      <span className="text-[10px] uppercase tracking-wide bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">
                        {t("accounts.system")}
                      </span>
                    )}
                    {a.parentId && (
                      <span className="text-[11px] text-gray-400">· {t("accounts.under")} {parentName(a.parentId)}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{a.code ? `${a.code} · ` : ""}{statusLabel(a.type)}</p>
                </div>
                {canManage && (
                  <div className="flex items-center gap-3 shrink-0">
                    <button onClick={() => openEdit(a)} className="text-xs text-blue-600 hover:underline">
                      {t("common.edit")}
                    </button>
                    {!a.isSystem && (
                      <button onClick={() => remove(a)} className="text-xs text-red-600 hover:underline">
                        {t("common.delete")}
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {visibleGroups.length === 0 && (
        <p className="text-gray-400 text-sm py-8 text-center">{t("accounts.noAccounts")}</p>
      )}

      <Modal
        isOpen={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? t("accounts.editAccount") : t("accounts.newAccount")}
      >
        {form && (
          <form onSubmit={save} className="space-y-4">
            {editingSystem && (
              <p className="text-xs text-amber-600 bg-amber-50 rounded p-2">
                {t("accounts.systemNote")}
              </p>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t("accounts.accountName")}</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={editingSystem}
                placeholder={t("accounts.namePh")}
                className="border border-gray-300 rounded p-2 text-sm w-full disabled:bg-gray-100 disabled:text-gray-400"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t("accounts.code")}</label>
                <input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder={t("accounts.codePh")}
                  className="border border-gray-300 rounded p-2 text-sm w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t("accounts.type")}</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                  disabled={editingSystem}
                  className="border border-gray-300 rounded p-2 text-sm w-full disabled:bg-gray-100"
                >
                  {ACCOUNT_TYPES.map((at) => (
                    <option key={at} value={at}>{statusLabel(at)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t("accounts.parent")}</label>
              <select
                value={form.parentId}
                onChange={(e) => setForm({ ...form, parentId: e.target.value })}
                className="border border-gray-300 rounded p-2 text-sm w-full"
              >
                <option value="">{t("accounts.noneParent")}</option>
                {parentOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({statusLabel(a.type)})
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-gray-400 mt-1">
                {t("accounts.groupingHint")}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setForm(null)} className="px-3 py-2 text-sm text-gray-600">
                {t("common.cancel")}
              </button>
              <button type="submit" className="bg-gray-800 text-white rounded px-4 py-2 text-sm font-medium">
                {t("accounts.saveAccount")}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
