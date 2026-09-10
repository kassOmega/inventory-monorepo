"use client";
// Hospitality inventory report: live stock with units + value, low-stock
// alerts, and a wastage/spoilage log with an inline "Record Wastage" action.
import api from "@/lib/api";
import Loading from "./Loading";
import i18n from "@/lib/i18n";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";

interface StockItem {
  productId: number;
  name: string;
  category: string;
  unit: string | null;
  quantity: number;
  currentBuyPrice: number;
  stockValue: number;
  reorderLevel: number;
  kind: string;
  location: string | null;
  locationId: number;
  status: "OK" | "LOW" | "OUT";
}

interface WastageLogRow {
  id: number;
  productId: number;
  productName: string;
  unit: string | null;
  quantity: number;
  unitCost: number;
  totalValue: number;
  reason: string | null;
  location: string | null;
  createdAt: string;
}

interface Overview {
  items: StockItem[];
  totals: {
    stockValue: number;
    lowStockCount: number;
    outOfStockCount: number;
    itemCount: number;
  };
  wastage: {
    totalValue: number;
    totalCount: number;
    byProduct: {
      productId: number;
      name: string;
      quantity: number;
      value: number;
      count: number;
    }[];
    log: WastageLogRow[];
  };
}

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 2 });

const STATUS_BADGE: Record<string, string> = {
  OK: "bg-emerald-100 text-emerald-700",
  LOW: "bg-amber-100 text-amber-700",
  OUT: "bg-red-100 text-red-700",
};

