# Plan — Car Wash: washer report, bookings, collection gap, finance, expenses, credits, i18n, Record Wash bug

## Inventory of requested work

1. Fix washer report showing **0 commission**; show exact earnings + a list of
   washes each washer completed in the chosen date range.
2. Booking page: wash types; price **autofilled** (not manual); queue position
   **autofilled**; customer → his vehicles with **multi-select**, each with its
   own wash type; total price autofilled.
3. Money collection: enable the button only when there's a **gap** between
   collected and money on the air, and show that gap.
4. **Show the finance page** for Car Wash (ledgers/accounts/finance staff like
   other businesses).
5. Expenses: manage + map accounting and **post the GL**.
6. Complete untranslated locales (e.g. `carwash.washerReports`).
7. Fix the **"Record Wash"** crash ("This page couldn't load").
8. Credit tables: make them **horizontally scrollable** and remove the whitespace
   wrapping the rows.

## Findings (verified)

### 1. Washer report = 0 (timezone) + no drill-down
- `washerReports()` (`carwash.service.ts:1213`), `commissions()` (~703) and
  `reportsBreakdown()` parse `YYYY-MM-DD` with `new Date()` → **UTC midnight**,
  while `CarWash.date` is **local**. On a UTC+3 server the end bound is UTC
  00:00, excluding the day's washes → commission 0. `dashboard()` already uses
  local-day `resolveRange()`; the others don't.
- No drill-down list of a washer's washes (though `listWashes` supports
  `washerId`).

### 2. Booking page
- `bookings/page.tsx`: single vehicle, manual amount, manual queue position.
- Backend `createBooking` accepts one `vehicleId`/`vehicleType`/`amount`.
- `listVehicles(search)` can't filter by customer.
- `positionInQueue` never derived; no per-vehicle wash type.
- **Decision:** single booking with a new **`CarWashBookingItem`** child model
  (vehicle, washTypeId, amount, date, startsAt, washId).
- **Decision:** GL posts at **wash completion**, not creation.

### 3. Collection
- `dailySummary()` returns ownerShare/equipment/expenses/net. No `gap`/collected.
- Page disables when today fully settled (should instead **enable when a gap
  exists** and show the gap).

### 4. Finance page hidden for Car Wash
- `dashboardNavigation.ts` gates the `finance` group with `!ctx.isCarWash`, and
  `routeBusinessTypes` redirects `/dashboard/finance`, `/dashboard/accounts`,
  `/dashboard/payment-methods`, `/dashboard/taxes`, `/dashboard/finance/ledger`,
  `.../mappings` for CAR_WASH.
- Car Wash orgs already seed a chart of accounts + mappings
  (`VERTICAL_ACCOUNTS[CAR_WASH]`: `Car Wash Revenue`, `Equipment Revenue`,
  `Washer Commission Expense`) via `seedAccountMappings()`.
- `finance/page.tsx` `verticalCards` has no CAR_WASH branch.

### 5. Expense GL
- Car Wash `createExpense` delegates to `finance.createExpense` (posts an EXP
  journal). Category→account mapping is loose (falls back to first EXPENSE
  account).
- **Wash revenue/commission is never posted to the GL** — no car-wash income
  posting exists (retail posts income+COGS via `finance.postSaleIncome`).

### 6. i18n
- `carwash.washerReports` is referenced in `carwash/washer-reports/page.tsx` but
  **missing** from `en/common.json`. (`am` also missing it; en has 149 keys, am
  matches except this.)

### 7. "Record Wash" crash
- The washes page serves 200 and compiles; the only dev-server error is a benign
  Grammarly hydration mismatch (browser extension). No compile/runtime error is
  reproducible headlessly.
- The crash occurs when the modal opens (which mounts `AiAutofillCapture` →
  `AiPhotoPicker` → `useToast`). **No browser console stack was available**, so
  the exact throw needs confirming; the plan includes a defensive fix for the
  most probable causes (see below).

### 8. Credit tables
- `credits/page.tsx`: table at line 163 wrapped by a `div` — need to verify it
  has `overflow-x-auto` and that the row wrapper adds `whitespace-nowrap` /
  padding producing the "white space wrapping the row".
- `credits/[id]/page.tsx`: table already inside `overflow-x-auto` (line 500).

## Design decisions

- Keep shared components; no new vertical-specific primitives.
- All Car Wash date filters go through local-day `resolveRange()`.
- Booking = one header + `CarWashBookingItem[]`; wash completion posts GL.
- Collection button gated by the gap; gap displayed.
- Finance nav/pages re-enabled for Car Wash; add CAR_WASH finance cards.
- Wash completion posts income + commission; expense posting tightened.

## Work plan

