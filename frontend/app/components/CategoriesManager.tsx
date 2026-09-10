"use client";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/app/components/ToastProvider";
import { useConfirm } from "@/app/components/ConfirmProvider";
import api, { markHandled } from "@/lib/api";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";

export default function CategoriesManager() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [categories, setCategories] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<any>(null);
  const [editName, setEditName] = useState("");

  const canCreate = hasPermission("categories.create");
  const canEdit = hasPermission("categories.edit");
  const canDelete = hasPermission("categories.delete");

  const fetchCategories = () =>
    api.get("/categories").then((r) => setCategories(r.data));

  useEffect(() => {
    fetchCategories();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api.post("/categories", { name: name.trim() });
      setName("");
      fetchCategories();
      toast.success(t("cat.created"));
    } catch (err: any) {
      markHandled(err);
      toast.error(t("cat.failedCreate"));
    }
  };

  const startEdit = (c: any) => {
    setEditing(c);
    setEditName(c.name);
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.put("/categories/" + editing.id, { name: editName.trim() });
      setEditing(null);
      setEditName("");
      fetchCategories();
      toast.success(t("cat.updated"));
    } catch (err: any) {
      markHandled(err);
      toast.error(t("cat.failedUpdate"));
    }
  };

  const handleDelete = async (c: any) => {
    const ok = await confirm(t("cat.deleteConfirm", { name: c.name }));
    if (!ok) return;
    try {
      await api.delete("/categories/" + c.id);
      fetchCategories();
      toast.success(t("cat.deleted"));
    } catch (err: any) {
      markHandled(err);
      toast.error(err.response?.data?.message || t("cat.failedDelete"));
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <h2 className="font-semibold text-gray-800">{t("cat.title")}</h2>
      </div>

      {canCreate && (
        <form onSubmit={handleCreate} className="flex gap-2 mb-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("cat.newNamePh")}
            className="border p-2 rounded-lg flex-1 text-sm"
          />
          <button
            type="submit"
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm"
          >
            {t("common.add")}
          </button>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="p-3">{t("cat.colName")}</th>
              <th className="p-3">{t("cat.colProducts")}</th>
              {(canEdit || canDelete) && <th className="p-3">{t("common.actions")}</th>}
            </tr>
          </thead>
          <tbody>
            {categories.map((c: any) => (
              <tr key={c.id} className="border-b hover:bg-gray-50">
                <td className="p-3 font-medium">
                  {editing?.id === c.id ? (
                    <form onSubmit={handleEdit} className="flex gap-2">
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="border p-1.5 rounded flex-1 text-sm"
                      />
                      <button type="submit" className="text-green-600 px-2">
                        {t("common.save")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="text-gray-500 px-2"
                      >
                        {t("common.cancel")}
                      </button>
                    </form>
                  ) : (
                    c.name
                  )}
                </td>
                <td className="p-3 text-gray-600">
                  {c._count?.products ?? 0}
                </td>
                {(canEdit || canDelete) && (
                  <td className="p-3">
                    <div className="flex gap-2">
                      {canEdit && (
                        <button
                          onClick={() => startEdit(c)}
                          className="text-blue-600 text-sm"
                        >
                          {t("common.edit")}
                        </button>
                      )}
                      {canDelete && (
                        <button
                          onClick={() => handleDelete(c)}
                          className="text-red-500 text-sm"
                        >
                          {t("common.delete")}
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