export default function HospitalityInventoryReport({
  startDate,
  endDate,
  locationId,
}: {
  startDate: string;
  endDate: string;
  locationId?: string;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const tStatus = (s: string) =>
    s === "OK"
      ? t("hinv.statusOk")
      : s === "LOW"
        ? t("hinv.statusLow")
        : t("hinv.statusOut");

  // Record Wastage modal
  const [wOpen, setWOpen] = useState(false);
  const [wSaving, setWSaving] = useState(false);
  const [wForm, setWForm] = useState({
    productId: "",
    quantity: "",
    reason: "",
    locationId: "",
  });

  const load = () => {
    setLoading(true);
    const q = new URLSearchParams({ startDate, endDate });
    if (locationId) q.set("locationId", locationId);
    api
      .get(`/reports/inventory-overview?${q.toString()}`)
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  useEffect(load, [startDate, endDate, locationId]);

  const openWastage = () => {
    setWForm({ productId: "", quantity: "", reason: "", locationId: "" });
    setWOpen(true);
  };

  const saveWastage = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!wForm.productId) return setError(t("hinv.pleaseSelectProduct"));
    const quantity = Number(wForm.quantity);
    if (!(quantity > 0)) return setError(t("hinv.validQuantity"));
    setWSaving(true);
    try {
      await api.post("/inventory/wastage", {
        productId: Number(wForm.productId),
        quantity,
        reason: wForm.reason || undefined,
        locationId: wForm.locationId ? Number(wForm.locationId) : undefined,
      });
      setWOpen(false);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("hinv.failedSave"));
    } finally {
      setWSaving(false);
    }
  };

  if (loading && !data) return <Loading className="py-16" />;
  if (!data) {
    return (
      <div className="bg-white rounded-xl border shadow-sm p-6 text-center text-sm text-gray-400">
        {t("fin.bdNoFinance")}
      </div>
    );
  }

  const locations = [
    ...new Map(
      data.items
        .filter((i) => i.locationId != null)
        .map((i) => [i.locationId, i.location ?? `Location #${i.locationId}`] as const),
    ).entries(),
  ].map(([id, name]) => ({ id, name }));

  return (
    <div className="space-y-5">
      {/* Totals */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border shadow-sm p-3 sm:p-4">
          <p className="text-[10px] sm:text-[11px] font-medium text-gray-500 uppercase">{t("hinv.stockValue")}</p>
          <p className="text-base sm:text-lg font-bold text-gray-800 mt-1">{fmt(data.totals.stockValue)} {t("orders.birr")}</p>
        </div>
        <div className="bg-white rounded-xl border shadow-sm p-3 sm:p-4">
          <p className="text-[10px] sm:text-[11px] font-medium text-gray-500 uppercase">{t("hinv.items")}</p>
          <p className="text-base sm:text-lg font-bold text-gray-800 mt-1">{data.totals.itemCount}</p>
        </div>
        <div className="bg-white rounded-xl border shadow-sm p-3 sm:p-4">
          <p className="text-[10px] sm:text-[11px] font-medium text-gray-500 uppercase">{t("hinv.lowStock")}</p>
          <p className="text-base sm:text-lg font-bold text-amber-600 mt-1">{data.totals.lowStockCount}</p>
        </div>
        <div className="bg-white rounded-xl border shadow-sm p-3 sm:p-4">
          <p className="text-[10px] sm:text-[11px] font-medium text-gray-500 uppercase">{t("hinv.outOfStock")}</p>
          <p className="text-base sm:text-lg font-bold text-red-600 mt-1">{data.totals.outOfStockCount}</p>
        </div>
      </div>

      {/* Stock table */}
      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b border-gray-100">
          <h3 className="text-sm sm:text-base font-semibold text-gray-800">{t("hinv.liveStock")}</h3>
          <button
            onClick={openWastage}
            className="text-xs font-semibold text-white bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded-lg"
          >
            {t("hinv.recordWastage")}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-gray-50 text-[10px] sm:text-xs uppercase text-gray-400">
              <tr>
                <th className="p-2 sm:p-3">{t("hinv.colItem")}</th>
                <th className="p-2 sm:p-3">{t("fin.colCategory")}</th>
                <th className="p-2 sm:p-3 text-right">{t("hinv.colQty")}</th>
                <th className="p-2 sm:p-3 text-right">{t("hinv.colUnit")}</th>
                <th className="p-2 sm:p-3 text-right">{t("hinv.colBuyPrice")}</th>
                <th className="p-2 sm:p-3 text-right">{t("hinv.colStockValue")}</th>
                <th className="p-2 sm:p-3 text-right">{t("hinv.colStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((it) => (
                <tr key={`${it.productId}-${it.location ?? ""}`} className="border-b hover:bg-gray-50">
                  <td className="p-2 sm:p-3 font-medium text-gray-800">{it.name}</td>
                  <td className="p-2 sm:p-3 text-gray-500">{it.category}</td>
                  <td className="p-2 sm:p-3 text-right">{fmt(it.quantity)}</td>
                  <td className="p-2 sm:p-3 text-right text-gray-500">{it.unit ?? "—"}</td>
                  <td className="p-2 sm:p-3 text-right">{fmt(it.currentBuyPrice)}</td>
                  <td className="p-2 sm:p-3 text-right font-semibold">{fmt(it.stockValue)}</td>
                  <td className="p-2 sm:p-3 text-right">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${STATUS_BADGE[it.status]}`}>
                      {tStatus(it.status)}
                    </span>
                  </td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-gray-400">
                    {t("hinv.noStock")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Wastage summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border shadow-sm p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-gray-800 mb-3">
            {t("hinv.wastageSummary")}
          </h3>
          <p className="text-xs text-gray-400 mb-3">
            {t("hinv.summaryEvents", { value: fmt(data.wastage.totalValue), count: data.wastage.totalCount })}
          </p>
          {data.wastage.byProduct.length === 0 ? (
            <p className="text-sm text-gray-400">{t("hinv.noWastage")}</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {data.wastage.byProduct.slice(0, 8).map((p) => (
                <li key={p.productId} className="py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-700 truncate">{p.name}</p>
                    <p className="text-[10px] text-gray-400">
                      {t("hinv.eventsOf", { qty: fmt(p.quantity), count: p.count })}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-red-600 shrink-0">{fmt(p.value)} {t("orders.birr")}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white rounded-xl border shadow-sm p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-gray-800 mb-3">{t("hinv.recentWastage")}</h3>
          {data.wastage.log.length === 0 ? (
            <p className="text-sm text-gray-400">{t("hinv.noWastageEvents")}</p>
          ) : (
            <ul className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
              {data.wastage.log.slice(0, 15).map((w) => (
                <li key={w.id} className="py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-gray-700 truncate">
                      {w.productName}
                      <span className="text-gray-400">
                        {" "}× {fmt(w.quantity)}{w.unit ? ` ${w.unit}` : ""}
                      </span>
                    </p>
                    <span className="text-xs font-semibold text-red-600 shrink-0">{fmt(w.totalValue)} {t("orders.birr")}</span>
                  </div>
                  <p className="text-[10px] text-gray-400">
                    {new Date(w.createdAt).toLocaleString()}
                    {w.reason ? ` · ${w.reason}` : ""}
                    {w.location ? ` · ${w.location}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Record Wastage modal */}
      {wOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-800 mb-3">{t("hinv.recordWastageTitle")}</h2>
            <form onSubmit={saveWastage} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t("hinv.product")}</label>
                <select
                  value={wForm.productId}
                  onChange={(e) => setWForm({ ...wForm, productId: e.target.value })}
                  className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
                  required
                >
                  <option value="">{t("hinv.select")}</option>
                  {data.items.map((i) => (
                    <option key={`${i.productId}-${i.location ?? ""}`} value={i.productId}>
                      {i.name} ({t("hinv.inStockOf", { qty: fmt(i.quantity), unit: i.unit ?? "unit" })})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t("hinv.quantity")}</label>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={wForm.quantity}
                    onChange={(e) => setWForm({ ...wForm, quantity: e.target.value })}
                    className="border border-gray-300 rounded p-2 text-sm w-full"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t("hinv.location")}</label>
                  <select
                    value={wForm.locationId}
                    onChange={(e) => setWForm({ ...wForm, locationId: e.target.value })}
                    className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
                  >
                    <option value="">{t("hinv.autoLocation")}</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t("hinv.reason")}</label>
                <input
                  value={wForm.reason}
                  onChange={(e) => setWForm({ ...wForm, reason: e.target.value })}
                  placeholder={t("hinv.reasonPh")}
                  className="border border-gray-300 rounded p-2 text-sm w-full"
                />
              </div>
              {error && (
                <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1.5">{error}</p>
              )}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setWOpen(false)} className="px-3 py-2 text-sm text-gray-600">
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={wSaving}
                  className="bg-red-600 text-white rounded px-3 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {wSaving ? t("hinv.recording") : t("hinv.writeOff")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

