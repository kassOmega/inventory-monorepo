# Plan — Match the shared filtering/reports flow across all businesses

## Guiding principle (from the request)

Every business must use the **same filtering flow** the other businesses already
use. Do **not** invent a Car Wash-specific filter UI. Study the existing pattern,
then make Car Wash identical. Keep UI flow, theme, structure and architecture.

## The canonical filtering flow (as used by retail/manufacturing/etc.)

Verified across `sales`, `purchases`, `requests`, `cashier`, `reports`,
`ManufacturingDashboard`, `HospitalityDashboard`:

1. **Primary tab row** — segmented control of the page's main modes
   (e.g. purchases `ALL / PAID / CREDIT`, sales `sales / payments`,
   reports tab bar). Sets the page's identifying dimension.
2. **Common composite filter** — `FilterPanel` (wraps `DateFilter` +
   `FilterBar`):
   - `DateFilter`: preset pills (Today / Week / Month / Year) + custom
     start/end; `getDateRange()` helper.
   - `FilterBar`: search input, category select, optional location select.
   - Props: `showDateFilter`, `datePreset/onDatePresetChange`,
     `startDate/endDate` + change handlers, `search/onSearchChange`,
     `category/onCategoryChange/categories`, `location/onLocationChange/
     locations/showLocation`.
3. **Page-specific extra selects** — rendered either inline next to the search
   (purchases: status, payment status, vendor `SearchableSelect`, shop) or via
   the collapsible `showFilters` toggle (purchases: date pills revealed on
   demand). These are native `<select>` styled
   `border p-1.5 sm:p-2 rounded-lg bg-white text-xs sm:text-sm`.
4. **Auto-apply** — state changes drive a `useEffect`/`load` that refetches.
5. **The filter always carries the page's identifying data** — e.g. sales
   filters by category/location; purchases by status/vendor/shop; reports by
   tab + date.
6. Compact list pages that only need a search (washers, vehicles, prices,
   store-items) currently use `ListFilters` (a lighter bar). For consistency the
   date/analytics pages must use `FilterPanel`; simple list pages may keep the
   lightweight search bar **if** that matches how equivalent retail list pages
   behave (they do — e.g. `/requests` uses `FilterRow`, other list pages use
   `FilterPanel`). Decide per page to mirror the closest retail analogue.

## Design decision

- **Date/analytics pages** (dashboard, reports, collection, expenses, washes,
  bookings, washer-reports) → use the shared **`FilterPanel`** exactly like
  `sales`/`reports`, with page-specific selects passed as extra controls.
- **To support page-specific selects without a bespoke bar**, extend `FilterBar`/
  `FilterPanel` with an **optional `extra?: ReactNode`** slot rendered inside the
  same panel (backward compatible; existing callers unchanged). This is the only
  change to the shared component and it preserves its look.
- **Simple list pages** (washers, vehicles, prices, store-items) → mirror the
  closest retail list page's filter (search + the identifying select), reusing
  the same `FilterPanel`/`FilterBar` controls so all businesses look alike.
- **Shared reports page** → one route (`/dashboard/reports`) for all businesses;
  a CAR_WASH tab set + car-wash data, matching how manufacturing/hospitality
  already branch inside that page. Retail branch untouched.

## Work plan

### 1. Common filter component (shared, backward compatible)

Files: `frontend/app/components/FilterBar.tsx`,
`frontend/app/components/FilterPanel.tsx`.

- Add optional `extra?: ReactNode` to `FilterBar` and pass-through from
  `FilterPanel`. Rendered inside the existing panel (below the search/category/
  location row), so car-wash-specific selects (washer, wash type, status,
  vehicle type) visually match the built-in controls.
- Keep every existing prop and default — no change for current consumers
  (`sales`, `reports`, `dashboard`).
- Add small styled helpers (e.g. `FilterSelect`, `FilterDateInput`) only if
  needed by `extra`; otherwise reuse the same class string.

### 2. Shared reports page (one page, per-business content)

Files: `frontend/app/dashboard/reports/page.tsx`,
`frontend/lib/dashboardNavigation.ts`, `frontend/app/dashboard/layout.tsx`.