### A. Washer report (fix + drill-down)
Backend `carwash.service.ts` / `carwash.controller.ts`:
- `washerReports`, `commissions`, `reportsBreakdown`: use `resolveRange()` for
  local-day bounds; compute commission via `computeWashCommissions`.
- Add drill-down: `GET /carwash/reports/washers/:washerId/washes?startDate&endDate`
  (or reuse `GET /carwash/washes?washerId&startDate&endDate`) returning each
  completed wash (date, vehicle/plate, wash type, amount, this washer's share).
Frontend `carwash/washer-reports/page.tsx`:
- Add i18n `carwash.washerReports`; make each row expandable to show the wash
  list for the range (auto-applies with the date filter).

### B. Booking page (header + items)
Schema + migration:
- `CarWashBookingItem { id, bookingId (cascade), vehicleId?, vehicleType,
  washTypeId?, amount, date, startsAt, washId?, timestamps }`;
  `CarWashBooking.items CarWashBookingItem[]`. Backfill existing bookings → one
  item each.
Backend:
- `listVehicles(search?, customerId?)`.
- `createBooking(items[])`: transactionally create header + items; `amount` =
  sum; auto `positionInQueue` (max of that day + 1); backward-compatible with the
  single-vehicle shape.
- `GET /carwash/bookings` includes items (vehicle + wash type).
Frontend `carwash/bookings/page.tsx`:
- Customer select → `/carwash/vehicles?customerId=`.
- Multi-select vehicles; per-vehicle **wash type** + vehicle type; amount =
  computed sum (read-only); queue position read-only.

### C. Collection gap
Backend: `dailySummary` returns `collectedAmount` + `gap`; `createCollection`
guards on the gap.
Frontend `carwash/collection/page.tsx`: enable button only when `gap > 0`; show
gap + collected vs on-the-air.

### D. Show finance page for Car Wash
- `dashboardNavigation.ts`: remove `!ctx.isCarWash` on the finance group.
- `layout.tsx` / `routeBusinessTypes`: drop the CAR_WASH restrictions on the
  finance routes.
- `finance/page.tsx`: add a CAR_WASH `verticalCards` branch.

### E. Expense mapping + wash GL posting
- Tighten `resolveExpenseAccountId` (explicit category→COA mapping; clear error
  when unmapped; no silent fallback).
- Add `finance.postCarWashIncome(washId, tenantId, tx)` +
  `reverseCarWashPostings(...)`: on `completeWash`, post Debit Cash/AR ↔ Credit
  `Car Wash Revenue`/`Equipment Revenue` and washer commission to `Washer
  Commission Expense`; idempotent by wash id; reverse on delete of a completed
  wash.

### F. i18n
- Add `carwash.washerReports` (en + am) and any other keys introduced (gap,
  queue, per-vehicle labels) to both locales; verify no other `carwash.*` key is
  referenced-but-missing.

### G. "Record Wash" crash
- Confirm the throw from the browser console (request a screenshot/stack if
  possible). Apply defensive fixes for the probable causes:
  - Guard `AiAutofillCapture`/`AiPhotoPicker` against a missing `analyze` /
    provider, and ensure the modal only mounts AI capture when `enabled`.
  - Ensure `SearchableSelect` never receives `undefined` `options` (default to
    `[]`) and that `Modal` children are safe when lists are empty.
  - Fix `ToastProvider`'s `let id = 0` reset each render (ids must be stable —
    hoist to a `useRef`) — this causes duplicate `key`s and can wedge the toast
    list.
  - Add a route-level `error.tsx` for `/dashboard/carwash` so a component error
    shows a recoverable message instead of the full-page crash.
- Reproduce and verify after fixing.

### H. Credit tables
- `credits/page.tsx` + `credits/[id]/page.tsx`: wrap tables in
  `overflow-x-auto`, set `w-full` + `min-w-[...]` on the table, and remove
  whitespace/padding wrappers that create a gap around rows (align the header
  and body cell padding; ensure the scroll container hugs the table with no
  extra margin/rounded whitespace).

### I. Tests & verification
- Backend: washerReports range/commission, booking items + auto queue,
  collection gap, expense GL, wash-completion GL (idempotent), reversal.
- `npx tsc --noEmit`, `npx jest`, frontend `tsc`, `next build --webpack`.
- Manual: Record Wash opens + submits without crashing; washer report non-zero +
  drill-down; multi-vehicle booking sums price; collection gap; finance page +
  ledger; credits scroll.

## Open item to confirm
- The **"Record Wash" crash** could not be reproduced headlessly (only a benign
  Grammarly hydration warning appears). I will add defensive fixes + a carwash
  `error.tsx`, but if you can paste the **browser console stack** (or the exact
  error text in the Next overlay), I can pin the true cause immediately.
