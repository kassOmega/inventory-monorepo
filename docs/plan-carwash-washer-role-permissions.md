# Plan — Car Wash washer role baseline + business-filtered permissions

## Requested changes

1. **Washer role baseline**: give the WASHER default role only
   `dashboard.view` + "View Car Wash Reports" (their **own** reports). The
   business owner can grant any **additional** permissions afterwards.
2. **Business-filtered permissions everywhere**: in the Roles list/detail modal,
   show only permissions relevant to the **active business type's** groups — even
   for system/seed roles. Today an OWNER shows all **115** permissions (retail +
   manufacturing + service + …) because the role's held permissions are rendered
   unfiltered.
3. Ensure **all routes, menus, buttons and actions are permission-gated**.

## Findings (verified)

### Washer role
- `DEFAULT_ROLE_PERMISSIONS.WASHER` (`permissions.ts:645`) currently grants:
  `dashboard.view`, `carwash.washes.view/create/edit`, `carwash.bookings.view`,
  `carwash.equipment.view`, `carwash.reports.view`. That's more than the owner
  wants.
- **Critical coupling:** `washerScope()` (`carwash.service.ts:70`) detects a
  washer as *"has `carwash.washes.create` AND not `carwash.collections.view`"*.
  Removing `carwash.washes.create` from the WASHER default **breaks** the
  "washer sees only their own data" scoping — the dashboard/`listWashes` would
  stop scoping and the washer would see everyone's washes. So the washer
  detection must be made **role/link-based** (by the linked `CarWashWasher`
  record), not permission-based.
- `myReport(userId)` already resolves the washer strictly by the linked
  `CarWashWasher` row → correct "own reports only" primitive exists.
- `carwash.washer-reports` nav + route are gated on `carwash.reports.view`, so
  retaining `carwash.reports.view` for WASHER keeps the "View Car Wash Reports"
  menu. But that key is *shared* with the full washer-performance report
  (`/carwash/reports/washers` lists ALL washers) — a washer with
  `carwash.reports.view` could see others. Need a **separate own-report gate**.

### Business-filtered permissions
- Backend `RolesService.findPermissions()` already filters the **catalog** by
  `PERMISSION_GROUPS_BY_BUSINESS_TYPE[org.businessType]`. Good for the editor.
- But `RolesService.findAll()` returns **`permissions: { include: permission }`
  unfiltered**, so each role carries every held key (OWNER = 115). The frontend:
  - table column `role.permissions.length` (roles-panel.tsx:235),
  - detail modal `viewing.permissions.length` + `groupPermissions(viewing.permissions)`
    (roles-panel.tsx:381, 390),
  all show ALL held permissions → foreign groups appear.
- The editor's `grouped` useMemo (roles-panel.tsx:77) intentionally re-adds
  held-out-of-filter keys so saving never silently drops them — fine for editing,
  but the **view** surfaces don't filter.

### Permission gating audit
- Nav items are permission-gated (`dashboardNavigation.ts`), routes via
  `routePermissionMap`, buttons via `hasPermission(...)` on most carwash pages.
- Gaps to verify: some carwash actions may not be gated (e.g. "Complete wash" /
  "Delete" in washes use `canEdit`/`canDelete` — present; the dashboard quick
  actions and `CarWashReport` links are not permission-gated; the new booking
  items and collection gap should gate on the right keys).

## Design decisions

- **Washer own-report**: keep `carwash.reports.view` as the report-menu gate, but
  the **backend already scopes** `washerReports`/`dashboard`/`listWashes` by the
  linked washer when the caller is a washer. Make that scoping **role/link-based**
  so it no longer depends on `carwash.washes.create`. Add a dedicated
  **`/carwash/my-report`** view (own data) that a washer can open; the shared
  washer-performance report (`/carwash/reports/washers`) filters out other
  washers for a washer caller (already scoped once detection is fixed).
- **Baseline WASHER** = `dashboard.view` + `carwash.reports.view` only. Owner
  grants the rest. Add `carwash.washes.create` back only when granted.
