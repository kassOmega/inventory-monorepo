"use client";
import Modal from "@/app/components/Modal";
import RowActionsMenu from "@/app/components/RowActionsMenu";
import { useToast } from "@/app/components/ToastProvider";
import { useConfirm } from "@/app/components/ConfirmProvider";
import api, { markHandled } from "@/lib/api";
import { statusLabel } from "@/lib/statusLabel";
import Loading from "@/app/components/Loading";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import useServerPaging from "@/lib/useServerPaging";
import Pagination from "@/app/components/Pagination";

export default function LocationsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", type: "SHOP", categoryId: "" });
  const [editing, setEditing] = useState<any>(null);
  const [showModal, setShowModal] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);
  const [newCategory, setNewCategory] = useState("");
  const paged = useServerPaging({ pageSize: 20 });

  const fetchLocs = async () => {
    setLoading(true);
    try {
      const res = await api.get(
        `/locations?page=${paged.page}&pageSize=${paged.pageSize}`,
      );
      const body = res.data;
      const rows = Array.isArray(body) ? body : (body?.data ?? []);
      setLocations(rows);
      paged.setTotal(Array.isArray(body) ? rows.length : (body?.total ?? rows.length));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    api
      .get("/locations/categories")
      .then((r) => setCategories(r.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchLocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paged.page, paged.pageSize]);

  const openCreate = () => { setEditing(null); setForm({ name: "", type: "SHOP", categoryId: "" }); setShowModal(true); };
  const openEdit = (l: any) => { setEditing(l); setForm({ name: l.name, type: l.type, categoryId: l.categoryId ? String(l.categoryId) : "" }); setShowModal(true); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      name: form.name,
      type: form.type === "SHOP" ? "SHOP" : "STORE",
      categoryId: form.categoryId ? Number(form.categoryId) : undefined,
    };
    if (editing) {
      await api.put(`/locations/${editing.id}`, data);
      toast.success(t("locations.updated"));
    } else {
      await api.post("/locations", data);
      toast.success(t("locations.created"));
    }
    setShowModal(false);
    setEditing(null);
    fetchLocs();
  };

  const handleDelete = async (id: number) => {
    const ok = await confirm(t("locations.deleteConfirm"));
    if (!ok) return;
    await api.delete(`/locations/${id}`);
    fetchLocs();
    toast.success(t("locations.deleted"));
  };

  const handleAddCategory = async () => {
    const name = newCategory.trim();
    if (!name) return;
    try {
      const res = await api.post("/locations/categories", { name });
      setCategories((prev) => [...prev, res.data]);
      setForm({ ...form, categoryId: String(res.data.id) });
      setNewCategory("");
    } catch (err: any) {
      markHandled(err);
      toast.error(t("locations.failedAddCategory"));
    }
  };

  if (loading) return <Loading className="py-24" />;

  return (
    <div>
      <div className="flex justify-between items-start md:items-center mb-6 gap-3">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800">
          {t("locations.title")}
        </h1>
        <button
          onClick={openCreate}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 whitespace-nowrap"
        >
          + {t("locations.addLocation")}
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-left text-xs sm:text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="p-2 sm:p-3 md:p-4 text-[10px] sm:text-xs font-semibold text-gray-600 uppercase">
                {t("common.name")}
              </th>
              <th className="p-2 sm:p-3 md:p-4 text-[10px] sm:text-xs font-semibold text-gray-600 uppercase">
                {t("common.type")}
              </th>
              <th className="p-2 sm:p-3 md:p-4 text-[10px] sm:text-xs font-semibold text-gray-600 uppercase">
                {t("locations.category")}
              </th>
              <th className="p-2 sm:p-3 md:p-4 text-right text-[10px] sm:text-xs font-semibold text-gray-600 uppercase">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {locations.map((l: any) => (
              <tr key={l.id} className="border-b hover:bg-gray-50">
                <td className="p-2 sm:p-3 md:p-4 font-medium text-gray-800">
                  {l.name}
                </td>
                <td className="p-2 sm:p-3 md:p-4">
                  <span
                    className={`px-1.5 sm:px-2 py-0.5 sm:py-1 text-[10px] sm:text-xs rounded-full ${l.type === "SHOP" ? "bg-blue-100 text-blue-800" : "bg-purple-100 text-purple-800"}`}
                  >
                    {statusLabel(l.type)}
                  </span>
                </td>
                <td className="p-2 sm:p-3 md:p-4 text-gray-600">
                  {l.category?.name || "-"}
                </td>
                <td className="p-2 sm:p-3 md:p-4">
                  <RowActionsMenu
                    items={[
                      { label: t("common.edit"), onClick: () => openEdit(l) },
                      {
                        label: t("common.delete"),
                        color: "text-red-500",
                        onClick: () => handleDelete(l.id),
                      },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
      </div>

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? t("locations.editLocation") : t("locations.addLocation")}
      >
        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("common.name")}
            </label>
            <input
              placeholder={t("locations.namePlaceholder")}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full p-2.5 border rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("common.type")}
            </label>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="w-full p-2.5 border rounded-lg outline-none bg-white text-sm"
            >
              <option value="SHOP">{t("status.shop")}</option>
              <option value="STORE">{t("status.store")}</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500 mb-1">
              {t("locations.categoryIfStore")}
            </label>
            <div className="flex gap-2">
              <select
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                className="flex-1 p-2.5 border rounded-lg outline-none bg-white text-sm"
              >
                <option value="">{t("locations.selectCategory")}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                placeholder={t("locations.newCategory")}
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="w-28 p-2.5 border rounded-lg outline-none text-sm"
              />
              <button
                type="button"
                onClick={handleAddCategory}
                className="bg-gray-200 px-3 rounded-lg text-sm font-medium whitespace-nowrap"
              >
                + {t("common.add")}
              </button>
            </div>
          </div>
          <button
            type="submit"
            className="bg-blue-600 text-white p-2.5 rounded-lg hover:bg-blue-700 font-medium text-sm mt-2"
          >
            {editing ? t("locations.updateLocation") : t("locations.addLocation")}
          </button>
        </form>
      </Modal>
    </div>
  );
}
