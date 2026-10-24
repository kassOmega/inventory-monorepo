"use client";

// PUBLIC guest-ordering page (no auth, no dashboard chrome). Opened by scanning a
// printed QR: /o/<token>. It talks ONLY to the /public/* API, scoped by the token.
import Button from "@/app/components/Button";
import CarWashBookingForm from "@/app/components/CarWashBookingForm";
import LanguageSwitcher from "@/app/components/LanguageSwitcher";
import Loading from "@/app/components/Loading";
import Modal from "@/app/components/Modal";
import PublicFooter from "@/app/components/PublicFooter";
import ReservationForm from "@/app/components/ReservationForm";
import ServiceBookingForm from "@/app/components/ServiceBookingForm";
import api from "@/lib/api";
import { fmtCurrency } from "@/lib/currency";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

interface PublicUnit {
  unitId: number;
  name: string;
  symbol: string | null;
  perBase: number;
  isBase: boolean;
  isDefaultSale: boolean;
  price: number;
}

interface PublicItem {
  ref: string;
  kind: string;
  name: string;
  description: string | null;
  price: number;
  category?: string | null;
  image?: string | null;
  units?: PublicUnit[];
  variants?: Array<{
    ref: string;
    name: string;
    price: number;
    image?: string | null;
    units?: PublicUnit[];
  }>;
  meta?: Record<string, unknown>;
}
interface EntryView {
  kind: string;
  serviceType: string | null;
  label: string;
  businessName: string;
  state: "LIVE" | "HELD" | "DROPPED";
  tableName: string | null;
  requiresProfile: boolean;
  showPrices: boolean;
  showBusinessInfo: boolean;
  businessAddress: string | null;
  businessPhone: string | null;
  items: PublicItem[];
  services: Array<{ key: string; label: string; items: PublicItem[] }>;
}
interface CartEntry {
  ref: string;
  unitId: number | null;
  qty: number;
}
type Cart = Record<string, CartEntry>;

const lineKey = (ref: string, unitId: number | null) =>
  unitId == null ? ref : `${ref}::${unitId}`;

/** The unit a line uses when the guest has not picked one yet. */
const defaultUnitFor = (
  item: { units?: PublicUnit[] } | null | undefined,
): PublicUnit | null => {
  const units = item?.units ?? [];
  return (
    units.find((unit) => unit.isDefaultSale) ??
    units.find((unit) => unit.isBase) ??
    units[0] ??
    null
  );
};

