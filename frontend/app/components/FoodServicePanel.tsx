"use client";

import api from "@/lib/api";
import { newClientRef } from "@/lib/clientRef";
import { useAuth } from "@/context/AuthContext";
import { getVerticalTerminology } from "@/lib/verticals";
import { useConfirm } from "@/app/components/ConfirmProvider";
import FiscalPrintButton from "@/app/components/FiscalPrintButton";
import {
  ackFiscalBatch,
  dispatchFiscalPrint,
  fetchFiscalBatchSummary,
  FiscalPrintPayload,
  markBatchPrintFailed,
  markBatchPrintPending,
  prepareFiscalPrintPayload,
} from "@/lib/fiscal";
import FiscalPrintPreviewModal from "@/app/components/FiscalPrintPreviewModal";
import { useTranslation } from "react-i18next";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

const STATUS_STYLES: Record<string, string> = {
  OPEN: "bg-gray-100 text-gray-700",
  DISPATCHED: "bg-amber-100 text-amber-800",
  PREPARING: "bg-blue-100 text-blue-800",
  READY: "bg-teal-100 text-teal-800",
  SERVED: "bg-purple-100 text-purple-800",
  PENDING_CONFIRMATION: "bg-orange-100 text-orange-800",
  PAID: "bg-green-100 text-green-800",
  CANCELLED: "bg-red-100 text-red-700",
};

const badge = (s: string) => STATUS_STYLES[s] ?? "bg-gray-100 text-gray-700";

const DONE_STATUSES = new Set(["PAID", "CANCELLED"]);

// The card badge is derived from the order's items (mirrors the backend sync):
// DISPATCHED → PREPARING → READY → SERVED, with PAID/CANCELLED terminal. No
// static OPEN badge — OPEN only exists for a split second before auto-dispatch.
const deriveStatus = (o: {
  status: string;
  items?: Array<{ status: string; quantity?: number }>;
}): string => {
  if (DONE_STATUSES.has(o.status)) return o.status;
  const items = o.items ?? [];
  if (!items.length) return "DISPATCHED";
  const s: Record<string, number> = { QUEUED: 0, PREPARING: 0, READY: 0, SERVED: 0 };
  items.forEach((it) => {
    if (s[it.status] != null) s[it.status] += it.quantity || 1;
  });
  const total = items.reduce((sum, it) => sum + (it.quantity || 1), 0);
  if (s.SERVED === total) return "SERVED";
  if (s.QUEUED === 0 && s.PREPARING === 0) return "READY";
  if (s.PREPARING > 0 || s.READY > 0) return "PREPARING";
  return "DISPATCHED";
};

const formatTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};

const TABLE_STYLES: Record<string, string> = {
  FREE: "bg-green-100 text-green-800",
  OCCUPIED: "bg-amber-100 text-amber-800",
  RESERVED: "bg-blue-100 text-blue-800",
  CLEANING: "bg-purple-100 text-purple-800",
};
const tableBadge = (s: string) => TABLE_STYLES[s] ?? "bg-gray-100 text-gray-700";

const isPackageOrder = (o: any) =>
  o?.billingType === "PACKAGE" || o?.billingType === "ROOM_CHARGE";

// Sentinel value for the order-target select: bill the order to a checked-in
// hotel stay's folio instead of a table (charge-to-room).
const ROOM_TARGET = "__ROOM__";

