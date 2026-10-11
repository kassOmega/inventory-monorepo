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

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const r = await api.get(`/public/entry/${token}`);
      setEntry(r.data);
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

  // Phone autofill (skipped for F&B on a table).
  const autofill = async () => {
    if (!entry?.requiresProfile || !phone || phone.length < 7) return;
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
    setSubmitting(true);
    setError("");
    try {
      const r = await api.post(`/public/entry/${token}/orders`, {
        items: cartLines.map((l) => ({ ref: l.item!.ref, quantity: l.qty })),
        customerName: entry?.requiresProfile ? name : undefined,
        customerPhone: entry?.requiresProfile ? phone : undefined,
        note: note || (entry?.kind === "TABLE" && tableNumber ? `${t("public.table")} ${tableNumber}` : undefined),
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

  // "Place order" opens the profile step for entries that need a name/phone;
  // F&B-on-a-table goes straight through (the table number is the identity).
  const requestSubmit = () => {
    if (cartLines.length === 0) return;
    if (entry?.requiresProfile) {
      setProfileOpen(true);
      return;
    }
    submit();
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

      <div className="mx-auto max-w-md p-4 space-y-2">
        {/* Service tabs (multi-service hospitality). */}
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

        {/* Table number (F&B at a table): prefilled, confirmable. */}
        {entry?.kind === "TABLE" && (
          <div className="bg-white rounded-xl border p-3">
            <label className="block text-xs font-medium text-gray-500">
              {t("public.table")}
              <input
                value={tableNumber}
                onChange={(e) => setTableNumber(e.target.value)}
                placeholder={t("public.table")}
                className="mt-1 border border-gray-300 rounded-lg p-2 text-sm w-full"
              />
            </label>
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

      {/* Checkout: collect the guest's profile before confirming the order. */}
      <Modal isOpen={profileOpen} onClose={() => setProfileOpen(false)} title={t("public.profileTitle")} size="sm">
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
            <button onClick={() => setProfileOpen(false)} className="px-3 py-2 text-sm text-gray-600">
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

      {cartLines.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t p-3">
          <div className="mx-auto max-w-md space-y-2">
            {/* Read-only summary so guests see each selected line (incl. variants). */}
            <div className="max-h-40 overflow-y-auto space-y-1">
              {cartLines.map((l) => (
                <div key={l.item!.ref} className="flex items-center justify-between gap-3 text-sm text-gray-700">
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

  const Thumb = ({ src }: { src?: string | null }) =>
    src ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" className="w-12 h-12 rounded-lg object-cover bg-gray-100 shrink-0" />
    ) : (
      <div className="w-12 h-12 rounded-lg bg-gray-100 shrink-0" />
    );

  const Qty = ({ ref: r }: { ref: string }) =>
    cart[r] ? (
      <div className="flex items-center gap-2">
        <button onClick={() => sub(r)} className="w-7 h-7 rounded-full border text-gray-600">−</button>
        <span className="w-5 text-center text-sm">{cart[r]}</span>
        <button onClick={() => add(r)} className="w-7 h-7 rounded-full bg-blue-600 text-white">+</button>
      </div>
    ) : (
      <button onClick={() => add(r)} className="bg-blue-600 text-white rounded-lg px-3 py-1.5 text-sm">
        {t("public.add")}
      </button>
    );

  return (
    <div className="bg-white rounded-xl border p-3">
      <div className="flex items-center gap-3">
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
            onClick={() => setOpen((v) => !v)}
            className="text-sm text-blue-600 whitespace-nowrap"
          >
            {open ? t("public.hideVariants") : t("public.variants")}
          </button>
        ) : (
          <Qty ref={item.ref} />
        )}
      </div>

      {hasVariants && open && (
        <ul className="mt-2 divide-y divide-gray-100 border-t pt-1">
          {item.variants!.map((v) => (
            <li key={v.ref} className="flex items-center gap-2 py-2">
              <Thumb src={v.image} />
              <span className="min-w-0 flex-1 text-sm text-gray-700 truncate">{v.name}</span>
              {showPrices && <span className="text-sm text-gray-600">{v.price.toLocaleString()}</span>}
              <Qty ref={v.ref} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
