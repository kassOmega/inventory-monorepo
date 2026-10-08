# Plan — Render menus by permission + per-detail report permissions

## Confirmed decisions

1. **Do both**: run/keep the role backfill (reconcile stale grants) **and** add a
   shared client-side `<RequirePermission>` page guard.
2. **Report detail permissions + own related data**: each report section renders
   when the user holds that detail permission; additionally a user always sees
   their **own** related data (e.g. a washer sees their own washes/commission)
   even without the broader detail keys. Redaction is server-side.

## Reported issues

1. **Menu shows pages the role can't use.** Logged in as a **Washer**, the sidebar
   shows Overview, Bookings, Washes, Store Items, Equipment, …; clicking them
   shows "no permission".
2. **Reports expose all detail regardless of permission.** The car-wash report
   shows Total revenue, Washer commission, Owner share, Total expenses,
   Equipment revenue, Net profit, Total income, Washes, Washer earnings, Popular
   items, Paid equipment, Unpaid equipment, Low stock items — all of it to any
   caller who can open the report. Each detail should require the matching
   permission and render accordingly.

## Findings (verified)

### Issue 1 — why the washer still sees everything
- The frontend menu **does** filter by `hasPermission` (`buildDashboardNav` →
  `isPermitted`). Simulating a washer whose permissions are exactly
  `dashboard.view` + `carwash.reports.view` shows only Dashboard + Car Wash
  Reports + Washer Reports — correct.
- So the running washer must **still hold the old broad permissions in the DB**.
  The narrowing of the Washer baseline ships in `backfill-carwash-role-permissions`
  which only runs when **`RUN_BACKFILLS=1`** (`docker/entrypoint.sh`). Until that
  runs, the role still has `carwash.washes.view`, `carwash.bookings.view`,
  `carwash.equipment.view`, … → the menu correctly renders them, and the *page*
  then shows a "no permission" (403 toast from `lib/api.ts` → `errors.noPermission`)
  because the backend endpoint/action needs a key the role lacks.
- **Two contributing problems:**
  a. The **backfill hasn't run** on that environment, so stale grants remain.
  b. The menu is *permission-driven but not route-verifiable*: it trusts the
     stored `permissions[]`. If those are stale/over-broad, the menu over-shows.
- Also note `hasPermission` returns `true` for `isSuperuser`, and `isSuperuser`
  is `active?.isSystem` — only the **Owner** role is `isSystem`, so this is not
  the washer cause (but worth keeping in mind).

### Issue 2 — reports are gated coarsely, not per-detail
- The car-wash report endpoint `GET /carwash/reports/breakdown` is gated by
  `@Permissions('carwash.reports.view', 'carwash.collections.view')` and returns
  **one flat payload** containing every figure/list
  (`totalRevenue, totalCommission, ownerShare, totalExpenses,
  paidEquipmentRevenue, unpaidEquipmentRevenue, totalEquipmentRevenue,
  netProfit, totalIncome, washCount, washerEarnings, paidEquipmentByWasher,
  unpaidEquipmentByWasher, popularItems, lowStockItems, …`).
- The frontend `CarWashReport.tsx` renders every tile/card/table unconditionally.
- There is only **one** car-wash report permission key (`carwash.reports.view`);
  there is no finer key to separate owner financials from washer commission from
  equipment/inventory data. Retail has a precedent: `reports.view` vs
  `reports.full` vs `reports.view_cost_valuation`.

## Design decision

### A. Menu by permission — make it robust (both measures)
1. **Run the role backfill** so stale, over-broad grants are reconciled:
   `backfill-carwash-role-permissions` (idempotent; narrows system roles exactly
   to the baseline). Add/keep a comparable reconcile step for other verticals.
2. **Menu reflects effective access.** Keep the permission filter and the
   registry-derived read permission (already done in the routing refactor) so a
   route can never appear with a mismatched key.
3. **Shared `<RequirePermission>` guard** (`frontend/app/components/
   RequirePermission.tsx`): a small wrapper/hook used by dashboard pages:
   `hasPermission(required)` → render children; otherwise show a friendly
   "no permission" panel (and, when used at the route level, `router.replace`
   to `/dashboard`). This replaces the silent 403 toast with a graceful state and
   gives every page a single, consistent gate. Wire the car-wash (and other
   per-entity) pages that currently only gate buttons.

### B. Per-detail report permissions + own data
Add **granular report permission keys** and gate the API payload and the UI.

New keys (group `Car Wash - Reports`):
- `carwash.reports.financials` — Total revenue, Owner share, Total expenses,
  Net profit, Total income, Equipment revenue (owner money).
- `carwash.reports.commission` — Washer commission, Washer earnings.
- `carwash.reports.inventory` — Popular items, Low stock items.
- `carwash.reports.equipment` — Paid/Unpaid equipment (+ by-washer).

Rules:
- Page access: `carwash.reports.view` (a washer can still open the report).
- A **section** renders when the caller holds its detail key.
- **Own related data always allowed**: the caller's own figures are returned even
  without the detail key — e.g. a washer (only `carwash.reports.view`) sees their
  own `washCount` + `commission` (their `washerEarnings` row) but not company
  financials/inventory/equipment. This reuses the existing `washerScope(user)`
  which already restricts to the caller's linked `CarWashWasher`.
