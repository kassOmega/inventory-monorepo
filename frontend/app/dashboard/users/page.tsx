"use client";
import api, { markHandled } from "@/lib/api";
import { useSingleLocationAutofill } from "@/lib/singleLocation";
import { useAuth } from "@/context/AuthContext";
import { useConfirm } from "@/app/components/ConfirmProvider";
import { useToast } from "@/app/components/ToastProvider";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import useServerPaging from "@/lib/useServerPaging";
import Pagination from "@/app/components/Pagination";
import Loading from "../../components/Loading";
import Modal from "../../components/Modal";
import { formatBusinessNumber } from "@/lib/bizNumber";

function groupPermissions(permissions: any[]) {
  const map: Record<string, any[]> = {};
  for (const p of permissions) {
    const g = p.permission?.group || "Other";
    (map[g] ||= []).push(p);
  }
  return Object.entries(map);
}

export default function UsersPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [users, setUsers] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [editing, setEditing] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    roleId: "",
    locationId: "",
    dailyAiQuota: "",
  });
  // Autofill the sole location when the business has only one.
  useSingleLocationAutofill(locations, form.locationId, (v) =>
    setForm((f) => ({ ...f, locationId: v })),
  );
  const [resetUser, setResetUser] = useState<any>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetMsg, setResetMsg] = useState("");
  const [resetError, setResetError] = useState("");
  const [viewingRole, setViewingRole] = useState<any>(null);
  const [aiUsage, setAiUsage] = useState<any>(null);
  const [menuUser, setMenuUser] = useState<any>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const paged = useServerPaging({ pageSize: 20 });

  const loadUsers = async () => {
    const res = await api.get(
      `/users?page=${paged.page}&pageSize=${paged.pageSize}`,
    );
    const body = res.data;
    const rows = Array.isArray(body) ? body : (body?.data ?? []);
    setUsers(rows);
    paged.setTotal(Array.isArray(body) ? rows.length : (body?.total ?? rows.length));
  };

  useEffect(() => {
    setLoading(true);
    loadUsers()
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paged.page, paged.pageSize]);

  useEffect(() => {
    Promise.all([api.get("/locations"), api.get("/roles")])
      .then(([lRes, rRes]) => {
        setLocations(lRes.data);
        setRoles(rRes.data);
      })
      .catch(() => {});
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: any = {
      ...form,
      roleId: form.roleId ? Number(form.roleId) : null,
      locationId: form.locationId ? Number(form.locationId) : null,
      dailyAiQuota:
        form.dailyAiQuota !== "" ? Number(form.dailyAiQuota) : null,
    };
    if (editing) {
      const { password, ...updateData } = payload;
      if (!password) delete (updateData as any).password;
      await api.put(`/users/${editing.id}`, updateData);
    } else {
      await api.post("/auth/register", payload);
    }
    setShowForm(false);
    setEditing(null);
    setForm({
      name: "",
      email: "",
      password: "",
      roleId: "",
      locationId: "",
      dailyAiQuota: "",
    });
    loadUsers();
  };

  const startEdit = (u: any) => {
    setEditing(u);
    setShowForm(true);
    setForm({
      name: u.name,
      email: u.email,
      password: "",
      roleId: u.roleId ? String(u.roleId) : "",
      locationId: u.locationId ? String(u.locationId) : "",
      dailyAiQuota: u.dailyAiQuota != null ? String(u.dailyAiQuota) : "",
    });
    // Today's AI usage for the edit view.
    api
      .get(`/users/${u.id}/ai-usage`)
      .then((r) => setAiUsage(r.data))
      .catch(() => setAiUsage(null));
  };

  const handleDelete = async (id: number) => {
    const ok = await confirm(t("users.delConfirm"));
    if (!ok) return;
    try {
      await api.delete(`/users/${id}`);
      toast.success(t("users.userDeleted"));
      loadUsers();
    } catch (err: any) {
      markHandled(err);
      toast.error(err.response?.data?.message || t("users.delFail"));
    }
  };

  const openResetPassword = (u: any) => {
    setResetUser(u);
    setNewPassword("");
    setResetMsg("");
    setResetError("");
  };

  const openMenu = (u: any, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenuUser(u);
    setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetMsg("");
    setResetError("");
    try {
      await api.put(`/users/${resetUser.id}/password`, {
        password: newPassword,
      });
      setResetMsg(t("users.passwordUpdated"));
      setNewPassword("");
      setTimeout(() => setResetUser(null), 1200);
    } catch (err: any) {
      markHandled(err);
      setResetError(
        err.response?.data?.message || t("users.errPassword"),
      );
    }
  };

  const toggleStatus = async (u: any) => {
    const next = u.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      await api.patch(`/users/${u.id}/status`, { status: next });
      loadUsers();
    } catch (err: any) {
      markHandled(err);
      toast.error(err.response?.data?.message || t("users.statusFail"));
    }
  };

  // Selected role (to know whether it is the system/owner role)
  const selectedRole = roles.find((r: any) => String(r.id) === form.roleId);
  const isSystemRole = !!selectedRole?.isSystem;

  if (loading) return <Loading className="py-24" />;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">
          {t("users.manageUsers")}
        </h1>
        <button
          onClick={() => {
            setEditing(null);
            setForm({ name: "", email: "", password: "", roleId: "", locationId: "", dailyAiQuota: "" });
            setShowForm(true);
          }}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg"
        >
          {t("users.addUserBtn")}
        </button>
      </div>

      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title={editing ? t("users.editUser") : t("users.addUser")}>
        <form
          onSubmit={handleSave}
          className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("users.fullName")}
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="border p-2 rounded-lg w-full"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("users.emailAddress")}
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="border p-2 rounded-lg w-full"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("users.password")} {editing && t("users.passKeepHint")}
            </label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="border p-2 rounded-lg w-full"
              required={!editing}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("users.role")}
            </label>
            <select
              value={form.roleId}
              onChange={(e) =>
                setForm({ ...form, roleId: e.target.value, locationId: "" })
              }
              className="border p-2 rounded-lg w-full bg-white"
              required
            >
              <option value="">{t("users.selectRolePh")}</option>
              {roles.map((r: any) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("users.aiDaily")}
            </label>
            <input
              type="number"
              min="0"
              value={form.dailyAiQuota}
              onChange={(e) => setForm({ ...form, dailyAiQuota: e.target.value })}
              placeholder={t("users.defaultPh")}
              className="border p-2 rounded-lg w-full"
            />
            <p className="text-[11px] text-gray-400 mt-1">
              {t("users.aiHint")}
            </p>
            {editing && aiUsage && (
              <p className="text-[11px] text-blue-600 mt-1">
                {t("users.usedToday", { count: aiUsage.count, quota: aiUsage.quota })}
              </p>
            )}
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("users.assignedLocation")}
            </label>
            <select
              value={form.locationId}
              onChange={(e) => setForm({ ...form, locationId: e.target.value })}
              className="border p-2 rounded-lg w-full bg-white"
              disabled={isSystemRole}
            >
              <option value="">{t("users.selectLocationPh")}</option>
              {locations.map((l: any) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.type})
                </option>
              ))}
            </select>
            {isSystemRole && (
              <p className="text-xs text-gray-400 mt-1">
                {t("users.ownerHint")}
              </p>
            )}
          </div>
          <button
            type="submit"
            className="bg-green-600 text-white p-2 rounded-lg md:col-span-2"
          >
            {editing ? t("users.update") : t("users.create")} {t("users.user")}
          </button>
        </form>
      </Modal>

      <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
        <table className="w-full text-left text-xs sm:text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="p-2 sm:p-3 md:p-4">{t("users.name")}</th>
              <th className="p-2 sm:p-3 md:p-4">{t("users.email")}</th>
              <th className="p-2 sm:p-3 md:p-4">{t("users.role")}</th>
              <th className="p-2 sm:p-3 md:p-4">{t("users.location")}</th>
              <th className="p-2 sm:p-3 md:p-4">AI / Day</th>
              <th className="p-2 sm:p-3 md:p-4">{t("users.status")}</th>
              <th className="p-2 sm:p-3 md:p-4">{t("users.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u: any) => {
              const loc = locations.find((l: any) => l.id === u.locationId);
              return (
                <tr key={u.id} className="border-b hover:bg-gray-50">
                  <td className="p-2 sm:p-3 md:p-4 font-medium whitespace-nowrap">
                    {u.name}
                    {(u.numberLabel ??
                      formatBusinessNumber("USR", u.number)) && (
                      <span className="block text-[10px] font-normal text-gray-400">
                        {u.numberLabel ??
                          formatBusinessNumber("USR", u.number)}
                      </span>
                    )}
                  </td>
                  <td className="p-2 sm:p-3 md:p-4 text-gray-600 text-xs sm:text-sm whitespace-nowrap">{u.email}</td>
                  <td className="p-2 sm:p-3 md:p-4">
                    <button
                      onClick={() =>
                        setViewingRole(
                          roles.find((r: any) => r.id === u.roleId) ?? null,
                        )
                      }
                      className="bg-blue-100 text-blue-800 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded text-[10px] sm:text-xs hover:bg-blue-200 underline decoration-dotted cursor-pointer"
                      title={t("users.viewRole")}
                    >
                      {u.role?.name}
                    </button>
                  </td>
                  <td className="p-2 sm:p-3 md:p-4 text-xs sm:text-sm text-gray-600 whitespace-nowrap">
                    {loc ? loc.name : "-"}
                  </td>
                  <td className="p-2 sm:p-3 md:p-4 text-xs sm:text-sm text-gray-600 whitespace-nowrap">
                    {u.dailyAiQuota != null ? u.dailyAiQuota : 15}
                    {u.dailyAiQuota == null && (
                      <span className="text-[10px] text-gray-400"> {t("users.defaultTag")}</span>
                    )}
                  </td>
                  <td className="p-2 sm:p-3 md:p-4">
                    <span
                      className={`px-1.5 sm:px-2 py-0.5 sm:py-1 rounded text-[10px] sm:text-xs ${
                        u.status === "ACTIVE"
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-200 text-gray-600"
                      }`}
                    >
                      {u.status === "ACTIVE" ? t("users.active") : t("users.inactive")}
                    </span>
                  </td>
                  <td className="p-2 sm:p-3 md:p-4">
                    <button
                      onClick={(e) => openMenu(u, e)}
                      className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                      title={t("users.actions")}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="h-5 w-5"
                      >
                        <circle cx="12" cy="5" r="2" />
                        <circle cx="12" cy="12" r="2" />
                        <circle cx="12" cy="19" r="2" />
                      </svg>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination
        page={paged.page}
        totalPages={paged.totalPages}
        total={paged.total}
        rangeStart={paged.rangeStart}
        rangeEnd={paged.rangeEnd}
        onPrev={paged.prev}
        onNext={paged.next}
        onPage={paged.setPage}
        onPageSizeChange={paged.setPageSize}
        pageSize={paged.pageSize}
      />

      <Modal
        isOpen={!!resetUser}
        onClose={() => setResetUser(null)}
        title={t("users.resetTitle", { name: resetUser?.name })}
      >
        <form onSubmit={handleResetPassword} className="space-y-4">
          <p className="text-sm text-gray-600">
            {t("users.setNewPw", { email: resetUser?.email })}
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("users.newPassword")}
            </label>
            <input
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="border p-2 rounded-lg w-full text-sm"
              minLength={8}
              required
            />
            <p className="text-xs text-gray-400 mt-1">{t("users.minChars")}</p>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setResetUser(null)}
              className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              {t("users.savePassword")}
            </button>
          </div>
          {resetMsg && <p className="text-green-600 text-sm">{resetMsg}</p>}
          {resetError && <p className="text-red-500 text-sm">{resetError}</p>}
        </form>
      </Modal>

      <Modal
        isOpen={!!viewingRole}
        onClose={() => setViewingRole(null)}
        title={t("roles.viewRoleTitle", { name: viewingRole?.name })}
      >
        <div className="space-y-4">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">
              {t("roles.desc")}
            </p>
            <p className="text-sm text-gray-700 mt-1">
              {viewingRole?.description || t("roles.noDescription")}
            </p>
            {viewingRole?.isSystem && (
              <span className="inline-block mt-1 bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-[10px]">
                {t("roles.systemNote")}
              </span>
            )}
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">
              {t("roles.permissions")} ({viewingRole?.permissions?.length ?? 0})
            </p>
            <div className="max-h-72 overflow-y-auto space-y-3">
              {viewingRole?.permissions?.length ? (
                groupPermissions(viewingRole.permissions).map(([group, perms]) => (
                  <div key={group}>
                    <p className="font-semibold text-xs uppercase tracking-wide text-gray-500 mb-1">
                      {group}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {perms.map((p: any) => (
                        <span
                          key={p.permission.key}
                          className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-[11px]"
                        >
                          {p.permission.label}
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
              onClick={() => setViewingRole(null)}
              className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100"
            >
              {t("roles.close")}
            </button>
          </div>
        </div>
      </Modal>

      {menuUser && menuPos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuUser(null)} />
          <div
            className="fixed z-50 bg-white rounded-lg shadow-lg border py-1 min-w-[170px]"
            style={{ top: menuPos.top, right: menuPos.right }}
          >
            <button
              onClick={() => {
                startEdit(menuUser);
                setMenuUser(null);
              }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              {t("roles.edit")}
            </button>
            {user?.isSuperuser && (
              <button
                onClick={() => {
                  openResetPassword(menuUser);
                  setMenuUser(null);
                }}
                className="w-full text-left px-4 py-2 text-sm text-amber-600 hover:bg-gray-100"
              >
                {t("users.resetPassword")}
              </button>
            )}
            <button
              onClick={() => {
                toggleStatus(menuUser);
                setMenuUser(null);
              }}
              disabled={menuUser.id === user?.id}
              className={`w-full text-left px-4 py-2 text-sm ${
                menuUser.id === user?.id
                  ? "text-gray-300 cursor-not-allowed"
                  : menuUser.status === "ACTIVE"
                    ? "text-red-500 hover:bg-gray-100"
                    : "text-green-600 hover:bg-gray-100"
              }`}
            >
              {menuUser.status === "ACTIVE" ? t("users.deactivate") : t("users.activate")}
            </button>
            <button
              onClick={() => {
                handleDelete(menuUser.id);
                setMenuUser(null);
              }}
              className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-gray-100"
            >
              {t("roles.delete")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
