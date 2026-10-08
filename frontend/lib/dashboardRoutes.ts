// src/lib/dashboardRoutes.ts
//
// Single source of truth for dashboard route access. Every /dashboard/** route
// declares the CRUD read permission(s) that grant it (mirroring the backend's
// @Permissions(...) gate on the matching list/detail endpoints), plus optional
// business-type constraints. The sidebar (`dashboardNavigation.ts`), the route
// guard (`app/dashboard/layout.tsx`) and in-page link bars all resolve access
// through here, so menu visibility and route access can never drift apart.
//
// `read` is a permission key OR a union of keys — access is granted when ANY
// one is held (matching the backend PermissionsGuard). Read endpoints often
// accept several keys (e.g. the sales list accepts sales.view OR sales.create OR
// cashier.confirm OR finance.view), so the union must mirror the backend, not
// only the resource's own `.view` key.

export type FeatureFlag = "inventory" | "retail" | "pos" | "rooms";
export type VerticalOwner = "HOSPITALITY" | "MANUFACTURING" | "SERVICE" | "CAR_WASH";

export interface DashboardRoute {
  /** Exact path, or a pattern with `:param` segments (e.g. `/dashboard/credits/:id`). */
  path: string;
  /** CRUD read permission(s) granting route access; `[]` = no permission needed. */
  read: string | string[];
  /** Business feature the route needs (drives the feature guard). */
  feature?: FeatureFlag;
  /** Route belongs to exactly one business type. */
  vertical?: VerticalOwner;
  /** Shared routes only meaningful for these business types. */
  businessTypes?: string[];
  /** Owner-account-only route (businesses / verification). */
  ownerOnly?: boolean;
  /** Platform-admin-only route. */
  platformAdminOnly?: boolean;
}

/**
 * The route registry. Order: shared/retail → CRM → finance → admin → verticals
 * → dynamic. Reads mirror the backend permission unions.
 */