export default function FoodServicePanel({ title }: { title: string }) {
  const { t } = useTranslation();
  const { hasPermission, user, activeOrganizationId } = useAuth();
  const confirm = useConfirm();
  const terms = getVerticalTerminology(user?.businessType);
  const canManage = hasPermission("restaurant.manage");
  // Waiters serve the ready order; managers/owners can override any step.
  const canServe = canManage || hasPermission("restaurant.serve");
  // Waiters only see the orders they took; owners/managers see all orders.
  const canSeeAllOrders = canManage || user?.isSuperuser === true;
  // The Tables management tab is an owner/manager capability.
  const canManageTables = canManage;
  const tStatus = (s: string) =>
    (t(`orders.st.${s.toLowerCase()}`, { defaultValue: s }) as string) ?? s;
  const tTable = (s: string) =>
    (t(`orders.tbl.${s.toLowerCase()}`, { defaultValue: s }) as string) ?? s;
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  const [menu, setMenu] = useState<any[]>([]);
  const [tables, setTables] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [stations, setStations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // Idempotency key: reuse on retries so a double-tap can't place two orders.
  const orderRef = useRef<string>(newClientRef());
  const [error, setError] = useState("");
  const [cart, setCart] = useState<{ menuItemId: number; name: string; price: number; quantity: number }[]>([]);
  const [tableId, setTableId] = useState("");
  // Charge-to-room: active checked-in stays from /hotel/chargeable-rooms.
  const [roomTargets, setRoomTargets] = useState<any[]>([]);
  const [hotelReservationId, setHotelReservationId] = useState("");
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [tableForm, setTableForm] = useState({ name: "", capacity: "4" });
  const [paymentMethods, setPaymentMethods] = useState<any[]>([]);
  // Company tax config (settings + rates) so the settle dialog can show the
  // computed output VAT before the cashier collects payment.
  const [taxCfg, setTaxCfg] = useState<any>(null);
  const [settleTarget, setSettleTarget] = useState<any>(null);
  const [settleForm, setSettleForm] = useState({ paymentMethodId: "", amount: "", transactionReference: "", netChargeMode: "FOLIO" });
  // Orders selected for settlement (a table may have several open orders).
  const [settleOrders, setSettleOrders] = useState<
    {
      order: {
        id: number;
        orderNumber: string;
        totalAmount: number;
        discount?: number | null;
        status: string;
        tableId?: number | null;
        table?: { name: string } | null;
        items?: Array<{ id?: number; name?: string; quantity?: number; unitPrice?: number; status: string }>;
      };
      checked: boolean;
    }[]
  >([]);
  // Multi-order fiscal batch print state for the settle dialog.
  const [batchPrint, setBatchPrint] = useState<
    "idle" | "printing" | "done" | "error"
  >("idle");
  const [batchPreview, setBatchPreview] = useState<FiscalPrintPayload | null>(
    null,
  );
  // Order whose audit timeline is shown in the detail modal.
  const [detailOrder, setDetailOrder] = useState<any>(null);
  const [orderStatus, setOrderStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [orderStation, setOrderStation] = useState("");
  const [orderSearch, setOrderSearch] = useState("");
  // Hospitality package billing (only surfaced when enablePackageRouting is on).
  const [policy, setPolicy] = useState<any>(null);
  const [billingMode, setBillingMode] = useState<"STANDARD" | "PACKAGE" | "ROOM_CHARGE">("STANDARD");
  const [billingGuest, setBillingGuest] = useState<any>(null);
  const [guestQuery, setGuestQuery] = useState("");
  const [guestResults, setGuestResults] = useState<any[]>([]);
  const [entitlements, setEntitlements] = useState<any[]>([]);
  // "take" = the order-taking screen (menu + cart); "orders" = the order
  // lists, which themselves have Live / History tabs; "tables" = table
  // management. The active tabs live in the URL (?tab=&list=) so they can be
  // deep-linked, survive reloads and respond to browser back/forward.
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlMode = searchParams.get("tab");
  const urlView = searchParams.get("list");
  const [mode, setMode] = useState<"take" | "orders" | "tables">(
    urlMode === "take"
      ? "take"
      : urlMode === "tables" && canManageTables
        ? "tables"
        : "orders",
  );
  // Which live order's "•••" action menu is open.
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  // "live" = orders still in progress; "history" = paid/cancelled orders.
  const [view, setView] = useState<"live" | "history">(
    urlView === "history" ? "history" : "live",
  );

  const switchTab = (
    m: "take" | "orders" | "tables",
    v: "live" | "history",
  ) => {
    setMode(m);
    setView(v);
    setOpenMenuId(null);
    const params = new URLSearchParams();
    params.set("tab", m);
    params.set("list", v);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  // Keep local tab state in sync with the URL (back/forward, manual edits).
  useEffect(() => {
    const m = searchParams.get("tab");
    const v = searchParams.get("list");
    let nextMode: "orders" | "take" | "tables" = "orders";
    if (m === "take") nextMode = "take";
    else if (m === "tables" && canManageTables) nextMode = "tables";
    setMode(nextMode);
    setView(v === "history" ? "history" : "live");
  }, [searchParams, canManageTables]);
  const [activeCategory, setActiveCategory] = useState<number | "all">("all");
  const [menuSearch, setMenuSearch] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    // Waiters only see the orders they took (the backend enforces the same
    // scope server-side); owners/managers fetch everyone's orders.
    if (!canSeeAllOrders && user?.id) params.set("waiterId", String(user.id));
    const qs = params.toString();
    try {
      const orgId = activeOrganizationId;
      const [m, tbl, o, pm, st, tx, org] = await Promise.all([
        api.get("/restaurant/menu"),
        api.get("/restaurant/tables"),
        api.get(`/restaurant/orders${qs ? `?${qs}` : ""}`),
        api.get("/payment-methods"),
        api.get("/restaurant/stations"),
        api.get("/taxes").catch(() => null),
        orgId ? api.get(`/tenants/${orgId}`) : Promise.resolve({ data: null }),
      ]);
      setMenu(m.data);
      setTables(tbl.data);
      setOrders(o.data);
      setPaymentMethods(pm.data);
      setStations(Array.isArray(st.data) ? st.data : []);
      const settings = org.data?.settings ?? {};
      setPolicy({
        enablePackageRouting: settings.enablePackageRouting === true,
        enableRoomFolioCharging: settings.enableRoomFolioCharging === true,
        defaultExcessSettlementMode: settings.defaultExcessSettlementMode ?? "FLEXIBLE",
      });
      setTaxCfg(tx?.data ?? null);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.message ?? t("orders.failedLoadData"));
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, activeOrganizationId, canSeeAllOrders, user?.id]);

  useEffect(() => {
    load();
    // Live status for every user: station boards poll, so the waiter/owner
    // order list does too, keeping the displayed status in sync everywhere.
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [load]);

  const addToCart = (item: any) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.menuItemId === item.id);
      if (existing) {
        return prev.map((c) => (c.menuItemId === item.id ? { ...c, quantity: c.quantity + 1 } : c));
      }
      return [...prev, { menuItemId: item.id, name: item.name, price: item.price, quantity: 1 }];
    });
  };

  const changeQty = (menuItemId: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) =>
          c.menuItemId === menuItemId
            ? { ...c, quantity: Math.max(0, c.quantity + delta) }
            : c,
        )
        .filter((c) => c.quantity > 0),
    );
  };

  const placeOrder = async () => {
    if (cart.length === 0) return setError(t("orders.addItemsFirst"));
    // Charge-to-room requires an actual stay to bill.
    const isRoomCharge = tableId === ROOM_TARGET;
    if (isRoomCharge && !hotelReservationId) {
      return setError(t("orders.selectRoomFirst"));
    }
    try {
      await api.post("/restaurant/orders", {
        tableId:
          isRoomCharge || !tableId ? undefined : Number(tableId),
        items: cart.map((c) => ({ menuItemId: c.menuItemId, quantity: c.quantity })),
        clientRef: orderRef.current,
        ...(isRoomCharge
          ? {
              // Charge-to-room: itemized lines land on the stay folio and the
              // net charge is deferred for front-desk checkout.
              billing: {
                type: "ROOM_CHARGE",
                hotelReservationId: Number(hotelReservationId),
                netChargeMode: "DEFER_TO_FOLIO",
              },
            }
          : billingMode !== "STANDARD"
            ? {
                billing: {
                  type: billingMode,
                  packageGuestId: billingGuest?.id,
                  packageId: billingGuest?.package?.id,
                  roomNumber: billingGuest?.roomNumber,
                },
              }
            : {}),
      });
      orderRef.current = newClientRef();
      setCart([]);
      setTableId("");
      setHotelReservationId("");
      setBillingGuest(null);
      setGuestQuery("");
      setGuestResults([]);
      setEntitlements([]);
      setBillingMode("STANDARD");
      setError("");
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("orders.failedPlaceOrder"));
    }
  };

  // POS-scoped charge-to-room list (active checked-in stays only).
  const loadChargeableRooms = async () => {
    setLoadingRooms(true);
    try {
      const r = await api.get("/hotel/chargeable-rooms");
      setRoomTargets(Array.isArray(r.data) ? r.data : []);
    } catch {
      // Business without the hotel module (or no active stays) — stay empty.
      setRoomTargets([]);
    } finally {
      setLoadingRooms(false);
    }
  };

  const searchGuests = async (q: string) => {
    setGuestQuery(q);
    if (!q.trim()) return setGuestResults([]);
    try {
      const r = await api.get(`/hospitality/packages/lookup?q=${encodeURIComponent(q.trim())}`);
      setGuestResults(Array.isArray(r.data) ? r.data : []);
    } catch {
      setGuestResults([]);
    }
  };

  const selectGuest = async (g: any) => {
    setBillingGuest(g);
    setGuestResults([]);
    setGuestQuery(g.roomNumber ? `Room ${g.roomNumber} · ${g.guestName}` : g.guestName);
    try {
      const r = await api.get(
        `/hospitality/packages/${g.package.id}/entitlements?guestId=${g.id}`,
      );
      setEntitlements(Array.isArray(r.data) ? r.data : []);
    } catch {
      setEntitlements([]);
    }
  };

  const markServed = async (id: number) => {
    try {
      await api.post(`/restaurant/orders/${id}/mark-served`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("orders.failedMarkServed"));
    }
  };

  const cancelOrder = async (id: number) => {
    if (!(await confirm(t("orders.cancelConfirm")))) return;
    try {
      await api.post(`/restaurant/orders/${id}/cancel`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("orders.failedCancelOrder"));
    }
  };

  const deleteOrder = async (id: number) => {
    if (!(await confirm(t("orders.deleteConfirm")))) return;
    try {
      await api.delete(`/restaurant/orders/${id}`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("orders.failedDeleteOrder"));
    }
  };

  const advanceItem = async (orderId: number, itemId: number, status: string) => {
    await api.patch(`/restaurant/orders/${orderId}/items/${itemId}/status`, { status });
    await load();
  };

  const openSettle = (order: any) => {
    const isPackage = order.billingType === "PACKAGE" || order.billingType === "ROOM_CHARGE";
    const net = isPackage
      ? Math.max(0, (order.totalAmount ?? 0) - (order.packageDiscount ?? 0))
      : order.totalAmount;
    const forced =
      policy?.defaultExcessSettlementMode === "DEFER_TO_FOLIO_ONLY"
        ? "FOLIO"
        : policy?.defaultExcessSettlementMode === "COLLECT_NOW_ONLY"
          ? "COLLECT_NOW"
          : null;
    setSettleTarget(order);
    // When the order is tied to a table, offer every open order on that table
    // so the whole bill can be settled together (checked by default).
    const tableOpen = order.tableId
      ? orders.filter((o) => o.tableId === order.tableId && !DONE_STATUSES.has(o.status))
      : [];
    const candidates = tableOpen.length ? tableOpen : [order];
    setSettleOrders(candidates.map((o) => ({ order: o, checked: true })));
    const total = candidates.reduce((s, o) => s + (o.totalAmount ?? 0) - (o.discount ?? 0), 0);
    setSettleForm({
      paymentMethodId: "",
      // Package orders settle on their net charge (gross − entitlement coverage);
      // a standard table bill settles on the summed open-order total.
      amount: String(isPackage ? net : total),
      transactionReference: "",
      netChargeMode: isPackage
        ? (forced ?? (policy?.enableRoomFolioCharging ? "FOLIO" : "COLLECT_NOW"))
        : "FOLIO",
    });
  };

  const toggleSettleOrder = (id: number) => {
    setSettleOrders((prev) => {
      const next = prev.map((s) => (s.order.id === id ? { ...s, checked: !s.checked } : s));
      const total = next
        .filter((s) => s.checked)
        .reduce((sum, s) => sum + (s.order.totalAmount ?? 0) - (s.order.discount ?? 0), 0);
      setSettleForm((f) => ({ ...f, amount: String(total) }));
      return next;
    });
  };

  const openDetail = (order: any) => setDetailOrder(order);

  const submitSettle = async () => {
    if (!settleTarget) return;
    const ids = settleOrders.filter((s) => s.checked).map((s) => s.order.id);
    if (ids.length === 0) return setError(t("orders.selectOrderSettle"));
    try {
      const isPackage =
        settleTarget.billingType === "PACKAGE" || settleTarget.billingType === "ROOM_CHARGE";
      if (isPackage) {
        // Package orders settle individually: the net charge is either deferred
        // to the guest folio or collected at the POS (per the chosen mode).
        await api.post(`/restaurant/orders/${settleTarget.id}/settle`, {
          // Send the explicit PAY_NOW / DEFER_TO_FOLIO aliases (legacy accepted).
          netChargeMode:
            settleForm.netChargeMode === "FOLIO" ? "DEFER_TO_FOLIO" : "PAY_NOW",
          ...(settleForm.netChargeMode === "COLLECT_NOW"
            ? {
                paymentMethodId: settleForm.paymentMethodId
                  ? Number(settleForm.paymentMethodId)
                  : undefined,
                transactionReference: settleForm.transactionReference || undefined,
              }
            : {}),
        });
      } else {
        // Standard orders: settle the selected table orders in one transaction.
        await api.post("/restaurant/orders/batch-settle", {
          orderIds: ids,
          payments: [
            {
              amount: Number(settleForm.amount),
              paymentMethodId: settleForm.paymentMethodId ? Number(settleForm.paymentMethodId) : undefined,
              transactionReference: settleForm.transactionReference || undefined,
            },
          ],
        });
      }
      setSettleTarget(null);
      setSettleOrders([]);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? t("orders.failedSettle"));
    }
  };

  // Print all checked orders as ONE consolidated fiscal invoice via the local
  // bridge agent. Intercepts with a thermal-receipt preview first.
  const openBatchPreview = async () => {
    const ids = settleOrders.filter((s) => s.checked).map((s) => s.order.id);
    if (ids.length === 0) return setError(t("orders.selectOrderPrint"));
    setError("");
    try {
      const summary = await fetchFiscalBatchSummary({ orderIds: ids });
      setBatchPreview(prepareFiscalPrintPayload(summary));
    } catch (e: any) {
      setError(e?.message ?? t("orders.failedFiscalSummary"));
    }
  };

  const confirmBatchPrint = async () => {
    if (!batchPreview) return;
    const ids = settleOrders.filter((s) => s.checked).map((s) => s.order.id);
    setBatchPrint("printing");
    try {
      await markBatchPrintPending({ orderIds: ids });
      const agent = await dispatchFiscalPrint(batchPreview);
      await ackFiscalBatch({ orderIds: ids }, agent);
      setBatchPrint("done");
      setBatchPreview(null);
      await load();
    } catch (e: any) {
      try {
        await markBatchPrintFailed(
          { orderIds: ids },
          e?.message ?? t("orders.fiscalPrintFailed"),
        );
      } catch {
        // ack-side failure is reported below
      }
      setBatchPrint("error");
      setBatchPreview(null);
      setError(e?.message ?? t("orders.fiscalPrintFailed"));
      await load();
    }
  };

  // The company's effective default OUTPUT rate (enabled, prefers isDefault).
  const defaultOutputRate =
    taxCfg?.settings?.taxEnabled
      ? (taxCfg.rates ?? []).find(
          (r: any) => r.direction === "OUTPUT" && r.enabled && r.isDefault,
        ) ??
        (taxCfg.rates ?? []).find(
          (r: any) => r.direction === "OUTPUT" && r.enabled,
        )
      : null;

  // Settle breakdown for the currently-checked orders: taxable base (item
  // totals minus discounts), computed VAT and the amount the cashier collects.
  const settleBreakdown = () => {
    const base = settleOrders
      .filter((s) => s.checked)
      .reduce(
        (sum, s) => sum + (s.order.totalAmount ?? 0) - (s.order.discount ?? 0),
        0,
      );
    if (!defaultOutputRate) return { base, tax: 0, total: base };
    const tax =
      taxCfg.settings.taxInclusive !== false
        ? Math.round((base - base / (1 + defaultOutputRate.rate / 100)) * 100) / 100
        : Math.round(base * (defaultOutputRate.rate / 100) * 100) / 100;
    return {
      base,
      tax,
      total: taxCfg.settings.taxInclusive !== false ? base : base + tax,
    };
  };

  const addTable = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/restaurant/tables", { name: tableForm.name, capacity: Number(tableForm.capacity) });
      setTableForm({ name: "", capacity: "4" });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("orders.failedAddTable"));
    }
  };

  const setTableStatus = async (id: number, status: string) => {
    try {
      await api.patch(`/restaurant/tables/${id}/status`, { status });
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? t("orders.failedUpdateTable"));
    }
  };

  if (loading) return <p className="text-gray-500">{t("orders.loading")}</p>;

  const cartTotal = cart.reduce((s, c) => s + c.price * c.quantity, 0);

  // Orders are split into Live (in progress) vs History (paid / cancelled).
  const liveOrders = orders.filter((o) => !DONE_STATUSES.has(o.status));
  const historyOrders = orders.filter((o) => DONE_STATUSES.has(o.status));
  const visibleOrders = (view === "live" ? liveOrders : historyOrders).filter(
    (o) =>
      (!orderStatus || deriveStatus(o) === orderStatus) &&
      (!orderStation ||
        (o.items ?? []).some((it: any) => it.stationKey === orderStation)) &&
      (!orderSearch ||
        o.orderNumber.toLowerCase().includes(orderSearch.toLowerCase()) ||
        (o.table?.name ?? "").toLowerCase().includes(orderSearch.toLowerCase()) ||
        (o.items ?? []).some((it: any) =>
          it.name.toLowerCase().includes(orderSearch.toLowerCase()),
        )),
  );
  const visibleStatusOptions =
    view === "live"
      ? ["DISPATCHED", "PREPARING", "READY", "SERVED", "PENDING_CONFIRMATION"]
      : ["PAID", "CANCELLED"];
  const itemStatusLabels = ["QUEUED", "PREPARING", "READY", "SERVED"];
  const allItems = menu.flatMap((cat: any) =>
    cat.items.map((item: any) => ({
      ...item,
      categoryName: cat.name,
      categoryId: cat.id,
    })),
  );
  const visibleItems = allItems.filter((item: any) => {
    if (activeCategory !== "all" && item.categoryId !== activeCategory) return false;
    if (menuSearch && !item.name.toLowerCase().includes(menuSearch.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="w-full max-w-full space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">{title}</h1>
      {error && <div className="bg-red-50 text-red-600 p-3 rounded text-sm">{error}</div>}

      {/* Main tabs: Orders (default), Take Order, Tables */}
      <div className="flex flex-wrap rounded-lg border border-gray-200 overflow-hidden w-fit">
        <button
          onClick={() => switchTab("orders", view)}
          className={`px-4 sm:px-6 py-2 text-sm font-medium transition ${
            mode === "orders"
              ? "bg-blue-600 text-white"
              : "bg-white text-gray-600 hover:bg-gray-50"
          }`}
        >
          📋 {terms.orders}
        </button>
        <button
          onClick={() => switchTab("take", view)}
          className={`px-4 sm:px-6 py-2 text-sm font-medium transition ${
            mode === "take"
              ? "bg-blue-600 text-white"
              : "bg-white text-gray-600 hover:bg-gray-50"
          }`}
        >
          🛎️ {t("orders.takeOrder", { order: terms.order })}
        </button>
        {canManageTables && (
          <button
            onClick={() => switchTab("tables", view)}
            className={`px-4 sm:px-6 py-2 text-sm font-medium transition ${
              mode === "tables"
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            🪑 {t("orders.tables")}
          </button>
        )}
      </div>

      {mode === "take" && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Menu browser */}
        <div className="lg:col-span-2 bg-white p-4 rounded-lg border border-gray-200">
          <h2 className="font-semibold text-gray-800 mb-3">{terms.catalog}</h2>

          <div className="flex flex-wrap items-center gap-2 mb-4">
            <input
              placeholder={t("orders.searchItems")}
              value={menuSearch}
              onChange={(e) => setMenuSearch(e.target.value)}
              className="border border-gray-300 rounded p-2 text-sm flex-1 min-w-[140px]"
            />
            <button
              onClick={() => setActiveCategory("all")}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
                activeCategory === "all"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {t("orders.all")}
            </button>
            {menu.map((cat: any) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
                  activeCategory === cat.id
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
            {visibleItems.map((item: any) => {
              const inCart = cart.find((c) => c.menuItemId === item.id);
              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => addToCart(item)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      addToCart(item);
                    }
                  }}
                  className={`bg-white border rounded-lg p-2.5 flex items-center gap-2 shadow-sm cursor-pointer active:bg-blue-50/60 transition ${
                    inCart ? "border-blue-300 bg-blue-50/30" : "border-gray-200 hover:border-blue-300"
                  }`}
                  title={t("orders.addItemTitle", { name: item.name })}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-gray-800 leading-tight truncate">{item.name}</p>
                    <p className="text-[10px] text-gray-400 truncate">{item.categoryName}</p>
                    <p className="text-blue-600 text-sm font-bold">{item.price} {t("orders.birr")}</p>
                  </div>
                  {inCart ? (
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          changeQty(item.id, -1);
                        }}
                        className="w-8 h-8 rounded-lg bg-gray-100 text-gray-700 text-base font-bold active:bg-gray-200"
                      >
                        −
                      </button>
                      <span className="w-5 text-center text-sm font-bold text-gray-800">{inCart.quantity}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          changeQty(item.id, 1);
                        }}
                        className="w-8 h-8 rounded-lg bg-blue-600 text-white text-base font-bold active:bg-blue-700"
                      >
                        +
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        addToCart(item);
                      }}
                      className="w-9 h-9 rounded-lg bg-blue-600 text-white text-lg font-bold active:bg-blue-700 shrink-0"
                      title={t("orders.addItemTitle", { name: item.name })}
                    >
                      +
                    </button>
                  )}
                </div>
              );
            })}
            {visibleItems.length === 0 && (
              <p className="col-span-full text-gray-400 text-sm py-8 text-center">{t("orders.noItemsFound")}</p>
            )}
          </div>
        </div>

        {/* Sticky cart */}
        <div className="lg:col-span-1">
          <div className="bg-white p-4 rounded-lg border border-gray-200 lg:sticky lg:top-4">
            <h2 className="font-semibold text-gray-800 mb-3">{t("orders.currentOrder", { order: terms.order })}</h2>
            <select
              value={tableId}
              onChange={(e) => {
                const v = e.target.value;
                setTableId(v);
                setHotelReservationId("");
                if (v === ROOM_TARGET) void loadChargeableRooms();
              }}
              className="border border-gray-300 rounded p-2 text-sm w-full mb-3"
            >
              <option value="">{t("orders.takeAway")}</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({tTable(t.status)})</option>
              ))}
              {policy?.enableRoomFolioCharging && (
                <option value={ROOM_TARGET}>{t("orders.chargeToRoom")}</option>
              )}
            </select>
            {tableId === ROOM_TARGET && (
              <div className="mb-3">
                <select
                  value={hotelReservationId}
                  onChange={(e) => setHotelReservationId(e.target.value)}
                  className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
                >
                  <option value="">{t("orders.selectRoom")}</option>
                  {roomTargets.map((r) => (
                    <option key={r.reservationId} value={r.reservationId}>
                      {t("orders.roomOption", {
                        number: r.roomNumber ?? "—",
                        name: r.guestName,
                      })}
                    </option>
                  ))}
                </select>
                {!loadingRooms && roomTargets.length === 0 && (
                  <p className="text-[11px] text-gray-400 mt-1">
                    {t("orders.noChargeableRooms")}
                  </p>
                )}
              </div>
            )}
            {/* Package/entitlement routing and charge-to-room are exclusive. */}
            {policy?.enablePackageRouting && tableId !== ROOM_TARGET && (
              <div className="mb-3 space-y-2">
                <select
                  value={billingMode}
                  onChange={(e) => {
                    setBillingMode(e.target.value as any);
                    setBillingGuest(null);
                    setGuestResults([]);
                    setEntitlements([]);
                    setGuestQuery("");
                  }}
                  className="border border-gray-300 rounded p-2 text-sm w-full bg-white"
                >
                  <option value="STANDARD">Standard billing</option>
                  <option value="PACKAGE">🎫 Charge to Guest Package</option>
                  <option value="ROOM_CHARGE">🛏️ Charge to Room</option>
                </select>
                {billingMode !== "STANDARD" &&
                  (billingGuest ? (
                    <div className="border border-violet-200 bg-violet-50/50 rounded p-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-gray-800">
                          {billingGuest.guestName}
                          {billingGuest.roomNumber && ` · Room ${billingGuest.roomNumber}`}
                        </span>
                        <button
                          onClick={() => {
                            setBillingGuest(null);
                            setEntitlements([]);
                            setGuestQuery("");
                          }}
                          className="text-red-600 hover:underline shrink-0"
                        >
                          Clear
                        </button>
                      </div>
                      <p className="text-gray-500">{billingGuest.package?.name}</p>
                      {entitlements.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {entitlements.map((e) => (
                            <li key={e.id} className="text-[11px] text-gray-600">
                              • {e.stationName}
                              {e.menuItemName ? ` · ${e.menuItemName}` : e.menuCategoryName ? ` · ${e.menuCategoryName}` : ""}
                              {" · "}
                              {e.allowanceValue > 0 ? `${e.allowanceValue} ETB/unit` : "full coverage"}
                              {e.remainingQuantity != null ? ` · ${e.remainingQuantity} left today` : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : (
                    <div>
                      <input
                        value={guestQuery}
                        onChange={(e) => searchGuests(e.target.value)}
                        placeholder="Room # or guest name…"
                        className="border border-gray-300 rounded p-2 text-sm w-full"
                      />
                      {guestResults.length > 0 && (
                        <ul className="border border-gray-200 rounded mt-1 max-h-32 overflow-y-auto bg-white">
                          {guestResults.map((g) => (
                            <li key={g.id}>
                              <button
                                onClick={() => selectGuest(g)}
                                className="w-full text-left px-2 py-1.5 hover:bg-gray-50 text-xs text-gray-700"
                              >
                                {g.guestName}
                                {g.roomNumber && ` · Room ${g.roomNumber}`}
                                {" · "}
                                {g.package?.name}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {guestQuery && guestResults.length === 0 && (
                        <p className="text-[11px] text-gray-400 mt-1">No active package guest found.</p>
                      )}
                    </div>
                  ))}
              </div>
            )}
            <ul className="space-y-1.5 mb-3 max-h-64 overflow-y-auto">
              {cart.map((c) => (
                <li key={c.menuItemId} className="flex items-center justify-between gap-2 text-sm text-gray-700">
                  <span className="min-w-0 truncate">
                    {c.name} <span className="text-gray-400">× {c.quantity}</span>
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => changeQty(c.menuItemId, -1)}
                      className="w-6 h-6 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 text-xs"
                    >
                      −
                    </button>
                    <button
                      onClick={() => changeQty(c.menuItemId, 1)}
                      className="w-6 h-6 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 text-xs"
                    >
                      +
                    </button>
                    <span className="w-14 text-right font-medium">{c.price * c.quantity}</span>
                  </span>
                </li>
              ))}
              {cart.length === 0 && <li className="text-gray-400 text-sm">{t("orders.cartEmpty")}</li>}
            </ul>
            <div className="flex justify-between items-center border-t pt-3">
              <span className="font-semibold text-gray-800">{t("orders.total")} {cartTotal}</span>
              <button
                onClick={placeOrder}
                disabled={cart.length === 0}
                className="bg-blue-600 text-white rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                {t("orders.placeOrder", { order: terms.order })}
              </button>
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg border border-gray-200 mt-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold text-gray-800">{t("orders.tables")}</h2>
              {canManageTables && (
                <button
                  onClick={() => switchTab("tables", view)}
                  className="text-xs font-medium text-blue-600 hover:underline shrink-0"
                >
                  {t("orders.manage")}
                </button>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-1">
              {t("orders.tablesTakeHint")}
            </p>
          </div>
        </div>

      </div>
      )}

      {/* Tables management */}
      {mode === "tables" && (
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-start justify-between flex-wrap gap-2 mb-4">
            <div>
              <h2 className="font-semibold text-gray-800">{t("orders.tables")}</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {t("orders.tablesManageHint")}
              </p>
            </div>
            <form onSubmit={addTable} className="flex gap-1.5">
              <input
                placeholder={t("orders.tableName")}
                value={tableForm.name}
                onChange={(e) => setTableForm({ ...tableForm, name: e.target.value })}
                className="border border-gray-300 rounded p-2 text-sm w-28 sm:w-32"
                required
              />
              <input
                type="number"
                min={1}
                placeholder={t("orders.seats")}
                value={tableForm.capacity}
                onChange={(e) => setTableForm({ ...tableForm, capacity: e.target.value })}
                className="border border-gray-300 rounded p-2 text-sm w-16 sm:w-20"
              />
              <button type="submit" className="bg-gray-800 text-white rounded px-3 py-2 text-sm font-medium shrink-0">
                {t("common.add")}
              </button>
            </form>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {tables.map((tbl) => {
              const active = tableId === String(tbl.id);
              return (
                <div
                  key={tbl.id}
                  className={`border rounded-lg p-3 transition ${
                    active ? "border-blue-500 ring-1 ring-blue-500 bg-blue-50/40" : "border-gray-200"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => setTableId(String(tbl.id))}
                      className="text-sm font-semibold text-gray-800 hover:text-blue-600"
                    >
                      {tbl.name}
                    </button>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${tableBadge(tbl.status)}`}>
                      {tTable(tbl.status)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{t("orders.seatsOf", { count: tbl.capacity })}</p>
                  <div className="flex items-center justify-between mt-2 gap-1">
                    <select
                      value={tbl.status}
                      onChange={(e) => setTableStatus(tbl.id, e.target.value)}
                      className="text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-gray-50"
                      aria-label={t("orders.statusAria", { name: tbl.name })}
                    >
                      {["FREE", "OCCUPIED", "RESERVED", "CLEANING"].map((s) => (
                        <option key={s} value={s}>{tTable(s)}</option>
                      ))}
                    </select>
                    {active && <span className="text-[10px] font-semibold text-blue-600 shrink-0">{t("orders.selected")}</span>}
                  </div>
                </div>
              );
            })}
            {tables.length === 0 && (
              <p className="col-span-full text-gray-400 text-sm py-6 text-center">{t("orders.noTables")}</p>
            )}
          </div>
        </div>
      )}

      {/* Orders */}
      {mode === "orders" && (
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm w-full">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button
              onClick={() => switchTab(mode, "live")}
              className={`px-3 sm:px-4 py-1.5 text-sm font-medium transition ${
                view === "live"
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              🔴 {t("orders.live")} {terms.orders}
            </button>
            <button
              onClick={() => switchTab(mode, "history")}
              className={`px-3 sm:px-4 py-1.5 text-sm font-medium transition ${
                view === "history"
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              🕘 {t("orders.history")} {terms.orders}
            </button>
          </div>
        </div>
        {/* Responsive filter bar: station, status, dates, search */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 w-full mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <select value={orderStation} onChange={(e) => setOrderStation(e.target.value)} className="border border-gray-300 rounded p-2 text-sm">
              <option value="">{t("orders.allStations")}</option>
              {stations.map((s) => (
                <option key={s.id} value={s.key}>{s.name}</option>
              ))}
            </select>
            <select value={orderStatus} onChange={(e) => setOrderStatus(e.target.value)} className="border border-gray-300 rounded p-2 text-sm">
              <option value="">{t("orders.allStatuses")}</option>
              {visibleStatusOptions.map((s) => (
                <option key={s} value={s}>{tStatus(s)}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border border-gray-300 rounded p-2 text-sm" aria-label={t("orders.fromDate")} />
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border border-gray-300 rounded p-2 text-sm" aria-label={t("orders.toDate")} />
            <input
              value={orderSearch}
              onChange={(e) => setOrderSearch(e.target.value)}
              placeholder={t("orders.searchOrder")}
              className="border border-gray-300 rounded p-2 text-sm w-full sm:w-56"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleOrders.map((o) => {
            const isDone = o.status === "PAID" || o.status === "CANCELLED";
            const stationNames = Array.from(
              new Set((o.items ?? []).map((it: any) => it.stationName).filter(Boolean)),
            ) as string[];
            const created = o.createdAt ? new Date(o.createdAt) : null;
            const orderTime = created
              ? `${created.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${created.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : "";
            return (
              <div key={o.id} className="relative w-full bg-white border rounded-xl p-4 shadow-sm flex flex-col justify-between gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-800 truncate">{o.orderNumber}</p>
                    {o.guestTag && (
                      <p className="text-[11px] text-violet-700 bg-violet-50 rounded px-1.5 py-0.5 mt-1 w-fit">
                        {o.guestTag}
                      </p>
                    )}
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {orderTime}
                      {o.table?.name && ` · ${t("orders.tablePrefix", { name: o.table.name })}`}
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${badge(deriveStatus(o))}`}>{tStatus(deriveStatus(o))}</span>
                </div>

                {stationNames.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {stationNames.map((s) => (
                      <span key={s} className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-[10px] font-medium">
                        {s}
                      </span>
                    ))}
                  </div>
                )}

                <p className="text-xs text-gray-500 line-clamp-2">
                  {(o.items ?? []).map((it: any) => `${it.name} ×${it.quantity}`).join(" · ") || t("orders.noItems")}
                </p>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
                <span className="font-bold text-gray-800">{o.totalAmount} {t("orders.birr")}</span>
                {!isDone && (
                  <>
                    {deriveStatus(o) === "READY" && canServe && (
                      <button
                        onClick={() => markServed(o.id)}
                        className="bg-purple-600 hover:bg-purple-700 text-white rounded-lg px-4 py-2 text-sm font-semibold"
                      >
                        {t("orders.markServed")}
                      </button>
                    )}
                    <button
                      onClick={() => openSettle(o)}
                      className="bg-green-600 hover:bg-green-700 text-white rounded-lg px-4 py-2 text-sm font-semibold"
                    >
                      {t("orders.settle")}
                    </button>
                    <div className="relative">
                      <button
                        onClick={() => setOpenMenuId(openMenuId === o.id ? null : o.id)}
                        className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                        title={t("orders.moreActions")}
                        aria-label={t("orders.moreActionsAria", { order: o.orderNumber })}
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                          <circle cx="12" cy="5" r="2" />
                          <circle cx="12" cy="12" r="2" />
                          <circle cx="12" cy="19" r="2" />
                        </svg>
                      </button>
                      {openMenuId === o.id && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setOpenMenuId(null)} />
                          <div className="absolute right-0 top-full mt-1 z-50 w-60 bg-white rounded-lg border border-gray-200 shadow-xl py-1">
                            {deriveStatus(o) === "READY" && canServe && (
                              <button
                                onClick={() => {
                                  setOpenMenuId(null);
                                  markServed(o.id);
                                }}
                                className="w-full text-left px-4 py-2 text-sm text-purple-700 hover:bg-gray-100"
                              >
                                {t("orders.markServed")}
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setOpenMenuId(null);
                                openDetail(o);
                              }}
                              className="w-full text-left px-4 py-2 text-sm text-blue-700 hover:bg-gray-100"
                            >
                              {t("orders.detailsTimeline")}
                            </button>
                            <button
                              onClick={() => {
                                setOpenMenuId(null);
                                openSettle(o);
                              }}
                              className="w-full text-left px-4 py-2 text-sm text-green-700 hover:bg-gray-100"
                            >
                              {t("orders.settlePayment")}
                            </button>
                            {/* Item status changes are owned by the station holding the item;
                                only managers/owners may override them from this screen. */}
                            {canManage && (
                              <>
                                <div className="border-t my-1" />
                                <div className="px-4 py-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                                  {t("orders.itemStatus")}
                                </div>
                                {o.items.map((it: any) => (
                                  <div key={it.id} className="flex items-center justify-between gap-2 px-4 py-1.5">
                                    <span className="text-xs text-gray-700 truncate">{it.name} ×{it.quantity}</span>
                                    <select
                                      value={it.status}
                                      onChange={(e) => advanceItem(o.id, it.id, e.target.value)}
                                      className="text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-gray-50"
                                    >
                                      {itemStatusLabels.map((s) => (
                                        <option key={s} value={s}>{tStatus(s)}</option>
                                      ))}
                                    </select>
                                  </div>
                                ))}
                              </>
                            )}
                            {canManage && (
                              <>
                                <div className="border-t my-1" />
                                <button
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    cancelOrder(o.id);
                                  }}
                                  className="w-full text-left px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
                                >
                                  {t("orders.cancelOrder")}
                                </button>
                                <button
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    deleteOrder(o.id);
                                  }}
                                  className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100"
                                >
                                  {t("orders.deleteOrder")}
                                </button>
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
            );
          })}
          {visibleOrders.length === 0 && (
            <p className="text-gray-400 text-sm py-6 text-center">
              {view === "live"
                ? t("orders.noLive", { orders: terms.orders.toLowerCase() })
                : t("orders.noHistory", { orders: terms.orders.toLowerCase() })}
            </p>
          )}
        </div>
      </div>
      )}

      {/* Mobile sticky bottom bar */}
      {mode === "take" && cart.length > 0 && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 px-4 py-3 flex items-center justify-between gap-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
          <div>
            <p className="text-xs text-gray-400">
              {t(cart.reduce((s, c) => s + c.quantity, 0) === 1 ? "orders.itemCount" : "orders.itemCountPlural", { count: cart.reduce((s, c) => s + c.quantity, 0) })}
            </p>
            <p className="text-lg font-bold text-gray-800">{cartTotal} {t("orders.birr")}</p>
          </div>
          <button
            onClick={placeOrder}
            className="bg-blue-600 text-white rounded-xl px-6 py-3 text-base font-bold active:bg-blue-700"
          >
            {t("orders.placeOrder", { order: terms.order })}
          </button>
        </div>
      )}

      {/* Settle modal */}
      {settleTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-sm max-h-[90vh] overflow-y-auto">
            <h2 className="font-semibold text-gray-800 mb-1">{t("orders.settleBill")}</h2>
            {settleTarget.guestTag && (
              <p className="text-xs text-violet-700 bg-violet-50 rounded px-2 py-1 mb-2 w-fit">
                {settleTarget.guestTag}
              </p>
            )}
            {settleTarget.table?.name && (
              <p className="text-xs text-gray-400 mb-3">
                {t("orders.tablePrefix", { name: settleTarget.table.name })} · {settleOrders.length} {plural(settleOrders.length, t("orders.openOrderOne"), t("orders.openOrderMany"))}
              </p>
            )}

            {settleOrders.length > 1 && !isPackageOrder(settleTarget) && (
              <div className="border border-gray-200 rounded-lg p-2 mb-3">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-1 pb-1">
                  {t("orders.selectOrdersCollect")}
                </p>
                {settleOrders.map(({ order, checked }) => (
                  <div key={order.id} className="border-b border-gray-50 last:border-0">
                    <label className="flex items-center gap-2 px-1 py-1.5 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSettleOrder(order.id)}
                        className="accent-blue-600"
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block truncate">{order.orderNumber}</span>
                        <span className="block text-[11px] text-gray-400">{tStatus(deriveStatus(order))}</span>
                      </span>
                      <span className="font-medium">{order.totalAmount} {t("orders.birr")}</span>
                    </label>
                    {/* Itemized breakdown so the cashier/waiter can verify every dish being billed. */}
                    <div className="ml-7 pb-1.5 text-xs text-gray-400 space-y-0.5">
                      {(order.items ?? []).map((it, itIdx: number) => (
                        <div key={it.id ?? itIdx}>
                          • {it.name} x{it.quantity} ({it.unitPrice} {t("orders.birr")})
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {isPackageOrder(settleTarget) ? (
              // Hospitality package billing: gross − entitlement coverage = net charge.
              <>
                <p className="text-sm text-gray-500 mb-2">
                  {settleTarget.totalAmount}
                  {settleTarget.packageDiscount > 0 && (
                    <> · Entitlement coverage: -{settleTarget.packageDiscount}</>
                  )}
                  <span className="block font-semibold text-gray-800">
                    Net charge: {Number(settleForm.amount)}
                  </span>
                </p>
                {policy?.defaultExcessSettlementMode === "FLEXIBLE" && (
                  <div className="flex gap-2 mb-3">
                    <button
                      onClick={() => setSettleForm({ ...settleForm, netChargeMode: "FOLIO" })}
                      className={`flex-1 rounded p-2 text-sm font-medium border ${
                        settleForm.netChargeMode === "FOLIO"
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-gray-200 text-gray-600"
                      }`}
                    >
                      Charge to Folio (DEFER_TO_FOLIO)
                    </button>
                    <button
                      onClick={() => setSettleForm({ ...settleForm, netChargeMode: "COLLECT_NOW" })}
                      className={`flex-1 rounded p-2 text-sm font-medium border ${
                        settleForm.netChargeMode === "COLLECT_NOW"
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-gray-200 text-gray-600"
                      }`}
                    >
                      Collect Now (PAY_NOW)
                    </button>
                  </div>
                )}
                <p className="text-xs text-gray-400 mb-3">
                  {settleForm.netChargeMode === "FOLIO"
                    ? "DEFER_TO_FOLIO — the itemized net charge is appended to the guest's room folio and settled at master checkout."
                    : "PAY_NOW — the net charge is collected at the terminal now and bypasses the room folio."}
                </p>
              </>
            ) : (
              (() => {
                const { tax, total } = settleBreakdown();
                return (
                  <>
                    {defaultOutputRate && (
                      <p className="text-sm text-gray-500 mb-1">
                        {t("orders.tax", { rate: defaultOutputRate.rate })}{" "}
                        <span className="font-semibold text-gray-800">
                          {tax.toFixed(2)} {t("orders.birr")}
                        </span>
                      </p>
                    )}
                    <p className="text-sm text-gray-500 mb-3">
                      {t("orders.totalCollect")}{" "}
                      <span className="font-bold text-gray-800">{total} {t("orders.birr")}</span>
                    </p>
                  </>
                );
              })()
            )}
            {/* A folio-deferred package charge collects nothing now, so there is
                no fiscal invoice to print for it. */}
            {!(isPackageOrder(settleTarget) && settleForm.netChargeMode === "FOLIO") && (
              <>
                {batchPrint === "printing" ? (
                  <p className="text-xs text-orange-600 mb-2">{t("orders.printingFiscal")}</p>
                ) : batchPrint === "done" ? (
                  <p className="text-xs text-green-600 mb-2">{t("orders.printedFiscal")}</p>
                ) : batchPrint === "error" ? (
                  <p className="text-xs text-red-600 mb-2">{t("orders.printFailedRetry")}</p>
                ) : null}
                <button
                  onClick={openBatchPreview}
                  disabled={batchPrint === "printing"}
                  className="text-xs bg-gray-800 text-white rounded px-2.5 py-1.5 font-medium mb-2 disabled:opacity-40"
                >
                  {t("orders.printFiscalInvoice")} (
                  {settleOrders.filter((s) => s.checked).length})
                </button>
              </>
            )}
            {batchPreview && (
              <FiscalPrintPreviewModal
                payload={batchPreview}
                onClose={() => setBatchPreview(null)}
                onConfirm={confirmBatchPrint}
                printing={batchPrint === "printing"}
              />
            )}
            {/* A folio-deferred package charge collects nothing at the POS, so the
                payment fields stay hidden until "Collect Now" is chosen. */}
            {(settleForm.netChargeMode === "COLLECT_NOW" || !isPackageOrder(settleTarget)) && (
              <>
                <select
                  value={settleForm.paymentMethodId}
                  onChange={(e) => setSettleForm({ ...settleForm, paymentMethodId: e.target.value })}
                  className="border border-gray-300 rounded p-2 text-sm w-full mb-2"
                  required
                >
                  <option value="">{t("orders.paymentMethod")}</option>
                  {paymentMethods.map((pm) => (
                    <option key={pm.id} value={pm.id}>{pm.name}</option>
                  ))}
                </select>
                {settleForm.paymentMethodId && (
                  <p className="text-xs text-gray-500 mb-2">
                    {t("orders.payTo", { account: paymentMethods.find((pm) => String(pm.id) === settleForm.paymentMethodId)?.account || "—" })}
                  </p>
                )}
                <input
                  type="number"
                  placeholder={t("orders.amount")}
                  value={settleForm.amount}
                  onChange={(e) => setSettleForm({ ...settleForm, amount: e.target.value })}
                  className="border border-gray-300 rounded p-2 text-sm w-full mb-2"
                  required
                />
                <input
                  placeholder={t("orders.transactionRef")}
                  value={settleForm.transactionReference}
                  onChange={(e) => setSettleForm({ ...settleForm, transactionReference: e.target.value })}
                  className="border border-gray-300 rounded p-2 text-sm w-full mb-3"
                />
              </>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setSettleTarget(null);
                  setSettleOrders([]);
                }}
                className="flex-1 bg-gray-200 text-gray-700 rounded p-2 text-sm"
              >
                {t("orders.cancel")}
              </button>
              <button onClick={submitSettle} className="flex-1 bg-green-600 text-white rounded p-2 text-sm font-medium">
                {isPackageOrder(settleTarget) && settleForm.netChargeMode === "FOLIO"
                  ? "Charge to Folio"
                  : t("orders.confirmPayment")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Order detail modal: items + chronological status timeline */}
      {detailOrder && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setDetailOrder(null)}
        >
          <div
            className="bg-white rounded-lg p-6 w-full max-w-md max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 mb-3">
              <div>
                <h2 className="font-semibold text-gray-800">{detailOrder.orderNumber}</h2>
                <p className="text-xs text-gray-400">
                  {formatTime(detailOrder.createdAt)}
                  {detailOrder.table?.name && ` · ${t("orders.tablePrefix", { name: detailOrder.table.name })}`}
                  {detailOrder.customerName && ` · ${detailOrder.customerName}`}
                </p>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${badge(deriveStatus(detailOrder))}`}>
                {tStatus(deriveStatus(detailOrder))}
              </span>
            </div>

            <div className="border border-gray-200 rounded-lg mb-4">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide px-3 pt-2 pb-1">
                {t("orders.itemsTitle")}
              </p>
              {(detailOrder.items ?? []).map(
                (it: { id?: number; name?: string; quantity?: number; status?: string; stationName?: string }, itIdx: number) => (
                  <div key={it.id ?? itIdx} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                    <span className="text-gray-700">{it.quantity}× {it.name}</span>
                    <span className="text-xs text-gray-400">
                      {tStatus(it.status ?? "")}
                      {it.stationName ? ` · ${it.stationName}` : ""}
                    </span>
                  </div>
                ),
              )}
              <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 text-sm font-semibold">
                <span>{t("orders.totalLabel")}</span>
                <span>{detailOrder.totalAmount} {t("orders.birr")}</span>
              </div>
            </div>

            {detailOrder.status === "PAID" && (
              <div className="mt-3">
                <FiscalPrintButton
                  target={{ kind: "order", id: detailOrder.id }}
                  fiscalStatus={detailOrder.fiscalStatus}
                  receipt={detailOrder.fiscalReceipt}
                  onUpdated={load}
                />
              </div>
            )}

            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">
              {t("orders.timeline")}
            </p>
            {(detailOrder.history ?? []).length > 0 ? (
              <ol className="space-y-2">
                {(detailOrder.history ?? []).map(
                  (h: { id?: number; status?: string; actorName?: string; createdAt?: string }, idx: number) => (
                    <li key={h.id ?? idx} className="flex items-start gap-2 text-sm">
                    <span className="mt-1.5 h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                    <div>
                      <p className="text-gray-700">
                        {tStatus(h.status ?? "")}
                        {h.actorName ? <span className="text-gray-400"> {t("orders.byActor", { name: h.actorName })}</span> : null}
                      </p>
                      <p className="text-xs text-gray-400">{formatTime(h.createdAt ?? "")}</p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-gray-400">{t("orders.historyNone")}</p>
            )}

            <div className="flex justify-end mt-4">
              <button
                onClick={() => setDetailOrder(null)}
                className="px-4 py-2 rounded bg-gray-200 text-gray-700 text-sm font-medium"
              >
                {t("orders.close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


