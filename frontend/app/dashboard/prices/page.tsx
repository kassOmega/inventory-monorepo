"use client";
import api from "@/lib/api";
import { fmtCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/datetime";
import Loading from "@/app/components/Loading";
import { useConfirm } from "@/app/components/ConfirmProvider";
import RowActionsMenu from "@/app/components/RowActionsMenu";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import useServerPaging from "@/lib/useServerPaging";
import Pagination from "@/app/components/Pagination";

export default function PriceHistoryPage() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [history, setHistory] = useState([]);
  const paged = useServerPaging({ pageSize: 20 });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ newBuyPrice: 0, newSellPrice: 0 });

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const res = await api.get(
        `/price-history?page=${paged.page}&pageSize=${paged.pageSize}`,
      );
      const body = res.data;
      const rows = Array.isArray(body) ? body : (body?.data ?? []);
      setHistory(rows);
      paged.setTotal(Array.isArray(body) ? rows.length : (body?.total ?? rows.length));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paged.page, paged.pageSize]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editing) {
      await api.put(`/price-history/${editing.id}`, form);
    }
    setShowForm(false);
    setEditing(null);
    fetchHistory();
  };

  const startEdit = (h: any) => {
    setEditing(h);
    setShowForm(true);
    setForm({ newBuyPrice: h.newBuyPrice, newSellPrice: h.newSellPrice });
  };

  const handleDelete = async (id: number) => {
    const ok = await confirm(t("prices.deleteConfirm"));
    if (!ok) return;
    await api.delete(`/price-history/${id}`);
    fetchHistory();
  };

  if (loading) return <Loading className="py-24" />;

  return (
    <div>
      <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-800 mb-6">
        {t("prices.title")}
      </h1>

      {showForm && editing && (
        <form
          onSubmit={handleSave}
          className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border mb-6 grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 items-end"
        >
          <div className="sm:col-span-1">
            <label className="block text-xs sm:text-sm font-medium text-gray-500 mb-1">
              {t("prices.newBuyPrice")}
            </label>
            <input
              type="number"
              value={form.newBuyPrice}
              onChange={(e) =>
                setForm({ ...form, newBuyPrice: Number(e.target.value) })
              }
              className="border p-2 rounded-lg w-full text-sm"
              required
            />
          </div>
          <div className="sm:col-span-1">
            <label className="block text-xs sm:text-sm font-medium text-gray-500 mb-1">
              {t("prices.newSellPrice")}
            </label>
            <input
              type="number"
              value={form.newSellPrice}
              onChange={(e) =>
                setForm({ ...form, newSellPrice: Number(e.target.value) })
              }
              className="border p-2 rounded-lg w-full text-sm"
              required
            />
          </div>
          <button
            type="submit"
            className="bg-green-600 text-white p-2 rounded-lg text-sm"
          >
            {t("prices.updateRecord")}
          </button>
        </form>
      )}

      <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
        <table className="w-full text-left min-w-[550px] sm:min-w-[600px] text-xs sm:text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="p-2 sm:p-3 md:p-4">{t("common.date")}</th>
              <th className="p-2 sm:p-3 md:p-4">{t("common.product")}</th>
              <th className="p-2 sm:p-3 md:p-4">{t("prices.oldBuy")}</th>
              <th className="p-2 sm:p-3 md:p-4">{t("prices.newBuy")}</th>
              <th className="p-2 sm:p-3 md:p-4">{t("prices.oldSell")}</th>
              <th className="p-2 sm:p-3 md:p-4">{t("prices.newSell")}</th>
              <th className="p-2 sm:p-3 md:p-4">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h: any) => (
              <tr key={h.id} className="border-b">
                <td className="p-2 sm:p-3 md:p-4 text-xs sm:text-sm text-gray-500">
                  {formatDate(h.updatedAt)}
                </td>
                <td className="p-2 sm:p-3 md:p-4 font-medium">
                  {h.product.brand} {h.product.baseName}
                </td>
                <td className="p-2 sm:p-3 md:p-4 text-red-500">{fmtCurrency(h.oldBuyPrice)}</td>
                <td className="p-2 sm:p-3 md:p-4 text-green-600 font-semibold">
                  {fmtCurrency(h.newBuyPrice)}
                </td>
                <td className="p-2 sm:p-3 md:p-4 text-red-500">{fmtCurrency(h.oldSellPrice)}</td>
                <td className="p-2 sm:p-3 md:p-4 text-green-600 font-semibold">
                  {fmtCurrency(h.newSellPrice)}
                </td>
                <td className="p-2 sm:p-3 md:p-4">
                  <RowActionsMenu
                    items={[
                      { label: t("common.edit"), onClick: () => startEdit(h) },
                      {
                        label: t("common.delete"),
                        color: "text-red-500",
                        onClick: () => handleDelete(h.id),
                      },
                    ]}
                  />
                </td>
              </tr>
            ))}
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
    </div>
  );
}
