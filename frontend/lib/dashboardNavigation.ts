// Central navigation definition for the dashboard shell.
// This file owns:
//   - the dashboard menu model (groups + loose links),
//   - every visibility condition that decides which links a user sees,
//   - the route->feature and route->permission guard maps used by the layout.
//
// Grouping is deliberately incremental: Overview / Inventory / Sales &
// Payments / Finance / Administration are expandable dropdown groups; every
// remaining item (hospitality, service, manufacturing, platform admin) is
// returned as a loose link so it keeps today's flat behaviour until it is
// grouped too.

export interface DashboardNavItem {
  href: string;
  label: string;
  permission?: string;
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
  isManufacturing: boolean;
  hasFinance: boolean;
  standalone: boolean;
  staffCount: number;
  canViewAllStations: boolean;
  stations: NavStation[];
  /** Role-based check used to filter every menu item by its `permission`. */
  hasPermission: (key: string) => boolean;
  t: (key: string) => string;
}

// Which feature a dashboard route requires, for per-business-type route guarding.
export const routeFeatureMap: Record<
  string,
  "inventory" | "retail" | "pos" | "rooms"
> = {
  "/dashboard/products": "inventory",
  "/dashboard/locations": "inventory",
  "/dashboard/restock": "inventory",
  "/dashboard/requests": "retail",
  "/dashboard/sales": "retail",
  "/dashboard/purchases": "retail",
  "/dashboard/prices": "retail",
  "/dashboard/credits": "retail",
  "/dashboard/food/orders": "pos",
  "/dashboard/food/kitchen": "pos",
  "/dashboard/food/bar": "pos",
  "/dashboard/food/barista": "pos",
  "/dashboard/food/station": "pos",
  "/dashboard/food/menu": "pos",
  "/dashboard/hotel": "rooms",
};

// Routes that require a specific permission (checked on top of the feature map).
export const routePermissionMap: Record<string, string> = {
  // Retail / shared
  "/dashboard/products": "products.view",
  "/dashboard/restock": "restock.create",
  "/dashboard/requests": "requests.view",
  "/dashboard/sales": "sales.view",
  "/dashboard/purchases": "purchases.view",
  "/dashboard/prices": "prices.view",
  "/dashboard/credits": "credits.view",
  "/dashboard/locations": "locations.manage",
  "/dashboard/users": "users.view",
  "/dashboard/roles": "roles.manage",
  "/dashboard/reports": "reports.view",
  "/dashboard/finance": "finance.view",
  "/dashboard/food/orders": "restaurant.take-orders",
  "/dashboard/food/kitchen": "kitchen.view",
  "/dashboard/food/bar": "bar.view",
  "/dashboard/food/barista": "barista.view",
  "/dashboard/food/station": "kitchen.view",
  "/dashboard/food/menu": "restaurant.manage",
  "/dashboard/payment-methods": "finance.view",
  "/dashboard/taxes": "finance.view",
  "/dashboard/accounts": "finance.view",
  "/dashboard/finance/ledger": "finance.view",
  "/dashboard/finance/settings/mappings": "finance.view",
  "/dashboard/forecast": "ai.view",
  "/dashboard/agent": "agent.manage",
};

