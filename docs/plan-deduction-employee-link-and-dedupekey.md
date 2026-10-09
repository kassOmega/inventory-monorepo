# Plan: Clarify (and simplify) the deduction employee link + document `dedupeKey`

Two design questions raised on the employee-deductions / notifications work. This
plan answers both from the actual code and proposes a concrete simplification.

---

## Q1 — Why `washerId` on a deduction when `userId` should be enough?

### What the code actually says
- `CarWashWasher.userId` is **nullable** (`userId Int?  @unique`), *not* required.
- A washer gets a login account only via `provisionWasherAccount(...)`, which
  **creates a `User` + a `WASHER` membership** and then sets `CarWashWasher.userId`.
  It is **idempotent** and only runs for washers created/updated through the
  car-wash module.
- Consequences:
  - New washers (created by the app) **do** get a `userId` — so for those,
    `userId` alone would be enough.
  - **Legacy / manually-inserted washers**, or rows created before account
    provisioning existed, can have **`userId = null`** — there is no `User` to key
    a deduction to.

### So why keep `washerId`?
Because a deduction in this feature is recovered **from commission**, and the
commission is attached to the **`CarWashWasher`** (the `commissionRate` lives
there, and `computeWashCommissions` works on washer ids). Even when a user exists,
the *money* is owed by the washer entity. Using `userId` alone would:
1. **drop deductions for a washer with no login** (nullable `userId`), and
2. make the commission→deduction sweep awkward (it works in washer space).

That was the rationale for carrying **both**: `userId?` (staff, and washers *with*
a login) and `washerId?` (commission recovery / no-login washers).

### Is it worth simplifying? Trade-offs
- **Keep both (status quo):** handles every washer (login or not) and matches the
  commission model. Cost: two nullable FKs, and callers must know which to pass.
- **Use only `userId`:** simpler, but **loses commission-only / no-login washers** —
  a real gap given `provisionWasherAccount` only covers app-created washers.
- **Use only `washerId` + a nullable `userId` for non-washer staff:** equivalent to
  status quo, just relabeled.

### Recommendation
**Keep the dual link, but make it explicit and safe:**
1. Add a **single resolved "employee" accessor**: when a deduction is created for a
   washer, **also persist `userId` if the washer has one** (denormalize once at
   create) — so both keys stay consistent and queries can use either.
2. Add a **DB guard**: at least one of `userId`/`washerId` must be set (a CHECK
   constraint or service validation — the service already requires one).
3. Document in the schema comment: *`washerId` is required for commission
   recovery / no-login washers; `userId` covers staff and is mirrored from the
   washer when known.*
4. Optionally: if you prefer a single key, key deductions on `userId` only **and
   backfill `washers.userId` for all existing washers** (provision accounts for
   legacy rows) — then `washerId` is redundant. This is a bigger change (creates
   logins for every legacy washer) and changes auth surface, so **not recommended**
   unless you want every washer to have an account.

**Net:** `userId` is *usually* enough, but **not guaranteed** given the nullable
link; `washerId` exists to cover commission recovery and no-login washers. Keep it,
tie them together at create time, and document the rule.

---

## Q2 — What is `dedupeKey`?

### Definition
`dedupeKey` is a **stable string that names the underlying business event**, stored
on `Notification`. It is the identity of "the thing that happened", so the system
can tell *the same event* apart from *a new one* and **never notify twice for the
same event**.

### How it works (from the code)
In `NotificationsService.emitOnce(recipient, payload)`:
```ts
const key = payload.dedupeKey ?? null;
if (key) {
  const existing = await prisma.notification.findFirst({
    where: { tenantId, dedupeKey: key, targetUserId: recipient },
    select: { id: true },
  });
  if (existing) return false;   // already notified this event → no new row, no push
}
await prisma.notification.create({ data: { ...payload, dedupeKey: key, targetUserId: recipient } });
```
So a key is unique **per recipient** — the same event produces **one row each**,
and once it exists (read or not) it is **never regenerated**.

### Why it matters (your requirement)
"Once marked read, block it from regenerating" is enforced here: the key is the
event identity, so re-running a job / re-saving a record / an idempotent re-trigger
cannot re-create or re-push the notification after it was read.

### Convention (examples in the code)
Key = `TEMPLATE:specific ids`, e.g.:
- `REQUEST_CREATED:<requestId>`
- `REQUEST_SHORTAGE:<requestId>:<locationId>`
- `PO_DRAFT:<batch ids>`
- `SUB_RECEIPT_FLAGGED:<paymentId>`
- `VERIFICATION_FLAGGED:<docId>`
- `LOW_STOCK:<tenant>:<product>:<variant>:<location>:<targetRole>:<targetLocation>`
- `DEDUCTION_DUE:<deductionId>:<dueDate>`  ← **includes the period**, so a read
  reminder stays gone for that due date, but a new due date notifies again (the
  intended **per-period** nag you asked for).

### Rules
- **Stable & deterministic:** derived from business ids, never from text/time.
- **Scoped per recipient:** uniqueness is `(tenantId, dedupeKey, targetUserId)`.
- **Omit it → legacy behavior:** no key means every call creates a new row (so a
  deliberately repeatable notification can opt out).
- **Recurring reminders include their period** in the key so they re-fire each
  period but not within one.

### Lifecycle nuance
Low-stock alerts additionally auto-**resolve** when stock recovers (marked read /
`resolvedAt`), which frees the key to fire again *if the condition returns* — a
controlled exception to "never again", for alerts that represent a live state.

---

## Proposed actions (small, safe)
1. **Schema/comment + consistency for the employee link:**
   - Mirror `userId` from the washer at deduction-create time (denormalized once).
   - Add a schema comment describing `userId` vs `washerId` and the commission case.
   - Keep the service's "at least one of userId/washerId" validation (already there).
2. **Doc `dedupeKey`** in the `Notification` model comment (the key convention +
   per-recipient uniqueness + per-period reminders), so future triggers use it
   consistently.
3. No behavior change beyond the create-time mirror; existing tests stay green
   (+ one test asserting the mirror).

## Open questions
1. Employee link: **keep dual `userId`+`washerId`** with the create-time mirror
   (recommended), or switch to **`userId`-only** and backfill accounts for all
   legacy washers (bigger, changes auth)?
2. Do you want a **DB CHECK** enforcing "userId OR washerId set", or keep it
   service-level validation only?
3. `dedupeKey` naming: keep the `TEMPLATE:ids` convention, or standardize on a
   namespaced form like `carwash.request.created:<id>`?