- **Revert** the earlier CAR_WASH exclusions: show `/dashboard/reports` for
  CAR_WASH again in `dashboardNavigation.ts`; remove `/dashboard/reports` from
  `routeBusinessTypes` in the layout guard.
- In `reports/page.tsx` add the CAR_WASH branch (mirroring the existing
  manufacturing/hospitality branches):
  - tabs: Revenue & Commission / Washers / Equipment / Expenses,
  - data from `/carwash/reports/breakdown`, `/carwash/commissions`,
    `/carwash/expenses`, `/carwash/summary`,
  - gate all retail fetches behind `!isCarWash`.
- Use `FilterPanel` (date filter) exactly like the other branches.
- `frontend/app/dashboard/carwash/reports/page.tsx`: keep it as a thin wrapper
  that renders the same component/branch (no duplicate logic), or redirect to
  `/dashboard/reports?tab=...`. Prefer the wrapper so deep links keep working.

### 3. Replace the Filtering UI I added with the common flow

Files: `CarWashDashboard.tsx`, `carwash/reports`, `carwash/collection`,
`carwash/expenses`, `carwash/washes`, `carwash/bookings`,
`carwash/washer-reports`.

- Replace each `ListFilters` bar with `FilterPanel` (date pages) using the same
  props as `sales`/`reports`.
- Move car-wash selects into the `extra` slot (washer, wash type, status,
  vehicle type, category) with the standard select styling.
- Preserve the existing state variables + auto-apply effects (request/response
  behavior unchanged) — only the filter markup changes.
- The dashboard keeps its role logic (washer vs staff) but now uses
  `FilterPanel`; washer view hides owner-only extras.

### 4. Filtering in all pages (identifying data per page)

Files: each `carwash/*/page.tsx` + the matching backend list endpoint.

Mirror the retail analogue for each:
- **washes**: tab/none + `FilterPanel` date + washer/wash-type/vehicle-type
  extra (wire washer/type into `/carwash/washes` params).
- **bookings**: status tab + `FilterPanel` date + washer extra (extend
  `/carwash/bookings` with date/washer/status params).
- **collection**: `FilterPanel` date (already) + settled indicator.
- **expenses**: `FilterPanel` date + category/search extra.
- **washers**: search + active/inactive select (mirror list pages).
- **vehicles**: search + customer select.
- **prices**: vehicle-type + wash-type selects.
- **store-items**: search + category + low-stock toggle.
- **equipment**: washer + paid/unpaid + date.
- **washer-reports**: date + washer.
- Backend: add the missing optional query params, keeping defaults so existing
  callers are unaffected.

### 5. "New booking" form update

Files: `carwash/bookings/page.tsx`, `carwash/dto/carwash.dto.ts`,
`carwash/carwash.service.ts`.

- Add a **Customer** `SearchableSelect` (`/customers`, optional) — backend
  already accepts `customerId`.
- Replace free-text `vehicleType` with a select from `/carwash/vehicle-types`
  (fallback free text if empty).
- Autofill `amount` from `/carwash/prices` when vehicle type + wash type are
  chosen (same "price autofill" pattern as the product form).
- Improve slot UX: default `startsAt` to now; keep the existing
  `checkAvailability` inline feedback; derive `endsAt` from `slotMinutes`
  (`/carwash/settings`) when present.
- Keep the same modal + submit structure/endpoints.

### 6. Prevent duplicate collection

Files: `carwash/carwash.service.ts`, `carwash/dto/carwash.dto.ts`,
`carwash/collection/page.tsx`, `i18n/backend.{en,am}.ts`.

- **Backend (source of truth):** in `createCollection`, reject a second
  collection for an already-settled `collectionDate` (per tenant) with a clear
  error (`errors.collectionAlreadySettled`); compute remaining balance without
  ever creating a duplicate full-share row. Optional explicit override flag only
  if a partial second collection is genuinely needed.
- **Frontend:** derive "already settled" from the fetched `collections` for the
  selected day/period; **disable + relabel** the record button ("Settled") and
  show the settled total. Uses the existing permission-gated button pattern.
- (Optional, separate) DB `@@unique([tenantId, collectionDate])` after a
  cleanup of any historical duplicates — not required for the fix.

### 7. i18n

