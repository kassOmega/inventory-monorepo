# Plan — Reports page crash

## Symptom

The dashboard **Reports** page (`/dashboard/reports`) crashes at runtime
("Something went wrong on this page"). It renders fine server-side (HTTP 200 for
every tab) and type-checks/builds, so the failure is a **client-side runtime
exception** after hydration / when a tab's data loads.

## What was already checked (no fault found)

- `tsc --noEmit` clean; `next build --webpack` compiles.
- SSR returns **200** for `?tab=` = sales, finance, inventory, low-stock,
  dead-stock, audit-trail, activity, production.
- Backend endpoints respond correctly: `/carwash/reports/breakdown` returns the
  expected (redacted) shape for a washer; `getAuditTrail` query + mapping verified
  against the DB (tenant-scoped, null-safe).
- All report components' arrays used in `.map`/`.reduce` are initialized to `[]`
  and set from API responses (`.catch(() => ({ data: [] }))`).
- No missing i18n keys in the report components.

So the crash is a specific value/shape at runtime, not a static error.

## Confirmed change in the last commit (`8a7fe56`)

Only two edits to `frontend/app/dashboard/reports/page.tsx`:
1. the audit-trail fetch now passes `startDate/endDate/search`;
2. the audit-trail tab wraps a `FilterPanel` + table in a fragment.
Both are structurally valid.

## Prime suspects (to confirm from the browser console)

Because the failure is client-only, the fix depends on the exact stack. The most
likely candidates, in order:

1. **A report component reads a field the API returns as `null`** and then calls
   an array/string method on it. The **car-wash report redaction** now returns
   `null` (not `[]`) for several *scalar* totals and `[]` for lists — if any
   list is ever `null` (older backend still running, or a partial response), a
   `.map`/`.length` throws. `CarWashReport` accesses
   `data.washerEarnings.map`, `data.popularItems.map`, `data.paidEquipmentByWasher.map`,
   `data.unpaidEquipmentByWasher.map`, `data.lowStockItems.map` — all should be
   guarded with `?? []`.
2. **`CarWashReport` sections gating** relies on `data.sections`; if the running
   backend predates that field, the fallback is all-true, but the data shape may
   differ.
3. **`SalesReport` numeric views** evaluate `trend.reduce`, `mostSold.map` in the
   `numeric` prop even when collapsed — safe only while those are arrays.
4. **Inventory/low-stock/dead-stock** rows use `r.variants.map` — pre-existing,
   but a row without `variants` would crash (backend always sends it today).
5. A **stale client build / hydration mismatch** (a `.next` built before the
   latest code) — cleaning `.next` and rebuilding resolves it.

## Plan

1. **Capture the real error.** The Reports route has no error boundary, so a
   component throw shows Next's global error. Add
   `frontend/app/dashboard/reports/error.tsx` (like the existing
   `carwash/error.tsx`) that logs `console.error(error)` and shows a recoverable
   panel. This turns the opaque crash into a visible message and a retry.
2. **Harden the report components against partial/null data** (defensive, cheap,
   fixes the most likely cause regardless):
   - `CarWashReport`: guard every list access with `?? []`
     (`washerEarnings`, `popularItems`, `paidEquipmentByWasher`,
     `unpaidEquipmentByWasher`, `lowStockItems`) and every scalar with
     `?? 0`/`fmt(null)`.
   - `SalesReport`: `const trend = t.data ?? []`, `mostSold ?? []`,
     `paymentBreakdown ?? []`; guard the numeric `.reduce`/`.map`.
   - `reports/page.tsx`: guard `inventoryData.columns ?? []`, `rows ?? []`, and
     `r.variants ?? []` in the three stock tables.
   - `CarWashReport`/`FinanceComparison`: same `?? []`/`?? 0` guards on the
     server-redacted fields.
3. **Ship the audit-trail filter safely**: confirm `FilterPanel` renders with no
   `categories`/`location` (it does), and that the audit-trail tab isn't rendered
   twice.
4. **Rebuild the client** (`rm -rf .next && next build`) so any stale bundle is
   replaced.
5. **Verify**: load `/dashboard/reports` and each tab as owner + staff (retail +
   car wash); confirm no client exception; `tsc`/`jest`/`next build`.

## Notes

- Root cause is not yet pinned because the crash is client-only and no browser
  console/stack was available. Steps 1–2 both **fix the most probable cause** and
  **surface the exact error** if it persists.
- If the user can paste the browser console stack (or the message shown by the
  new `error.tsx`), the true culprit can be fixed directly.
