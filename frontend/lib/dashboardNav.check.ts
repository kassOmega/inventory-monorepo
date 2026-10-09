// lib/dashboardNav.check.ts
// Runnable sanity check for the mobile quick-action resolution. The frontend has
// no test runner, so this is a plain script: `npx tsx lib/dashboardNav.check.ts`.
// Exits non-zero on failure.
import { buildDashboardNav, quickActionsFor } from "./dashboardNavigation";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (!cond) {
    failures++;
    // eslint-disable-next-line no-console
    console.error("FAIL:", msg);
  }
}

const t = (k: string) => k;
const base = {
  isPlatformAdmin: false,
  isOwnerAccount: true,
  hasBusiness: true,
  standalone: false,
  staffCount: 2,
  canViewAllStations: true,
  stations: [{ key: "kitchen", name: "Kitchen", permissionView: "kitchen.view" }],
  services: [
    { serviceType: "FOOD_AND_BEVERAGE", isEnabled: true },
    { serviceType: "ACCOMMODATION", isEnabled: true },
  ],
  hasPermission: () => true,
  t,
};

const navFor = (over: any) => buildDashboardNav({ ...base, ...over } as any);

// Owner (all permissions): each tenant resolves its full list in order.
check(
  quickActionsFor(navFor({ isCarWash: true, isRetail: false, isHospitality: false, isService: false, isManufacturing: false, hasFinance: true }), [
    "/dashboard",
    "/dashboard/carwash/reports",
    "/dashboard/carwash/washer-reports",
    "/dashboard/carwash/washes",
    "/dashboard/carwash/expenses",
    "/dashboard/carwash/washers",
  ]).map((i) => i.href).join(",") ===
    "/dashboard,/dashboard/carwash/reports,/dashboard/carwash/washer-reports,/dashboard/carwash/washes,/dashboard/carwash/expenses,/dashboard/carwash/washers",
  "car wash owner quick actions",
);

// Washer (limited perms): only permitted actions survive.
const washerNav = buildDashboardNav({
  ...base,
  isCarWash: true,
  isRetail: false,
  isHospitality: false,
  isService: false,
  isManufacturing: false,
  hasFinance: true,
  isOwnerAccount: false,
  hasPermission: (k: string) =>
    ["dashboard.view", "carwash.reports.view"].includes(k),
} as any);
check(
  quickActionsFor(washerNav, [
    "/dashboard",
    "/dashboard/carwash/reports",
    "/dashboard/carwash/washes",
    "/dashboard/carwash/expenses",
    "/dashboard/carwash/washers",
  ]).map((i) => i.href).join(",") ===
    "/dashboard,/dashboard/carwash/reports",
  "washer quick actions are permission-filtered",
);

// Hospitality resolves the station board via the `match` prefix.
check(
  quickActionsFor(navFor({ isRetail: false, isHospitality: true, isService: false, isManufacturing: false, isCarWash: false, hasFinance: true }), [
    "/dashboard/food/station/kitchen",
  ]).length === 1,
  "hospitality station board resolves",
);

// Unknown hrefs are dropped (never rendered without a nav entry).
check(
  quickActionsFor(navFor({ isCarWash: true, isRetail: false, isHospitality: false, isService: false, isManufacturing: false, hasFinance: true }), [
    "/dashboard/carwash/does-not-exist",
  ]).length === 0,
  "unknown href dropped",
);

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} dashboard nav check(s) failed.`);
  process.exit(1);
}
// eslint-disable-next-line no-console
console.log("dashboardNavigation: all checks passed");
