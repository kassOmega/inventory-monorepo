# Plan — Full refactor: single CRUD-permission-driven route registry

## Confirmed direction

Full refactor. Every route's access is derived from a **single registry** keyed on
the CRUD permission model (`.view` for read/route access; `.create` / `.edit` /
`.delete` gated on actions). The sidebar, the route guard, and in-page link bars
all read from the same source so they can never drift again.

## Reported bug (verified)

- The **sidebar is correct**: for a Washer (baseline `dashboard.view` +
  `carwash.reports.view`) it shows only Dashboard + Car Wash Reports +
  Washer Reports.
- The bug is the **in-page link bars / quick actions**, which are hand-written
  and unguarded:
  - `frontend/app/components/CarWashReport.tsx` footer → `/carwash/washes`,
    `/carwash/collection`, `/carwash/expenses` rendered unconditionally.
  - `frontend/app/components/CarWashDashboard.tsx` washer branch → "Record Wash"
    link without a `hasPermission` check.
  - `frontend/app/components/ServiceDashboard.tsx` → 3 quick-action links without
    checks.
- Route guard gap: **all `/dashboard/manufacturing/*` routes** have permissions in
  the sidebar but **no `routePermissionMap` entry**, so a typed URL bypasses the
  permission check (only the vertical guard fires).

## Permission model (verified)

65 keys; resources use `resource.view|create|edit|delete` (e.g.
`products.view/create/edit/delete`, `carwash.washes.view/create/edit/delete`).
Some resources use action-specific keys (`sales.return`, `restock.create`,
`purchases.approve`, `requests.*`, `carwash.equipment.issue`,
`carwash.collections.create`, `reports.full`, `reports.view_cost_valuation`).
Routing/read access for a resource = its `.view` key (or the documented union,
e.g. users = `users.view|users.manage|roles.manage`).

## Design decision

### 1. `frontend/lib/dashboardRoutes.ts` — the single source of truth

A typed, dependency-free registry. Each route entry:

```ts
interface DashboardRoute {
  path: string;                 // exact path or ":param" pattern
  read: string | string[];      // CRUD read permission(s); [] = no permission
  feature?: "inventory" | "retail" | "pos" | "rooms";
  vertical?: BusinessTypeOwner; // exclusive-vertical route
  businessTypes?: string[];     // restricted shared routes
  ownerOnly?: boolean;
  platformAdminOnly?: boolean;
  match?: string[];             // extra prefixes for active highlighting
}
```

Coverage: **every** `/dashboard/**` route, including all manufacturing routes
(read `manufacturing.view`; `/settings` → `manufacturing.manage`), carwash,
hospitality, service, retail, admin, and the dynamic routes
(`/dashboard/customers/[id]`, `/dashboard/credits/[id]`,
`/dashboard/food/station/[key]`, `/dashboard/hospitality/service/[key]`).

Helper resolvers:
- `routeFor(pathname)` → the matching entry (exact then pattern), or null.
- `canAccessRoute(entry, hasPermission)` → boolean.
- `requiredPermission(entry)` / `requiredFeature` / `requiredVertical`.

### 2. `dashboardNavigation.ts` builds the menu from the registry

- Keep the **public API** (`buildDashboardNav`, `DashboardNav`,
  `NavBuildContext`, `PRIMARY_NAV_GROUP_KEYS`, `isNavItemActive`, `primaryNavGroups`,
  `activeNavGroupKeys`, `verticalForRoute`, `businessTypesForRoute`) so
  `layout.tsx`, `SidebarMenu`, `MobileQuickNav` don't break.
- Re-derive the legacy maps from the registry (kept as generated exports for
  compatibility, or remove and update the two importers — prefer keeping them
  generated):
  - `routePermissionMap` ← `{ entry.path: entry.read }`
  - `routeFeatureMap` ← `{ entry.path: entry.feature }`
  - `verticalRoutePrefixes` ← grouped by `entry.vertical`
  - `routeBusinessTypes` ← `{ entry.path: entry.businessTypes }`
- Each nav `items.push({...})` reads its `permission` from the registry entry for
  that href (no more hand-copied permission strings), so **menu visibility ==
  route access** by construction.
- Keep the business-type gating (`ctx.isRetail`, `isCarWash`, hospitality
  services, `staffCount`, `standalone`) exactly as today — the registry adds the
  permission/feature/vertical layer only.

### 3. `layout.tsx` uses the registry resolver

- Replace the several bespoke lookups (`routeFeatureMap`, `routePermissionMap`,
  `verticalForRoute`, `businessTypesForRoute`, station/customer/service regexes)
  with one `routeFor(pathname)` + the derived checks.
