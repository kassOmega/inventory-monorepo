"use client";
import Modal from "./Modal";
import { QRCodeSVG } from "qrcode.react";
import { variantLabel } from "@/lib/variantLabel";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import { fmtCurrency } from "@/lib/currency";
import { useTranslation } from "react-i18next";
import { Fragment, useEffect, useState } from "react";

export default function ProductDetailModal({
  product,
  onClose,
}: {
  product: any;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  // Cost / profit data (Buy Price, Total Cost Value, margin) is RBAC-gated.
  const canViewProfit = hasPermission("sales.view-profit");
  const [detail, setDetail] = useState<any>(null);
  // Tracks which location rows are expanded (by location id) in "Stock by Location".
  const [expandedLocations, setExpandedLocations] = useState<Set<number>>(
    new Set(),
  );

  useEffect(() => {
    if (!product?.id) return;
    setDetail(null);
    setExpandedLocations(new Set());
    api
      .get("/products/" + product.id)
      .then((res) => setDetail(res.data))
      .catch(() => setDetail(null));
  }, [product?.id]);

  const d = detail ?? product;
  const specs = (d?.attributes ?? {}) as Record<string, any>;
  const specEntries = Object.entries(specs);
  const inventory = detail?.inventory ?? product?.inventory ?? [];
  const totalStock = inventory.reduce(
    (s: number, i: any) => s + (i.quantity ?? 0),
    0,
  );
  const priceHistory = detail?.priceHistory ?? [];

  // Gated cost/margin figures (only shown to roles with sales.view-profit).
  const unitCost = d?.currentBuyPrice ?? 0;
  const unitSell = d?.currentSellPrice ?? 0;
  const totalCostValue = totalStock * unitCost;
  const estProfit = totalStock * (unitSell - unitCost);

  // Group inventory rows by location so each location appears exactly once,
  // with its summed total. Expanding a location reveals the per-variant rows.
  const locationsGrouped = (() => {
    const map = new Map<number, { location: any; total: number; rows: any[] }>();
    for (const i of inventory) {
      const key = i.location?.id ?? 0;
      if (!map.has(key)) map.set(key, { location: i.location, total: 0, rows: [] });
      const entry = map.get(key)!;
      entry.total += i.quantity ?? 0;
      entry.rows.push(i);
    }
    return Array.from(map.values());
  })();

  const variantOf = (variantId: number | null) =>
    (d?.variants ?? []).find((v: any) => v.id === variantId) ?? null;

  const toggleLocation = (key: number) => {
    setExpandedLocations((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <Modal isOpen={!!product} onClose={onClose} title={t("pdm.title")}>
      {d && (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-gray-800">
                {d.brand} {d.baseName}
              </h3>
              <p className="text-sm text-gray-500">
                {d.category?.name ?? t("pdm.noCategory")}
              </p>
              <p className="font-mono text-xs text-gray-400">{d.sku}</p>
              {d.barcode && (
                <p className="font-mono text-xs text-gray-400">
                  {t("pdm.barcode")} {d.barcode}
                </p>
              )}
            </div>
            <span
              className={
                "px-2 py-1 rounded-full text-xs font-bold " +
                (d.reorderLevel > 0 && totalStock < d.reorderLevel
                  ? "bg-red-100 text-red-600"
                  : "bg-green-100 text-green-700")
              }
            >
              {t("pdm.inStock", { n: totalStock })}
            </span>
          </div>
          {d.reorderLevel > 0 && (
            <p className="text-xs text-gray-500">
              {t("pdm.lowStockAlert", { n: d.reorderLevel })}
              {d.reorderQty ? t("pdm.suggestedReorder", { n: d.reorderQty }) : ""}
            </p>
          )}

          {/* Pricing summary. Buy Price / Total Cost Value / Est. Profit are
              RBAC-gated (sales.view-profit); everyone sees the sell price. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {canViewProfit && (
              <div className="border rounded-lg p-2">
                <p className="text-[11px] text-gray-400 font-medium">{t("pdm.buyPrice")}</p>
                <p className="text-sm font-semibold text-gray-800">
                  {fmtCurrency(unitCost)}
                </p>
              </div>
            )}
            <div className="border rounded-lg p-2">
              <p className="text-[11px] text-gray-400 font-medium">{t("pdm.sellPrice")}</p>
              <p className="text-sm font-semibold text-gray-800">
                {fmtCurrency(unitSell)}
              </p>
            </div>
            {canViewProfit && (
              <>
                <div className="border rounded-lg p-2">
                  <p className="text-[11px] text-gray-400 font-medium">{t("pdm.totalCostValue")}</p>
                  <p className="text-sm font-semibold text-gray-800">
                    {fmtCurrency(totalCostValue)}
                  </p>
                </div>
                <div className="border rounded-lg p-2">
                  <p className="text-[11px] text-gray-400 font-medium">{t("pdm.estProfit")}</p>
                  <p
                    className={
                      "text-sm font-semibold " +
                      (estProfit >= 0 ? "text-green-600" : "text-red-500")
                    }
                  >
                    {fmtCurrency(estProfit)}
                  </p>
                </div>
              </>
            )}
          </div>

          <div>
            <h4 className="font-medium text-gray-700 mb-2">{t("pdm.specifications")}</h4>
            {specEntries.length === 0 ? (
              <p className="text-sm text-gray-400">{t("pdm.noSpecs")}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {specEntries.map(([k, v]) => (
                  <span
                    key={k}
                    className="bg-gray-100 px-2 py-1 rounded text-xs text-gray-700"
                  >
                    {k}: {String(v)}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <h4 className="font-medium text-gray-700 mb-2">{t("pdm.qrCode")}</h4>
            <QRCodeSVG value={d.sku || ""} size={120} />
            <p className="font-mono text-xs mt-1 text-gray-500">{d.sku}</p>
          </div>

          {d.hasVariants && (d.variants?.length ?? 0) > 0 && (
            <div>
              <h4 className="font-medium text-gray-700 mb-2">{t("pdm.variants")}</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr>
                      <th className="text-left p-1">{t("pdm.colAttributes")}</th>
                      <th className="text-left p-1">{t("pdm.colBarcode")}</th>
                      <th className="text-left p-1">{t("pdm.colSku")}</th>
                      {canViewProfit && <th className="text-right p-1">{t("pdm.colBuy")}</th>}
                      <th className="text-right p-1">{t("pdm.colSell")}</th>
                      <th className="text-right p-1">{t("pdm.colStock")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(d.variants ?? []).map((v: any) => {
                      const qty = inventory
                        .filter((i: any) => i.variantId === v.id)
                        .reduce((s: number, i: any) => s + (i.quantity ?? 0), 0);
                      return (
                        <tr key={v.id} className="border-t">
                          <td className="p-1">{variantLabel(v) || "—"}</td>
                          <td className="p-1 font-mono text-xs">
                            {v.barcode || "—"}
                          </td>
                          <td className="p-1 font-mono text-xs">{v.sku}</td>
                          {canViewProfit && (
                            <td className="p-1 text-right">
                              {v.buyPrice != null ? v.buyPrice : "—"}
                            </td>
                          )}
                          <td className="p-1 text-right">
                            {v.sellPrice != null ? v.sellPrice : "—"}
                          </td>
                          <td className="p-1 text-right font-semibold">
                            {qty}
                            {v.reorderLevel > 0 && (
                              <span className="block text-[10px] font-normal text-gray-400">
                                {t("pdm.lowStockAlert", { n: v.reorderLevel })}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}


          {(d.batches?.length ?? 0) > 0 && (
            <div>
              <h4 className="font-medium text-gray-700 mb-2">{t("pdm.batches")}</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr>
                      <th className="text-left p-1">{t("pdm.colBatch")}</th>
                      <th className="text-left p-1">{t("pdm.colExpiry")}</th>
                      <th className="text-right p-1">{t("pdm.colQty")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(d.batches ?? []).map((b: any) => (
                      <tr key={b.id} className="border-t">
                        <td className="p-1 font-mono text-xs">{b.batchNumber}</td>
                        <td className="p-1">
                          {b.expiryDate
                            ? new Date(b.expiryDate).toLocaleDateString()
                            : "—"}
                        </td>
                        <td className="p-1 text-right font-semibold">
                          {b.quantity}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div>
            <h4 className="font-medium text-gray-700 mb-2">{t("pdm.stockByLocation")}</h4>
            {locationsGrouped.length === 0 ? (
              <p className="text-sm text-gray-400">{t("pdm.noInventory")}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left p-1">{t("pdm.colLocation")}</th>
                    <th className="text-right p-1">{t("pdm.colQty")}</th>
                  </tr>
                </thead>
                <tbody>
                  {locationsGrouped.map((entry) => {
                    const key = entry.location?.id ?? 0;
                    const expanded = expandedLocations.has(key);
                    const showVariants =
                      entry.rows.length > 1 ||
                      (entry.rows.length === 1 && entry.rows[0].variantId != null);
                    return (
                      <Fragment key={key}>
                        <tr
                          className={
                            "border-t " +
                            (showVariants
                              ? "cursor-pointer hover:bg-gray-50"
                              : "")
                          }
                          onClick={() => showVariants && toggleLocation(key)}
                        >
                          <td className="p-1">
                            {showVariants && (
                              <span className="mr-1 text-gray-400">
                                {expanded ? "▾" : "▸"}
                              </span>
                            )}
                            {entry.location?.name ?? "—"}
                          </td>
                          <td className="p-1 text-right font-semibold">
                            {entry.total}
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="bg-gray-50">
                            <td colSpan={2} className="p-2 pl-6">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-gray-400">
                                    <th className="text-left p-1 font-medium">
                                      {t("pdm.variants")}
                                    </th>
                                    <th className="text-right p-1 font-medium">
                                      {t("pdm.colQty")}
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {entry.rows.map((i: any, idx: number) => {
                                    const v = variantOf(i.variantId);
                                    return (
                                      <tr key={idx} className="border-t border-gray-200">
                                        <td className="p-1">
                                          {variantLabel(v) || t("pdm.standard")}
                                        </td>
                                        <td className="p-1 text-right">
                                          {i.quantity ?? 0}
                                        </td>
                                      </tr>
                                    );
                                  })}
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
            )}
          </div>


          {priceHistory.length > 0 && (
            <div>
              <h4 className="font-medium text-gray-700 mb-2">{t("pdm.priceHistory")}</h4>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left p-1">{t("pdm.colDate")}</th>
                    <th className="text-right p-1">{t("pdm.colOldBuy")}</th>
                    <th className="text-right p-1">{t("pdm.colNewBuy")}</th>
                    <th className="text-right p-1">{t("pdm.colOldSell")}</th>
                    <th className="text-right p-1">{t("pdm.colNewSell")}</th>
                  </tr>
                </thead>
                <tbody>
                  {priceHistory.map((h: any) => (
                    <tr key={h.id} className="border-t">
                      <td className="p-1 text-xs">
                        {new Date(h.updatedAt).toLocaleDateString()}
                      </td>
                      <td className="p-1 text-right">{h.oldBuyPrice}</td>
                      <td className="p-1 text-right">{h.newBuyPrice}</td>
                      <td className="p-1 text-right">{h.oldSellPrice}</td>
                      <td className="p-1 text-right">{h.newSellPrice}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

