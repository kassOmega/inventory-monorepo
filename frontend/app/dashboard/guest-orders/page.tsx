"use client";

// Privileged Guest Orders inbox. Reviews incoming public orders, routes them to
// branches (which reply accept/decline), and registers accepted product orders
// as internal Sales (branch or central, central picking the branch).
import api from "@/lib/api";
import Button from "@/app/components/Button";
import Loading from "@/app/components/Loading";
import Modal from "@/app/components/Modal";
import SearchableSelect from "@/app/components/SearchableSelect";
import { useToast } from "@/app/components/ToastProvider";
import { useAuth } from "@/context/AuthContext";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { fmtCurrency } from "@/lib/currency";
import { canShareFiles, shareFile } from "@/lib/shareFile";
import { buildPriceListPdf, priceListFileName } from "@/lib/priceListPdf";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const STATUS_CLASS: Record<string, string> = {
  SUBMITTED: "bg-amber-100 text-amber-700",
  REVIEWED: "bg-blue-100 text-blue-700",
  ROUTED: "bg-indigo-100 text-indigo-700",
  ACCEPTED: "bg-emerald-100 text-emerald-700",
  COMPLETED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
  DROPPED: "bg-gray-200 text-gray-500",
};

const SALE_TYPES = ["FULLY_PAID", "PARTIALLY_PAID", "CREDITED"] as const;

const SALE_TYPE_STATUS_KEY: Record<string, string> = {
  FULLY_PAID: "status.fullyPaid",
  PARTIALLY_PAID: "status.partiallyPaid",
  CREDITED: "status.credited",
};

