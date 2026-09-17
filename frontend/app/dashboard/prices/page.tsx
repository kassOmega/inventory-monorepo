"use client";
import api from "@/lib/api";
import { fmtCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/datetime";
import Loading from "@/app/components/Loading";
import { useConfirm } from "@/app/components/ConfirmProvider";
import RowActionsMenu from "@/app/components/RowActionsMenu";
import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import useServerPaging from "@/lib/useServerPaging";
import Pagination from "@/app/components/Pagination";
import { ChevronDown, ChevronRight } from "lucide-react";
import { variantLabel } from "@/lib/variantLabel";

const SOURCES = ["RESTOCK", "PURCHASE", "REQUEST", "PRODUCT_EDIT", "COUNT"] as const;

export default function PriceHistoryPage() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [history, setHistory] = useState([]);
  const paged = useServerPaging({ pageSize: 20 });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ newBuyPrice: 0, newSellPrice: 0 });
  const [source, setSource] = useState("");
  /** Expanded actions: their per-variant detail already travels with the row. */
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const res = await api.get("/price-history", {
        params: {
          page: paged.page,
          pageSize: paged.pageSize,
          // One request also brings each action's per-variant rows.
          withDetails: 1,
          ...(source ? { source } : {}),
        },
      });
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
  }, [paged.page, paged.pageSize, source]);

  const sourceLabel = (value?: string | null) => {
    switch (value) {
      case "RESTOCK":
        return t("prices.sourceRestock");
      case "PURCHASE":
        return t("prices.sourcePurchase");
      case "REQUEST":
        return t("prices.sourceRequest");
      case "PRODUCT_EDIT":
        return t("prices.sourceProductEdit");
      case "COUNT":
        return t("prices.sourceCount");
      default:
        return "—";
    }
  };

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

      <div className="flex items-center gap-2 mb-4">
        <label className="text-xs text-gray-500">{t("prices.source")}</label>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="border p-2 rounded-lg bg-white text-xs"
        >
          <option value="">{t("prices.sourceAll")}</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {sourceLabel(s)}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
        <table className="w-full text-left min-w-[760px] text-xs sm:text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="p-2 sm:p-3 md:p-4 w-8" />
              <th className="p-2 sm:p-3 md:p-4">{t("common.date")}</th>
              <th className="p-2 sm:p-3 md:p-4">{t("common.product")}</th>
              <th className="p-2 sm:p-3 md:p-4">{t("prices.source")}</th>
              <th className="p-2 sm:p-3 md:p-4">{t("prices.oldBuy")}</th>
              <th className="p-2 sm:p-3 md:p-4">{t("prices.newBuy")}</th>
              <th className="p-2 sm:p-3 md:p-4">{t("prices.oldSell")}</th>
              <th className="p-2 sm:p-3 md:p-4">{t("prices.newSell")}</th>
              <th className="p-2 sm:p-3 md:p-4">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h: any) => {
              const variants: any[] = h.variants ?? [];
              const isOpen = !!expanded[h.id];
              return (
                <Fragment key={h.id}>
                  <tr className="border-b">
                    <td className="p-2 sm:p-3 w-8">
                      {variants.length > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded((prev) => ({ ...prev, [h.id]: !prev[h.id] }))
                          }
                          title={t("prices.variantDetail")}
                          className="text-gray-500 hover:text-gray-800"
                        >
                          {isOpen ? (
                            <ChevronDown size={16} />
                          ) : (
                            <ChevronRight size={16} />
                          )}
                        </button>
                      )}
                    </td>
                    <td className="p-2 sm:p-3 md:p-4 text-xs sm:text-sm text-gray-500">
                      {formatDate(h.updatedAt)}
                    </td>
                    <td className="p-2 sm:p-3 md:p-4 font-medium">
                      {h.product?.brand} {h.product?.baseName}
                      {/* The main row is the product's own number — for a variant
                          product that is the average across its variants. */}
                      {h.product?.hasVariants && (
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                          {t("prices.averageBadge")}
                        </span>
                      )}
                      {variants.length > 0 && (
                        <span className="block text-[10px] text-gray-400">
                          {t("prices.variantsCount", { count: variants.length })}
                        </span>
                      )}
                    </td>
                    <td className="p-2 sm:p-3 md:p-4 text-xs text-gray-500">
                      {sourceLabel(h.source)}
                    </td>
                    <td className="p-2 sm:p-3 md:p-4 text-red-500">
                      {fmtCurrency(h.oldBuyPrice)}
                    </td>
                    <td className="p-2 sm:p-3 md:p-4 text-green-600 font-semibold">
                      {fmtCurrency(h.newBuyPrice)}
                    </td>
                    <td className="p-2 sm:p-3 md:p-4 text-red-500">
                      {fmtCurrency(h.oldSellPrice)}
                    </td>
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
                  {isOpen && (
                    <tr className="border-b bg-gray-50">
                      <td colSpan={9} className="p-3">
                        <table className="w-full text-left text-xs">
                          <thead className="text-gray-500">
                            <tr>
                              <th className="p-1.5">{t("prices.variantDetail")}</th>
                              <th className="p-1.5">{t("prices.oldBuy")}</th>
                              <th className="p-1.5">{t("prices.newBuy")}</th>
                              <th className="p-1.5">{t("prices.oldSell")}</th>
                              <th className="p-1.5">{t("prices.newSell")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {variants.map((v: any) => (
                              <tr key={`${h.id}-${v.variantId}`}>
                                <td className="p-1.5">
                                  <span className="font-medium">
                                    {variantLabel(v) || v.sku || `#${v.variantId}`}
                                  </span>
                                  {v.sku && (
                                    <span className="block text-[10px] text-gray-400 font-mono">
                                      {v.sku}
                                    </span>
                                  )}
                                </td>
                                <td className="p-1.5 text-red-500">
                                  {fmtCurrency(v.oldBuyPrice)}
                                </td>
                                <td className="p-1.5 text-green-600 font-semibold">
                                  {fmtCurrency(v.newBuyPrice)}
                                </td>
                                <td className="p-1.5 text-red-500">
                                  {fmtCurrency(v.oldSellPrice)}
                                </td>
                                <td className="p-1.5 text-green-600 font-semibold">
                                  {fmtCurrency(v.newSellPrice)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
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
    </div>
  );
}
