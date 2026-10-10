# Plan: Car-wash queue numbering, today-default, stat row, filter panel

> **STATUS: IMPLEMENTED.** Queue renumbers on start + delete, washes page defaults
> to Today, stat cards are a single tappable row that opens a per-status vehicle
> list, and the page uses `CollapsibleFilterPanel`. 461/461 tests pass.

## Goal
1. **Starting a wash removes it from the queue** and the remaining queue numbers
   are **renumbered** (compact, in order).
2. **Deleting a wash renumbers** the remaining queue the same way.
3. The washes page **defaults the date filter to Today**.
4. The **status stat cards sit in one row on both mobile and desktop**.
5. The page uses the **reusable filter dropdown panel** (verify/align).

## Current state (from the code)
- **Queue number** is assigned in `createWash` per tenant per local **day**:
  `queueNumber = (last?.queueNumber ?? 0) + 1` for the day's `last` row ordered by
  `queueNumber desc`. It is **never renormalized** afterward — so starting or
  deleting a wash leaves **gaps** (1, 3, 4 …).
- **Status flow:** `QUEUED → IN_PROGRESS → COMPLETED → SETTLED`.
  `startWash` sets `IN_PROGRESS` + `startedAt` (no queue change).
  `deleteWash` just deletes.
- **Washes list** (`listWashes`) returns the day's rows `orderBy: { date: 'desc' }`.
- **Frontend washes page** (`app/dashboard/carwash/washes/page.tsx`):
  - **Already uses `FilterPanel` + `FilterSelect`** (the shared dropdown panel) —
    so requirement #5 is largely met; only verify/align styling.
  - **Date default is `"month"`** (`getDateRange("month")`) → must become
    **`"today"`**.
  - **Stat cards** are `grid grid-cols-2 md:grid-cols-4` → 2×2 on mobile → must be
    **a single row** (`grid-cols-4`) on all sizes.
  - Queue number is shown next to the date as `#<n>`.

## Design

### 1 & 2 — Queue renumbering on start / delete
The queue is the set of **open** washes for the day, i.e. `QUEUED` (+ we must
decide whether `IN_PROGRESS` still counts — see open question 1). "Starting"
moves a wash out of the queue, so the remaining `QUEUED` washes are compacted to
`1..N`.

Implement a helper on the backend:
```
private async renumberQueue(tx, tenantId, day /* the wash's date */) {
  const open = await tx.carWash.findMany({
    where: { tenantId, date: { gte: dayStart, lt: dayEnd }, status: 'QUEUED' },
    orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }],   // stable FIFO order
    select: { id: true, queueNumber: true },
  });
  let n = 1;
  for (const w of open) {
    if (w.queueNumber !== n) {
      await tx.carWash.update({ where: { id: w.id }, data: { queueNumber: n } });
    }
    n += 1;
  }
}
```
- Call it **after** `startWash` (the started wash is no longer `QUEUED`, so it is
  excluded) and **after** `deleteWash`.
- Both should run in a transaction so the renumber is atomic with the status/deletion
  change (delete first, then renumber; start then renumber).
- Order by **`queuedAt`** (FIFO) rather than the current `queueNumber`, so the
  compaction is deterministic even if numbers were already gapped.
- **New washes created after a compaction** continue from the current max
  (`(last?.queueNumber ?? 0) + 1` already does this) — but note it uses the day's
  max over **all** statuses. To keep the queue contiguous it should compute the
  next number over **`QUEUED` only** (see open question 2), or simply always append
  `max(queueNumber)+1` — either is consistent as long as renumber is `1..N`.

