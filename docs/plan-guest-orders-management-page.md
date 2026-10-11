# Plan: Guest Orders management page (pre-go-live gate)

## Goal
A dedicated **Guest Orders** page where the privileged user **manages every guest
order before it goes live** (reaches the kitchen/queue/station or becomes an
internal order/sale/booking). Nothing reaches operations until it is reviewed and
approved here.

## Current state (what exists)
- Backend `guest-orders` module already has: `list`, `pending-count`, `get`,
  `review`, `route` (to branches), `respond` (branch accept/decline), `assign`,
  `reject`, `free`, plus QR/blocklist management.
- Frontend `/dashboard/guest-orders` exists: a list + a detail modal with
  review / route / branch-replies / assign / reject / free. It polls every 15s.
- Nav entry present (`nav.guestOrders`, gated by `guest-orders.view|manage`).

So the **plumbing is there**; this plan turns it into a clear, complete
**management surface** with the go-live gate as the centrepiece.

## Definition of the gate (what "before they go live" means)
- A guest order is created as **SUBMITTED** and posts **nothing** to operations.
- It goes live only after the privileged user **approves** (the conversion step):
  - **F&B / service / rooms** → approve → becomes the internal record
    (`Order` / `ServiceBooking` / `HotelReservation`) → then the station sees it.
  - **Retail / manufacturing** → central user **routes** to branch(es) → a branch
    **accepts** → **assign** → internal `Sale` is created → live.
- **Decline** → freed, nothing happens. **Free** → manually cleared.
- Approve/reject are **permission-gated** (`guest-orders.manage`).

## The page (redesign)

### Layout
- **Header + KPI row** (cards a guest order moves through):
  `New (SUBMITTED)`, `Awaiting branch (ROUTED)`, `Accepted`, `Completed`,
  `Rejected/Closed` — each clickable to filter, using the shared smart-cards style.
- **Filters** via the shared **`CollapsibleFilterPanel`**: status, source
  (central vs branch QR), entry label/branch, date range, search (guest/phone).
- **Live updates**: keep polling (raise to a sensible interval) and/or SSE so new
  orders appear without a manual refresh; a **badge** on the nav shows the pending
  count (`pending-count`).

### Table (rich rows)
Columns: `#`, **Source** (Central / branch name), **Channel** (kind + service tab
for multi-service), **Guest** (name/phone or "Table N"), **Items** (count/short
list), **Total**, **Status** (pill), **Age**, **Actions**.

### Row actions / detail
- **Approve** (`review`) — the primary go-live action for F&B/service/rooms.
- **Route to branches** (retail/manufacturing) — multi-select branches → `route`.
- **Branch replies** shown inline (Accepted/Declined per branch) → **Assign** to an
  accepting branch → internal sale.
- **Decline** (`reject`) and **Free** (`free`).
- **Detail modal**: full item list with prices/images, guest info, the **activity
  timeline** (`GuestOrderActivity`), branch replies, and the linked internal record
  once live (order #/sale #/booking #/reservation #).
- **Bulk**: select multiple SUBMITTED orders → approve/decline in one action
  (calls the same endpoints per order).

### Branch view
- A **branch-scoped** view (same page, filtered to the user's location) so branch
  staff see only orders routed to them and **Accept / Decline** from their side.

## Backend (small additions)
- `list` already supports a `status` filter; add filters for `entryId`/`locationId`
  and `search` (guest name/phone), and return item counts + the linked record ids.
- Optional **bulk** endpoints: `POST /guest-orders/bulk/review` and
  `.../bulk/reject` (`{ ids: number[] }`) so the table can act on many at once.
- Keep everything permission-gated and tenant-scoped; branch scoping uses the
  user's `locationId`.

## Frontend
- Rework `app/dashboard/guest-orders/page.tsx` into the layout above (KPIs,
  CollapsibleFilterPanel, richer table, detail with timeline, bulk actions,
  branch view). Reuse `Button`, `Modal`, `Loading`, `RowActionsMenu`, the
  first-load-only loading pattern, and the existing status/payment pill styles.
- Nav: keep the **Guest Orders** entry; show the **pending badge**.

## Verification
- New SUBMITTED order appears live in the inbox and posts **nothing** to stations.
- **Approve** (F&B) → a restaurant `Order` is created and only then reaches the
  station; the activity timeline records it.
- **Route → branch accepts → assign** → internal `Sale` created; guest status
  updates.
- **Decline/Free** → no internal record; the table/entry frees up.
- Branch user sees only their routed orders and can accept/decline.
- Bulk approve/decline works.
- KPIs and filters reflect the current set; the nav badge matches `pending-count`.
- `tsc` + jest + `next build` clean.

## Open questions
(none — all confirmed)

## Confirmed (round 2)
1. **Bulk actions** — approve/decline many orders at once (add bulk endpoints + UI).
2. **Live transport** — **SSE** (reuse the notifications SSE stream pattern) for
   instant inbox updates, with polling as a fallback.
3. **Branch inbox** — the **same page filtered by the user's location**
   (recommended).
4. **Auto-approve** — provide **both**: manual approval (default) **and** a
   per-service (and per-tenant) **auto-approve toggle** the owner decides.
