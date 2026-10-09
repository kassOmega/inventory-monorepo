// lib/subscriptions.ts
// Shared (client + admin) subscription helpers: the term list, status styling,
// and a couple of formatters. Keeps every surface agreeing on labels/colors.
import type { TFunction } from "i18next";

export const SUBSCRIPTION_TERMS = [
  "MONTHLY",
  "QUARTERLY",
  "SEMIANNUAL",
  "YEARLY",
] as const;

export type SubscriptionTerm = (typeof SUBSCRIPTION_TERMS)[number];

export const BUSINESS_TYPES = [
  "RETAIL",
  "HOSPITALITY",
  "MANUFACTURING",
  "SERVICE",
  "CAR_WASH",
] as const;

/** Localized term label (1 month / 3 months / …). */
export function termLabel(t: TFunction, term: string): string {
  return t(`subscription.terms.${term}`, { defaultValue: term });
}

/** Localized status label. */
export function statusLabel(t: TFunction, status: string): string {
  return t(`subscription.statuses.${status}`, { defaultValue: status });
}

/** Tailwind classes for a subscription status pill. */
export function statusClass(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "bg-green-100 text-green-700";
    case "FREE":
      return "bg-purple-100 text-purple-700";
    case "LIFETIME":
      return "bg-indigo-100 text-indigo-700";
    case "GRACE":
      return "bg-amber-100 text-amber-700";
    case "EXPIRED":
      return "bg-red-100 text-red-700";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

/** Tailwind classes for a payment review status pill. */
export function paymentStatusClass(status: string): string {
  switch (status) {
    case "APPROVED":
      return "bg-green-100 text-green-700";
    case "FLAGGED":
      return "bg-amber-100 text-amber-700";
    case "REJECTED":
      return "bg-red-100 text-red-700";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

/** A status that still needs a human decision. */
export function needsReview(status: string): boolean {
  return status === "PENDING" || status === "FLAGGED";
}

/**
 * Effective status from a subscription row. FREE / LIFETIME are returned as-is;
 * otherwise the expiry date is classified as ACTIVE / GRACE (≤2 days past) /
 * EXPIRED, matching the backend guard.
 */
export function effectiveStatus(sub: {
  status: string;
  expiresAt: string | Date | null;
}): string {
  if (sub.status === "FREE" || sub.status === "LIFETIME") return sub.status;
  if (!sub.expiresAt) return "ACTIVE";
  const ms = new Date(sub.expiresAt).getTime() - Date.now();
  if (ms >= 0) return "ACTIVE";
  return ms >= -2 * 24 * 60 * 60 * 1000 ? "GRACE" : "EXPIRED";
}

/** Whole days left until expiry from a subscription row (null when not billed). */
export function daysLeftFor(sub: {
  status: string;
  expiresAt: string | Date | null;
}): number | null {
  if (sub.status === "FREE" || sub.status === "LIFETIME" || !sub.expiresAt) return null;
  return Math.ceil(
    (new Date(sub.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000),
  );
}