export default function PublicOrderPage() {
  const { t } = useTranslation();
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [entry, setEntry] = useState<EntryView | null>(null);
  const [cart, setCart] = useState<Cart>({});
  // Per-item selected unit (ref -> unitId). Defaults to the product's default
  // sale unit so legacy products without an explicit choice keep working.
  const [unitChoice, setUnitChoice] = useState<Record<string, number>>({});
  // Public catalog filters.
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [identityMode, setIdentityMode] = useState<"TABLE" | "PHONE">("TABLE");
  const [tableNumber, setTableNumber] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [orderToken, setOrderToken] = useState<string | null>(null);
  const [orderStatus, setOrderStatus] = useState<string>("");
  // Active service tab when the business offers multiple services.
  const [tab, setTab] = useState<string>("");
  // Checkout step: collect name/phone AFTER the guest picks their items.
  const [profileOpen, setProfileOpen] = useState(false);
  const [carwashOptions, setCarwashOptions] = useState<any>(null);
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [bookingDone, setBookingDone] = useState<{
    kind: "CARWASH" | "ROOM" | "SERVICE";
    data: any;
  } | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const r = await api.get(`/public/entry/${token}`);
      setEntry(r.data);
      if (r.data?.kind === "CARWASH_BAY") {
        const cw = await api.get(`/public/entry/${token}/carwash-options`);
        setCarwashOptions(cw.data);
      }
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "This link is not available");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-select the first service tab; prefill the table number from the token.
  useEffect(() => {
    if (entry?.tableName) setTableNumber(entry.tableName);
    if (entry?.services?.length && !tab) setTab(entry.services[0].key);
  }, [entry, tab]);

  // Phone autofill (best-effort; works for take-away and other profile flows).
  const autofill = async () => {
    if (!phone || phone.length < 7) return;
    try {
      const r = await api.post(`/public/entry/${token}/customer-lookup`, {
        phone,
      });
      if (r.data?.name && !name) setName(r.data.name);
    } catch {
      // best-effort
    }
  };

  const itemsByRef = useMemo(() => {
    const all = (entry?.items ?? []).concat(
      entry?.services?.flatMap((s) => s.items) ?? [],
    );
    const map = new Map<string, PublicItem>();
    for (const item of all) {
      map.set(item.ref, item);
      // Index every selectable variant ref too, mirroring the backend catalogMap,
      // so adding a variant resolves to a cart line (and a valid submit ref).
      for (const v of item.variants ?? []) {
        map.set(v.ref, {
          ...item,
          ref: v.ref,
          name: v.name,
          price: v.price,
          image: v.image,
          units: v.units ?? item.units,
          variants: undefined,
        });
      }
    }
    return map;
  }, [entry]);
  // Items to show: the active service tab when tabbed, else the flat catalog.
  const visibleItems = useMemo(() => {
    if (entry?.services?.length) {
      return (
        entry.services.find((s) => s.key === tab)?.items ??
        entry.services[0].items
      );
    }
    return entry?.items ?? [];
  }, [entry, tab]);

  // Public catalog filters: category chips + free-text search.
  const categories = useMemo(() => {
    const found = new Set<string>();
    for (const item of visibleItems) {
      if (item.category) found.add(item.category);
    }
    return [...found];
  }, [visibleItems]);
  const activeCategory = categories.includes(categoryFilter)
    ? categoryFilter
    : "";
  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return visibleItems.filter((item) => {
      if (activeCategory && item.category !== activeCategory) return false;
      if (!query) return true;
      return (
        item.name.toLowerCase().includes(query) ||
        (item.description ?? "").toLowerCase().includes(query)
      );
    });
  }, [visibleItems, activeCategory, search]);

  const isCarwash = entry?.kind === "CARWASH_BAY";
  const isAccommodation =
    entry?.kind === "HOTEL" || entry?.serviceType === "ACCOMMODATION";
  const isService = entry?.kind === "SERVICE";
  const isFnb =
    entry?.kind === "TABLE" || entry?.serviceType === "FOOD_AND_BEVERAGE";
  const isCart = !isCarwash && !isAccommodation && !isService;

  /** The unit currently selected for an item/variant ref. */
  const unitFor = (ref: string): PublicUnit | null => {
    const item = itemsByRef.get(ref);
    const units = item?.units ?? [];
    return (
      units.find((unit) => unit.unitId === unitChoice[ref]) ??
      defaultUnitFor(item)
    );
  };
  const qtyFor = (ref: string) => {
    const unit = unitFor(ref);
    return cart[lineKey(ref, unit?.unitId ?? null)]?.qty ?? 0;
  };

  const cartLines = Object.values(cart)
    .filter((line) => line.qty > 0)
    .map((line) => {
      const item = itemsByRef.get(line.ref);
      if (!item) return null;
      const unit =
        (item.units ?? []).find((u) => u.unitId === line.unitId) ?? null;
      return {
        ...line,
        item,
        unit,
        unitPrice: unit ? unit.price : item.price,
      };
    })
    .filter((line): line is NonNullable<typeof line> => line !== null);
  const total = cartLines.reduce(
    (sum, line) => sum + line.unitPrice * line.qty,
    0,
  );

  const add = (ref: string) => {
    const unit = unitFor(ref);
    const key = lineKey(ref, unit?.unitId ?? null);
    setCart((current) => ({
      ...current,
      [key]: {
        ref,
        unitId: unit?.unitId ?? null,
        qty: (current[key]?.qty ?? 0) + 1,
      },
    }));
  };
  const sub = (ref: string) => {
    const unit = unitFor(ref);
    const key = lineKey(ref, unit?.unitId ?? null);
    setCart((current) => {
      const line = current[key];
      if (!line) return current;
      const next = { ...current };
      if (line.qty <= 1) delete next[key];
      else next[key] = { ...line, qty: line.qty - 1 };
      return next;
    });
  };
  // Switching unit moves the quantity the guest already picked onto the new
  // unit, so the line they see keeps its count.
  const setUnit = (ref: string, unitId: number) => {
    const item = itemsByRef.get(ref);
    if (!item?.units?.length) return;
    const previousUnit = unitFor(ref);
    const previousKey = lineKey(ref, previousUnit?.unitId ?? null);
    const nextKey = lineKey(ref, unitId);
    setUnitChoice((current) => ({ ...current, [ref]: unitId }));
    setCart((current) => {
      const qty = current[previousKey]?.qty ?? 0;
      if (!qty || previousKey === nextKey) return current;
      const next = { ...current };
      delete next[previousKey];
      next[nextKey] = {
        ref,
        unitId,
        qty: (next[nextKey]?.qty ?? 0) + qty,
      };
      return next;
    });
  };

  const submit = async () => {
    if (cartLines.length === 0) return;
    if (isFnb && identityMode === "TABLE" && !tableNumber.trim()) {
      setError(t("public.tableRequired"));
      return;
    }
    if (isFnb && identityMode === "PHONE" && !phone.trim()) {
      setError(t("public.phoneRequired"));
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const r = await api.post(`/public/entry/${token}/orders`, {
        items: cartLines.map((line) => ({
          ref: line.item.ref,
          quantity: line.qty,
          ...(line.unitId != null ? { unitId: line.unitId } : {}),
        })),
        ...(isFnb
          ? {
              identityMode,
              tableNumber:
                identityMode === "TABLE"
                  ? tableNumber.trim() || undefined
                  : undefined,
              customerName:
                identityMode === "PHONE" ? name.trim() || undefined : undefined,
              customerPhone:
                identityMode === "PHONE"
                  ? phone.trim() || undefined
                  : undefined,
            }
          : {
              customerName: entry?.requiresProfile
                ? name.trim() || undefined
                : undefined,
              customerPhone: entry?.requiresProfile
                ? phone.trim() || undefined
                : undefined,
            }),
        note: note.trim() || undefined,
      });
      setOrderToken(r.data.token);
      setOrderStatus(r.data.status);
      setProfileOpen(false);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not submit");
    } finally {
      setSubmitting(false);
    }
  };

  // F&B captures identity inline (table or phone); other cart entries open the
  // profile step when they require a name/phone.
  const requestSubmit = () => {
    if (cartLines.length === 0) return;
    if (isFnb) {
      submit();
      return;
    }
    if (entry?.requiresProfile) {
      setProfileOpen(true);
      return;
    }
    submit();
  };

  const checkCarwashAvailability = async (
    washerId: string,
    startsAt: string,
    vehicleType: string,
    washTypeId: string,
  ) => {
    const r = await api.get(
      `/public/entry/${token}/carwash-availability?washerId=${washerId}&startsAt=${encodeURIComponent(startsAt)}&vehicleType=${encodeURIComponent(vehicleType)}&washTypeId=${washTypeId}`,
    );
    return { available: !!r.data?.available };
  };

  const lookupPublicCustomer = async (phone: string) => {
    try {
      const r = await api.post(`/public/entry/${token}/customer-lookup`, {
        phone,
      });
      return r.data?.name ? { id: "", name: r.data.name } : null;
    } catch {
      return null;
    }
  };

  const submitCarwashBooking = async (payload: any) => {
    setBookingSubmitting(true);
    setError("");
    try {
      const r = await api.post(`/public/entry/${token}/carwash-bookings`, {
        name: payload.name ?? payload.customerName,
        phone: payload.phone ?? payload.customerPhone,
        washerId: payload.washerId ? Number(payload.washerId) : null,
        startsAt: payload.startsAt,
        notes: payload.notes,
        items: (payload.items ?? []).map((it: any) => ({
          vehicleType: it.vehicleType,
          plateNumber: it.plateNumber,
          washTypeId: it.washTypeId ? Number(it.washTypeId) : null,
          washerId: it.washerId ? Number(it.washerId) : null,
          amount: Number(it.amount) || 0,
          startsAt: it.startsAt,
        })),
      });
      setBookingDone({ kind: "CARWASH", data: r.data });
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not submit booking");
    } finally {
      setBookingSubmitting(false);
    }
  };

  const fetchPublicRoomAvailability = async (
    checkIn: string,
    checkOut: string,
  ) => {
    const r = await api.get(
      `/public/entry/${token}/room-availability?checkIn=${checkIn}&checkOut=${checkOut}`,
    );
    return {
      totalAvailable: r.data?.totalAvailable ?? 0,
      roomTypes: r.data?.roomTypes ?? [],
    };
  };

  const submitRoomReservation = async (payload: any) => {
    setBookingSubmitting(true);
    setError("");
    try {
      const r = await api.post(`/public/entry/${token}/reservations`, payload);
      setBookingDone({ kind: "ROOM", data: r.data });
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not submit reservation");
    } finally {
      setBookingSubmitting(false);
    }
  };

  const submitServiceBooking = async (payload: any) => {
    setBookingSubmitting(true);
    setError("");
    try {
      const r = await api.post(
        `/public/entry/${token}/service-bookings`,
        payload,
      );
      setBookingDone({ kind: "SERVICE", data: r.data });
    } catch (e: any) {
      setError(e?.response?.data?.message ?? "Could not submit booking");
    } finally {
      setBookingSubmitting(false);
    }
  };

  // Poll the order status after submit.
  useEffect(() => {
    if (!orderToken) return;
    const id = setInterval(async () => {
      try {
        const r = await api.get(`/public/orders/${orderToken}`);
        setOrderStatus(r.data.status);
      } catch {
        // ignore
      }
    }, 5000);
    return () => clearInterval(id);
  }, [orderToken]);

  if (loading) return <Loading className="py-24" />;

  if (error && !entry) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-6">
        <div className="bg-white rounded-xl border p-6 max-w-sm text-center">
          <p className="text-3xl mb-2">🔒</p>
          <p className="text-gray-700">{error}</p>
        </div>
      </div>
    );
  }

  if (entry && entry.state !== "LIVE") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-6">
        <div className="bg-white rounded-xl border p-6 max-w-sm text-center">
          <p className="text-3xl mb-2">⏳</p>
          <p className="font-semibold text-gray-800">{entry.businessName}</p>
          <p className="text-sm text-gray-500 mt-1">
            {entry.state === "HELD"
              ? t("public.temporarilyUnavailable")
              : t("public.closed")}
          </p>
        </div>
      </div>
    );
  }

  if (orderToken) {
    return (
      <div className="min-h-screen bg-gray-100 p-6">
        <div className="mx-auto max-w-md bg-white rounded-xl border p-6 text-center space-y-3">
          <p className="text-3xl">✅</p>
          <p className="font-semibold text-gray-800">{t("public.orderSent")}</p>
          <p className="text-sm text-gray-500">
            {t("public.status")}:{" "}
            <span className="font-medium text-gray-700">
              {t(`public.status_${orderStatus}`, { defaultValue: orderStatus })}
            </span>
          </p>
          <p className="text-xs text-gray-400">{t("public.waitHint")}</p>
        </div>
      </div>
    );
  }

  if (bookingDone) {
    const isCarwashBooking = bookingDone.kind === "CARWASH";
    return (
      <div className="min-h-screen bg-gray-100">
        <header className="bg-white border-b px-4 py-3 flex justify-end">
          <LanguageSwitcher variant="light" />
        </header>
        <div className="mx-auto max-w-md px-4 pt-6">
          <div className="bg-white rounded-xl border p-6 text-center space-y-3">
            <p className="text-3xl">✅</p>
            <p className="font-semibold text-gray-800">
              {isCarwashBooking
                ? t("carwash.bookingSent")
                : t("public.bookingSent")}
            </p>
            <p className="text-sm text-gray-500">
              {isCarwashBooking
                ? t("carwash.bookingWaitHint")
                : t("public.bookingWaitHint")}
            </p>
          </div>
        </div>
        <PublicFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white border-b px-4 py-3 sticky top-0 z-10">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {entry?.showBusinessInfo ? (
              <>
                <p className="font-semibold text-gray-800">
                  {entry?.businessName}
                </p>
                {entry?.businessAddress && (
                  <p className="text-xs text-gray-500">
                    {entry.businessAddress}
                  </p>
                )}
                {entry?.businessPhone && (
                  <p className="text-xs text-gray-500">
                    {entry.businessPhone}
                  </p>
                )}
              </>
            ) : (
              <p className="font-semibold text-gray-800">
                {t("public.orderHere")}
              </p>
            )}
            {entry?.label && (
              <p className="text-xs text-gray-400">{entry.label}</p>
            )}
          </div>
          <LanguageSwitcher variant="light" className="shrink-0" />
        </div>
      </header>

      {error && (
        <div className="mx-4 mt-3 bg-red-50 text-red-600 p-3 rounded text-sm">
          {error}
        </div>
      )}

      {isCarwash && (
        <div className="mx-auto max-w-md p-4">
          <div className="bg-white rounded-xl border p-4">
            {carwashOptions ? (
              <CarWashBookingForm
                mode="public"
                vehicleTypes={carwashOptions.vehicleTypes ?? []}
                washTypes={(carwashOptions.washTypes ?? []).map((w: any) => ({
                  id: w.id,
                  name: w.name,
                }))}
                prices={carwashOptions.prices ?? []}
                washers={(carwashOptions.washers ?? []).map((w: any) => ({
                  id: w.id,
                  name: w.name,
                }))}
                showPrices={carwashOptions.showPrices}
                onLookupCustomer={lookupPublicCustomer}
                onCheckAvailability={checkCarwashAvailability}
                onSubmit={submitCarwashBooking}
                submitting={bookingSubmitting}
              />
            ) : (
              <Loading className="py-12" />
            )}
          </div>
        </div>
      )}

      {isAccommodation && (
        <div className="mx-auto max-w-md p-4">
          <div className="bg-white rounded-xl border p-4">
            <ReservationForm
              mode="public"
              roomTypes={visibleItems.map((it) => ({
                ref: it.ref,
                name: it.name,
                price: it.price,
                description: it.description,
                image: it.image ?? null,
                meta: it.meta,
              }))}
              onFetchAvailability={fetchPublicRoomAvailability}
              onSubmit={submitRoomReservation}
              submitting={bookingSubmitting}
            />
          </div>
        </div>
      )}

      {isService && (
        <div className="mx-auto max-w-md p-4">
          <div className="bg-white rounded-xl border p-4">
            <ServiceBookingForm
              mode="public"
              items={visibleItems.map((it) => ({
                ref: it.ref,
                name: it.name,
                price: it.price,
                description: it.description,
              }))}
              onSubmit={submitServiceBooking}
              submitting={bookingSubmitting}
            />
          </div>
        </div>
      )}

      {isCart && (
        <div className="mx-auto max-w-md p-4 space-y-2">
          {/* Service tabs (legacy multi-service hospitality). */}
          {entry?.services && entry.services.length > 1 && (
            <div className="flex gap-1 overflow-x-auto pb-1">
              {entry.services.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setTab(s.key)}
                  className={
                    "px-3 py-1.5 rounded-full text-sm whitespace-nowrap " +
                    (tab === s.key
                      ? "bg-blue-600 text-white"
                      : "bg-white text-gray-600 border")
                  }
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {/* F&B identity: dine-in (table) or take-away (phone). */}
          {isFnb && (
            <div className="bg-white rounded-xl border p-3 space-y-3">
              <div className="flex gap-2">
                <button
                  onClick={() => setIdentityMode("TABLE")}
                  className={
                    "px-3 py-1.5 rounded-full text-sm " +
                    (identityMode === "TABLE"
                      ? "bg-blue-600 text-white"
                      : "bg-white text-gray-600 border")
                  }
                >
                  {t("public.dineIn")}
                </button>
                <button
                  onClick={() => setIdentityMode("PHONE")}
                  className={
                    "px-3 py-1.5 rounded-full text-sm " +
                    (identityMode === "PHONE"
                      ? "bg-blue-600 text-white"
                      : "bg-white text-gray-600 border")
                  }
                >
                  {t("public.takeAway")}
                </button>
              </div>

              {identityMode === "TABLE" ? (
                <label className="block text-xs font-medium text-gray-500">
                  {t("public.tableNumber")}
                  <input
                    value={tableNumber}
                    onChange={(e) => setTableNumber(e.target.value)}
                    placeholder={t("public.tableNumber")}
                    className="mt-1 border border-gray-300 rounded-lg p-2 text-sm w-full"
                  />
                </label>
              ) : (
                <>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    onBlur={autofill}
                    placeholder={t("public.phone")}
                    className="border border-gray-300 rounded-lg p-2 text-sm w-full"
                    inputMode="tel"
                  />
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("public.name")}
                    className="border border-gray-300 rounded-lg p-2 text-sm w-full"
                  />
                </>
              )}
            </div>
          )}

          {/* Catalog filters: search + category chips. */}
          <div className="bg-white rounded-xl border p-2 space-y-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("public.searchPlaceholder")}
              className="border border-gray-300 rounded-lg p-2 text-sm w-full"
              inputMode="search"
            />
            {categories.length > 0 && (
              <div className="flex gap-1 overflow-x-auto pb-1">
                <button
                  onClick={() => setCategoryFilter("")}
                  className={
                    "px-3 py-1.5 rounded-full text-sm whitespace-nowrap " +
                    (!activeCategory
                      ? "bg-blue-600 text-white"
                      : "bg-white text-gray-600 border")
                  }
                >
                  {t("public.allCategories")}
                </button>
                {categories.map((category) => (
                  <button
                    key={category}
                    onClick={() => setCategoryFilter(category)}
                    className={
                      "px-3 py-1.5 rounded-full text-sm whitespace-nowrap " +
                      (activeCategory === category
                        ? "bg-blue-600 text-white"
                        : "bg-white text-gray-600 border")
                    }
                  >
                    {category}
                  </button>
                ))}
              </div>
            )}
          </div>

          {filteredItems.map((it) => (
            <ItemCard
              key={it.ref}
              item={it}
              qtyFor={qtyFor}
              add={add}
              sub={sub}
              setUnit={setUnit}
              unitChoice={unitChoice}
              t={t}
              showPrices={entry?.showPrices ?? false}
            />
          ))}
          {filteredItems.length === 0 && (
            <p className="text-center text-gray-400 text-sm py-10">
              {search.trim() || activeCategory
                ? t("public.noResults")
                : t("public.empty")}
            </p>
          )}

          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("public.note")}
            className="border border-gray-300 rounded-lg p-2 text-sm w-full bg-white"
          />
        </div>
      )}

      {entry?.kind === "SHOP" && (
        <Modal
          isOpen={profileOpen}
          onClose={() => setProfileOpen(false)}
          title={t("public.profileTitle")}
          size="sm"
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-500">{t("public.profileHint")}</p>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={autofill}
              placeholder={t("public.phone")}
              className="border border-gray-300 rounded-lg p-2 text-sm w-full"
              inputMode="tel"
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("public.name")}
              className="border border-gray-300 rounded-lg p-2 text-sm w-full"
            />
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setProfileOpen(false)}
                className="px-3 py-2 text-sm text-gray-600"
              >
                {t("common.cancel")}
              </button>
              <Button
                loading={submitting}
                disabled={!phone.trim() && !name.trim()}
                onClick={submit}
              >
                {t("public.confirmOrder")}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {isCart && cartLines.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-3">
          <div className="mx-auto max-w-md space-y-2">
            {/* Read-only summary so guests see each selected line (incl. variants). */}
            <div className="max-h-40 overflow-y-auto space-y-1">
              {cartLines.map((line) => (
                <div
                  key={`${line.ref}|${line.unitId ?? ""}`}
                  className="flex items-center justify-between gap-3 text-sm text-gray-700"
                >
                  <span className="min-w-0 truncate">
                    {line.item.name}
                    {line.unit ? (
                      <span className="text-gray-500"> · {line.unit.name}</span>
                    ) : null}{" "}
                    <span className="text-gray-400">× {line.qty}</span>
                  </span>
                  {entry?.showPrices && (
                    <span className="font-medium whitespace-nowrap">
                      {fmtCurrency(line.unitPrice * line.qty)}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3">
              {entry?.showPrices && (
                <span className="text-sm font-semibold text-gray-800">
                  {t("public.total")}: {fmtCurrency(total)}
                </span>
              )}
              <Button
                loading={submitting}
                onClick={requestSubmit}
                className="!px-5"
              >
                {t("public.placeOrder")}
              </Button>
            </div>
          </div>
        </div>
      )}

      <PublicFooter />
    </div>
  );
}

/** Item thumbnail (module-scope so it is not re-created on every render). */
function Thumb({ src }: { src?: string | null }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className="w-12 h-12 rounded-lg object-cover bg-gray-100 shrink-0"
    />
  ) : (
    <div className="w-12 h-12 rounded-lg bg-gray-100 shrink-0" />
  );
}

/** Add/remove quantity control for the unit currently selected on a line. */
function Qty({
  qty,
  add,
  sub,
  t,
}: {
  qty: number;
  add: () => void;
  sub: () => void;
  t: (k: string, o?: Record<string, unknown>) => string;
}) {
  if (qty > 0) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={sub}
          className="w-7 h-7 rounded-full border text-gray-600"
        >
          −
        </button>
        <span className="w-5 text-center text-sm">{qty}</span>
        <button
          onClick={add}
          className="w-7 h-7 rounded-full bg-blue-600 text-white"
        >
          +
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={add}
      className="bg-blue-600 text-white rounded-lg px-3 py-1.5 text-sm"
    >
      {t("public.add")}
    </button>
  );
}

