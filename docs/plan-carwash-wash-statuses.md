# Plan — Car-wash wash statuses (queue → in progress → complete → settled) + fixes

## Requested work

1. **Four wash statuses** (currently only `IN_PROGRESS` / `COMPLETED`):
   - `QUEUED` (ሰልፍ) — auto queue number per day starting at 0 each day,
   - `IN_PROGRESS` (እየታጠበ) — when "Start" is clicked,
   - `COMPLETED` (ተጠናቋል),
   - `SETTLED` / Paid (ተከፍሏል).
   - **Track the time of every status change** (time only, not date).
2. **UI**: rows clickable → detail modal; keep the table compact; the **status
   column is clickable until settled** (advances the status).
3. **Fix price edit** — editing creates a new row and keeps the old one.
4. **Washer registration dropdown** → only **active** washers.
5. **Sort washers by status** everywhere in the project.

## Findings (verified)

### Status model
- `enum CarWashStatus { IN_PROGRESS, COMPLETED }`; `CarWash.status` defaults
  `IN_PROGRESS`, with a single `completedAt` timestamp and no queue number.
- `createWash` creates with the default status; `completeWash` sets
  `COMPLETED` + `completedAt` and posts the GL income (only on completion).
- No queue number column exists on `CarWash` (bookings have `positionInQueue`,
  but the request is about the *wash* row).

### Washes UI (`carwash/washes/page.tsx`)
- Table with a status pill; only a "Complete" text button for `IN_PROGRESS` and
  "Delete". No row-click detail, no per-status advance.
- `statusFilter` offers only `IN_PROGRESS` / `COMPLETED`.

### Price edit bug (root cause)
- Frontend `openEdit` loads the row into the form, but `submit` always calls
  `POST /carwash/prices` **without the row id**.
- Backend `upsertPrice` matches on `(tenantId, vehicleType, washTypeId)`. When the
  user **changes the vehicle type** (or wash type), no row matches the new key →
  it **creates** a new row and the old row remains → "keeps the first price and
  creates the edited one".
- Fix: send the edited price `id`; backend `updatePrice(id, dto)` updates that
  exact row (re-checking the unique key for collisions). `POST` only for creates.

### Washer dropdowns / sorting
- `listWashers()` returns **all** washers (`orderBy: { name: 'asc' }`) with no
  active filter. The registration (washes) dropdown uses it directly, so inactive
  washers appear.
- Washers are sorted by name in `listWashers`; other surfaces (dashboard,
  reports) sort differently or not at all.

## Design decision

### A. Statuses + per-day queue number
- Extend `enum CarWashStatus { QUEUED, IN_PROGRESS, COMPLETED, SETTLED }`
  (migration `ALTER TYPE ... ADD VALUE` for `QUEUED`, `SETTLED`).
- Add to `CarWash`:
  - `queueNumber Int?` — the per-day queue position.
  - `queuedAt DateTime?`, `startedAt DateTime?`, `completedAt DateTime?` (exists),
    `settledAt DateTime?` — **timestamps** (the UI shows time-only).
- **Auto queue number**: on `createWash`, compute
  `queueNumber = count(washes for that tenant+day) ` (0-based → "starts from 0",
  so `max(queueNumber)+1` starting at 0, or `count` for same-day). Reset daily by
  scoping to the local day. (Use the existing `resolveRange`/local-day helper.)
- **New wash defaults to `QUEUED`** with `queuedAt = now` (the vehicle waits in
  queue on registration).
- Status transitions (each sets its timestamp):
  - `startWash(id)` → `IN_PROGRESS`, `startedAt = now`.
  - `completeWash(id)` → `COMPLETED`, `completedAt = now` (existing GL posting
    stays on completion).
  - `settleWash(id)` → `SETTLED`, `settledAt = now`. (Payment settlement; may also
    be where cash collection is recognised — keep GL posting on completion as
    today unless specified.)
- Controller endpoints: `PATCH /carwash/washes/:id/start`,
  `/complete` (exists), `/settle`. Guarded by `carwash.washes.edit` (settle may
  additionally require `carwash.collections.create` — propose edit for now).

