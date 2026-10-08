# Plan — Per-business (tenant) reports, finance, dashboard, nav & permissions

> **STATUS: IMPLEMENTED (option 1a).** Retail flows are untouched. See the
> "Implementation summary" at the bottom.

## Confirmed decisions

1. **Make surfaces business/tenant-specific where possible; otherwise hide.**
   The reports/finance pages already read `activeMembership.businessType`
   (`frontend/app/dashboard/layout.tsx:37`) and the backend already accepts
   `businessType` in places, so we make each surface branch on the **active
   business type** and only fall back to hiding a generic link when a surface
   has no business-specific meaning.
2. **Every permission list must be business/tenant-specific.** Drop
   `Products`/`Categories` (and the retail `Reports`/`Finance`) from the Car
   Wash permission groups. `RolesService.findPermissions()` already resolves the
   active tenant's `businessType` and filters groups by
   `PERMISSION_GROUPS_BY_BUSINESS_TYPE` — so the backend gate is correct; only
   the CAR_WASH group list is wrong. Also prune stale grants from existing
   Car Wash roles.

## Core principle

Each vertical owns its own dashboard, reports, finance and nav. A business must
never see another vertical's data or permission groups. Implement by branching on
the **active business type** (not hardcoding a single vertical), so retail,
hospitality, manufacturing, service and car wash each render their own content.

## Verified facts

- **Nav** — `frontend/lib/dashboardNavigation.ts`:
  - `carWash` group exists (`/dashboard/carwash/*`).
  - `finance` group (`/dashboard/finance`, payment-methods, taxes, accounts,
    ledger, mappings) and `administration` group (`/dashboard/reports`,
    forecast, purchase-orders) are pushed for **all** businesses.
- **Reports page** — `frontend/app/dashboard/reports/page.tsx` branches on
  `isManufacturing`/`isHospitality` only; CAR_WASH falls to the retail tabs
  (`/reports/inventory-breakdown`, `low-stock`, `dead-stock`). Backend
  `reports.controller.ts` has no `@Vertical`.
- **Finance page** — `frontend/app/dashboard/finance/page.tsx` `verticalCards`
  has MANUFACTURING/HOSPITALITY/SERVICE branches, no CAR_WASH (falls to retail
  chart of accounts). `finance.controller.ts` already accepts a `businessType`
  query in some endpoints.
- **Dashboard** — `frontend/app/dashboard/page.tsx` renders
  `<CarWashDashboard />`; `CarWashDashboard.tsx` branches on backend `role`
  ("washer" vs staff) but has **no filters**.
- **Permissions** — `inventory-backend/src/roles/roles.service.ts:48`
  `findPermissions()` resolves the active tenant's business type and filters by
  `PERMISSION_GROUPS_BY_BUSINESS_TYPE[org.businessType]`. The CAR_WASH entry
  (`inventory-backend/src/common/permissions.ts`) wrongly includes `Products`,
  `Categories`, `Reports`, `Finance`. The roles panel re-adds any permission a
  role already holds (stale grants stay visible).
- **Car Wash store items** use `/carwash/store-items` gated by
  `carwash.equipment.*`, **not** the generic `/products` endpoints — so dropping
  `Products`/`Categories` permissions is safe.
- **Reusable filter UI** — `frontend/app/components/ListFilters.tsx`
  (`ListFilters`, `SearchField`, `SelectField`, `DateField`, `CheckboxField`),
  plus the pure `getDateRange()` preset helper in
  `frontend/app/components/DateFilter.tsx`. Used by every carwash list page.

## Work plan

### A. Permissions — business-specific catalog (do first; unblocks testing)

Files: `inventory-backend/src/common/permissions.ts`,
`inventory-backend/src/common/carwash-role-permissions.ts`,
new `inventory-backend/prisma/backfill-carwash-permission-prune.ts`.

1. Curate `PERMISSION_GROUPS_BY_BUSINESS_TYPE[CAR_WASH]` to **carwash-only**
   groups:
   - `Dashboard`, `Car Wash - Washers`, `Car Wash - Prices`,
     `Car Wash - Vehicles`, `Car Wash - Bookings`, `Car Wash - Washes`,
     `Car Wash - Equipment`, `Car Wash - Expenses`, `Car Wash - Collections`,
     `Car Wash - Reports`, `Car Wash - Settings`, `Customers`, `Users`, `Roles`,
     `AI`, `Agent`.
   - **Remove**: `Products`, `Categories`, `Reports`, `Finance`.
2. Audit the other verticals' lists the same way (retail should not include
   hotel/kitchen groups etc.) — the map is the single source of truth.
3. Verify `CAR_WASH_ROLE_GRANTS` (owner = `ALL_PERMISSION_KEYS` filtered by
   `CAR_WASH_PERMISSION_KEYS`) contains only carwash + `dashboard.view` +
   `customers.*`.
