// src/subscriptions/subscription.constants.ts
// Shared subscription constants + tiny pure helpers, kept in one place so the
// service, the AI reviewer and the admin DTOs agree on terms and lifecycle.

import type { SubscriptionTerm } from '@prisma/client';

/** Fixed day-length of each term (not calendar months, so expiry is exact). */
export const TERM_DAYS: Record<SubscriptionTerm, number> = {
  MONTHLY: 30,
  QUARTERLY: 90,
  SEMIANNUAL: 180,
  YEARLY: 365,
};

export const TERM_ORDER: SubscriptionTerm[] = [
  'MONTHLY',
  'QUARTERLY',
  'SEMIANNUAL',
  'YEARLY',
];

/** Days a tenant may keep using the app after expiry before it turns read-only. */
export const GRACE_DAYS = 2;

/** How many days before expiry the client is prompted to renew. */
export const RENEWAL_WINDOW_DAYS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The end of a period that starts at `start` for the given term. */
export function periodEnd(start: Date, term: SubscriptionTerm): Date {
  return new Date(start.getTime() + TERM_DAYS[term] * DAY_MS);
}

/**
 * Derive the effective lifecycle state from an expiry date.
 * FREE / LIFETIME never expire and are handled by the caller (they have no
 * expiry), so this only classifies time-based subscriptions.
 */
export function classify(
  expiresAt: Date | null,
  now: Date = new Date(),
): 'ACTIVE' | 'GRACE' | 'EXPIRED' {
  if (!expiresAt) return 'ACTIVE';
  if (now.getTime() <= expiresAt.getTime()) return 'ACTIVE';
  const graceEnds = new Date(expiresAt.getTime() + GRACE_DAYS * DAY_MS);
  return now.getTime() <= graceEnds.getTime() ? 'GRACE' : 'EXPIRED';
}

/** Whole days left until expiry (negative once past). null when no expiry. */
export function daysUntil(expiresAt: Date | null, now: Date = new Date()): number | null {
  if (!expiresAt) return null;
  return Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS);
}