- Keep the owner-only / verification / platform-admin effects (they encode
  lifecycle rules, not CRUD) but source their path predicates from
  `entry.ownerOnly` / `entry.platformAdminOnly`.
- Effect: the **manufacturing permission guard now fires**, and every future
  route is guarded automatically once registered.

### 4. A shared route-access hook + gate for pages and link bars

- `frontend/lib/useRouteAccess.ts` (or `components/RequirePermission.tsx`):
  `canAccess(pathname)` = registry read-permission check, reusing
  `useAuth().hasPermission`.
- Use it to **gate the in-page link bars** (the reported bug):
  - `CarWashReport` footer: render each link only if `canAccess('/dashboard/carwash/washes'|...)`.
  - `CarWashDashboard` washer "Record Wash": gate on `carwash.washes.create`
    (action, not the read key).
  - `ServiceDashboard` quick actions: gate via `canAccess`.
- This makes the bars correct without repeating permission strings.

### 5. CRUD-action gating review (belt and braces)

- Audit each page's create/edit/delete buttons to ensure they use the resource's
  `.create`/`.edit`/`.delete` key consistently (most already do; the reported
  bug was the missing read/route gate). Fix any that gate buttons on the wrong
  key or not at all.

### 6. Test — prevent recurrence

`frontend/lib/dashboardRoutes.spec.ts` (node, no browser):
- every nav item href resolves to a registry entry with a `read` (or an explicit
  allow-list entry),
- every registry `feature`/`vertical` is used,
- no two routes share a path,
- every in-page `Link href="/dashboard/..."` string resolves to a registry route
  (a small grep-style test), so unguarded links are caught,
- menu visibility and route access use the **same** `read` permission.

## Verification

- `tsc --noEmit`, `next build --webpack`, `jest` (backend unaffected but run).
- Role matrix (retail / manufacturing / hospitality / service / car wash ×
  owner / manager / staff / washer):
  - sidebar shows only permitted items;
  - typed hidden URL (incl. `/dashboard/manufacturing/*`) redirects;
  - in-page link bars show only permitted links;
  - washer dashboard/report show no wash/collection/expense/equipment links.

## Risks / notes

- `dashboardNavigation.ts` is large and imported by the sidebar + mobile nav —
  keep exports stable; refactor internals only.
- Dynamic routes need pattern matching (`:param`); implement a small matcher
  rather than regexes scattered in the layout.
- Some routes are intentionally permission-less (`/dashboard`, `/profile`,
  owner-only pages) — the registry marks `read: []` and the guard allows them,
  preserving current behaviour.
- No backend changes; this only aligns frontend visibility + routing with the
  existing CRUD permission catalog.

---

## Implementation summary (delivered)

**Single source of truth — `frontend/lib/dashboardRoutes.ts`**
- `DASHBOARD_ROUTES`: every `/dashboard/**` route (including all
  manufacturing routes, which previously had no guard) with `read` (CRUD read
  permission or union mirroring the backend `@Permissions`), plus
  `feature`/`vertical`/`businessTypes`/`ownerOnly`/`platformAdminOnly`.
- `routeFor(pathname)` exact-then-`:param` resolver, `canAccessRoute`/`canAccess`
  (any-of read), and derived `routePermissionMap`/`routeFeatureMap`/
  `verticalRoutePrefixes`/`routeBusinessTypes`/`businessTypesForRoute`/
  `verticalForRoute`.

**`dashboardNavigation.ts`**
- Removed the hand-maintained maps; re-exports the derived ones.
- Every nav item now reads its permission from the registry via `routeRead(href)`
  (stock tabs + customers union + station + custom-service included), so menu
  visibility and route access share one definition.

**`app/dashboard/layout.tsx`**
- Feature, vertical/business-type and permission guards now all resolve via
  `routeFor(pathname)` (no scattered regexes / parallel maps). The manufacturing
  permission guard now fires; lifecycle effects (owner-only, verification,
  admin) are unchanged.

**In-page link bars (the reported bug)**
- `CarWashReport` footer links and `ServiceDashboard` quick actions now gate via
  `canAccess(path, hasPermission)`; the washer "Record Wash" action gates on
  `carwash.washes.create`. A washer now sees only Dashboard + reports.

**Verification**
- `frontend/lib/dashboardRoutes.check.ts` — runnable registry check (no test
  runner in the frontend): `npx tsx lib/dashboardRoutes.check.ts` → all pass,
  including "washer blocked from washes/bookings/collection/equipment/store-items
  /expenses" and "manufacturing routes guarded".
- `tsc --noEmit` clean; `next build --webpack` compiles; layout lint error count
  unchanged (8 pre-existing, none new); backend suite 43/412 green.
