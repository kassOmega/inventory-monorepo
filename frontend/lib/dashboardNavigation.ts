// Central navigation definition for the dashboard shell.
// This file owns:
//   - the dashboard menu model (groups + loose links),
//   - every visibility condition that decides which links a user sees,
//   - the route->feature and route->permission guard maps used by the layout
//     (a route may list several permissions; holding any one of them grants
//     access, mirroring the backend PermissionsGuard).
//
// Grouping is deliberately incremental: Overview / Inventory / Sales &
// Payments / Finance / Administration are expandable dropdown groups; every
// remaining item (hospitality, service, manufacturing, platform admin) is
// returned as a loose link so it keeps today's flat behaviour until it is
// grouped too.

import { routeFor } from "./dashboardRoutes";

export interface DashboardNavItem {
  href: string;
  label: string;
  /** One key, or several (any of them grants the item). */
  permission?: string | string[];
  /**
   * Extra route prefixes that keep this item highlighted — a section whose pages
   * are tabs (e.g. Stock: products, Stock In, Stock Count) stays lit on all of
   * them even though its links have different paths.
   */
  match?: string[];
  /** Optional sub-section heading rendered above this item (e.g. "Reports"). */
  section?: string;
}

export interface DashboardNavGroup {
  key: string;
  label: string;
  items: DashboardNavItem[];
  flat?: boolean;
}

export interface DashboardNav {
  groups: DashboardNavGroup[];
  loose: DashboardNavItem[];
}

/**
 * Is this menu item the page the user is on? `href` is the item's own route and
 * `match` lists the other routes of the same section (its tabs), so a section with
 * tabbed pages stays highlighted on every one of them.
 */
export function isNavItemActive(
  item: DashboardNavItem,
  pathname: string,
): boolean {
  return [item.href, ...(item.match ?? [])].some(
    (href) =>
      pathname === href ||
      (href !== "/dashboard" && pathname.startsWith(href + "/")),
  );
}

/**
 * The five primary menu groups, in the order the sidebar and the mobile quick nav
 * show them. A group that is absent for this user (no permission, or a business
 * type that does not use it) is skipped rather than reordered — see
 * primaryNavGroups.
 */
export const PRIMARY_NAV_GROUP_KEYS = [
  "overview",
  "carwash",
  "inventory",
  "salesPayments",
  "finance",
  "administration",
] as const;

/** The primary groups this user actually has, in PRIMARY_NAV_GROUP_KEYS order. */
export function primaryNavGroups(nav: DashboardNav): DashboardNavGroup[] {
  return PRIMARY_NAV_GROUP_KEYS.map((key) =>
    nav.groups.find((g) => g.key === key),
  ).filter((g): g is DashboardNavGroup => g !== undefined);
}

/**
 * Resolve a fixed, ordered list of quick-action hrefs against the built nav.
 *
 * The nav returned by `buildDashboardNav` is already filtered by permissions,
 * enabled stations and service lines — so looking an href up in it means the
 * quick-action row inherits that gating automatically: an href the user may not
 * open is simply absent from the nav and therefore dropped here (never rendered
 * without permission). Order follows the requested `hrefs`, not the nav.
 */
export function quickActionsFor(
  nav: DashboardNav,
  hrefs: string[],
): DashboardNavItem[] {
  const all: DashboardNavItem[] = [
    ...nav.groups.flatMap((g) => g.items),
    ...nav.loose,
  ];
  const out: DashboardNavItem[] = [];
  for (const href of hrefs) {
    const match = all.find(
      (i) =>
        i.href === href ||
        (i.match ?? []).some(
          (m) => href === m || href.startsWith(`${m}/`),
        ),
    );
    if (match && !out.some((o) => o.href === match.href)) out.push(match);
  }
  return out;
}

/**
 * Keys of the groups containing the current page, in nav order. The sidebar uses
 * them to open the section you are in, the mobile quick nav to highlight it.
 */
export function activeNavGroupKeys(
  nav: DashboardNav,
  pathname: string,
): string[] {
  return nav.groups
    .filter((g) => g.items.some((i) => isNavItemActive(i, pathname)))
    .map((g) => g.key);
}

export interface NavService {
  serviceType: string;
  isEnabled: boolean;
  customKey?: string | null;
  customName?: string | null;
}

export interface NavStation {
  key: string;
  name: string;
  nameLocalized?: string | null;
  permissionView?: string | null;
}

