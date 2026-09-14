// src/common/business-date.util.ts
// Business-local calendar dates for day-boundary logic.
//
// Package entitlements ("daily allowances") reset at the *business's* midnight,
// not the server's, so daily usage is keyed by the organization's timezone
// (Organization.timezone) instead of the Node process timezone. The output is
// always YYYY-MM-DD, which is exactly how
// PackageGuestEntitlementUsage.usageDate is stored.

/** Used when an org has no timezone configured or the value is invalid. */
export const FALLBACK_TIME_ZONE = 'UTC';

/**
 * Format an instant as `YYYY-MM-DD` in the given IANA timezone.
 * Invalid/missing timezones fall back to UTC so a bad config never throws
 * inside a settlement transaction.
 */
export function formatBusinessDate(
  date: Date,
  timeZone?: string | null,
): string {
  const tz = (timeZone ?? '').trim() || FALLBACK_TIME_ZONE;
  // 'en-CA' renders as YYYY-MM-DD and is stable across ICU versions.
  const options: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  };
  try {
    return new Intl.DateTimeFormat('en-CA', options).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      ...options,
      timeZone: FALLBACK_TIME_ZONE,
    }).format(date);
  }
}

/**
 * Today's date (`YYYY-MM-DD`) in the business timezone — the key used for
 * daily entitlement usage rows.
 */
export function businessToday(
  timeZone?: string | null,
  now: Date = new Date(),
): string {
  return formatBusinessDate(now, timeZone);
}

/**
 * Weekday name (e.g. "Monday") for an instant in the business timezone. The
 * itemized guest folio uses this so every line shows the business-local day it
 * was consumed, regardless of the server or requester timezone.
 */
export function formatBusinessWeekday(
  date: Date,
  timeZone?: string | null,
): string {
  const tz = (timeZone ?? '').trim() || FALLBACK_TIME_ZONE;
  const options: Intl.DateTimeFormatOptions = { timeZone: tz, weekday: 'long' };
  try {
    return new Intl.DateTimeFormat('en-US', options).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      ...options,
      timeZone: FALLBACK_TIME_ZONE,
    }).format(date);
  }
}