4. Add idempotent `backfill-carwash-permission-prune.ts`: for every CAR_WASH
   organization role, remove `rolePermission` rows whose permission group is not
   in the CAR_WASH allow-list. Reuse the pattern in
   `backfill-carwash-role-permissions.ts`. Invoke via the entrypoint's existing
   `RUN_BACKFILLS=1` hook (`docker/entrypoint.sh`).
5. (Optional) After the prune, the roles panel's "re-add held-out-of-filter"
   behaviour becomes a no-op for Car Wash, so no frontend change is required.
   If we want belt-and-braces, filter the panel's `grouped` output by the
   endpoint's group set — but the prune is the real fix.

### B. Dashboard — filters + role awareness (auto-apply)

Files: `frontend/app/components/CarWashDashboard.tsx`,
`inventory-backend/src/carwash/carwash.{controller,service}.ts`.

1. Backend: extend `GET /carwash/dashboard` and `GET /carwash/summary` with
   optional `startDate`, `endDate`, `washerId`, `washTypeId`, `vehicleType`.
   - Washers: force their `washerId` via `washerScope()`; ignore any supplied
     `washerId` (cannot widen scope).
   - Owner/manager may pass `washerId`.
   - Keep `role`, `daily[]` and all existing fields; no-param calls unchanged.
2. Frontend: add `ListFilters` with date presets (`getDateRange()`), two
   `DateField`s, `SelectField` washer (hidden for washers), `SelectField` wash
   type, `SearchField`. Auto-apply via `useEffect` keyed on the filter values.
   - Washers: date range + wash type apply to their **personal** tiles/chart.
   - Owner/manager: full filters + a period-totals strip so changes are visible.

### C. Reports — per-business content

Files: `frontend/app/dashboard/reports/page.tsx`,
`inventory-backend/src/reports/reports.{controller,service}.ts`,
`frontend/app/dashboard/carwash/reports/page.tsx`,
`frontend/lib/dashboardNavigation.ts`.

1. Add a `CAR_WASH` branch to `reports/page.tsx` tabs so a Car Wash business
   never renders retail tabs:
   - Tabs: Revenue & Commission, Washers, Equipment, Expenses (sourced from
     `/carwash/reports/breakdown`, `/carwash/commissions`).
   - Gate all retail fetches (`/reports/inventory-breakdown`, `low-stock`,
     `dead-stock`) behind `!isCarWash`.
2. Update `/carwash/reports` with `ListFilters` (date preset + washer select),
   **auto-apply**, and a role guard (redirect roles lacking
   `carwash.reports.view` to `/carwash/washer-reports`).
3. Nav: replace the generic `/dashboard/reports` entry for CAR_WASH with the
   carwash reports links (already in the `carwash` group) — i.e. only push the
   `administration.reports` item when `!ctx.isCarWash`.
4. Make the same `businessType` branching explicit in `reports.service.ts`
   where it currently assumes retail (return empty/vertical-appropriate data
   instead of retail inventory figures for non-retail callers).

### D. Finance — per-business content

Files: `frontend/app/dashboard/finance/page.tsx` (or a dedicated branch),
`frontend/app/dashboard/carwash/{collection,expenses}/page.tsx`,
`inventory-backend/src/finance/finance.{controller,service}.ts`,
`frontend/lib/dashboardNavigation.ts`.

1. Add a `CAR_WASH` branch to `finance/page.tsx` `verticalCards` driven by the
   active `businessType`:
   - Cards: Wash Revenue, Equipment Revenue, Washer Commission, Owner Share,
     Car Wash Expenses, Net Profit (from `/carwash/summary` +
     `/carwash/reports/breakdown`).
   - Guard all retail account lookups (`/finance/accounts`, `/finance/incomes`,
     chart-of-accounts mapping) behind the retail/accounting verticals; for
     CAR_WASH fetch carwash finance endpoints instead.
2. Treat the Car Wash **Collection** and **Expenses** pages as its finance
   surface:
   - Add `ListFilters` (date presets + two `DateField`s; expenses add category
     `SelectField` + `SearchField`) with **auto-apply**.
   - Backend: add optional `startDate/endDate` to `GET /carwash/collections`
     and `category`/`search` to `GET /carwash/expenses` (dates already exist on
     expenses).
