"use client";

// Client-facing subscription summary: the current plan, its status badge, the
// expiry, and a "Renew" link to the submission page. FREE / LIFETIME tenants see
// a friendly badge and no renewal call-to-action. Takes a role in the layout so
// the shared context can be provided once.
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { fmtCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/datetime";
import { effectiveStatus, statusClass, statusLabel, termLabel } from "@/lib/subscriptions";

export interface SubscriptionView {
  status: string;
  term: string | null;
  startedAt: string | null;
  expiresAt: string | null;
  daysLeft: number | null;
  freeForever: boolean;
  lifetime: boolean;
  priceOverride?: number | null;
  readOnly: boolean;
  note?: string | null;
  isTrial?: boolean;
}

export default function SubscriptionCard({
  subscription,
}: {
  subscription: SubscriptionView;
}) {
  const { t } = useTranslation();
  const status = effectiveStatus(subscription);
  const notBilled = status === "FREE" || status === "LIFETIME";
  const needsAction = status === "GRACE" || status === "EXPIRED";

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-800">
            {t("subscription.title")}
          </p>
          <p className="text-xs text-gray-400">
            {subscription.term ? termLabel(t, subscription.term) : t("subscription.free")}
            {subscription.isTrial && (
              <span className="ml-1.5 text-[10px] font-medium text-blue-600">
                {t("adm.sub.trialOf")}
              </span>
            )}
          </p>
        </div>
        <span
          className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${statusClass(status)}`}
        >
          {statusLabel(t, status)}
        </span>
      </div>

      {!notBilled && (
        <div className="text-xs text-gray-600">
          {subscription.expiresAt ? (
            status === "GRACE" ? (
              <span className="text-amber-700">
                {t("subscription.inGrace", { count: Math.max(0, 2 + (subscription.daysLeft ?? 0)) })}
              </span>
            ) : status === "EXPIRED" ? (
              <span className="text-red-600">{t("subscription.readOnly")}</span>
            ) : subscription.daysLeft != null && subscription.daysLeft <= 2 ? (
              <span className="text-amber-700">
                {subscription.daysLeft <= 0
                  ? t("subscription.expiresToday")
                  : t("subscription.expiresInDays", { count: subscription.daysLeft })}
              </span>
            ) : (
              <span>{t("subscription.renewedUntil", { date: formatDate(subscription.expiresAt) })}</span>
            )
          ) : (
            <span>{t("subscription.expires")}: —</span>
          )}
        </div>
      )}

      {subscription.note && (
        <p className="text-xs text-gray-500 bg-gray-50 rounded-lg p-2">
          {subscription.note}
        </p>
      )}

      {(needsAction || !notBilled) && (
        <Link
          href="/dashboard/businesses/subscription"
          className="inline-block bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          {needsAction ? t("subscription.renewCta") : t("subscription.manage")}
        </Link>
      )}
    </div>
  );
}