export interface NavBuildContext {
  isPlatformAdmin: boolean;
  isOwnerAccount: boolean;
  hasBusiness: boolean;
  isRetail: boolean;
  isHospitality: boolean;
  isService: boolean;
  isCarWash: boolean;
  isManufacturing: boolean;
  hasFinance: boolean;
  standalone: boolean;
  staffCount: number;
  canViewAllStations: boolean;
  stations: NavStation[];
  /** Enabled hospitality services for the active business (multi-service gating). */
  services: NavService[];
  /** Role-based check used to filter every menu item by its `permission`. */
  hasPermission: (key: string) => boolean;
  t: (key: string) => string;
}

// Which feature a dashboard route requires, for per-business-type route guarding.
// The maps below are DERIVED from the single route registry so the sidebar and
// the route guard can never disagree. See lib/dashboardRoutes.ts.
export {
  routePermissionMap,
  routeFeatureMap,
  verticalRoutePrefixes,
  routeBusinessTypes,
  businessTypesForRoute,
  verticalForRoute,
} from "./dashboardRoutes";

export function buildDashboardNav(ctx: NavBuildContext): DashboardNav {
  const t = ctx.t;
  /**
   * The read permission(s) for a route, sourced from the registry so the menu
   * and the route guard always agree (see lib/dashboardRoutes.ts). Falls back to
   * the passed value only if the route is not yet registered.
   */
  const routeRead = (href: string): string | string[] | undefined => {
    const entry = routeFor(href);
    return entry ? entry.read : undefined;
  };
  /** Whether the active hospitality business has a given service enabled. */
  const serviceEnabled = (type: string) =>
    ctx.services.some((s) => s.serviceType === type && s.isEnabled);
  // Owner-created custom services (each gets a generic facility dashboard).
  const customServices = ctx.services.filter(
    (s) => s.serviceType === "CUSTOM" && s.isEnabled,
  );

  // Platform admins manage the platform, not a business: show the admin links
  // flat until they get grouped.
  if (ctx.isPlatformAdmin) {
    return {
      groups: [],
      loose: [
        { href: "/dashboard/admin", label: t("nav.adminOverview") },
        { href: "/dashboard/admin/owners", label: t("nav.adminUsers") },
        { href: "/dashboard/admin/businesses", label: t("nav.adminBusinesses") },
        { href: "/dashboard/admin/verification", label: t("nav.adminVerification") },
      ],
    };
  }

  // Business groups (only non-empty groups are kept).
  const overview: DashboardNavGroup = {
    key: "overview",
    label: t("nav.groups.overview"),
    items: [],
  };
  const inventory: DashboardNavGroup = {
    key: "inventory",
    label: t("nav.groups.inventory"),
    items: [],
  };
  const sales: DashboardNavGroup = {
    key: "salesPayments",
    label: t("nav.groups.salesPayments"),
    items: [],
  };
  const finance: DashboardNavGroup = {
    key: "finance",
    label: t("nav.groups.finance"),
    items: [],
  };
  const administration: DashboardNavGroup = {
    key: "administration",
    label: t("nav.groups.administration"),
    items: [],
  };
  const manufacturing: DashboardNavGroup = {
    key: "manufacturing",
    label: t("nav.groups.manufacturing"),
    items: [],
    flat: true,
  };
  const carWash: DashboardNavGroup = {
    key: "carwash",
    label: t("nav.groups.carwash"),
    items: [],
    flat: true,
  };


  if (ctx.hasBusiness) {
    overview.items.push({ href: "/dashboard", label: t("nav.dashboard") });
  }
  if (ctx.isOwnerAccount) {
    overview.items.push({
      href: "/dashboard/businesses",
      label: t("nav.myBusinesses"),
    });
    overview.items.push({
      href: "/dashboard/verification",
      label: t("nav.verification"),
    });
  }

  if (ctx.hasBusiness && ctx.isRetail) {
    inventory.items.push({
      href: "/dashboard/products",
      label: t("nav.products"),
      permission: routeRead("/dashboard/products"),
    });
    // Stock is one menu item whose three pages are tabs: the stock tasks overview,
    // receiving stock and counting it. The item lands on the first tab the user may
    // open and stays highlighted on all three (see `match`).
    const stockTabs = [
      "/dashboard/inventory",
      "/dashboard/restock",
      "/dashboard/adjust-stock",
    ];
    const holdsRead = (href: string) => {
      const entry = routeFor(href);
      const read = entry ? (Array.isArray(entry.read) ? entry.read : [entry.read]) : [];
      return read.length === 0 || read.some((k) => ctx.hasPermission(k));
    };
    const openTabs = stockTabs.filter(holdsRead);
    if (openTabs.length > 0) {
      inventory.items.push({
        href: openTabs[0],
        label: t("nav.stock"),
        permission: openTabs.flatMap((href) => {
          const entry = routeFor(href);
          return entry ? [entry.read].flat() : [];
        }),
        match: stockTabs,
      });
    }
    if (!ctx.standalone) {
      inventory.items.push({
        href: "/dashboard/locations",
        label: t("nav.locations"),
        permission: routeRead("/dashboard/locations"),
      });
    }
    if (ctx.staffCount > 0) {
      inventory.items.push({
        href: "/dashboard/requests",
        label: t("nav.requests"),
        permission: routeRead("/dashboard/requests"),
      });
    }
    sales.items.push(
      { href: "/dashboard/sales", label: t("nav.sales"), permission: routeRead("/dashboard/sales") },
      { href: "/dashboard/purchases", label: t("nav.purchases"), permission: routeRead("/dashboard/purchases") },
      { href: "/dashboard/prices", label: t("nav.prices"), permission: routeRead("/dashboard/prices") },
      { href: "/dashboard/credits", label: t("nav.credits"), permission: routeRead("/dashboard/credits") },
      { href: "/dashboard/customers", label: t("nav.customers"), permission: routeRead("/dashboard/customers") },
    );
  }

  // CRM: the customer book is not retail-only — hospitality bills guests,
  // service bills clients and manufacturing bills dealers, so every vertical
  // that grants `customers.view` gets the directory. It sits in Sales &
  // Payments because that is the section it is read alongside (credits).
  if (ctx.hasBusiness && !ctx.isRetail && !ctx.isCarWash) {
    sales.items.push({
      href: "/dashboard/customers",
      label: t("nav.customers"),
      permission: routeRead("/dashboard/customers"),
      match: ["/dashboard/credits"],
    });
  }

  if (ctx.hasBusiness && ctx.hasFinance) {
    finance.items.push(
      { href: "/dashboard/finance", label: t("nav.finance"), permission: routeRead("/dashboard/finance") },
      { href: "/dashboard/payment-methods", label: t("nav.paymentMethods"), permission: routeRead("/dashboard/payment-methods") },
      { href: "/dashboard/taxes", label: t("nav.taxes"), permission: routeRead("/dashboard/taxes") },
      { href: "/dashboard/accounts", label: t("nav.accounts"), permission: routeRead("/dashboard/accounts") },
      { href: "/dashboard/finance/ledger", label: t("nav.generalLedger"), permission: routeRead("/dashboard/finance/ledger") },
      { href: "/dashboard/finance/settings/mappings", label: t("nav.accountMappings"), permission: routeRead("/dashboard/finance/settings/mappings") },
    );
  }

  if (ctx.hasBusiness) {
    administration.items.push(
      // Users & Roles are two tabs of one page, so a single entry opens
      // both; the page hides the tab the user cannot see.
      {
        href: "/dashboard/users",
        label: t("nav.usersAndRoles"),
        permission: routeRead("/dashboard/users"),
      },
      // One shared reports page for every business; it renders the tab set for
      // the active business type (retail/manufacturing/hospitality/service/
      // car wash).
      { href: "/dashboard/reports", label: t("nav.reports"), permission: routeRead("/dashboard/reports") },
      { href: "/dashboard/forecast", label: t("nav.aiForecast"), permission: routeRead("/dashboard/forecast") },
      { href: "/dashboard/purchase-orders", label: t("nav.purchaseOrders"), permission: routeRead("/dashboard/purchase-orders") },
      { href: "/dashboard/agent", label: t("nav.aiAgent"), permission: routeRead("/dashboard/agent") },
    );
  }

  if (ctx.hasBusiness && ctx.isManufacturing) {
    manufacturing.items.push(
      { href: "/dashboard/manufacturing/production", label: t("nav.production"), permission: routeRead("/dashboard/manufacturing/production") },
      { href: "/dashboard/manufacturing/boms", label: t("nav.billOfMaterials"), permission: routeRead("/dashboard/manufacturing/boms") },
      { href: "/dashboard/manufacturing/catalog", label: t("nav.designCatalog"), permission: routeRead("/dashboard/manufacturing/catalog") },
      { href: "/dashboard/manufacturing/orders", label: t("nav.jobs"), permission: routeRead("/dashboard/manufacturing/orders") },
      { href: "/dashboard/manufacturing/teams", label: t("nav.teams"), permission: routeRead("/dashboard/manufacturing/teams") },
      { href: "/dashboard/manufacturing/flows", label: t("nav.flows"), permission: routeRead("/dashboard/manufacturing/flows") },
      { href: "/dashboard/manufacturing/services", label: t("nav.servicesIncome"), permission: routeRead("/dashboard/manufacturing/services") },
      { href: "/dashboard/manufacturing/materials", label: t("nav.materialsIssues"), permission: routeRead("/dashboard/manufacturing/materials") },
      { href: "/dashboard/manufacturing/purchasing", label: t("nav.purchasing"), permission: routeRead("/dashboard/manufacturing/purchasing") },
      { href: "/dashboard/manufacturing/receipts", label: t("nav.stockReceipts"), permission: routeRead("/dashboard/manufacturing/receipts") },
      { href: "/dashboard/manufacturing/machines", label: t("nav.machines"), permission: routeRead("/dashboard/manufacturing/machines") },
      { href: "/dashboard/manufacturing/shifts", label: t("nav.shifts"), permission: routeRead("/dashboard/manufacturing/shifts") },
      { href: "/dashboard/manufacturing/workers", label: t("nav.workers"), permission: routeRead("/dashboard/manufacturing/workers") },
      { href: "/dashboard/manufacturing/settings", label: t("nav.settings"), permission: routeRead("/dashboard/manufacturing/settings") },
    );
  }

  if (ctx.hasBusiness && ctx.isCarWash) {
    carWash.items.push(
      { href: "/dashboard/carwash/bookings", label: t("nav.carwashBookings"), permission: routeRead("/dashboard/carwash/bookings") },
      { href: "/dashboard/carwash/washes", label: t("nav.carwashWashes"), permission: routeRead("/dashboard/carwash/washes") },
      { href: "/dashboard/carwash/collection", label: t("nav.carwashCollection"), permission: routeRead("/dashboard/carwash/collection") },
      { href: "/dashboard/carwash/washers", label: t("nav.carwashWashers"), permission: routeRead("/dashboard/carwash/washers") },
      { href: "/dashboard/carwash/prices", label: t("nav.carwashPrices"), permission: routeRead("/dashboard/carwash/prices") },
      { href: "/dashboard/carwash/vehicles", label: t("nav.carwashVehicles"), permission: routeRead("/dashboard/carwash/vehicles") },
      { href: "/dashboard/carwash/store-items", label: t("nav.carwashStoreItems"), permission: routeRead("/dashboard/carwash/store-items") },
      { href: "/dashboard/carwash/equipment", label: t("nav.carwashEquipment"), permission: routeRead("/dashboard/carwash/equipment") },
      { href: "/dashboard/carwash/expenses", label: t("nav.carwashExpenses"), permission: routeRead("/dashboard/carwash/expenses") },
      { href: "/dashboard/carwash/reports", label: t("nav.carwashReports"), permission: routeRead("/dashboard/carwash/reports") },
      { href: "/dashboard/carwash/washer-reports", label: t("nav.carwashWasherReports"), permission: routeRead("/dashboard/carwash/washer-reports") },
      { href: "/dashboard/carwash/settings", label: t("nav.settings"), permission: routeRead("/dashboard/carwash/settings") },
      { href: "/dashboard/customers", label: t("nav.customers"), permission: routeRead("/dashboard/customers") },
    );
  }

  const groupOrder = [overview];
  if (ctx.hasBusiness && ctx.isCarWash) groupOrder.push(carWash);
  if (ctx.hasBusiness && ctx.isManufacturing) groupOrder.push(manufacturing);
  groupOrder.push(inventory, sales, finance, administration);
  let groups = groupOrder.filter((g) => g.items.length > 0);

  // Not-yet-grouped links keep their flat behaviour and relative order.
  const loose: DashboardNavItem[] = [];
  if (ctx.hasBusiness && ctx.isHospitality) {
    // FOOD_AND_BEVERAGE — orders, station boards, menu.
    if (serviceEnabled("FOOD_AND_BEVERAGE")) {
      loose.push(
        { href: "/dashboard/food/orders", label: t("nav.orders"), permission: routeRead("/dashboard/food/orders") },
        ...ctx.stations.map((s) => ({
          href: `/dashboard/food/station/${s.key}`,
          label: s.nameLocalized ?? s.name,
          permission: ctx.canViewAllStations
            ? undefined
            : (s.permissionView ?? "kitchen.view"),
        })),
        { href: "/dashboard/food/menu", label: t("nav.menu"), permission: routeRead("/dashboard/food/menu") },
      );
    }
    // ACCOMMODATION — rooms, reservations and front-desk billing.
    if (serviceEnabled("ACCOMMODATION")) {
      loose.push({ href: "/dashboard/hotel", label: t("nav.roomService"), permission: routeRead("/dashboard/hotel") });
    }
    // Facility dashboards per enabled service line.
    if (serviceEnabled("SPA_AND_WELLNESS")) {
      loose.push({
        href: "/dashboard/hospitality/spa",
        label: t("hospitalityServices.SPA_AND_WELLNESS"),
        permission: routeRead("/dashboard/hospitality/spa"),
      });
    }
    if (serviceEnabled("GYM_AND_FITNESS")) {
      loose.push({
        href: "/dashboard/hospitality/gym",
        label: t("hospitalityServices.GYM_AND_FITNESS"),
        permission: routeRead("/dashboard/hospitality/gym"),
      });
    }
    if (serviceEnabled("SWIMMING_POOL")) {
      loose.push({
        href: "/dashboard/hospitality/pool",
        label: t("hospitalityServices.SWIMMING_POOL"),
        permission: routeRead("/dashboard/hospitality/pool"),
      });
    }
    if (serviceEnabled("EVENT_AND_HALL_RENTAL")) {
      loose.push({
        href: "/dashboard/hospitality/events",
        label: t("hospitalityServices.EVENT_AND_HALL_RENTAL"),
        permission: routeRead("/dashboard/hospitality/events"),
      });
    }
    // Owner-created custom services → generic facility dashboards.
    for (const s of customServices) {
      loose.push({
        href: `/dashboard/hospitality/service/${s.customKey}`,
        label: s.customName ?? s.customKey ?? t("terms.svc.service"),
        permission: routeRead("/dashboard/hospitality/service/:key"),
      });
    }
    // Memberships — shown when any membership-capable service is enabled.
    if (
      serviceEnabled("SPA_AND_WELLNESS") ||
      serviceEnabled("GYM_AND_FITNESS") ||
      serviceEnabled("SWIMMING_POOL") ||
      customServices.length > 0
    ) {
      loose.push(
        { href: "/dashboard/hospitality/memberships", label: t("nav.memberships"), permission: routeRead("/dashboard/hospitality/memberships") },
        { href: "/dashboard/hospitality/memberships/types", label: t("nav.membershipTypes"), permission: routeRead("/dashboard/hospitality/memberships/types") },
      );
    }
    // Packages & guest folios (package / entitlement routing).
    if (
      serviceEnabled("ACCOMMODATION") ||
      serviceEnabled("FOOD_AND_BEVERAGE") ||
      customServices.length > 0
    ) {
      loose.push(
        { href: "/dashboard/hospitality/packages", label: t("nav.packages"), permission: routeRead("/dashboard/hospitality/packages") },
        { href: "/dashboard/hospitality/folios", label: t("nav.folios"), permission: routeRead("/dashboard/hospitality/folios") },
      );
    }
    // Owner-only: upgrade/toggle the service lines as the business expands.
    if (ctx.isOwnerAccount) {
      loose.push({
        href: "/dashboard/settings/hospitality-services",
        label: t("nav.hospitalityServices"),
      });
    }
    // Shared — always visible for a hospitality business.
    loose.push({ href: "/dashboard/cashier", label: t("nav.cashier"), permission: routeRead("/dashboard/cashier") });
  }
  if (ctx.hasBusiness && ctx.isService) {
    loose.push(
      { href: "/dashboard/service", label: t("nav.serviceOverview"), permission: routeRead("/dashboard/service") },
      { href: "/dashboard/service/catalog", label: t("nav.serviceCatalog"), permission: routeRead("/dashboard/service/catalog") },
      { href: "/dashboard/service/bookings", label: t("nav.serviceBookings"), permission: routeRead("/dashboard/service/bookings") },
      { href: "/dashboard/service/tickets", label: t("nav.serviceTickets"), permission: routeRead("/dashboard/service/tickets") },
      { href: "/dashboard/service/clients", label: t("nav.serviceClients"), permission: routeRead("/dashboard/service/clients") },
      { href: "/dashboard/service/settings", label: t("nav.settings"), permission: routeRead("/dashboard/service/settings") },
    );
  }
  /** An item shows when it declares no permission, or any one of them. */
  const isPermitted = (permission?: string | string[]) =>
    !permission ||
    (Array.isArray(permission)
      ? permission.some((key) => ctx.hasPermission(key))
      : ctx.hasPermission(permission));

  return {
    // Role-based visibility: drop every item whose declared permission(s) the
    // user's role doesn't grant (see isPermitted). Items without a permission stay
    // governed by the business-type/feature flags above (e.g. owner-only pages).
    groups: groups
      .map((g) => ({
        ...g,
        items: g.items.filter((i) => isPermitted(i.permission)),
      }))
      .filter((g) => g.items.length > 0),
    loose: loose.filter((l) => isPermitted(l.permission)),
  };
}
