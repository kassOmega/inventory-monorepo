"use client";
import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useToast } from "@/app/components/ToastProvider";
import RowActionsMenu from "@/app/components/RowActionsMenu";
import { useTranslation } from "react-i18next";
import api, { markHandled } from "@/lib/api";
import { useEffect, useMemo, useState } from "react";
import Loading from "../../components/Loading";
import Modal from "../../components/Modal";

interface Role {
  id: number;
  name: string;
  description: string | null;
  isSystem: boolean;
  _count: { users: number };
  permissions: { permission: { key: string; label: string; group: string } }[];
}

interface Permission {
  id?: number;
  key: string;
  label: string;
  group: string;
}

function groupPermissions(permissions: { permission: Permission }[]) {
  const map: Record<string, Permission[]> = {};
  for (const rp of permissions) {
    const g = rp.permission.group || "Other";
    (map[g] ||= []).push(rp.permission);
  }
  return Object.entries(map);
}

export default function RolesPage() {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [editing, setEditing] = useState<Role | null>(null);
  const [viewing, setViewing] = useState<Role | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get("/roles"),
      api.get("/roles/permissions"),
    ])
      .then(([rRes, pRes]) => {
        setRoles(rRes.data);
        setPermissions(pRes.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const grouped = useMemo(() => {
    const map: Record<string, Permission[]> = {};
    for (const p of permissions) {
      (map[p.group] ||= []).push(p);
    }
    // The catalog is filtered to the business type, so include any permission
    // the role being edited already has that falls outside that filter (e.g.
    // granted before the vertical filter existed) under its own group — that
    // way saving the role never silently drops it.
    if (editing) {
      for (const rp of editing.permissions) {
        const p = rp.permission;
        if (!permissions.some((x) => x.key === p.key)) {
          (map[p.group] ||= []).push(p);
        }
      }
    }
    return map;
  }, [permissions, editing]);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setDescription("");
    setSelectedKeys(new Set());
    setError("");
    setMsg("");
    setShowModal(true);
  };

  const openEdit = (role: Role) => {
    setEditing(role);
    setName(role.name);
    setDescription(role.description || "");
    setSelectedKeys(new Set(role.permissions.map((p) => p.permission.key)));
    setError("");
    setMsg("");
    setShowModal(true);
  };

  const toggle = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleGroup = (keys: string[]) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      const allSelected = keys.every((k) => next.has(k));
      for (const k of keys) {
        if (allSelected) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  };

  const save = async () => {
    setError("");
    setMsg("");
    if (!name.trim()) {
      setError(t("roles.nameRequired"));
      return;
    }
    const body = {
      name: name.trim(),
      description: description.trim() || null,
      permissions: Array.from(selectedKeys),
    };
    try {
      if (editing) await api.put(`/roles/${editing.id}`, body);
      else await api.post("/roles", body);
      setMsg(t("roles.saved"));
      load();
      setTimeout(() => {
        setShowModal(false);
        setMsg("");
      }, 700);
    } catch (e: any) {
      markHandled(e);
      setError(e.response?.data?.message || t("roles.saveFail"));
    }
  };

  const remove = async (role: Role) => {
    const ok = await confirm(t("roles.deleteConfirm", { name: role.name }));
    if (!ok) return;
    try {
      await api.delete(`/roles/${role.id}`);
      load();
    } catch (e: any) {
      markHandled(e);
      toast.error(e.response?.data?.message || t("roles.deleteFail"));
    }
  };

  if (!hasPermission("roles.manage")) {
    return (
      <div className="p-8 text-gray-500">
        {t("roles.noAccess")}
      </div>
    );
  }

  if (loading) return <Loading className="py-24" />;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">
          {t("roles.pageTitle")}
        </h1>
        <button
          onClick={openCreate}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          {t("roles.addRoleBtn")}
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
        <table className="w-full text-left text-xs sm:text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="p-2 sm:p-3 md:p-4">Role</th>
              <th className="p-2 sm:p-3 md:p-4">{t("roles.desc")}</th>
              <th className="p-2 sm:p-3 md:p-4">{t("roles.users")}</th>
              <th className="p-2 sm:p-3 md:p-4">{t("roles.permissions")}</th>
              <th className="p-2 sm:p-3 md:p-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr
                key={role.id}
                onClick={() => setViewing(role)}
                title={t("roles.rowTitle")}
                className="border-b hover:bg-gray-50 cursor-pointer"
              >
                <td className="p-2 sm:p-3 md:p-4 font-medium whitespace-nowrap group">
                  <span className="group-hover:text-blue-600 transition-colors">
                    {role.name}
                  </span>
                  {role.isSystem && (
                    <span className="ml-2 bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-[10px]">
                      {t("roles.system")}
                    </span>
                  )}
                </td>
                <td className="p-2 sm:p-3 md:p-4 text-gray-600">
                  {role.description || "-"}
                </td>
                <td className="p-2 sm:p-3 md:p-4 text-gray-600">
                  {role._count?.users ?? 0}
                </td>
                <td className="p-2 sm:p-3 md:p-4 text-gray-600">
                  {role.permissions.length}
                </td>
                <td
                  className="p-2 sm:p-3 md:p-4"
                  onClick={(e) => e.stopPropagation()}
                >
                  {!role.isSystem && (
                    <RowActionsMenu
                      items={[
                        { label: t("roles.edit"), onClick: () => openEdit(role) },
                        {
                          label: t("roles.delete"),
                          color: "text-red-500",
                          onClick: () => remove(role),
                        },
                      ]}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? t("roles.editRoleTitle", { name: editing.name }) : t("roles.addRole")}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("roles.name")}
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="border p-2 rounded-lg w-full text-sm"
              placeholder={t("roles.namePh")}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("roles.desc")}
            </label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="border p-2 rounded-lg w-full text-sm"
              placeholder={t("roles.optional")}
            />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500 mb-2">
              {t("roles.permissions")}
            </p>
            <div className="max-h-72 overflow-y-auto space-y-3 border rounded-lg p-3">
              {Object.entries(grouped).map(([group, perms]) => (
                <div key={group}>
                  <div className="flex items-center gap-2 mb-1">
                    <button
                      type="button"
                      onClick={() => toggleGroup(perms.map((p) => p.key))}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      {perms.every((p) => selectedKeys.has(p.key))
                        ? t("roles.uncheckAll")
                        : t("roles.checkAll")}
                    </button>
                    <p className="font-semibold text-xs uppercase tracking-wide text-gray-500">
                      {group}
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                    {perms.map((p) => (
                      <label
                        key={p.key}
                        className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedKeys.has(p.key)}
                          onChange={() => toggle(p.key)}
                          className="rounded"
                        />
                        {p.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          {msg && <p className="text-green-600 text-sm">{msg}</p>}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowModal(false)}
              className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={save}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              {t("roles.saveBtn")}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!viewing}
        onClose={() => setViewing(null)}
        title={t("roles.viewRoleTitle", { name: viewing?.name })}
      >
        <div className="space-y-4">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">
              {t("roles.desc")}
            </p>
            <p className="text-sm text-gray-700 mt-1">
              {viewing?.description || t("roles.noDescription")}
            </p>
            {viewing?.isSystem && (
              <span className="inline-block mt-1 bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-[10px]">
                {t("roles.systemNote")}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="border border-gray-100 rounded-lg p-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide">
                {t("roles.users")}
              </p>
              <p className="text-xl font-bold text-gray-800 mt-1">
                {viewing?._count?.users ?? 0}
              </p>
            </div>
            <div className="border border-gray-100 rounded-lg p-3">
              <p className="text-xs text-gray-400 uppercase tracking-wide">
                {t("roles.permissions")}
              </p>
              <p className="text-xl font-bold text-gray-800 mt-1">
                {viewing?.permissions.length ?? 0}
              </p>
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">
              {t("roles.permissions")}
            </p>
            <div className="max-h-72 overflow-y-auto space-y-3">
              {viewing?.permissions.length ? (
                groupPermissions(viewing.permissions).map(([group, perms]) => (
                  <div key={group}>
                    <p className="font-semibold text-xs uppercase tracking-wide text-gray-500 mb-1">
                      {group}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {perms.map((p) => (
                        <span
                          key={p.key}
                          className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-[11px]"
                        >
                          {p.label}
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500">
                  {t("roles.noPerms")}
                </p>
              )}
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => setViewing(null)}
              className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100"
            >
              {t("roles.close")}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