- **Permission filtering** happens on the **backend** (authoritative) by
  returning only the permissions whose **group is in the active business's
  allow-list** on `findAll`/role detail (both the `permissions[]` and the
  count). The frontend then renders that filtered set for the table, the editor
  and the detail modal. The editor keeps the "held-out-of-filter" safety only
  for **non-system** roles (so a custom role can't lose a grant), while
  system/seed roles display only business-relevant groups.

## Work plan

### A. Washer role baseline + own-report

Files: `inventory-backend/src/common/permissions.ts`,
`inventory-backend/src/common/carwash-role-permissions.ts`,
`inventory-backend/src/carwash/carwash.service.ts`,
`inventory-backend/prisma/backfill-carwash-role-permissions.ts`.

- Change `DEFAULT_ROLE_PERMISSIONS.WASHER` to:
  `['dashboard.view', 'carwash.reports.view']` (drop `washes.view/create/edit`,
  `bookings.view`, `equipment.view`).
- Keep `CAR_WASH_ROLE_GRANTS` filtering by car-wash groups; ensure WASHER ends
  with exactly those two (+ `customers.view/manage` only if truly needed — the
  washer no longer records washes by default, so **drop** the customer extras
  for WASHER; owner can grant).
- **Make washer detection link-based** in `washerScope()`: a caller is a washer
  if there is a `CarWashWasher` linked to `user.sub` **and** the caller lacks
  the owner/manager report scope. Concretely: resolve the linked washer by
  `userId`; if found, scope to it (regardless of `carwash.washes.create`). Keep
  the `!carwash.collections.view` guard as the "not a manager" check, or better,
  scope whenever a linked washer exists and the caller isn't the owner.
- Add/extend an **own-report** endpoint the washer menu can hit:
  `GET /carwash/my-report?startDate&endDate` (currently `myReport(userId)` has no
  date range) → return own washes + commission for the range. Gate it on
  `carwash.reports.view` (the washer baseline).
- Ensure `washerReports`, `dashboard`, `listWashes` all use the link-based
  washer scope so a baseline washer sees only their own data.

### B. Business-filtered permissions (backend authoritative)

Files: `inventory-backend/src/roles/roles.service.ts`.

- Add a private `allowedGroupsForActiveOrg()` (reuse the existing logic in
  `findPermissions`).
- `findAll()`: after loading roles, filter each `role.permissions` to those
  whose `permission.group` is in the allowed set, and return the filtered array
  (so the table count and the detail modal both reflect the business only).
  - Keep the full set available for **non-system** roles' editor safety via a
    separate field if needed (e.g. return `permissions` filtered +
    `allPermissions` for custom roles), or handle the "don't drop grants" logic
    purely in the editor using the filtered catalog + the role's raw keys.
- Add/extend a role-detail endpoint (`GET /roles/:id`) returning the filtered
  permissions, and have the frontend use it for the view modal (or filter
  client-side against `/roles/permissions`).

### C. Frontend roles panel

Files: `frontend/app/dashboard/users/roles-panel.tsx`.

- Table: show `role.permissions.length` from the **filtered** set (or compute
  against the loaded catalog).
- Detail modal: render only permissions whose group is in the loaded catalog's
  groups (filter `viewing.permissions` against `permissions` catalog before
  grouping). The count tile then shows the business-relevant count.
- Editor: keep the "held-out-of-filter" safety for **custom** roles only; for
  **system** roles, show only business groups.
- Ensure the modal/table never renders foreign-vertical groups.

### D. Permission-gating audit

- Verify every carwash route (`routePermissionMap`), nav item, button and action
  is gated:
  - washes: record (`carwash.washes.create`), complete/edit
    (`carwash.washes.edit`), delete (`carwash.washes.delete`).
  - bookings, prices, vehicles, washers, equipment, store-items, expenses,
    collection, settings, reports, washer-reports — confirm each action maps to
    the matching `carwash.*` key.
  - dashboard quick-action links and `CarWashReport` deep links: gate on the
    destination permission (hide when not held).
- Backend: confirm every controller endpoint has the correct `@Permissions(...)`
  (audit `carwash.controller.ts`).

### E. Tests & verification

- Backend: washer baseline resolved to exactly `dashboard.view` +
  `carwash.reports.view`; `washerScope` link-based (a linked washer with any
  permission set is scoped to own data; a manager/owner is not);
  `findAll`/role-detail returns only business-group permissions (OWNER < 115,
  no foreign groups); a WASHER can hit own-report and cannot see others.
- Frontend: `tsc`, `next build`; manual — Roles modal for OWNER/WASHER shows
  only car-wash groups; washer menu shows dashboard + View Car Wash Reports
  (own); buttons hidden without permission.
- Run `backfill-carwash-role-permissions` (existing, idempotent) to apply the new
  WASHER baseline to existing orgs; ensure it **also removes** now-extra grants
  (extend the backfill to prune WASHER down to the baseline, like the prune
  backfill).

## Risks / notes

- Changing WASHER defaults + the backfill will **reduce** existing washers'
  permissions to the baseline on the next run. This is the requested behavior,
  but confirm — owners will need to re-grant anything a washer relied on.
- `washerScope` becoming link-based changes who is treated as a washer; verify
  owners/managers (who may also have a linked washer row) still see everything.
- Filtering `findAll` permissions means a system role's editor must still be
  able to keep grants outside the business list (custom roles) — handle in the
  editor, not by unfiltering the API.
- Keep all new endpoints/gates backward compatible.

---

## Implementation summary (delivered)

**Washer role + own report**
- `DEFAULT_ROLE_PERMISSIONS.WASHER` reduced to `dashboard.view` +
  `carwash.reports.view`; customer extras dropped for WASHER.
- `washerScope()` is now **link-based** (a linked `CarWashWasher` + not a
  manager) so own-data scoping no longer depends on `carwash.washes.create`.
- `washerReports`/`reportsBreakdown` use local-day `resolveRange`; a washer
  caller is scoped to their own row; new drill-down endpoint
  `GET /carwash/reports/washers/:washerId/washes`.
- Washer report page: `carwash.washerReports` key added (en+am) and expandable
  rows showing each completed wash + commission.

**Business-filtered permissions**
- `RolesService.findAll()/findOne()` filter each role's permissions to the
  active business's groups (new `GET /roles/:id`); `resolvePermissionIds` only
  grants in-catalog keys; `create/update` return filtered roles.
- System/seed roles are now **editable** (name locked) so an owner can grant a
  Washer extra permissions; custom roles are strictly limited to the catalog
  (frontend `grouped` no longer re-adds out-of-filter keys).
- Role detail modal + list count render only business-relevant permissions.

**Gating**
- Dashboard quick actions gated on `carwash.bookings.create` /
  `carwash.washes.create` / `carwash.washers.view`.

**Backfill**
- `backfill-carwash-role-permissions` now reconciles system roles **exactly** to
  the car-wash baseline (grants missing + revokes extras), so existing washers
  drop to the baseline; hand-made roles untouched.

**Tests**: `roles.service.spec.ts` (3), `carwash-booking.spec.ts` (3). Full
backend 43 suites / 412 tests; `tsc` clean.
