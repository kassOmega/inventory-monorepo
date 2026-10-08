// src/lib/dashboardRoutes.check.ts
//
// Runnable sanity check for the route registry (the single source of truth for
// both the sidebar and the route guard). The frontend has no test runner, so this
// is a plain script: run it with `npx tsx lib/dashboardRoutes.check.ts`. It exits
// non-zero on the first failure, so CI can gate on it.
//
// It guards the "menu hides it but a typed URL still opens it" drift.
import {
  DASHBOARD_ROUTES,
  routeFor,
  canAccess,
  routePermissionMap,
  verticalForRoute,
} from "./dashboardRoutes";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (!cond) {
    failures++;
    // eslint-disable-next-line no-console
    console.error("FAIL:", msg);
  }
}
const flat = (r: string | string[]) => (Array.isArray(r) ? r : [r]);
const has = (keys: string[]) => (k: string) => keys.includes(k);

// No duplicate paths.
check(
  new Set(DASHBOARD_ROUTES.map((r) => r.path)).size === DASHBOARD_ROUTES.length,
  "duplicate route paths",
);

// Exact + dynamic resolution.
check(routeFor("/dashboard/carwash/washes")?.read === "carwash.washes.view", "carwash/washes read");
check(JSON.stringify(routeFor("/dashboard/credits/123")?.read) === JSON.stringify(["credits.view", "credits.manage"]), "credits/:id dynamic");
check(routeFor("/dashboard/customers/abc") !== null, "customers/:id dynamic");
check(routeFor("/dashboard/food/station/kitchen")?.read === "kitchen.view", "food station dynamic");
check(routeFor("/nope") === null, "unknown route → null");

// Manufacturing routes are guarded (the reported gap).
for (const p of [
  "/dashboard/manufacturing/production",
  "/dashboard/manufacturing/boms",
  "/dashboard/manufacturing/orders",
  "/dashboard/manufacturing/settings",
]) {
  const e = routeFor(p);
  check(!!e && flat(e.read).includes("manufacturing.view"), `manufacturing guard ${p}`);
}

// Any-of read semantics.
check(canAccess("/dashboard/manufacturing/boms", has(["manufacturing.view"])) === true, "mfg view grants");
check(canAccess("/dashboard/manufacturing/boms", has(["manufacturing.manage"])) === true, "mfg manage grants");
check(canAccess("/dashboard/manufacturing/boms", has(["products.view"])) === false, "mfg denies others");
check(canAccess("/dashboard", () => false) === true, "permission-less route open");

// Washer baseline cannot reach operational pages, can reach reports.
const washer = has(["dashboard.view", "carwash.reports.view"]);
for (const p of [
  "/dashboard/carwash/washes",
  "/dashboard/carwash/bookings",
  "/dashboard/carwash/collection",
  "/dashboard/carwash/equipment",
  "/dashboard/carwash/store-items",
  "/dashboard/carwash/expenses",
]) {
  check(canAccess(p, washer) === false, `washer blocked ${p}`);
}
check(canAccess("/dashboard/carwash/reports", washer) === true, "washer reports");
check(canAccess("/dashboard/carwash/washer-reports", washer) === true, "washer own reports");

// Derived map matches the registry.
for (const r of DASHBOARD_ROUTES) {
  check(
    JSON.stringify(routePermissionMap[r.path]) === JSON.stringify(r.read),
    `permission map ${r.path}`,
  );
}

// Vertical ownership.
check(verticalForRoute("/dashboard/carwash/washes") === "CAR_WASH", "vertical carwash");
check(verticalForRoute("/dashboard/manufacturing/boms") === "MANUFACTURING", "vertical mfg");
check(verticalForRoute("/dashboard/products") === null, "vertical shared");

if (failures > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures} route-registry check(s) failed.`);
  process.exit(1);
}
// eslint-disable-next-line no-console
console.log("dashboardRoutes: all checks passed");