/** Compact unit picker; each option shows that unit's own price. */
function UnitSelect({
  units,
  value,
  onChange,
  showPrices,
}: {
  units: PublicUnit[];
  value: number | null | undefined;
  onChange: (unitId: number) => void;
  showPrices: boolean;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(Number(e.target.value))}
      onClick={(e) => e.stopPropagation()}
      className="max-w-32 rounded-lg border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-700"
    >
      {units.map((unit) => (
        <option key={unit.unitId} value={unit.unitId}>
          {unit.name}
          {showPrices ? ` · ${fmtCurrency(unit.price)}` : ""}
        </option>
      ))}
    </select>
  );
}

/** One catalog line: image + name/price; products with variants expand. */
function ItemCard({
  item,
  qtyFor,
  add,
  sub,
  setUnit,
  unitChoice,
  t,
  showPrices,
}: {
  item: PublicItem;
  qtyFor: (ref: string) => number;
  add: (ref: string) => void;
  sub: (ref: string) => void;
  setUnit: (ref: string, unitId: number) => void;
  unitChoice: Record<string, number>;
  t: (k: string, o?: Record<string, unknown>) => string;
  showPrices: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasVariants = (item.variants?.length ?? 0) > 0;
  const unit =
    (item.units ?? []).find((u) => u.unitId === unitChoice[item.ref]) ??
    defaultUnitFor(item);
  const hasUnitChoice = (item.units?.length ?? 0) > 1;
  const displayPrice = hasVariants
    ? item.price
    : unit
      ? unit.price
      : item.price;

  return (
    <div className="bg-white rounded-xl border p-3">
      <div
        className={
          "flex items-center gap-3" + (hasVariants ? " cursor-pointer" : "")
        }
        onClick={hasVariants ? () => setOpen((v) => !v) : undefined}
        role={hasVariants ? "button" : undefined}
        tabIndex={hasVariants ? 0 : undefined}
        aria-expanded={hasVariants ? open : undefined}
        onKeyDown={
          hasVariants
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen((v) => !v);
                }
              }
            : undefined
        }
      >
        <Thumb src={item.image} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-800 truncate">
            {item.name}
          </p>
          {item.description && (
            <p className="text-xs text-gray-400 line-clamp-2">
              {item.description}
            </p>
          )}
          {(showPrices || (!hasVariants && hasUnitChoice)) && (
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              {showPrices && (
                <p className="text-sm text-gray-700">
                  {hasVariants ? `${t("public.from")} ` : ""}
                  {fmtCurrency(displayPrice)}
                  {item.meta?.availableCount != null && (
                    <span className="ml-2 text-[11px] text-emerald-600">
                      {t("public.roomsFree", {
                        count: item.meta.availableCount as number,
                      })}
                    </span>
                  )}
                </p>
              )}
              {!hasVariants && hasUnitChoice && (
                <UnitSelect
                  units={item.units!}
                  value={unit?.unitId}
                  onChange={(unitId) => setUnit(item.ref, unitId)}
                  showPrices={showPrices}
                />
              )}
            </div>
          )}
        </div>
        {hasVariants ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
            className="text-sm text-blue-600 whitespace-nowrap"
          >
            {open ? t("public.hideVariants") : t("public.variants")}
          </button>
        ) : (
          <Qty
            qty={qtyFor(item.ref)}
            add={() => add(item.ref)}
            sub={() => sub(item.ref)}
            t={t}
          />
        )}
      </div>

      {hasVariants && open && (
        <ul className="mt-2 divide-y divide-gray-100 border-t pt-1">
          {item.variants!.map((v) => {
            const variantUnit =
              (v.units ?? []).find(
                (u) => u.unitId === unitChoice[v.ref],
              ) ?? defaultUnitFor(v);
            const variantHasUnitChoice = (v.units?.length ?? 0) > 1;
            const variantPrice = variantUnit ? variantUnit.price : v.price;
            return (
              <li key={v.ref} className="flex items-center gap-2 py-2">
                <Thumb src={v.image} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-700 truncate">{v.name}</p>
                  {(showPrices || variantHasUnitChoice) && (
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      {showPrices && (
                        <span className="text-xs text-gray-500">
                          {fmtCurrency(variantPrice)}
                        </span>
                      )}
                      {variantHasUnitChoice && (
                        <UnitSelect
                          units={v.units!}
                          value={variantUnit?.unitId}
                          onChange={(unitId) => setUnit(v.ref, unitId)}
                          showPrices={showPrices}
                        />
                      )}
                    </div>
                  )}
                </div>
                <Qty
                  qty={qtyFor(v.ref)}
                  add={() => add(v.ref)}
                  sub={() => sub(v.ref)}
                  t={t}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