export default function GuestOrdersPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { user, activeMembership, hasPermission } = useAuth();
  const canManage = hasPermission("guest-orders.manage");
  const isCentral = !user?.locationId;

  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [locations, setLocations] = useState<any[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState("SUBMITTED");
  const [sort, setSort] = useState<"oldest" | "newest">("oldest");
  const [detail, setDetail] = useState<any | null>(null);
  const [routePick, setRoutePick] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  // Edit car-wash guest order lines.
  const [editOpen, setEditOpen] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editOptions, setEditOptions] = useState<{
    washers: any[];
    washTypes: any[];
    vehicleTypes: string[];
  }>({ washers: [], washTypes: [], vehicleTypes: [] });
  const [editRows, setEditRows] = useState<any[]>([]);
  // "Add as sale" form state (per detail).
  const [saleBranch, setSaleBranch] = useState("");
  const [saleMethod, setSaleMethod] = useState("");
  const [saleType, setSaleType] = useState<string>("FULLY_PAID");
  const [paidAmount, setPaidAmount] = useState("");
  // "Share prices" (ordered items) state.
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareHeader, setShareHeader] = useState(true);
  const [shareAddress, setShareAddress] = useState("");
  const [sharePhone, setSharePhone] = useState("");

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set("status", statusFilter);
      qs.set("sort", sort);
      const [o, l, p] = await Promise.all([
        api.get(`/guest-orders?${qs.toString()}`),
        api.get("/locations").catch(() => ({ data: [] })),
        api.get("/payment-methods").catch(() => ({ data: [] })),
      ]);
      setOrders(Array.isArray(o.data) ? o.data : []);
      setLocations(Array.isArray(l.data) ? l.data : []);
      setPaymentMethods(Array.isArray(p.data) ? p.data : []);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, sort, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll so new guest orders and branch replies appear without a manual refresh.
  // Live updates: subscribe to the notification SSE stream (fires on every new
  // guest order / activity) and refetch; poll as a fallback.
  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000";
    let es: EventSource | null = null;
    try {
      es = new EventSource(`${base}/notifications/stream`);
      es.onmessage = () => load();
      es.onerror = () => {
        es?.close();
        es = null;
      };
    } catch {
      // EventSource unavailable — polling below still covers it.
    }
    const id = setInterval(load, 20000);
    return () => {
      clearInterval(id);
      es?.close();
    };
  }, [load]);

  const openDetail = async (o: any) => {
    setRoutePick([]);
    setSaleBranch("");
    setSaleMethod("");
    setSaleType("FULLY_PAID");
    setPaidAmount("");
    try {
      const r = await api.get(`/guest-orders/${o.id}`);
      setDetail(r.data);
    } catch {
      setDetail(o);
    }
  };

  const toLocalInput = (value: any) => {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // Deletion is only allowed before the order links to a sale/booking.
  const linked = (o: any) =>
    o?.saleId != null ||
    o?.bookingId != null ||
    o?.orderId != null ||
    o?.reservationId != null;

  const openEdit = async () => {
    if (!detail) return;
    try {
      const r = await api.get("/guest-orders/edit-options");
      setEditOptions(
        r.data ?? { washers: [], washTypes: [], vehicleTypes: [] },
      );
    } catch {
      setEditOptions({ washers: [], washTypes: [], vehicleTypes: [] });
    }
    const rows = (detail.items ?? [])
      .filter((it: any) => it.itemKind === "CARWASH_ITEM")
      .map((it: any) => {
        let meta: any = {};
        try {
          meta = JSON.parse(it.notes || "{}");
        } catch {
          meta = {};
        }
        return {
          id: it.id,
          vehicleType: meta.vehicleType ?? "",
          washTypeId: meta.washTypeId != null ? String(meta.washTypeId) : "",
          washerId: meta.washerId != null ? String(meta.washerId) : "",
          startsAt: meta.startsAt ? toLocalInput(meta.startsAt) : "",
          plateNumber: meta.plateNumber ?? "",
        };
      });
    setEditRows(rows);
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!detail) return;
    setEditBusy(true);
    try {
      await api.patch(`/guest-orders/${detail.id}`, {
        items: editRows.map((r) => ({
          id: r.id,
          vehicleType: r.vehicleType || undefined,
          washTypeId: r.washTypeId ? Number(r.washTypeId) : null,
          washerId: r.washerId ? Number(r.washerId) : null,
          startsAt: r.startsAt || undefined,
        })),
      });
      const refreshed = await api.get(`/guest-orders/${detail.id}`).catch(() => null);
      if (refreshed) setDetail(refreshed.data);
      setEditOpen(false);
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? "Failed to update");
    } finally {
      setEditBusy(false);
    }
  };

  const removeOrder = async () => {
    if (!detail) return;
    if (!confirm(t("guestOrders.deleteConfirm"))) return;
    setBusy(true);
    try {
      await api.delete(`/guest-orders/${detail.id}`);
      setDetail(null);
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? "Failed to delete");
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await load();
      if (detail) {
        const r = await api.get(`/guest-orders/${detail.id}`).catch(() => null);
        if (r) setDetail(r.data);
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? "Action failed");
    } finally {
      setBusy(false);
    }
  };

  /** Ordered items as price-list rows (unit price, like the products list). */
  const shareRowsFor = (d: any) =>
    (d?.items ?? []).map((it: any) => ({
      item: it.nameSnapshot,
      price: fmtCurrency(it.unitPrice, 2, "en"),
    }));

  /** Open the price-share modal, loading the business-info visibility config. */
  const openShare = async () => {
    setShareBusy(true);
    try {
      const orgId = activeMembership?.organizationId;
      if (orgId) {
        const [org, fiscal] = await Promise.all([
          api.get(`/tenants/${orgId}`).catch(() => ({ data: { settings: {} } })),
          api.get("/fiscal/config").catch(() => ({ data: {} })),
        ]);
        const settings = org.data?.settings ?? {};
        setShareHeader(settings.showPriceListBusinessInfo !== false);
        setShareAddress(String(fiscal.data?.address ?? "").trim());
        setSharePhone(String(fiscal.data?.phone ?? "").trim());
      }
    } catch {
      // best effort — keep the default header-on behavior
    } finally {
      setShareBusy(false);
    }
    setShareOpen(true);
  };

  /** Build + download/share the ordered-items price list. */
  const doSharePrices = async (action: "download" | "share") => {
    const rows = shareRowsFor(detail);
    if (rows.length === 0) return;
    setShareBusy(true);
    try {
      const headerLines = shareHeader
        ? [
            activeMembership?.organizationName ?? "",
            shareAddress,
            sharePhone
              ? `${t("products.priceList.phoneLabel")}: ${sharePhone}`
              : "",
          ]
        : [];
      const opts = {
        rows,
        title: t("products.priceList.docTitle"),
        generatedOnLabel: t("products.priceList.generatedOn", {
          date: formatDate(new Date().toISOString(), "en"),
        }),
        labels: {
          item: t("products.priceList.item"),
          price: t("products.priceList.price"),
          footer: t("products.priceList.footer"),
        },
        headerLines,
      };
      if (action === "share") {
        const doc = await buildPriceListPdf(opts);
        const file = new File([doc.output("blob")], priceListFileName(), {
          type: "application/pdf",
        });
        const outcome = await shareFile(file, t("products.priceList.docTitle"));
        if (outcome === "shared") toast.success(t("products.priceList.shared"));
      } else {
        await buildPriceListPdf({ ...opts, fileName: priceListFileName() });
        toast.success(t("products.priceList.downloaded"));
      }
      setShareOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Share failed");
    } finally {
      setShareBusy(false);
    }
  };

  if (loading) return <Loading className="py-24" />;

  const hasProducts = (o: any) =>
    (o?.items ?? []).some((it: any) => it.itemKind === "PRODUCT");
  const detailIsCarWash = (detail?.items ?? []).some(
    (it: any) => it.itemKind === "CARWASH_ITEM",
  );
  const myBranch = locations.find((l) => l.id === user?.locationId);
  const openStatuses = ["SUBMITTED", "REVIEWED", "ROUTED"];
  const saleValid =
    (isCentral ? !!saleBranch : true) &&
    (saleType === "CREDITED" || !!saleMethod) &&
    (saleType !== "PARTIALLY_PAID" || Number(paidAmount) > 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">{t("guestOrders.title")}</h1>

      <div className="flex flex-wrap items-center gap-2">
        {["", "SUBMITTED", "REVIEWED", "ROUTED", "ACCEPTED", "COMPLETED", "REJECTED"].map(
          (s) => (
            <button
              key={s || "ALL"}
              onClick={() => setStatusFilter(s)}
              className={
                "px-3 py-1.5 rounded-lg text-xs font-medium border " +
                (statusFilter === s
                  ? "bg-blue-50 text-blue-700 border-blue-200"
                  : "bg-white text-gray-600 border-gray-200")
              }
            >
              {s ? t(`guestOrders.status.${s}`) : t("guestOrders.statusAll")}
            </button>
          ),
        )}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as "oldest" | "newest")}
          className="ml-auto border border-gray-300 rounded-lg p-2 text-xs bg-white"
          aria-label={t("guestOrders.sort")}
        >
          <option value="oldest">{t("guestOrders.sortOldest")}</option>
          <option value="newest">{t("guestOrders.sortNewest")}</option>
        </select>
      </div>

      {canManage && selected.size > 0 && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm">
          <span className="text-blue-700">
            {t("guestOrders.selected", { count: selected.size })}
          </span>
          <Button
            size="sm"
            loading={busy}
            onClick={() =>
              act(() =>
                api.post("/guest-orders/bulk/review", { ids: [...selected] }),
              ).then(() => setSelected(new Set()))
            }
          >
            {t("guestOrders.approveSelected")}
          </Button>
          <Button
            size="sm"
            variant="danger"
            loading={busy}
            onClick={() =>
              act(() =>
                api.post("/guest-orders/bulk/reject", { ids: [...selected] }),
              ).then(() => setSelected(new Set()))
            }
          >
            {t("guestOrders.rejectSelected")}
          </Button>
        </div>
      )}

      {statusFilter === "SUBMITTED" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {orders.map((o) => (
            <div
              key={o.id}
              onClick={() => openDetail(o)}
              className="bg-white rounded-xl border border-gray-200 p-3 space-y-2 cursor-pointer hover:border-blue-300 hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-gray-800">
                    {o.entry?.label}
                  </p>
                  <p className="text-[11px] text-gray-400">
                    {o.entry?.kind}
                    {o.entry?.table?.name ? ` · ${o.entry.table.name}` : ""}
                  </p>
                </div>
                {canManage && (
                  <input
                    type="checkbox"
                    checked={selected.has(o.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        next.has(o.id) ? next.delete(o.id) : next.add(o.id);
                        return next;
                      })
                    }
                  />
                )}
              </div>

              <p className="text-sm text-gray-600">
                {o.customerName ?? "—"}
                {o.customerPhone ? (
                  <span className="block text-[11px] text-gray-400">
                    {o.customerPhone}
                  </span>
                ) : null}
              </p>

              <ul className="text-xs text-gray-500 space-y-0.5">
                {(o.items ?? []).slice(0, 3).map((it: any) => (
                  <li key={it.id}>
                    · {it.quantity}× {it.nameSnapshot}
                  </li>
                ))}
                {(o.items ?? []).length > 3 && (
                  <li className="text-gray-400">
                    +{(o.items ?? []).length - 3} {t("guestOrders.more")}
                  </li>
                )}
              </ul>

              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">
                  {fmtCurrency(o.totalAmount)}
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${STATUS_CLASS[o.status]}`}
                >
                  {t(`guestOrders.status.${o.status}`)}
                </span>
              </div>

              <div className="flex items-center justify-between pt-1 border-t">
                <span className="text-[11px] text-gray-400">
                  {formatDateTime(o.createdAt)}
                </span>
                <span className="text-xs text-blue-600">{t("common.view")}</span>
              </div>
            </div>
          ))}
          {orders.length === 0 && (
            <p className="col-span-full text-center text-gray-400 py-10">
              {t("guestOrders.empty")}
            </p>
          )}
        </div>
      ) : (
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[680px]">
          <thead className="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              {canManage && <th className="px-3 py-2 w-8"></th>}
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">{t("guestOrders.source")}</th>
              <th className="px-3 py-2">{t("guestOrders.from")}</th>
              <th className="px-3 py-2 text-right">{t("common.total")}</th>
              <th className="px-3 py-2">{t("common.status")}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {orders.map((o) => (
              <tr key={o.id} className="hover:bg-gray-50">
                {canManage && (
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(o.id)}
                      onChange={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          next.has(o.id) ? next.delete(o.id) : next.add(o.id);
                          return next;
                        })
                      }
                    />
                  </td>
                )}
                <td className="px-3 py-2 text-gray-400">#{o.id}</td>
                <td className="px-3 py-2">
                  <span className="text-gray-700">{o.entry?.label}</span>
                  <span className="block text-[11px] text-gray-400">
                    {o.entry?.kind}
                    {o.entry?.table?.name ? ` · ${o.entry.table.name}` : ""}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-600">
                  {o.customerName ?? "—"}
                  {o.customerPhone ? (
                    <span className="block text-[11px] text-gray-400">{o.customerPhone}</span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right">{fmtCurrency(o.totalAmount)}</td>
                <td className="px-3 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_CLASS[o.status]}`}>
                    {t(`guestOrders.status.${o.status}`)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => openDetail(o)} className="text-xs text-blue-600 hover:underline">
                    {t("common.view")}
                  </button>
                </td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={canManage ? 7 : 6} className="px-3 py-6 text-center text-gray-400">
                  {t("guestOrders.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title={t("guestOrders.detail")}>
        {detail && (
          <div className="space-y-3 text-sm">
            <p className="text-xs text-gray-500">{formatDateTime(detail.createdAt)}</p>
            <p className="text-sm text-gray-700">
              {t("guestOrders.customer")}: {detail.customerName ?? "—"}
              {detail.customerPhone ? ` · ${detail.customerPhone}` : ""}
            </p>

            {/* Car-wash orders: edit lines; delete only before conversion. */}
            {canManage && detailIsCarWash && (
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={openEdit}>
                  {t("common.edit")}
                </Button>
                {!linked(detail) && (
                  <Button
                    size="sm"
                    variant="danger"
                    loading={busy}
                    onClick={removeOrder}
                  >
                    {t("common.delete")}
                  </Button>
                )}
              </div>
            )}

            <ul className="divide-y divide-gray-100 border rounded-lg">
              {detail.items?.map((it: any) => (
                <li key={it.id} className="flex justify-between px-3 py-2 gap-3">
                  <span className="min-w-0">
                    {it.quantity}× {it.nameSnapshot}
                    {it.itemKind === "CARWASH_ITEM" && it.washerName ? (
                      <span className="block text-[11px] text-gray-400">
                        {t("carwash.washer")}: {it.washerName}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-gray-500 whitespace-nowrap">
                    {it.unitPrice * it.quantity}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-right font-semibold">
              {t("common.total")}: {fmtCurrency(detail.totalAmount)}
            </p>
            {detail.note && <p className="text-xs text-gray-500">{detail.note}</p>}

            {/* Linked internal record (sale) once converted. */}
            {detail.sale && (
              <p className="text-xs text-emerald-700">
                {t("guestOrders.saleLinked")}: {detail.sale.invoiceNumber}
                {detail.sale.shop?.name ? ` · ${detail.sale.shop.name}` : ""}
              </p>
            )}

            {/* Branch replies (retail/manufacturing). */}
            {detail.routes?.length > 0 && (
              <div className="text-xs">
                <p className="text-gray-400 mb-1">{t("guestOrders.branchReplies")}</p>
                {detail.routes.map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between py-0.5 gap-2">
                    <span>{r.location?.name}</span>
                    <span
                      className={
                        r.status === "ACCEPTED"
                          ? "text-emerald-600"
                          : r.status === "DECLINED"
                            ? "text-red-600"
                            : "text-gray-400"
                      }
                    >
                      {t(`guestOrders.branchStatus.${r.status}`)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Branch: answer a request that was routed to this branch. */}
            {canManage && !isCentral &&
              detail.routes
                ?.filter(
                  (r: any) =>
                    r.locationId === user?.locationId && r.status === "REQUESTED",
                )
                .map((r: any) => (
                  <div key={r.id} className="flex gap-2 pt-2 border-t">
                    <Button
                      size="sm"
                      loading={busy}
                      onClick={() =>
                        act(() =>
                          api.post(
                            `/guest-orders/${detail.id}/branches/${r.locationId}/respond`,
                            { reply: "ACCEPTED" },
                          ),
                        )
                      }
                    >
                      {t("guestOrders.accept")}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      loading={busy}
                      onClick={() =>
                        act(() =>
                          api.post(
                            `/guest-orders/${detail.id}/branches/${r.locationId}/respond`,
                            { reply: "DECLINED" },
                          ),
                        )
                      }
                    >
                      {t("guestOrders.decline")}
                    </Button>
                  </div>
                ))}

            {/* Accept & review (the go-live gate) + central routing. */}
            {canManage && ["SUBMITTED", "REVIEWED"].includes(detail.status) && (
              <div className="space-y-2 pt-2 border-t">
                <div className="flex gap-2">
                  <Button
                    loading={busy}
                    className="flex-1"
                    onClick={() => act(() => api.post(`/guest-orders/${detail.id}/review`))}
                  >
                    {t("guestOrders.acceptReview")}
                  </Button>
                  <Button
                    variant="danger"
                    loading={busy}
                    onClick={() => act(() => api.post(`/guest-orders/${detail.id}/reject`))}
                  >
                    {t("guestOrders.reject")}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={shareRowsFor(detail).length === 0}
                    onClick={openShare}
                  >
                    {t("guestOrders.sharePrices")}
                  </Button>
                </div>
                {isCentral && hasProducts(detail) && locations.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 mb-1">{t("guestOrders.routeTo")}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {locations.map((l) => (
                        <label
                          key={l.id}
                          className="flex items-center gap-1 text-xs border rounded px-2 py-1"
                        >
                          <input
                            type="checkbox"
                            checked={routePick.includes(l.id)}
                            onChange={() =>
                              setRoutePick((p) =>
                                p.includes(l.id) ? p.filter((x) => x !== l.id) : [...p, l.id],
                              )
                            }
                          />
                          {l.name}
                        </label>
                      ))}
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-2"
                      disabled={routePick.length === 0}
                      loading={busy}
                      onClick={() =>
                        act(() =>
                          api.post(`/guest-orders/${detail.id}/route`, {
                            locationIds: routePick,
                          }),
                        )
                      }
                    >
                      {t("guestOrders.sendToBranches")}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Register a product order as a Sale (branch or central). */}
            {canManage && hasProducts(detail) && openStatuses.includes(detail.status) && (
              <div className="space-y-2 pt-2 border-t">
                <p className="text-xs font-semibold text-gray-500">
                  {t("guestOrders.addAsSale")}
                </p>
                {isCentral ? (
                  <SearchableSelect
                    options={locations.map((l: any) => ({
                      value: String(l.id),
                      label: l.name,
                    }))}
                    value={saleBranch}
                    onChange={setSaleBranch}
                    placeholder={t("sales.shopLocation")}
                    required
                  />
                ) : (
                  <p className="text-xs text-gray-500">
                    {t("sales.shopLocation")}: {myBranch?.name ?? user?.locationId}
                  </p>
                )}
                <div>
                  <p className="text-xs text-gray-500 mb-1">{t("guestOrders.saleType")}</p>
                  <select
                    value={saleType}
                    onChange={(e) => setSaleType(e.target.value)}
                    className="border border-gray-300 rounded-lg p-2 text-sm w-full bg-white"
                  >
                    {SALE_TYPES.map((st) => (
                      <option key={st} value={st}>
                        {t(SALE_TYPE_STATUS_KEY[st])}
                      </option>
                    ))}
                  </select>
                </div>
                {saleType !== "CREDITED" && (
                  <SearchableSelect
                    options={paymentMethods.map((m: any) => ({
                      value: String(m.id),
                      label: m.name,
                    }))}
                    value={saleMethod}
                    onChange={setSaleMethod}
                    placeholder={t("sales.paymentMethod")}
                    required
                  />
                )}
                {saleType === "PARTIALLY_PAID" && (
                  <input
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(e.target.value)}
                    type="number"
                    min="0"
                    placeholder={t("sales.paidAmount")}
                    className="border border-gray-300 rounded-lg p-2 text-sm w-full"
                  />
                )}
                <Button
                  className="w-full"
                  disabled={!saleValid}
                  loading={busy}
                  onClick={() =>
                    act(() =>
                      api.post(`/guest-orders/${detail.id}/convert`, {
                        locationId: isCentral && saleBranch ? Number(saleBranch) : undefined,
                        paymentMethodId: saleMethod ? Number(saleMethod) : undefined,
                        saleType,
                        paidAmount: saleType === "PARTIALLY_PAID" ? Number(paidAmount) : undefined,
                      }),
                    )
                  }
                >
                  {t("guestOrders.addAsSale")}
                </Button>
              </div>
            )}

            {/* Reject stays available only while the order has not yet been
                accepted (ROUTED has no accept/review row above). */}
            {canManage && detail.status === "ROUTED" && (
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button
                  variant="danger"
                  size="sm"
                  loading={busy}
                  onClick={() => act(() => api.post(`/guest-orders/${detail.id}/reject`))}
                >
                  {t("guestOrders.reject")}
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Share ordered items as a customer-facing price list. */}
      <Modal
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
        title={t("products.priceList.modalTitle")}
        size="sm"
      >
        <div className="space-y-3 text-sm">
          <ul className="divide-y divide-gray-100 border rounded-lg max-h-60 overflow-y-auto">
            {shareRowsFor(detail).map((r: any, i: number) => (
              <li key={i} className="flex justify-between px-3 py-2">
                <span>{r.item}</span>
                <span className="text-gray-500">{r.price}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap justify-end gap-2">
            {canShareFiles() && (
              <button
                type="button"
                onClick={() => doSharePrices("share")}
                disabled={shareBusy}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {t("products.shareLabel")}
              </button>
            )}
            <button
              type="button"
              onClick={() => doSharePrices("download")}
              disabled={shareBusy}
              className="border border-blue-600 text-blue-600 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {t("products.priceList.generatePdf")}
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit car-wash guest order lines. */}
      <Modal
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        title={t("guestOrders.editTitle")}
      >
        <div className="space-y-3 text-sm">
          {(detail?.customerVehicles ?? []).length > 0 && (
            <div className="rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
              <p className="font-medium text-gray-700 mb-1">
                {t("guestOrders.registeredVehicles")}
              </p>
              {detail.customerVehicles.map((v: any) => (
                <p key={v.id}>
                  · {v.plateNumber} ({v.vehicleType})
                </p>
              ))}
            </div>
          )}

          {editRows.map((row: any, index: number) => {
            const vehicleTypes = Array.from(
              new Set([
                ...(editOptions.vehicleTypes ?? []),
                ...(detail?.customerVehicles ?? []).map(
                  (v: any) => v.vehicleType,
                ),
              ]),
            );
            const updateRow = (patch: any) =>
              setEditRows((rows) =>
                rows.map((r) => (r.id === row.id ? { ...r, ...patch } : r)),
              );
            return (
              <div key={row.id} className="space-y-2 border rounded-lg p-3">
                <p className="text-xs text-gray-400">
                  {row.plateNumber ? `${row.plateNumber} · ` : ""}
                  {t("guestOrders.detail")} #{index + 1}
                </p>

                <label className="block text-gray-600">
                  {t("carwash.vehicleType")}
                  <select
                    value={row.vehicleType}
                    onChange={(e) => updateRow({ vehicleType: e.target.value })}
                    className="border border-gray-300 rounded-lg p-2 text-sm w-full bg-white"
                  >
                    <option value="">{t("common.select")}</option>
                    {vehicleTypes.map((vt) => (
                      <option key={vt} value={vt}>
                        {vt}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-gray-600">
                  {t("carwash.washType")}
                  <select
                    value={row.washTypeId}
                    onChange={(e) => updateRow({ washTypeId: e.target.value })}
                    className="border border-gray-300 rounded-lg p-2 text-sm w-full bg-white"
                  >
                    <option value="">{t("common.optional")}</option>
                    {editOptions.washTypes.map((w) => (
                      <option key={w.id} value={String(w.id)}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-gray-600">
                  {t("carwash.washer")}
                  <select
                    value={row.washerId}
                    onChange={(e) => updateRow({ washerId: e.target.value })}
                    className="border border-gray-300 rounded-lg p-2 text-sm w-full bg-white"
                  >
                    <option value="">{t("carwash.washerOptional")}</option>
                    {editOptions.washers.map((w) => (
                      <option key={w.id} value={String(w.id)}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-gray-600">
                  {t("guestOrders.dateTime")}
                  <input
                    type="datetime-local"
                    value={row.startsAt}
                    onChange={(e) => updateRow({ startsAt: e.target.value })}
                    className="border border-gray-300 rounded-lg p-2 text-sm w-full"
                  />
                </label>
              </div>
            );
          })}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEditOpen(false)}
              className="px-3 py-2 text-sm text-gray-600"
            >
              {t("common.cancel")}
            </button>
            <Button loading={editBusy} onClick={saveEdit}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
