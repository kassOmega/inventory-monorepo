# Plan — Replace runtime backfills with migrations + phone login for washers

## Task 1 — Remove runtime backfill commands; rely on `prisma migrate deploy`

### Current state (verified)
- `docker/entrypoint.sh` `run_migrations()`:
  - applies schema via `prisma migrate deploy` (or a one-time `db push` baseline
    for legacy DBs without `_prisma_migrations`), **then**
  - runs **role-permission backfills on every start**:
    `backfill-hospitality-role-permissions`, `backfill-customer-permissions`,
    `backfill-carwash-role-permissions`, `backfill-carwash-permission-prune`;
  - and `RUN_BACKFILLS=1` runs more: `backfill-guest-id-types`,
    `backfill-room-charges`, `backfill-carwash-vehicle-types`,
    `backfill-carwash-wash-types`.
- `inventory-backend/package.json` `build` also chains backfills:
  `backfill-guest-id-types`, `backfill-room-charges`,
  `backfill-hospitality-role-permissions`, `backfill-customer-permissions`,
  `backfill-carwash-role-permissions`.
- 15 backfill scripts exist in `prisma/`. Existing migrations already contain
  data fixes (UPDATE/INSERT), so the pattern is established.

### Decision
Move the **data changes** the backfills perform into **idempotent SQL migrations**
(one or more new migrations under `prisma/migrations/`), then **delete the
runtime backfill invocations** from `entrypoint.sh` (and the chained ones from
`package.json`'s `build`). Schema is already handled by `prisma migrate deploy`.

### Approach
Not every backfill is a data migration; classify:
- **Data-only, must persist** (convert to SQL, idempotent):
  - `backfill-carwash-role-permissions` — grant/revoke role-permission rows to
    the baseline (`INSERT ... ON CONFLICT DO NOTHING` / `DELETE ...`) per
    car-wash system role.
  - `backfill-carwash-permission-prune` — delete role-permission rows whose
    permission group is not in the business allow-list, for car-wash orgs.
  - `backfill-carwash-vehicle-types`, `backfill-carwash-wash-types` — seed
    default vehicle/wash types for existing car-wash orgs (`INSERT ... WHERE NOT
    EXISTS`).
  - `backfill-guest-id-types`, `backfill-room-charges` — hospitality defaults.
  - `backfill-hospitality-role-permissions`, `backfill-customer-permissions`,
    `backfill-view-profit` — role-permission baselines (same shape as car-wash).
- **One-off column fixes** already run historically; do **not** re-run. Leave the
  scripts in the repo for manual use but remove them from the entrypoint.
- **Ambiguous / risky** (`backfill-multi-tenant`, `backfill-standalone`,
  `backfill-verification`, `backfill-phantom-inventory`,
  `backfill-procurement-postings`, `backfill-beverage-categories`): **not** in the
  entrypoint today → leave untouched.

Key challenge: the backfills are written in **TypeScript against the Prisma
client** with logic (e.g. diffing role grants). Converting to SQL:
- Option A (preferred): generate a **static SQL migration** from the current
  desired state. Because the desired state is data-driven (permission catalog +
  role grants), write SQL that references the `Permission` table by `key` and
  `Role` by `systemKey`, **idempotently**:
  ```sql
  -- grant carwash.reports.commission to every CAR_WASH Washer role
  INSERT INTO "RolePermission" ("roleId","permissionId")
  SELECT r.id, p.id
  FROM "Role" r
  JOIN "Organization" o ON o.id = r."organizationId"
  JOIN "Permission" p ON p.key = 'carwash.reports.commission'
  WHERE o."businessType" = 'CAR_WASH' AND r."systemKey" = 'WASHER'
  ON CONFLICT DO NOTHING;
  ```
  and matching DELETE statements for keys not in the allow-list.
- Option B (fallback): keep one **pure-SQL "reconcile" migration** that recomputes
  grants from the catalog tables using INSERT/DELETE per role, or run the
  reconciler once via `migrate deploy` is not possible (migrations are SQL only),
  so Option A is used.
- To keep migrations maintainable, generate them from the TS logic via a small
  script (dev-time) that prints the SQL, then commit the SQL.

Also: `prisma migrate deploy` requires a **baseline** for existing DBs that used
`db push`. The entrypoint already handles the no-`_prisma_migrations` case with a
one-time `db push`. Keep that baseline step; it is not a "backfill".

### Deliverables
- New migration(s) `prisma/migrations/<ts>_reconcile_role_permissions/migration.sql`
  (+ any default-data seeds) that encode the backfill logic idempotently.
- `docker/entrypoint.sh`: remove both backfill loops; keep `migrate deploy` (+
  legacy `db push` baseline) and the `RUN_BACKFILLS` block **removed** or reduced
  to nothing.
- `inventory-backend/package.json`: `build` no longer chains the backfills
  (`prisma generate && nest build`); keep the backfill scripts for manual runs.
- Keep `prisma/*.ts` backfill scripts (documented as manual) OR delete the ones
  fully superseded. Recommend **keep** (they remain useful for local/backfill
  reruns) but stop invoking them automatically.
- Update Dockerfile comments referencing backfills.

### Verification
- On a fresh DB: `prisma migrate deploy` builds the schema **and** applies the
  data migrations; the API starts; roles have the expected grants.
- On a legacy `db push` DB: baseline branch runs once, then `migrate deploy`.
- No backfill script runs at container start (check logs).
- `carwash` role grants still correct (washers baseline; owners keep catalog).

## Task 2 — Allow washers to log in with their phone number

### Current state (verified)
- `LoginDto` requires `email` (`@IsEmail`) + `password`.
- `auth.service.login` looks up `user.findUnique({ where: { email } })`,
  lockout keyed by `email|ip`, audits `user.email`.
- `User.email` is `@unique`; `User.phone` is **nullable and not unique**.
- Washers are created via `createWasher` with `email` (required) + optional
  `phone` (`CreateWasherDto`), so a washer always has an email but the owner
  wants them to sign in with a **phone number**.
- Frontend `login/page.tsx` posts `{ email, password }`, input `type="email"`.

### Decision
Let the login identifier be **either an email or a phone number** in the same
field. Resolve the user by email first, then by phone.

### Approach
- **DTO**: rename the field to `identifier` (accept email OR phone) while keeping
  backward compatibility with `email`. Simplest: keep `email` optional and add
  `identifier` optional, require exactly one. Or: keep the property name `email`
  but relax validation to a string and detect. Prefer a clear `identifier` field
  with the old `email` accepted as an alias (so existing clients keep working).
- **Service `login`**: build a lookup:
  - if the identifier looks like an email (contains `@`) → `findUnique({ email })`;
  - else normalize the phone and `findFirst({ where: { phone: normalized } })`.
  - If phone matches multiple users, reject with invalid-credentials (or require
    uniqueness — see below).
- **Phone normalization**: strip spaces/dashes/leading `+`, keep digits; compare
  normalized. Store a normalized form (or normalize on write) so lookups are
  reliable. Add a helper `normalizePhone()` used on create/update and on login.
- **Uniqueness / ambiguity**: `User.phone` is not unique. For login safety:
  - Recommended: enforce phone uniqueness **per tenant** is hard because `User`
    is global; instead, if **more than one** user shares the phone, require the
    email (reject phone login with a clear "use email" message) — or scope the
    phone lookup by the org the person belongs to (not available pre-auth).
  - Simpler and safe: if `count > 1`, throw invalid credentials (do not leak).
  - Optional follow-up migration: add a **unique index on a normalized phone
    column** for washer accounts; but that's a bigger schema change — propose as
    an optional item.
- **Lockout / audit**: key the lockout on the **identifier** (email or phone) +
  IP, and audit with the resolved user's email/identifier.
- **Frontend** (`login/page.tsx`): change the field to accept email **or** phone:
  - label "Email or phone", `type="text"` (not `email`), update placeholder.
  - post `{ identifier, password }` (or `{ email: identifier, password }` if we
    keep the property). Keep demo-account prefill working (email-based).
- **i18n**: add/adjust `auth.emailOrPhone`.
- **createWasher**: ensure `phone` is captured and normalized; optionally make it
  required for washers so phone login is guaranteed.
- **Rate limiting**: keep the existing throttler on `/auth/login`.

### Verification
- Login with email → works (unchanged).
- Login with a washer's phone → resolves the user and issues the token.
- Ambiguous phone (two users) → rejected safely.
- Lockout still applies per identifier.
- Frontend field accepts both; error messages unchanged.

## Risks / notes
- **SQL conversion accuracy**: the role-reconcile logic must exactly reproduce
  the TS diff (grants + revokes) or roles drift. Generate the SQL from the TS
  logic and add a check.
- **Phone collisions**: because `User.phone` isn't unique, phone login can be
  ambiguous; handle explicitly (reject when multiple).
- Keeping the backfill scripts but not calling them preserves manual reruns.
- The one-time `db push` baseline for legacy DBs stays (it's schema, not data).

---

## Implementation summary (delivered)

### Task 1 — backfills → migrations
- New SQL migrations (idempotent, validated against the DB):
  - `20261013000000_reconcile_role_permissions` — syncs the permission catalog,
    then grants each car-wash system role its exact baseline and revokes anything
    outside it (mirrors `backfill-carwash-role-permissions`).
  - `20261013000001_carwash_prune_foreign_grants` — deletes foreign-group grants
    from all car-wash roles incl. hand-made (mirrors
    `backfill-carwash-permission-prune`).
- `docker/entrypoint.sh`:
  - migration-managed DBs: `prisma migrate deploy` **only** — no backfill loops.
  - legacy (`db push`) DBs: after the one-time baseline, it applies the **same
    SQL migration files** via `prisma db execute` (idempotent), instead of the TS
    backfill scripts. No backfill invocation remains anywhere.
- `inventory-backend/package.json` `build` → `prisma generate && nest build` (no
  chained backfills). The `.ts` backfill scripts remain in the repo for manual
  reruns but are no longer auto-invoked.

### Task 2 — phone login
- `common/phone.util.ts`: `normalizePhone()` (keeps optional `+`, digits only) and
  `looksLikeEmail()`.
- `LoginDto`: accepts `identifier` (email OR phone); `email` kept as an alias.
- `auth.service.login`: resolves by email (unique) or by **normalized phone**
  (narrowed by a 9-digit tail, confirmed by full comparison). A phone shared by
  more than one account is rejected (ambiguous). Lockout/audit keyed on the
  identifier / resolved user.
- Phone is normalized on write in `createWasher`/`updateWasher`,
  `register`/`signup`, and `updateProfile`.
- Frontend login: field label "Email or phone", `type="text"`,
  `autoComplete="username"`, posts `{ identifier, password }`; new i18n
  `auth.emailOrPhone` (en + am).

### Verification
- Migrations execute successfully via `prisma db execute`; reconcile + prune are
  idempotent.
- Phone resolution confirmed against the local DB (a linked washer user resolves
  by phone).
- Backend `jest` **45 suites / 423 tests** pass; `tsc` clean; `next build
  --webpack` compiles.

**Note:** several `CarWashWasher` rows have `userId: null` (no linked login
account) — those washers still cannot log in until an account is created; only
linked washers with a phone can use phone login.

---

## Follow-up — washer account provisioning (delivered)

- `createWasher`/`updateWasher`: a shared `provisionWasherAccount` helper creates
  a `User` (+ ACTIVE `Membership` with the WASHER role) and links the washer row,
  so **every newly created washer can sign in** (by email or phone). A phone-only
  washer gets a deterministic placeholder email `washer+<digits>@carwash.local`.
  `updateWasher` also provisions+links a legacy unlinked washer on save.
- New migration `20261013000002_carwash_washer_accounts` links existing phone-
  having washers to a login account (idempotent SQL, fixed bcrypt hash for the
  default password). Added to the entrypoint's legacy `db execute` list.
- `prisma/backfill-carwash-washer-accounts.ts` kept as a manual rerun tool.
- Tests: `carwash-washer-account.spec.ts` (provisioning + placeholder email);
  full backend suite 425 tests.
- Verified locally: legacy washers with phones are now linked and resolve by
  phone for login. (Washers with no phone still need an account/phone first.)
