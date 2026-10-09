# Plan: 502 after deploy (PWA, persists across app restarts)

> **STATUS: FIX APPLIED (pending deploy).** Root cause identified and the
> idempotency bug + entrypoint hardening are implemented. Still to confirm:
> whether prod is a legacy `db push` DB or migration-tracked, and whether a
> `migrate resolve` is needed before redeploy (see P2).

## Symptom
Opening the PWA after deploying the latest changes (`a320bbd`) returns **502 Bad
Gateway**. Clearing the app from recents / clearing cache does **not** fix it —
which rules out a stale client shell and points at the **server**: the container
is not serving, so the platform proxy has no upstream.

## Root cause
The entrypoint treats a failed schema step as **fatal** (`exit 1`), and the new
migration added in `a320bbd` is **not idempotent for the foreign key**:

`inventory-backend/prisma/migrations/20261015000000_carwash_payment_method/migration.sql`

```sql
ALTER TABLE "CarWash" ADD COLUMN IF NOT EXISTS "paymentMethodId" INTEGER;   -- idempotent
CREATE INDEX IF NOT EXISTS ...;                                             -- idempotent
ALTER TABLE "CarWash"
  ADD CONSTRAINT "CarWash_paymentMethodId_fkey" ...                          -- NOT idempotent
```

PostgreSQL has **no `ADD CONSTRAINT IF NOT EXISTS`**. On any database where
`CarWash.paymentMethodId` + its FK already exist, this line throws
`ERROR: constraint "CarWash_paymentMethodId_fkey" for relation "CarWash" already exists`.

That happens on both deploy paths:

1. **Legacy `db push` database** (`docker/entrypoint.sh`): when `_prisma_migrations`
   is absent, the entrypoint runs `prisma db push` **first** — which recreates the
   column + FK from `schema.prisma` — and **then** replays the data migrations
   listed in the `for migration in ...` loop, including this one. The FK already
   exists → the `db execute` fails → `exit 1`.
2. **`migrate deploy` database** that got the FK via an earlier `db push` before
   the FK was tracked as its own migration.

Because the failure is fatal and happens **before** the API binds, the container
crash-loops: each boot re-runs the same failing step. The proxy returns 502 on
every request, app restart or cache clear included — exactly the reported
behavior (same class as the earlier `plan-502-login-carwash.md`, which was also a
schema/startup issue).

### Why it wasn't caught locally
The local DB already has the column/FK (built from the current schema), and the
dev server never runs the entrypoint's `db push` + migration replay path.

## Fix

### P0 — make the migration idempotent (done)
Rewrite the FK addition as a guarded block so re-applying it is a no-op:

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CarWash_paymentMethodId_fkey'
  ) THEN
    ALTER TABLE "CarWash"
      ADD CONSTRAINT "CarWash_paymentMethodId_fkey"
      FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
```

`ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` were already safe.

### P0 — audit every migration for the same class of bug
Sweep all committed migrations for non-idempotent DDL (`ADD CONSTRAINT`,
`ADD COLUMN`, `CREATE INDEX`, `CREATE TABLE`, `CREATE TYPE`) and guard each the
same way. Any `ALTER TABLE ... ADD CONSTRAINT` is the dangerous pattern.

### P1 — stop a schema hiccup from 502-ing the whole app
Two independent hardenings in `docker/entrypoint.sh`:
1. **Legacy replay should be resilient**: when the `db push` baseline already
   synced the schema, a *replayed data migration* that fails because the object
   already exists should not be fatal. Wrap the per-file `db execute` so it logs
   and continues on "already exists" errors, and only fails on genuine errors
   (or run the data migrations before `db push`, or skip the schema-related ones).
   Simplest robust form: keep `migrate deploy`/`db push` fatal, but treat the
   best-effort role/permission **data** replays as non-fatal (log a warning).
2. **Fail fast with a clear log**: the current message ("refusing to start") is
   good; add the actual failing SQL/error to the log so the next 502 is
   diagnosable from the platform logs without guessing.

### P2 — recovery on the already-broken deployment
The failed migration may be recorded in `_prisma_migrations` as **failed**
(Prisma "started but failed" state) on a database that reached `migrate deploy`.
Recovery options, in order:
- Redeploy with the fixed migration; if Prisma refuses ("failed migration
  found"), run `prisma migrate resolve --rolled-back 20261015000000_carwash_payment_method`
  once, then redeploy.
- Or mark it applied: `prisma migrate resolve --applied 20261015000000_carwash_payment_method`
  (safe now that the SQL is idempotent).

Add this to the runbook. Optionally add `--schema` + a startup guard in the
entrypoint that auto-resolves a **known** failed migration idempotently.

## Verification
- Reproduce against a DB that **already has** `CarWash.paymentMethodId` + FK:
  `prisma db execute --file 20261015000000_.../migration.sql` must exit 0
  (previously errored).
- Reproduce the legacy path: create a DB from `db push`, then run the entrypoint;
  the container must reach "API listening" and serve `/`.
- Fresh DB: `prisma migrate deploy` applies all migrations cleanly.
- `migrate deploy` after a prior failed run + `migrate resolve --rolled-back`
  succeeds.
- 502 gone: PWA loads, `/` returns 200, healthcheck passes.

## Open questions
1. Is the production DB **legacy (`db push`)** or **migration-tracked**
   (`_prisma_migrations` present)? This decides whether recovery needs
   `migrate resolve` or whether the fixed SQL alone is enough.
2. Can we read the platform container logs to confirm the exact failure line
   (the "refusing to start" message + SQL error)? That would confirm this root
   cause over a pure infra/proxy outage.
3. Should the best-effort role/permission **data** migrations be non-fatal in the
   entrypoint (recommended), or stay strict?
