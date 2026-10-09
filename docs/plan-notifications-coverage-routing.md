> **STATUS: CORE IMPLEMENTED.** Read-once infrastructure landed: a stable
> `dedupeKey` (+ `resolvedAt`) on `Notification`, an `emitOnce`/`emitToUsers`
> core that never regenerates an event for a recipient (read or not), and all
> `notify*` methods now fan out to per-recipient rows. Business-critical call
> sites (requests, purchases PO-draft, subscriptions receipt-flagged,
> verification flagged, employee-deduction due-soon, low stock) pass dedupe keys;
> the client link map gained the new types. 459/459 tests pass. Remaining: sweep
> the remaining secondary call sites with keys.

## Goal
1. **Review/update notifications and their routing** across the whole platform so
   every business action that should notify does, to the right people, with a
   correct deep link.
2. **Read-once suppression:** once a notification has been marked read, it must
   **not regenerate / re-trigger** for the same underlying event.

## Current state (what exists)
- **Model** `Notification`: `tenantId?`, `type`, `title`, `message`, `link?`,
  `productId/variantId/threshold/locationId`, `targetRoleId`, `targetLocationId`,
  `targetUserId`, `isRead` (a single global boolean per row).
- **Service** (`notifications.service.ts`) exposes:
  `notifyOwner`, `notifyLocation`, `notifyUser`, `notifyAdmins`, `notifyRole`,
  `notifyRoleId`, low-stock helpers (`checkAndNotifyLowStock`,
  `checkAllLowStockForLocation`), `findAll`, `getUnreadCount`, `markAsRead`,
  `markAllAsRead`, and an **SSE** refresh stream.
- **Consumers (frontend):** `NotificationBell` (dropdown), `NotificationToast`
  (alert bar + toasts), shared `lib/notificationLink.ts` (icon + deep-link map,
  `STICKY_TYPES`). Push via `PushService`.
- **63 call sites** across admin, agent, ai, auth, manufacturing (+ shift
  automation), products, purchases, requests, restaurant, restock,
  subscriptions, tenants, verification.

