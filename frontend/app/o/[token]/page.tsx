"use client";

// PUBLIC guest-ordering page (no auth, no dashboard chrome). Opened by scanning a
// printed QR: /o/<token>. It talks ONLY to the /public/* API, scoped by the token.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import api from "@/lib/api";
import Loading from "@/app/components/Loading";
import Button from "@/app/components/Button";
import Modal from "@/app/components/Modal";
import CarWashBookingForm from "@/app/components/CarWashBookingForm";
import ReservationForm from "@/app/components/ReservationForm";
import ServiceBookingForm from "@/app/components/ServiceBookingForm";

interface PublicItem {
  ref: string;
  kind: string;
  name: string;
  description: string | null;
  price: number;
  image?: string | null;
  variants?: Array<{ ref: string; name: string; price: number; image?: string | null }>;
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
type Cart = Record<string, number>;

export default function PublicOrderPage() {
  const { t } = useTranslation();
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [entry, setEntry] = useState<EntryView | null>(null);
  const [cart, setCart] = useState<Cart>({});
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
      const r = await api.post(`/public/entry/${token}/customer-lookup`, { phone });
      if (r.data?.name && !name) setName(r.data.name);
    } catch {
      // best-effort
    }
  };

  const itemsByRef = useMemo(() => {
    const all = (entry?.items ?? []).concat(entry?.services?.flatMap((s) => s.items) ?? []);
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
          variants: undefined,
        });
      }
    }
    return map;
  }, [entry]);
  // Items to show: the active service tab when tabbed, else the flat catalog.
  const visibleItems = useMemo(() => {
    if (entry?.services?.length) {
      return entry.services.find((s) => s.key === tab)?.items ?? entry.services[0].items;
    }
    return entry?.items ?? [];
  }, [entry, tab]);

  const isCarwash = entry?.kind === "CARWASH_BAY";
  const isAccommodation =
    entry?.kind === "HOTEL" || entry?.serviceType === "ACCOMMODATION";
  const isService = entry?.kind === "SERVICE";
  const isFnb =
    entry?.kind === "TABLE" || entry?.serviceType === "FOOD_AND_BEVERAGE";
  const isCart = !isCarwash && !isAccommodation && !isService;

  const cartLines = Object.entries(cart)
    .filter(([, q]) => q > 0)
    .map(([ref, q]) => ({ item: itemsByRef.get(ref), qty: q }))
    .filter((l) => l.item);
  const total = cartLines.reduce((s, l) => s + (l.item!.price * l.qty), 0);

  const add = (ref: string) => setCart((c) => ({ ...c, [ref]: (c[ref] ?? 0) + 1 }));
  const sub = (ref: string) =>
    setCart((c) => ({ ...c, [ref]: Math.max(0, (c[ref] ?? 0) - 1) }));

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
        items: cartLines.map((l) => ({ ref: l.item!.ref, quantity: l.qty })),
        ...(isFnb
          ? {
              identityMode,
              tableNumber:
                identityMode === "TABLE" ? tableNumber.trim() || undefined : undefined,
              customerName:
                identityMode === "PHONE" ? name.trim() || undefined : undefined,
              customerPhone:
                identityMode === "PHONE" ? phone.trim() || undefined : undefined,
            }
          : {
              customerName: entry?.requiresProfile ? name.trim() || undefined : undefined,
              customerPhone: entry?.requiresProfile ? phone.trim() || undefined : undefined,
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
      const r = await api.post(`/public/entry/${token}/service-bookings`, payload);
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
      <div className="min-h-screen bg-gray-100 p-6">
        <div className="mx-auto max-w-md bg-white rounded-xl border p-6 text-center space-y-3">
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
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 pb-32">
      <header className="bg-white border-b px-4 py-3 sticky top-0 z-10">
        {entry?.showBusinessInfo ? (
          <>
            <p className="font-semibold text-gray-800">{entry?.businessName}</p>
            {entry?.businessAddress && (
              <p className="text-xs text-gray-500">{entry.businessAddress}</p>
            )}
            {entry?.businessPhone && (
              <p className="text-xs text-gray-500">{entry.businessPhone}</p>
            )}
          </>
        ) : (
          <p className="font-semibold text-gray-800">{t("public.orderHere")}</p>
        )}
        {entry?.label && <p className="text-xs text-gray-400">{entry.label}</p>}
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

          {visibleItems.map((it) => (
            <ItemCard
              key={it.ref}
              item={it}
              cart={cart}
              add={add}
              sub={sub}
              t={t}
              showPrices={entry?.showPrices ?? false}
            />
          ))}
          {visibleItems.length === 0 && (
            <p className="text-center text-gray-400 text-sm py-10">{t("public.empty")}</p>
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
              {cartLines.map((l) => (
                <div
                  key={l.item!.ref}
                  className="flex items-center justify-between gap-3 text-sm text-gray-700"
                >
                  <span className="min-w-0 truncate">
                    {l.item!.name} <span className="text-gray-400">× {l.qty}</span>
                  </span>
                  {entry?.showPrices && (
                    <span className="font-medium whitespace-nowrap">
                      {(l.item!.price * l.qty).toLocaleString()}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3">
              {entry?.showPrices && (
                <span className="text-sm font-semibold text-gray-800">
                  {t("public.total")}: {total.toLocaleString()}
                </span>
              )}
              <Button loading={submitting} onClick={requestSubmit} className="!px-5">
                {t("public.placeOrder")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Item thumbnail (module-scope so it is not re-created on every render). */
function Thumb({ src }: { src?: string | null }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="w-12 h-12 rounded-lg object-cover bg-gray-100 shrink-0" />
  ) : (
    <div className="w-12 h-12 rounded-lg bg-gray-100 shrink-0" />
  );
}

/** Add/remove quantity control (module-scope; `code` is the item/variant ref). */
function Qty({
  code,
  cart,
  add,
  sub,
  t,
}: {
  code: string;
  cart: Cart;
  add: (ref: string) => void;
  sub: (ref: string) => void;
  t: (k: string, o?: Record<string, unknown>) => string;
}) {
  if (cart[code]) {
    return (
      <div className="flex items-center gap-2">
        <button onClick={() => sub(code)} className="w-7 h-7 rounded-full border text-gray-600">−</button>
        <span className="w-5 text-center text-sm">{cart[code]}</span>
        <button onClick={() => add(code)} className="w-7 h-7 rounded-full bg-blue-600 text-white">+</button>
      </div>
    );
  }
  return (
    <button onClick={() => add(code)} className="bg-blue-600 text-white rounded-lg px-3 py-1.5 text-sm">
      {t("public.add")}
    </button>
  );
}

/** One catalog line: image + name/price; products with variants expand. */
function ItemCard({
  item,
  cart,
  add,
  sub,
  t,
  showPrices,
}: {
  item: PublicItem;
  cart: Cart;
  add: (ref: string) => void;
  sub: (ref: string) => void;
  t: (k: string, o?: Record<string, unknown>) => string;
  showPrices: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasVariants = (item.variants?.length ?? 0) > 0;

  return (
    <div className="bg-white rounded-xl border p-3">
      <div
        className={"flex items-center gap-3" + (hasVariants ? " cursor-pointer" : "")}
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
          <p className="text-sm font-medium text-gray-800 truncate">{item.name}</p>
          {item.description && (
            <p className="text-xs text-gray-400 line-clamp-2">{item.description}</p>
          )}
          {showPrices && (
            <p className="text-sm text-gray-700 mt-0.5">
              {hasVariants ? `${t("public.from")} ` : ""}
              {item.price.toLocaleString()}
              {item.meta?.availableCount != null && (
                <span className="ml-2 text-[11px] text-emerald-600">
                  {t("public.roomsFree", { count: item.meta.availableCount as number })}
                </span>
              )}
            </p>
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
          <Qty code={item.ref} cart={cart} add={add} sub={sub} t={t} />
        )}
      </div>

      {hasVariants && open && (
        <ul className="mt-2 divide-y divide-gray-100 border-t pt-1">
          {item.variants!.map((v) => (
            <li key={v.ref} className="flex items-center gap-2 py-2">
              <Thumb src={v.image} />
              <span className="min-w-0 flex-1 text-sm text-gray-700 truncate">{v.name}</span>
              {showPrices && <span className="text-sm text-gray-600">{v.price.toLocaleString()}</span>}
              <Qty code={v.ref} cart={cart} add={add} sub={sub} t={t} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