Add new keys (`carwash.customer`, `carwash.allStatus`,
`carwash.collectionSettled`, filter labels) to
`frontend/lib/locales/{en,am}/common.json`, and
`errors.collectionAlreadySettled` to
`inventory-backend/src/i18n/backend.{en,am}.ts`.

## Verification

- Backend: `npx tsc --noEmit`; `npx jest` (add: collection duplicate guard,
  booking with customerId, new list filters). Keep the CAR_WASH permission
  catalog test green.
- Frontend: `tsc --noEmit`; `next build --webpack`.
- **Retail/other-vertical regression (critical):** confirm `reports/page.tsx`
  retail/manufacturing/hospitality/service branches, the retail finance page,
  and all shared filter consumers render byte-identically. The only shared-file
  change is the additive `extra` prop.
- Manual matrix: owner/manager/washer × each page — the filter flow looks and
  behaves like sales/purchases; collection disables once settled.

## Risks / notes

- Re-enabling `/dashboard/reports` for CAR_WASH reverses the earlier hide — this
  is the requested "shared reports page".
- The `extra` prop is the single shared-component change; keep it optional and
  default-null so nothing else shifts.
- Keep `ListFilters` in place for any page that still uses it (other verticals);
  migrate Car Wash pages deliberately, page by page.
- All new query params stay optional; no existing deep links/consumers break.

---

## Implementation summary (delivered)

Every change follows the existing business flow. Retail/manufacturing/hospitality/
service code paths are untouched — new logic is CAR_WASH-guarded or purely additive.

### 1. Common filter component (shared, backward compatible)
- `FilterBar.tsx` / `FilterPanel.tsx`: made `search`/`category`/location props
  optional, added an `extra` slot, and exported a `FilterSelect` styled exactly
  like the built-in controls. `FilterPanel` date props are optional when the
  date filter is hidden. Existing consumers unchanged.
- `DateFilter.tsx`: exported `DatePreset`.

### 2. Shared reports page (one route, per-business content)
- `dashboardNavigation.ts`: `/dashboard/reports` shown for CAR_WASH again (shared).
- `layout.tsx`: `/dashboard/reports` removed from `routeBusinessTypes` (allowed).
- `reports/page.tsx`: added a CAR_WASH branch — tabs (Reports + Audit) and a
  `CarWashReport` body; all retail fetches/exports gated with `!isCarWash`.
- New `CarWashReport.tsx` component reused by the shared page and
  `/dashboard/carwash/reports` (which now just wraps it in `FilterPanel`).

### 3. Common filter UI replaces `ListFilters` on Car Wash
All Car Wash pages now use `FilterPanel` (+ `FilterSelect` extras): dashboard,
reports, collection, expenses, washes, bookings, washer-reports, washers,
vehicles, prices, store-items, equipment. Auto-apply retained.

### 4. Filtering in all pages (page-identifying data)
- dashboard: date + washer + wash type
- washes: date + washer + wash type + status (backend `listWashes` params)
- bookings: date + status (backend `listBookings` date/washer/status)
- collection/expenses: date + category
- washers: search + active status
- vehicles: search + customer
- prices: search + vehicle type + wash type
- store-items: search + low-stock; equipment: paid/unpaid

### 5. New booking form
- Added a Customer `SearchableSelect` (writes `customerId`).
- Vehicle type is now a select from `/carwash/vehicle-types` (free-text fallback).
- Amount autofills from `/carwash/prices` when a vehicle type is chosen.

### 6. Collection duplicate prevention
- Backend `createCollection` rejects a second full collection once a day's
  `remainingBalance` is ≤ 0 (new `errors.collectionAlreadySettled`), while still
  allowing an explicit partial amount.
- Collection page disables and relabels the button ("Settled") once today is
  settled.

### 7. i18n
- New `carwash.*` keys in en + am; `errors.collectionAlreadySettled` in the
  backend catalogues.

### Verification
- Backend: `tsc --noEmit` clean; `npx jest` → 41 suites / 406 tests.
- Frontend: `tsc --noEmit` clean; `next build --webpack` compiles successfully.
- Nav matrix: RETAIL/MANUFACTURING/HOSPITALITY/SERVICE unchanged (finance +
  reports); CAR_WASH now has the shared reports link and hides the retail finance.
- Retail `reports/page.tsx` branches and `finance/page.tsx`: unmodified behavior.