**Edge cases**
- The renumber must be **day-scoped** (queue is per local day, so use the same
  `dayStart`/`dayEnd` derivation as `createWash`, based on the wash's `date`).
- **Idempotent:** re-running produces the same `1..N`.
- **Concurrency:** two washes started at once could race; wrapping the status
  change + renumber in one transaction and (optionally) a row lock on the day's
  rows keeps it consistent. At minimum, the renumber is a single ordered pass.
- **Ordering on the list**: keep the wash list sorted so the queue reads 1,2,3…;
  the list currently orders by `date desc` — the **queue column** (or its sort)
  should follow `queueNumber asc` for open rows.

### 3 — Default the date filter to Today
- Frontend: `const wsInit = getDateRange("today");` and
  `useState<DatePreset>("today")` for `datePreset` on the washes page.
- Confirm the backend `listWashes` default range (when no dates sent) is the
  current day too, so the initial load matches the UI (`resolveRange` already
  defaults to the local day — verify).

### 4 — Stat cards in one row (mobile + desktop)
- Change `grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3` →
  **`grid grid-cols-4 gap-1.5 sm:gap-3`** (single row at every width).
- Shrink typography/padding so four cards fit a 360 px phone:
  `px-2 py-1.5`, label `text-[10px]`, value `text-sm`.
- Keep the existing colour coding (QUEUED amber / IN_PROGRESS blue / COMPLETED
  green / SETTLED emerald).

### 5 — Reusable filter dropdown panel
- Already implemented with `FilterPanel` + `FilterSelect`. Verify:
  - the `extra` selects (washer, wash type, status) use `FilterSelect` (they do),
  - the search field + date filter render through the shared panel,
  - **no** ad-hoc toolbar remains,
  - optionally wrap it in the shared **`CollapsibleFilterPanel`** for consistency
    with other list pages (matches the "reusable filter panel" direction) — decide
    in open question 3.

## Files to touch
- **Backend** `src/carwash/carwash.service.ts`:
  - add `renumberQueue(...)` and call it in `startWash` and `deleteWash`
    (transactional).
  - (optional) adjust `createWash`'s next-number to consider `QUEUED` only.
- **Frontend** `app/dashboard/carwash/washes/page.tsx`:
  - default `datePreset`/range to **today**;
  - stat cards → single row (`grid-cols-4`);
  - (optional) switch to `CollapsibleFilterPanel`.
- Tests: a car-wash spec asserting renumber after start and after delete
  (e.g. queued 1,2,3 → start #1 → remaining are 1,2; delete one → 1).
- i18n: reuse existing labels (no new strings expected).

## Verification
- Create 3 queued washes (queue 1,2,3). **Start #2** → queue becomes **1,2** for the
  two remaining (the started one no longer shows a queue number / is out of the
  queue). **Delete one** → remaining queued renumber to **1,2** (contiguous).
- Queue numbers are per-day and start at 1 each new day.
- Washes page opens on **Today**.
- Stat cards render in **one row** on a 360 px viewport and on desktop.
- Filters render through the shared panel (dropdowns), no ad-hoc toolbar.
- Backend `tsc` + jest clean; frontend `tsc` + `next build` clean.

## Open questions
1. **What counts as "in the queue"?** Only `QUEUED`, or `QUEUED + IN_PROGRESS`
   (i.e. does starting remove it from the queue, or does the queue still list
   "currently washing")? The request says *remove it from the queue when it starts
   washing* → **queue = QUEUED only**. Confirm.
2. **New-number source:** after renumbering, should a new wash take `max+1`
   (which, post-compaction, is `N+1`) — i.e. append to the end — while older
   `IN_PROGRESS`/`COMPLETED` rows keep their (now possibly duplicated) numbers?
   Recommend: **queue numbers only apply to `QUEUED`**; once started, the number is
   cleared (set `null`) or kept as a historical label. Which do you want?
3. **Panel form:** keep the plain `FilterPanel` (current) or switch the washes page
   to the shared **`CollapsibleFilterPanel`** (collapsible, starts expanded)?
4. **Renumber past rows?** Only *open* (`QUEUED`) washes are renumbered; already
   started/completed/settled washes keep their number as history. Confirm.