export const DASHBOARD_ROUTES: DashboardRoute[] = [
  // --- Overview / account (no permission beyond being signed in) ---
  { path: "/dashboard", read: [] },
  { path: "/dashboard/profile", read: [] },
  { path: "/dashboard/businesses", read: [], ownerOnly: true },
  { path: "/dashboard/businesses/settings", read: [], ownerOnly: true },
  { path: "/dashboard/verification", read: [], ownerOnly: true },

  // --- Retail / inventory ---
  { path: "/dashboard/products", read: ["products.view", "products.create"], feature: "inventory" },
  { path: "/dashboard/inventory", read: "products.view", feature: "inventory" },
  { path: "/dashboard/adjust-stock", read: ["products.adjust-stock", "products.edit"], feature: "inventory" },
  { path: "/dashboard/restock", read: "restock.create", feature: "inventory" },
  { path: "/dashboard/locations", read: "locations.manage", feature: "inventory" },
  { path: "/dashboard/requests", read: "requests.view", feature: "retail" },

  // --- Sales & payments (retail) ---
  { path: "/dashboard/sales", read: ["sales.view", "sales.create", "cashier.view", "cashier.confirm", "finance.view"], feature: "retail" },
  { path: "/dashboard/purchases", read: ["purchases.view", "purchases.create"], feature: "retail" },
  { path: "/dashboard/prices", read: "prices.view", feature: "retail" },
  { path: "/dashboard/credits", read: ["credits.view", "credits.manage"], feature: "retail" },
  { path: "/dashboard/credits/:id", read: ["credits.view", "credits.manage"] },

  // --- CRM (every business type) ---
  { path: "/dashboard/customers", read: ["customers.view", "customers.manage", "credits.view"] },
  { path: "/dashboard/customers/settings", read: "customers.manage" },
  { path: "/dashboard/customers/:id", read: ["customers.view", "customers.manage"] },

  // --- Finance / accounting (businesses that use it) ---
  { path: "/dashboard/finance", read: ["finance.view", "finance.manage"] },
  { path: "/dashboard/finance/ledger", read: ["finance.view", "finance.manage"] },
  { path: "/dashboard/finance/settings/mappings", read: ["finance.view", "finance.manage"] },
  { path: "/dashboard/payment-methods", read: ["finance.view", "finance.manage"] },
  { path: "/dashboard/taxes", read: ["finance.view", "finance.manage"] },
  { path: "/dashboard/accounts", read: ["finance.view", "finance.manage"] },

  // --- Administration ---
  { path: "/dashboard/users", read: ["users.view", "users.manage", "roles.manage"] },
  { path: "/dashboard/reports", read: ["reports.view", "reports.full"] },
  { path: "/dashboard/forecast", read: "ai.view" },
  { path: "/dashboard/purchase-orders", read: "ai.view" },
  { path: "/dashboard/agent", read: "agent.manage" },

  // --- Hospitality (FOOD_AND_BEVERAGE / ACCOMMODATION) ---
  { path: "/dashboard/food/orders", read: "restaurant.take-orders", feature: "pos", vertical: "HOSPITALITY" },
  { path: "/dashboard/food/kitchen", read: "kitchen.view", feature: "pos", vertical: "HOSPITALITY" },
  { path: "/dashboard/food/bar", read: "bar.view", feature: "pos", vertical: "HOSPITALITY" },
  { path: "/dashboard/food/barista", read: "barista.view", feature: "pos", vertical: "HOSPITALITY" },
  { path: "/dashboard/food/station/:key", read: "kitchen.view", feature: "pos", vertical: "HOSPITALITY" },
  { path: "/dashboard/food/menu", read: "restaurant.manage", feature: "pos", vertical: "HOSPITALITY" },
  { path: "/dashboard/restaurant", read: "restaurant.view", feature: "pos", vertical: "HOSPITALITY" },
  { path: "/dashboard/hotel", read: ["hotel.view", "hotel.reception"], feature: "rooms", vertical: "HOSPITALITY" },
  { path: "/dashboard/cashier", read: ["cashier.view", "cashier.confirm"], vertical: "HOSPITALITY" },
  { path: "/dashboard/hospitality/packages", read: ["packages.view", "packages.manage"], vertical: "HOSPITALITY" },
  { path: "/dashboard/hospitality/folios", read: ["folios.view", "folios.manage"], vertical: "HOSPITALITY" },
  { path: "/dashboard/hospitality/memberships", read: ["memberships.view", "memberships.manage"], vertical: "HOSPITALITY" },
  { path: "/dashboard/hospitality/memberships/types", read: ["memberships.view", "memberships.manage"], vertical: "HOSPITALITY" },
  { path: "/dashboard/hospitality/spa", read: ["facility.view", "facility.manage"], vertical: "HOSPITALITY" },
  { path: "/dashboard/hospitality/gym", read: ["facility.view", "facility.manage"], vertical: "HOSPITALITY" },
  { path: "/dashboard/hospitality/pool", read: ["facility.view", "facility.manage"], vertical: "HOSPITALITY" },
  { path: "/dashboard/hospitality/events", read: ["facility.view", "facility.manage"], vertical: "HOSPITALITY" },
  { path: "/dashboard/hospitality/service/:key", read: ["facility.view", "facility.manage"], vertical: "HOSPITALITY" },
  { path: "/dashboard/settings/hospitality-services", read: [], ownerOnly: true, vertical: "HOSPITALITY" },

  // --- Service vertical ---
  { path: "/dashboard/service", read: "service.view", vertical: "SERVICE" },
  { path: "/dashboard/service/catalog", read: "service.view", vertical: "SERVICE" },
  { path: "/dashboard/service/bookings", read: "service.view", vertical: "SERVICE" },
  { path: "/dashboard/service/tickets", read: "service.view", vertical: "SERVICE" },
  { path: "/dashboard/service/clients", read: "service.view", vertical: "SERVICE" },
  { path: "/dashboard/service/settings", read: ["service.manage", "service.view"], vertical: "SERVICE" },

  // --- Car wash vertical (CRUD per resource) ---
  { path: "/dashboard/carwash", read: "carwash.washes.view", vertical: "CAR_WASH" },
  { path: "/dashboard/carwash/washes", read: "carwash.washes.view", vertical: "CAR_WASH" },
  { path: "/dashboard/carwash/bookings", read: "carwash.bookings.view", vertical: "CAR_WASH" },
  { path: "/dashboard/carwash/collection", read: ["carwash.collections.view", "carwash.collections.create"], vertical: "CAR_WASH" },
  { path: "/dashboard/carwash/washers", read: "carwash.washers.view", vertical: "CAR_WASH" },
  { path: "/dashboard/carwash/prices", read: "carwash.prices.view", vertical: "CAR_WASH" },
  { path: "/dashboard/carwash/vehicles", read: "carwash.vehicles.view", vertical: "CAR_WASH" },
  { path: "/dashboard/carwash/store-items", read: ["carwash.equipment.view", "carwash.equipment.issue"], vertical: "CAR_WASH" },
  { path: "/dashboard/carwash/equipment", read: ["carwash.equipment.view", "carwash.equipment.issue"], vertical: "CAR_WASH" },
  { path: "/dashboard/carwash/expenses", read: "carwash.expenses.view", vertical: "CAR_WASH" },
  { path: "/dashboard/carwash/reports", read: "carwash.reports.view", vertical: "CAR_WASH" },
  { path: "/dashboard/carwash/washer-reports", read: "carwash.reports.view", vertical: "CAR_WASH" },
  { path: "/dashboard/carwash/settings", read: "carwash.settings.view", vertical: "CAR_WASH" },

  // --- Manufacturing vertical (read = view OR manage, matching the backend) ---
  { path: "/dashboard/manufacturing/production", read: ["manufacturing.view", "manufacturing.manage"], vertical: "MANUFACTURING" },
  { path: "/dashboard/manufacturing/boms", read: ["manufacturing.view", "manufacturing.manage"], vertical: "MANUFACTURING" },
  { path: "/dashboard/manufacturing/catalog", read: ["manufacturing.view", "manufacturing.manage"], vertical: "MANUFACTURING" },
  { path: "/dashboard/manufacturing/orders", read: ["manufacturing.view", "manufacturing.manage"], vertical: "MANUFACTURING" },
  { path: "/dashboard/manufacturing/jobs", read: ["manufacturing.view", "manufacturing.manage"], vertical: "MANUFACTURING" },
  { path: "/dashboard/manufacturing/teams", read: ["manufacturing.view", "manufacturing.manage"], vertical: "MANUFACTURING" },
  { path: "/dashboard/manufacturing/flows", read: ["manufacturing.view", "manufacturing.manage"], vertical: "MANUFACTURING" },
  { path: "/dashboard/manufacturing/services", read: ["manufacturing.view", "manufacturing.manage"], vertical: "MANUFACTURING" },
  { path: "/dashboard/manufacturing/materials", read: ["manufacturing.view", "manufacturing.manage"], vertical: "MANUFACTURING" },
  { path: "/dashboard/manufacturing/purchasing", read: ["manufacturing.view", "manufacturing.manage"], vertical: "MANUFACTURING" },
  { path: "/dashboard/manufacturing/receipts", read: ["manufacturing.view", "manufacturing.manage"], vertical: "MANUFACTURING" },
  { path: "/dashboard/manufacturing/machines", read: ["manufacturing.view", "manufacturing.manage"], vertical: "MANUFACTURING" },
  { path: "/dashboard/manufacturing/shifts", read: ["manufacturing.view", "manufacturing.manage"], vertical: "MANUFACTURING" },
  { path: "/dashboard/manufacturing/workers", read: ["manufacturing.view", "manufacturing.manage"], vertical: "MANUFACTURING" },
  { path: "/dashboard/manufacturing/settings", read: ["manufacturing.manage", "manufacturing.view"], vertical: "MANUFACTURING" },

  // --- Platform admin (guarded by admin/layout.tsx) ---
  { path: "/dashboard/admin", read: [], platformAdminOnly: true },
  { path: "/dashboard/admin/owners", read: [], platformAdminOnly: true },
  { path: "/dashboard/admin/businesses", read: [], platformAdminOnly: true },
  { path: "/dashboard/admin/verification", read: [], platformAdminOnly: true },
];