- Redaction is **server-side**: `reportsBreakdown` nulls/empties the fields the
  caller may not see, so data never leaks via the API. The UI then hides the
  corresponding cards.

Backend:
- `reportsBreakdown(..., user)`: compute the allowed sections from
  `user.permissions`; redact disallowed fields; when the caller is a washer, keep
  only their own commission/earnings (already scoped by `washerScope`).
- Extend the same redaction idea to other verticals where the same fields exist,
  but the concrete ask is the car-wash report.

Frontend (`CarWashReport.tsx`):
- Gate each tile/card/table on its detail permission via `hasPermission(...)`
  (and skip rendering when the API returned it redacted).
- Keep the chart/numeric toggle.

### C. Permission catalogue + role baselines
- Add the new keys to `PERMISSIONS` and `PERMISSION_GROUPS_BY_BUSINESS_TYPE`
  (CAR_WASH) so the roles editor can assign them.
- Default grants:
  - Owner/Manager -> `financials`, `commission`, `inventory`, `equipment`.
  - **Washer** -> `commission` only + `carwash.reports.view` (own data).
  - Cashier -> `equipment` (+ optional `financials`).
- Add to the carwash backfill so existing roles get the right detail keys.


## Work plan

1. **Backend permissions** (`src/common/permissions.ts`): add
   `carwash.reports.financials|commission|inventory|equipment`; add to the
   CAR_WASH group list; update `DEFAULT_ROLE_PERMISSIONS` /
   `carwash-role-permissions.ts` baselines (Owner/Manager all, Washer
   `commission`, Cashier `equipment`).
2. **Backend report redaction + own data** (`carwash.service.ts`
   `reportsBreakdown`): compute the caller's allowed sections; keep their own
   `washerEarnings`/`washCount` via the existing `washerScope`; null/empty the
   rest. Endpoint gate stays `carwash.reports.view`.
3. **Frontend report** (`CarWashReport.tsx`): gate each card/table on its detail
   permission; render nothing for redacted sections; keep the toggle.
4. **Shared guard** (`components/RequirePermission.tsx`): a small wrapper +
   `useRouteAccess` hook; adopt it on the car-wash (and other per-entity) pages
   so a missing read permission shows a friendly panel/redirect instead of a 403
   toast. Menu already hides it, so this is the belt-and-braces path.
5. **Menu/backfill**: ensure the nav uses registry reads (done); run
   `backfill-carwash-role-permissions` so stale grants are reconciled.
6. **i18n**: labels for new report toggle/section titles (reuse existing
   `carwash.*`).
7. **Tests**:
   - service test: caller with `carwash.reports.view` + `commission` gets
     financials/inventory/equipment redacted, own commission present; owner gets
     everything.
   - registry/nav check unaffected.
8. **Verify**: `tsc`, `next build`, backend `jest`, role matrix for the report.

## Risks / notes

- Adding permission keys requires the **catalog sync + backfill** to run so roles
  get the new keys; otherwise owners see empty sections until they re-assign.
- Redaction must be **server-side** — hiding in the UI alone would still leak data
  via the API.
- Keep `carwash.reports.view` as the page entry key so a washer can still open the
  report (seeing only their commission), matching the requested behavior.
- Same pattern can be extended to the retail/hospitality/manufacturing reports if
  desired, but the concrete request is the car-wash report detail.

---

## Implementation summary (delivered)

**Backend**
- `permissions.ts`: added `carwash.reports.financials|commission|inventory|equipment`
  to the `Car Wash - Reports` group; MANAGER gets all four, **WASHER gets
  `commission` only**, CASHIER gets `equipment`.
- `carwash.service.ts` `reportsBreakdown`: computes the caller's allowed sections
  and **redacts server-side** — company financials/inventory/equipment are
  `null`/`[]` unless the caller holds the matching key; a washer keeps their OWN
  commission (via the existing `washerScope`). Returns a `sections` object the
  client uses to render only permitted cards.
- Endpoint gate stays `carwash.reports.view` (a washer can open the report).
- `backfill-carwash-role-permissions` reconciles roles to the new baselines.

**Frontend**
- `CarWashReport.tsx`: each tile/chart/table now renders only when its section is
  allowed (`data.sections`), so redacted data is never shown.
- New `components/RequirePermission.tsx` — shared page/section guard
  (`useHasAnyPermission`), for graceful "no permission" states.
- The route guard in `layout.tsx` (registry-driven) already redirects any user
  lacking the route's read key; verified it blocks a washer from
  washes/bookings/equipment/store-items/collection/expenses/prices/vehicles and
  allows only the report routes.

**Deploy**
- `docker/entrypoint.sh`: the **role-permission reconcile backfills now run on
  every start** (idempotent + cheap) so the DB roles always match the code — this
  removes the stale washer grants that made the menu over-show.

**Verification**
- `carwash-report-permissions.spec.ts` (3 tests): owner sees all; washer sees only
  own commission with financials/inventory/equipment redacted; financials-only
  caller gets financials but not inventory/equipment.
- Backend `jest` 44 suites / 415 tests; `tsc` clean; `next build --webpack`
  compiles; registry check passes.

**Note on "reports pages" plural**: the per-detail redaction was applied to the
car-wash report (the concrete field list). Retail/Hospitality/Manufacturing
reports keep their existing `reports.view` / `reports.full` /
`reports.view_cost_valuation` gating; the same pattern can be extended there on
request.