### B. UI — compact table + clickable status + detail modal
- Table stays short: Date/time, Plate, Washer(s), Amount, **Status** (clickable),
  and maybe a "view" affordance. Full data (customer, vehicle type, wash type,
  notes, timestamps, participants) moves into a **detail modal**.
- Row click → detail modal (shows all fields + the status timeline with times).
- **Status column is a clickable control until settled**: clicking advances
  QUEUED → IN_PROGRESS → COMPLETED → SETTLED (calling the matching endpoint).
  Once `SETTLED`, it renders a static badge.
- Keep the existing filters; extend `statusFilter` options to all four.
- Show queue number ("#3") on queued rows and the Amharic/localized labels.

### C. Fix price edit
- Add `id?` to `UpsertPriceDto` (or add `PATCH /carwash/prices/:id` +
  `UpdatePriceDto`). Recommended: **`PATCH /carwash/prices/:id`** with
  `updatePrice(id, dto)` that updates the row (and rejects a change that collides
  with another row's key). Frontend `submit` uses PATCH when editing, POST when
  creating.
- Keep `upsertPrice`/`POST` for creates (and idempotent seeding).

### D. Active washers + sorting
- `listWashers(activeOnly?)`: default returns active; the washes create form and
  bookings/equipment pickers request **active only**. (Option: a query param
  `?activeOnly=1`, or filter by default and add `?includeInactive=1` for the
  management page which must show inactive ones.)
- **Sort by status then name** everywhere: active/`isActive` first, then by name.
  Apply in `listWashers`, the washers page, dashboard, and the washer reports.
  (Define "status" = active before inactive.)

## Work plan

1. **Schema + migration**: extend `CarWashStatus` (`QUEUED`, `SETTLED`); add
   `queueNumber`, `queuedAt`, `startedAt`, `settledAt` to `CarWash`. Backfill:
   existing `IN_PROGRESS` → `startedAt = date`, `COMPLETED` → `completedAt`.
2. **Service**:
   - `createWash`: assign `queueNumber`, status `QUEUED`, `queuedAt`.
   - add `startWash(id)`, `settleWash(id)`; keep `completeWash` (GL posting).
   - `listWashers(activeOnly?)` + status-then-name ordering.
   - `updatePrice(id, dto)`.
3. **Controller**: `PATCH washes/:id/start`, `.../settle`; `PATCH prices/:id`.
4. **DTOs**: `UpdatePriceDto`; keep `UpsertPriceDto` for create.
5. **Frontend**:
   - washes page: compact table, row-click detail modal, clickable status column,
     queue column, extend status filter; washes-create washer dropdown active-only.
   - prices page: PATCH on edit.
   - bookings/equipment/dashboard washer dropdowns: active-only where used for
     assignment.
   - profile page: for washers, allow phone/name edit (email read-only) and show
     the self password-change card.
6. **Backend profile/auth**: allow a washer to change their own password
   (current-password verified); restrict a washer's `updateProfile` to
   name/phone (ignore/reject email).
7. **i18n** (en + am): status labels — Queue→ሰልፍ, In-progress→እየታጠበ,
   Complete→ተጠናቋል, Paid→ተከፍሏል; plus "Queue #", timeline labels.
8. **Tests**: status transitions + timestamps; queue numbering resets daily;
   price update keeps one row; `listWashers` active filter + ordering; washer can
   change own password / cannot change email.
9. **Verify**: `tsc`, `jest`, `next build`.

## Risks / notes
- `SETTLED` vs `COMPLETED` semantics: GL posting currently happens on completion.
  Decide whether settlement should also post cash/owner collection — plan keeps
  completion posting; settlement is a status/timestamp (extendable).
- **Existing rows**: default status changes to `QUEUED` for *new* rows only; the
  migration must not reclassify historical washes (keep their status, backfill
  timestamps from `date`/`completedAt`).
- Queue numbering must scope to the **tenant + local day**; concurrent creates
  could collide — use a `max(queueNumber)+1` inside a transaction (small race
  window; acceptable, or add a per-day unique index if strict).
- `CarWashStatus` is an enum: adding values needs a migration (`ALTER TYPE ADD
  VALUE`), which Postgres applies immediately and cannot be rolled back in a
  transaction — order the migration accordingly.
- Active-only dropdowns: the **management** washers page must still list inactive
  ones (so an owner can reactivate), so the filter is for *assignment* pickers.

---

## Implementation summary (delivered)

**Statuses + queue**
- `CarWashStatus` extended to `QUEUED | IN_PROGRESS | COMPLETED | SETTLED`
  (migration `20261014000000_carwash_wash_statuses`, with `ALTER TYPE ADD VALUE`
  and a `status` default of `QUEUED`).
- `CarWash` gains `queueNumber`, `queuedAt`, `startedAt`, `completedAt` (existing),
  `settledAt`. Migration backfills `startedAt`/`completedAt` for historical rows
  without reclassifying them.
- `createWash`: status `QUEUED`, `queuedAt = now`, and a **per-tenant per-day
  queue number starting at 0** (scoped to the local day).
- New `startWash` (→ IN_PROGRESS, `startedAt`) and `settleWash` (→ SETTLED,
  `settledAt`); `completeWash` unchanged (→ COMPLETED + GL posting).
- Endpoints `PATCH /carwash/washes/:id/start|complete|settle`, all gated on
  `carwash.washes.edit`.

**Washes UI**
- Compact table: Date(+queue #), Plate, Washers, Amount, Status. Row click opens a
  **detail modal** with all fields + a **status timeline (time only)**.
- The **status cell/column is a clickable control** that advances the status
  until `SETTLED`, then renders static. Status filter extended to all four.
- Wash-create dropdown now requests **active washers** (`?activeOnly=1`).

**Price edit fix**
- New `PATCH /carwash/prices/:id` + `updatePrice` (updates the exact row,
  rejecting a collision with another row's key). The prices page uses PATCH when
  editing, POST when creating — no more duplicate rows.

**Active washers + sorting**
- `listWashers(activeOnly)`; assignment pickers (wash create, bookings, equipment,
  dashboard) request active-only; the management page still lists all.
- Washers are ordered **active-first, then name** in `listWashers` and the report
  queries.

**Washer profile**
- `changePassword` now allows a washer (linked `CarWashWasher`) to change their
  own password (current password verified); non-owner non-washers still rejected.
- `updateProfile` ignores an email change for a washer (name/phone editable);
  `getProfile` returns `isWasher` / `emailEditable`.
- Profile page shows the change-password card for owners **and** washers, and
  locks the email field for washers.

**i18n** (en + am): `carwash.status_QUEUED|IN_PROGRESS|COMPLETED|SETTLED`,
`queueNumber`, `statusTimeline`, `advanceStatus`.

**Tests**: `carwash-wash-status.spec.ts` (queue numbering, transitions,
`listWashers` ordering/active filter) and `auth-washer-profile.spec.ts` (washer
password allowed, email locked, plain staff blocked). Full suite **49/432**.

---

## Revision — final status flow + GL timing

Per the confirmed flow:
1. **QUEUED** — ሰልፍ / Queue (registered; queue number starts at **1** each day)
2. **IN_PROGRESS** — እየታጠበ / Washing (click **Start washing**)
3. **COMPLETED** — ታጥቧል / Washed (click **Washed**)
4. **SETTLED** — ተጠናቋል / Complete (click **Paid** or **Washed & paid**) — **final**
   → **no further status action** after Complete.

Changes:
- Status labels updated (en + am): `IN_PROGRESS` → Washing, `COMPLETED` → Washed,
  `SETTLED` → Complete.
- The washes UI replaces the single clickable status pill with **explicit labeled
  action buttons per stage** (row + detail modal): Start washing / Washed, and
  from Washed both **Paid** and **Washed & paid** (both → Complete).
- **GL timing moved to Complete/paid** (decision 2): revenue + washer commission
  are posted in `settleWash`, not `completeWash`. A washed-but-unpaid wash posts
  nothing. `completeWash` is now a status/timestamp-only update.
- Queue numbers start at 1; the "Wash recorded — …" banner was removed; a status
  totals strip (Queue / Washing / Washed / Complete) was added.
- Spec updated: complete-washed posts nothing; settle-complete posts the ledger.

Note: the reports/summary surfaces still aggregate all washes in range by date
(unchanged); if revenue should count only settled washes on those surfaces, that
is a follow-up.