/** Compile a `:param` pattern into a matcher once. */
function compilePattern(pattern: string): RegExp {
  const escaped = pattern
    .split("/")
    .map((seg) =>
      seg.startsWith(":")
        ? "[^/]+"
        : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  return new RegExp(`^${escaped}$`);
}

const COMPILED = DASHBOARD_ROUTES.map((r) => ({
  route: r,
  isDynamic: r.path.includes(":"),
  regex: r.path.includes(":") ? compilePattern(r.path) : null,
}));

/** Exact-first, then pattern match. Returns the owning route or null. */
export function routeFor(pathname: string): DashboardRoute | null {
  for (const { route, isDynamic } of COMPILED) {
    if (!isDynamic && route.path === pathname) return route;
  }
  for (const { route, regex } of COMPILED) {
    if (regex && regex.test(pathname)) return route;
  }
  return null;
}

/** True when the route's read permission(s) are held (any-of). */
export function canAccessRoute(
  route: DashboardRoute | null,
  hasPermission: (key: string) => boolean,
): boolean {
  if (!route) return true; // unknown route → let other guards decide
  const read = Array.isArray(route.read) ? route.read : [route.read];
  if (read.length === 0) return true;
  return read.some((k) => hasPermission(k));
}

/** Convenience: can the current user open this exact path? */
export function canAccess(
  pathname: string,
  hasPermission: (key: string) => boolean,
): boolean {
  return canAccessRoute(routeFor(pathname), hasPermission);
}

// --- Backwards-compatible derived maps (consumed by layout + components) ---

/** path → read permission(s). Dynamic routes keep their `:param` key. */
export const routePermissionMap: Record<string, string | string[]> =
  Object.fromEntries(DASHBOARD_ROUTES.map((r) => [r.path, r.read]));

/** path → required feature flag. */
export const routeFeatureMap: Record<string, FeatureFlag> =
  Object.fromEntries(
    DASHBOARD_ROUTES.filter((r) => r.feature).map((r) => [r.path, r.feature!]),
  );

/** Vertical prefixes (business-root), used by the sidebar/layout vertical guard. */
export const verticalRoutePrefixes: Array<{ prefix: string; type: VerticalOwner }> = [
  { prefix: "/dashboard/service", type: "SERVICE" },
  { prefix: "/dashboard/carwash", type: "CAR_WASH" },
  { prefix: "/dashboard/manufacturing", type: "MANUFACTURING" },
  { prefix: "/dashboard/hotel", type: "HOSPITALITY" },
  { prefix: "/dashboard/food", type: "HOSPITALITY" },
  { prefix: "/dashboard/hospitality", type: "HOSPITALITY" },
];

/** path → allowed business types (shared routes only). */
export const routeBusinessTypes: Record<string, string[]> =
  Object.fromEntries(
    DASHBOARD_ROUTES.filter((r) => r.businessTypes).map((r) => [
      r.path,
      r.businessTypes!,
    ]),
  );

export function businessTypesForRoute(pathname: string): string[] | null {
  const entry = routeFor(pathname);
  return entry?.businessTypes ?? null;
}

/** The vertical that owns a route, or null when the route is shared. */
export function verticalForRoute(pathname: string): VerticalOwner | null {
  return routeFor(pathname)?.vertical ?? null;
}