3. Nav: for CAR_WASH, hide the generic accounting `finance` group (it maps to a
   retail chart of accounts a car wash doesn't use); its finance lives in the
   `carwash` group. Gate the `finance` group push with a "vertical uses
   accounting" check.

### E. Nav bar — business-specific routes

File: `frontend/lib/dashboardNavigation.ts`.

- `finance` group: push only when the vertical actually uses the accounting
  module (RETAIL / MANUFACTURING / HOSPITALITY / SERVICE). Skip for CAR_WASH.
- `administration` group: keep `users`/`forecast`/`agent`; skip the retail
  `/dashboard/reports` for CAR_WASH (use the carwash report links).
- Add a guard so future verticals can't accidentally inherit another vertical's
  groups (e.g. assert each pushed item's prefix matches the vertical's allowed
  prefixes).
- Keep the `carwash` group first via `groupOrder`.

### F. i18n

Add the new `carwash.*` filter/preset/period keys and any new `reports.*` /
`fin.*` CAR_WASH labels to **both** `frontend/lib/locales/en/common.json` and
`frontend/lib/locales/am/common.json`.

## Verification

- Backend: `npx tsc --noEmit`; run `npx jest` (extend carwash specs for new
  params + forced washer scope; add a roles spec asserting the CAR_WASH catalog
  excludes `Products/Categories/Reports/Finance`).
- Frontend: `npx tsc --noEmit` / `npm run build`.
- Manual matrix (owner / manager / washer / view-only) × (dashboard, reports,
  finance, collection, expenses, roles, nav):
  - Car Wash shows only carwash data + only carwash permission groups.
  - Retail/hospitality/manufacturing/service each still show their own.
  - Filters auto-apply and change totals; washers only ever see their own data.
  - No generic `/dashboard/finance` or `/dashboard/reports` links for Car Wash.
  - Default (no-filter) load matches today's numbers.

## Risks / notes

- Hiding the generic finance/reports links for Car Wash is a user-visible
  behavior change — confirm Collection/Expenses cover what owners need first.
- The permission catalog change + prune must ship together, otherwise the roles
  editor hides keys that roles still hold (the panel re-adds them, but the
  backfill keeps it clean).
- All new query params remain optional; existing deep links keep working.
- Tenant scoping: reuse existing `CarWash*` models (in `TENANT_MODELS`) and
  `washerScope()`; never allow a washer to widen scope via a query param.

---

## Implementation summary

Every change is additive and Car Wash-only. **Retail code paths are untouched**
(the retail `reports/page.tsx` and `finance/page.tsx` were not modified).

### A. Tenant-specific permission catalog
- `inventory-backend/src/common/permissions.ts`: removed `Products`,
  `Categories`, `Reports`, `Finance` from
  `PERMISSION_GROUPS_BY_BUSINESS_TYPE[CAR_WASH]`. The roles editor
  (`RolesService.findPermissions`, already tenant-aware) now returns only
  car-wash groups.
- `inventory-backend/prisma/backfill-carwash-permission-prune.ts`: new
  idempotent backfill that strips foreign-group grants from every role in a
  CAR_WASH org; wired into `docker/entrypoint.sh` under `RUN_BACKFILLS=1`.
- `permissions.spec.ts`: new test asserting the CAR_WASH catalog has no foreign
  groups and still has all car-wash groups.

### B. Dashboard filters + role awareness (auto-apply)
- Backend `GET /carwash/dashboard` + `/carwash/summary` accept
  `startDate/endDate/washerId/washTypeId/vehicleType`; dates parsed as local
  calendar days; a washer's scope is forced (`washerScope()`), owner/manager may
  narrow to one washer.
- `CarWashDashboard.tsx`: reusable `ListFilters` (period preset, two date
  fields, washer + wash-type selects, search) with **auto-apply**; washer view
  keeps only filters they may use (wash-type gated by `carwash.prices.view`).
- `carwash-dashboard.spec.ts`: 4 tests covering range, forced washer scope,
  owner narrowing, and echoed range.

### C. Reports — Car Wash-specific
- `dashboardNavigation.ts`: the generic `/dashboard/reports` link is **not**
  pushed for CAR_WASH (its reports live in the carwash group).
- `dashboard/layout.tsx` + `businessTypesForRoute()`: `/dashboard/reports`
  redirects to `/dashboard` for CAR_WASH (typed URL / stale bookmark).
- `/dashboard/carwash/reports` now uses `ListFilters` (period + dates) with
  auto-apply.

### D. Finance — Car Wash-specific
- The generic accounting `finance` group is **not** pushed for CAR_WASH;
  `/dashboard/finance`, `/dashboard/accounts`, `/dashboard/payment-methods`,
  `/dashboard/taxes`, `/dashboard/finance/ledger`, `.../mappings` redirect to
  `/dashboard` for CAR_WASH.
- Car Wash's finance surface is `/dashboard/carwash/collection` and
  `.../expenses`, both updated with `ListFilters` + auto-apply; backend
  `GET /carwash/collections` accepts `startDate/endDate` and
  `GET /carwash/expenses` accepts `startDate/endDate/category/search`.

### E. Nav
- `finance` group gated with `!ctx.isCarWash`; `administration.reports` skipped
  for CAR_WASH. Retail/hospitality/manufacturing/service nav unchanged.

### F. i18n
- Added 10 `carwash.*` filter keys to both `en` and `am`.

### Verification
- Backend: `tsc --noEmit` clean; `npx jest` → 40 suites / 403 tests pass.
- Frontend: `tsc --noEmit` clean; `next build --webpack` compiles successfully.
- Nav sanity: CAR_WASH nav has no `/dashboard/finance` or `/dashboard/reports`
  links; RETAIL still has both.
- Retail `reports/page.tsx` and `finance/page.tsx`: **unmodified**.
