// Shared notification → icon + deep-link mapping (used by the bell and the toast
// so the two surfaces can never drift apart).
//
// The backend stores an optional `link` on every notification (hospitality order
// alerts, low-stock alerts, …) and also forwards it to web push, so that wins.
// The per-type defaults below cover rows created before `link` existed.

export interface LinkableNotification {
  type: string;
  link?: string | null;
}

/** Types that stay pinned in the alert bar until the user reads them. */
export const STICKY_TYPES = ["LOW_STOCK", "REQUEST_STATUS", "ORDER_STATUS"];

export function notificationIcon(type: string): string {
  switch (type) {
    case "LOW_STOCK":
      return "⚠️";
    case "REQUEST_STATUS":
      return "📦";
    case "ORDER_STATUS":
      return "🍽️";
    default:
      return "🔔";
  }
}

/** Where clicking a notification should navigate (null = not clickable). */
export function notificationLink(n: LinkableNotification): string | null {
  if (n.link) return n.link;

  switch (n.type) {
    case "REQUEST_STATUS":
      return "/dashboard/requests";
    case "LOW_STOCK":
      return "/dashboard/reports?tab=low-stock";
    case "ORDER_STATUS":
      return "/dashboard/restaurant";
    default:
      return null;
  }
}
