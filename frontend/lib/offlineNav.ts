// lib/offlineNav.ts
// Which dashboard routes keep working with no network. Everything else needs a
// live server, so while the browser is offline the shell only offers these
// (the sidebars call `filterNavForOffline`); a menu item to an online-only page
// would otherwise navigate straight into the offline fallback.
import type { DashboardNav, DashboardNavItem } from "./dashboardNavigation";

/** Pages with an offline story: cached reference data + the mutation queue. */
export const OFFLINE_ROUTES = [
  "/dashboard",
  "/dashboard/sales",
  "/dashboard/purchases",
  "/dashboard/requests",
  "/dashboard/products",
];

/** True when `href` is a page that can be used offline. */
export function isOfflineRoute(href: string): boolean {
  return OFFLINE_ROUTES.some(
    (route) =>
      href === route ||
      (route !== "/dashboard" && href.startsWith(route + "/")),
  );
}

/** Keep only offline-capable items, dropping groups that become empty. */
export function filterNavForOffline(nav: DashboardNav): DashboardNav {
  const keep = (item: DashboardNavItem) =>
    isOfflineRoute(item.href) || (item.match ?? []).some(isOfflineRoute);
  return {
    groups: nav.groups
      .map((group) => ({ ...group, items: group.items.filter(keep) }))
      .filter((group) => group.items.length > 0),
    loose: nav.loose.filter(keep),
  };
}