export function buildDashboardNav(ctx: NavBuildContext): DashboardNav {
  const t = ctx.t;

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
    inventory.items.push(
      {
        href: "/dashboard/products",
        label: t("nav.products"),
        permission: "products.view",
      },
      {
        href: "/dashboard/restock",
        label: t("nav.restock"),
        permission: "restock.create",
      },
    );
    if (!ctx.standalone) {
      inventory.items.push({
        href: "/dashboard/locations",
        label: t("nav.locations"),
        permission: "locations.manage",
      });
    }
    if (ctx.staffCount > 0) {
      inventory.items.push({
        href: "/dashboard/requests",
        label: t("nav.requests"),
        permission: "requests.view",
      });
    }
    sales.items.push(
      { href: "/dashboard/sales", label: t("nav.sales"), permission: "sales.view" },
      { href: "/dashboard/purchases", label: t("nav.purchases"), permission: "purchases.view" },
      { href: "/dashboard/prices", label: t("nav.prices"), permission: "prices.view" },
      { href: "/dashboard/credits", label: t("nav.credits"), permission: "credits.view" },
    );
  }

  if (ctx.hasBusiness && ctx.hasFinance) {
    finance.items.push(
      { href: "/dashboard/finance", label: t("nav.finance"), permission: "finance.view" },
      { href: "/dashboard/payment-methods", label: t("nav.paymentMethods"), permission: "finance.view" },
      { href: "/dashboard/taxes", label: t("nav.taxes"), permission: "finance.view" },
      { href: "/dashboard/accounts", label: t("nav.accounts"), permission: "finance.view" },
      { href: "/dashboard/finance/ledger", label: t("nav.generalLedger"), permission: "finance.view" },
      { href: "/dashboard/finance/settings/mappings", label: t("nav.accountMappings"), permission: "finance.view" },
    );
  }

  if (ctx.hasBusiness) {
    administration.items.push(
      { href: "/dashboard/users", label: t("nav.manageUsers"), permission: "users.view" },
      { href: "/dashboard/roles", label: t("nav.rolesPermissions"), permission: "roles.manage" },
      { href: "/dashboard/reports", label: t("nav.reports"), permission: "reports.view" },
      { href: "/dashboard/forecast", label: t("nav.aiForecast"), permission: "ai.view" },
      { href: "/dashboard/agent", label: t("nav.aiAgent"), permission: "agent.manage" },
    );
  }

  if (ctx.hasBusiness && ctx.isManufacturing) {
    manufacturing.items.push(
      { href: "/dashboard/manufacturing/production", label: t("nav.production"), permission: "manufacturing.view" },
      { href: "/dashboard/manufacturing/boms", label: t("nav.billOfMaterials"), permission: "manufacturing.view" },
      { href: "/dashboard/manufacturing/catalog", label: t("nav.designCatalog"), permission: "manufacturing.view" },
      { href: "/dashboard/manufacturing/orders", label: t("nav.jobs"), permission: "manufacturing.view" },
      { href: "/dashboard/manufacturing/teams", label: t("nav.teams"), permission: "manufacturing.view" },
      { href: "/dashboard/manufacturing/flows", label: t("nav.flows"), permission: "manufacturing.view" },
      { href: "/dashboard/manufacturing/services", label: t("nav.servicesIncome"), permission: "manufacturing.view" },
      { href: "/dashboard/manufacturing/materials", label: t("nav.materialsIssues"), permission: "manufacturing.view" },
      { href: "/dashboard/manufacturing/purchasing", label: t("nav.purchasing"), permission: "manufacturing.view" },
      { href: "/dashboard/manufacturing/receipts", label: t("nav.stockReceipts"), permission: "manufacturing.view" },
      { href: "/dashboard/manufacturing/machines", label: t("nav.machines"), permission: "manufacturing.view" },
      { href: "/dashboard/manufacturing/shifts", label: t("nav.shifts"), permission: "manufacturing.view" },
      { href: "/dashboard/manufacturing/workers", label: t("nav.workers"), permission: "manufacturing.view" },
      { href: "/dashboard/manufacturing/settings", label: t("nav.settings"), permission: "manufacturing.manage" },
    );
  }

  const groupOrder = [overview];
  if (ctx.hasBusiness && ctx.isManufacturing) groupOrder.push(manufacturing);
  groupOrder.push(inventory, sales, finance, administration);
  let groups = groupOrder.filter((g) => g.items.length > 0);

  // Not-yet-grouped links keep their flat behaviour and relative order.
  const loose: DashboardNavItem[] = [];
  if (ctx.hasBusiness && ctx.isHospitality) {
    loose.push(
      { href: "/dashboard/food/orders", label: t("nav.orders"), permission: "restaurant.take-orders" },
      ...ctx.stations.map((s) => ({
        href: `/dashboard/food/station/${s.key}`,
        label: s.nameLocalized ?? s.name,
        permission: ctx.canViewAllStations
          ? undefined
          : (s.permissionView ?? "kitchen.view"),
      })),
      { href: "/dashboard/food/menu", label: t("nav.menu"), permission: "restaurant.manage" },
      { href: "/dashboard/cashier", label: t("nav.cashier"), permission: "cashier.view" },
      { href: "/dashboard/hotel", label: t("nav.roomService"), permission: "hotel.view" },
    );
  }
  if (ctx.hasBusiness && ctx.isService) {
    loose.push(
      { href: "/dashboard/service", label: t("nav.serviceOverview"), permission: "service.view" },
      { href: "/dashboard/service/catalog", label: t("nav.serviceCatalog"), permission: "service.view" },
      { href: "/dashboard/service/bookings", label: t("nav.serviceBookings"), permission: "service.view" },
      { href: "/dashboard/service/tickets", label: t("nav.serviceTickets"), permission: "service.view" },
      { href: "/dashboard/service/clients", label: t("nav.serviceClients"), permission: "service.view" },
      { href: "/dashboard/service/settings", label: t("nav.settings"), permission: "service.manage" },
    );
  }


  return {
    // Role-based visibility: drop every item whose declared permission the
    // user's role doesn't grant. Items without a permission stay governed by
    // the business-type/feature flags above (e.g. owner-only pages).
    groups: groups
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (i) => !i.permission || ctx.hasPermission(i.permission),
        ),
      }))
      .filter((g) => g.items.length > 0),
    loose: loose.filter(
      (l) => !l.permission || ctx.hasPermission(l.permission),
    ),
  };
}