### Problems found
1. **No read-once suppression except low stock.** `raiseLowStock` dedups on
   `isRead: false` (so a read alert won't regenerate until it resolves + re-fires)
   — but every other `notify*` method **creates a new row on every call**. So
   re-running a job, re-saving a record, or an idempotent re-trigger produces a
   duplicate notification even after the user read (and the situation may be
   unchanged). This is the core of the request.
2. **`isRead` is global, not per-user.** A role/location broadcast is **one row**;
   when one member reads it, it is marked read for **everyone**, and different
   members' read states collide. "Read once" is therefore ambiguous for fan-out
   notifications.
3. **Regeneration after read for periodic/recomputed events.** e.g. low-stock is
   handled, but "shift ended", "shortage reported", "pending approval", reminder
   jobs that re-run create fresh rows each run.
4. **Routing gaps to verify:** some flows may notify the wrong audience (owner vs
   location vs role), have no deep link, or use a default link that 404s. The map
   in `notificationLink.ts` covers only a few types.
5. **No stable "event key".** Without a business-event identity (a dedup key),
   the system cannot tell "the same event" from "a new one", so read-once is
   impossible to enforce reliably.

## Design

### 1. Give every notification a stable dedup key (the enabler)
Add to `Notification`:
- `dedupeKey String?` — a deterministic key for the underlying business event,
  e.g. `LOW_STOCK:<tenant>:<product>:<variant>:<location>`,
  `REQUEST_APPROVED:<requestId>`, `SHIFT_END:<shiftId>`,
  `SUB_RECEIPT_FLAGGED:<paymentId>`, `PO_DRAFT:<poId>`.
- `@@unique([tenantId, targetUserId, dedupeKey])` won't work with nulls; use a
  partial unique index per audience (see below) **or** enforce dedup in the
  service with an existence check.
- `resolvedAt DateTime?` (optional) — for alerts that should stay suppressed until
  the condition clears (low stock does this via `isRead`; make it explicit).

### 2. Per-user read state for broadcasts (or a clear rule)
Two options; pick one (open question 1):
- **A. Recipient rows:** fan a broadcast out to one row **per recipient**
  (`targetUserId` set). Then `isRead` is naturally per-user and read-once is
  exact. Cost: more rows; needs a recipient-resolution step at create time
  (already partly done by `notifyOwner`/`notifyRole`→`sendToRoleId` push).
- **B. Keep single rows + a `NotificationRead` join table** (`notificationId`,
  `userId`, `readAt`) and compute unread per user. Smaller write volume, more
  query complexity.

Recommend **A** (recipient rows) for correctness and simpler per-user unread
counts, since pushes already resolve recipients.

### 3. Read-once enforcement (the requested behavior)
- **Insert-once per event:** `notify*` computes a `dedupeKey`; if a row with the
  same key already exists **for that recipient** (read or not), it does **not**
  create another and does **not** re-push. This is what "once marked read, block
  from regenerating / re-triggering" requires.
- **Low stock** already dedups; align it to the same helper and keep the
  auto-resolve-until-condition-clears rule.
- **Recurring reminders** (e.g. subscription due-soon, shift end): make them
  **idempotent per period** by including the period in the key, so a read
  reminder is not re-created within the same period but a **new** period still
  notifies (that's the intended nag).
- Provide a small helper `notifyOnce({ dedupeKey, ...target }, ...)` used by all
  senders, so dedup lives in one place.

### 4. Routing correctness pass
- **Audience matrix:** for each trigger, confirm *who* should get it (owner /
  location / specific role systemKey / specific user) and that the code uses the
  right `notify*` method. Fix misroutes (e.g. owner-only where the location's
  staff must act).
- **Deep links:** ensure every notification sets a `link`, and extend
  `notificationLink.ts`'s type→link map for types that currently fall through to
  `null` (so nothing is a dead-end). Validate links resolve to real routes.
- **Tenant/role resolution:** restaurant/manufacturing use `notifyRoleId` (by
  immutable id) — good; verify car-wash, hotel, service, credits, purchases,
  restock, requests, subscriptions, verification routes.
- **Domain coverage check:** walk the business-critical events and confirm a
  notification exists (list in Appendix), adding any missing ones.

### 5. Frontend
- Bell/toast already share `notificationLink`; extend it for new types.
- Keep the "sticky" bar behavior; once read, the item disappears and must not
  re-appear via SSE/poll (server now guarantees no re-insert).
- Per-user unread count becomes exact with recipient rows.

## Data model changes
```prisma
model Notification {
  // ...existing...
  dedupeKey  String?    // stable key for the underlying event
  resolvedAt DateTime?  // when the underlying condition was cleared (optional)
  @@index([tenantId, dedupeKey])
  // A recipient is now always concrete when fanned out:
  // (targetUserId set for per-user rows)
}
```
Optionally a `NotificationRead` table if Option B is chosen.

Migration: **idempotent** SQL — add columns + index; backfill `dedupeKey` for
existing open alerts where derivable (low stock) so they suppress correctly.

## Implementation steps
1. Schema + idempotent migration (`dedupeKey`, `resolvedAt`, index).
2. `notifications.service.ts`: add `notifyOnce(...)` + a `dedupeKey` builder;
   route `notifyOwner/Location/User/Admins/Role/RoleId` through it; fan out to
   recipient rows; refactor low-stock onto the same helper.
3. Update **every call site** (63) to pass a stable `dedupeKey` and the correct
   audience/link. Grouped per module; each gets a test.
4. Extend `lib/notificationLink.ts` type→link map; verify icons/links.
5. Frontend: no re-appear after read (server guarantee); ensure bell/toast honor
   it; re-check unread counts on the SSE stream.
6. Tests: dedup (same key twice → one row; after read → still no re-insert),
   per-user read isolation, link correctness, and a coverage test asserting each
   trigger type emits the expected audience + key.

## Verification
- Trigger the same event twice → **one** notification; mark read → re-trigger →
  **still none**.
- A role/location broadcast: each member has their own read state.
- Low stock: read it, re-run the stock scan with the same qty → not recreated;
  stock rises above the threshold → resolved; drops again → a new alert is allowed.
- Every notification has a working deep link (no dead ends).
- `tsc` + jest clean; frontend build.

## Appendix — business events to cover (audit checklist)
Inventory/stock (low stock, wastage, adjustment, restock ready), Requests
(submitted/approved/rejected/shortage), Purchases (PO draft/needs approval/bill
due), Sales/Credits (credit payment received, overdue), Car wash (wash settled/
collection, washer deduction due), Restaurant (new order/ready/served/cancelled),
Hotel (reservation/check-in/out/folio), Manufacturing (job stage/shift end/
reorder), Subscriptions (receipt flagged, expiring soon, expiring, expired),
Verification (business/user submitted/flagged/approved/rejected), Employee
deductions (due soon), Admin (new business/owner). Confirm each has a trigger,
audience, key, and link — adding any that are missing.

## Open questions
(none — all confirmed)

## Confirmed decisions
1. **Recipient rows** — every notification fans out to one row per recipient
   (`targetUserId`), so read state is per-user. Broadcasts resolve their
   recipients at create time.
2. **Recurring reminders are idempotent per period** — a read reminder does not
   re-appear in the same period, but a new period notifies again (intended nag).
   The `dedupeKey` includes the period.
3. **Prioritize the business-critical modules** first (inventory/stock, requests,
   purchases, sales/credits, car wash, hospitality, manufacturing, subscriptions,
   verification, employee deductions), then the rest.
4. **Keep the client `localStorage` dismissal cache** for the toast bar; the server
   additionally guarantees no re-insert after read.
