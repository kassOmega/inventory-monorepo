# Plan — Production-only 502 on login (multi-business user, 2nd business = Car Wash)

Read-only investigation. No code changed.

## TL;DR

The "oversized JWT cookie" theory does **not** hold: even a worst-case owner
token (all 115 permission keys, 2 memberships) is **~4.3 KB**, and the whole
login response body is ~7.5 KB — comfortably under the 8 KB single-header /
16 KB total limits. The 502 is therefore almost certainly the **proxy failing
because the upstream NestJS process errors or hangs while serving login /
the immediate post-login `/auth/me` + `/tenants/me` calls**, and the Car Wash
vertical is the trigger because it introduces **lazy profile writes on a read
path** plus **models that were never added to the tenant-scoping middleware**.

Two concrete defects explain a "works local, 502 in prod" split:

1. **Lazy-create profile write inside `myOrganizations` (read path) is
   unguarded and race-prone.** `VerticalProfilesService.getProfile()` does a
   `create()` when no profile row exists. For the Car Wash org this hits
   `prisma.carWashProfile.create`. In production this runs on the first
   post-login load (and/or the business-switcher), can collide on the
   `@unique organizationId`, and — when migrations were not applied
   (`db push` vs. committed migrations, or `SKIP_MIGRATIONS=1`) — throws
   `P2021 table "CarWashProfile" does not exist`. The catch in
   `myOrganizations` is per-membership, but the created Prisma promise/error
   surfaces through the request pipeline and the reverse proxy turns the
   broken upstream response into a **502**.

2. **`CarWashProfile` (and the other `*Profile` models) are missing from the
   Prisma tenant middleware sets**, so profile reads/writes are not
   tenant-scoped and run outside the tenant context — inconsistent with every
   other model and a source of cross-request errors.

The JWT/header limit is a **secondary hardening item**, not the root cause.

---

## Evidence

### Suspect #1 — Oversized JWT / Set-Cookie: NOT the cause

- `auth.controller.ts:49` sets the token via
  `res.cookie(AUTH_COOKIE_NAME, result.access_token, authCookieOptions())`.
  Cookie name `access_token`, `HttpOnly`, `Secure` in prod, `SameSite=Lax`,
  `Max-Age=12h`.
- `auth.service.ts` login → `buildUserPayload(user)` → `jwtService.sign(payload)`.
  `auth.module.ts:18` uses `expiresIn: '6h'`, `JWT_SECRET` enforced ≥32 chars.
- `user-payload.util.ts` — the only per-business data added to the payload is
  `memberships[]` (`organizationId`, name, `businessType`, role name,
  `aiTrialEndsAt`, `verificationStatus`, `staffCount`), **plus a single
  `permissions[]` array**.
- **Key point:** `permissions` is taken from the **first membership only**
  (`user.memberships?.[0]?.role?.permissions`), *not* unioned across
  businesses. Adding a Car Wash business does **not** add its 33
  `carwash.*` keys on top of the first business's keys.
- Measured worst case: 115 distinct permission keys (the entire catalog)
  + 2 memberships → payload JSON ≈ **3.2 KB** → JWT ≈ **4.3 KB** →
  `Set-Cookie` ≈ **4.4 KB**. Full login JSON body ≈ **7.5 KB**.
- No duplicated `Set-Cookie`; no frontend `document.cookie` writer. So the
  header is large but below the 8 KB nginx `large_client_header_buffers` /
  common proxy limits.
- **Conclusion:** keep as a hardening item (trim `permissions` from the JWT and
  read them from `/auth/me`; or drop the cookie and rely on the Bearer +
  `localStorage` transport that the frontend already uses in
  `frontend/lib/api.ts`), but do not treat it as the 502 root cause.

### Suspect #2 — Car Wash query/schema on the auth path: LIKELY ROOT CAUSE

Relevant files:

- `frontend/context/AuthContext.tsx:110` — on mount the app calls
  **`GET /auth/me`** (and the business switcher calls `GET /tenants/me`).
- `inventory-backend/src/auth/auth.service.ts` `getMe()` — re-runs the
  memberships+role+permissions query and rebuilds the payload. No Car Wash
  joins here (safe on its own).
- `inventory-backend/src/common/strategies/jwt.strategy.ts` `validate()` /
  `loadUser()` — runs the **same heavy query on every authenticated request**
  and caches the payload for only 10 s. `validate()` caches the **promise**;
  if `loadUser` rejects (DB error) the rejected promise is cached for 10 s,
  extending an outage.
- `inventory-backend/src/tenants/tenants.service.ts:44` `myOrganizations()` —
  for **each** membership it calls
  `this.profiles.getProfile(m.organizationId)`.
- `inventory-backend/src/vertical-profiles/vertical-profiles.service.ts`
  `getProfile()` — **lazily creates a profile row when missing**:
  ```ts
  const existing = await (this.prisma as any)[delegate].findUnique({ where: { organizationId: orgId } });
  if (existing) return existing;
  const created = await (this.prisma as any)[delegate].create({ data: { organizationId: orgId } });
  ```
  For a `CAR_WASH` org the delegate is **`carWashProfile`**.

Problems:
1. **Write on a read path.** The first request after login (and any switch to
   the Car Wash business) performs an INSERT. If two requests arrive together
   (AuthContext `/auth/me` + business list, or double nav), both see "missing"
   and both INSERT → `P2002` unique violation on
   `CarWashProfile_organizationId_key`.
2. **Schema drift → hard failure.** Prod boots via
   `docker/entrypoint.sh` → `npx prisma db push` (or `SKIP_MIGRATIONS=1`).
   The Car Wash tables only exist in the committed migration
   `prisma/migrations/20261007000000_car_wash_vertical/migration.sql`.
   If `db push` wasn't run (or a separate migration step wasn't), the insert
   throws `P2021 table "CarWashProfile" does not exist`. The local DB (built
   from the latest schema/seed) has the table, so localhost works.
3. **Tenant middleware blind spot.** In
   `inventory-backend/src/prisma/prisma.service.ts`:
   - `CarWashProfile`, `RetailProfile`, `HospitalityProfile`, `ServiceProfile`,
     `ManufacturingProfile` are **absent** from `TENANT_MODELS` **and**
     `TENANT_FIELD_BY_MODEL`.
   - All *other* Car Wash models (`CarWashWasher`, `CarWashPrice`, …) **are**
     listed. So the profile tables alone fall outside auto-scoping, meaning the
     lazy write/read runs unscoped and can behave differently depending on
     whether a tenant context is active.
4. **`myOrganizations` swallows the error per-membership** (`try/catch`), but
   the profile `create` still runs on the auth-critical path; combined with
   proxy connection handling this is the classic "upstream broke during a
   fan-out after login → 502" signature.

### Other things verified (not the cause, worth noting)

- Login query is narrow: `user` + `role` + `location` + `memberships →
  organization/role/permissions`. No Car Wash relations are joined in
  `login` or `getMe`.
- No circular reference in the payload: `buildUserPayload` maps memberships to
  plain scalars.
- `TenantContextInterceptor` (global) sets tenant from
  `req.tenantId ?? req.user.organizationId`; for `@Public()` login there is no
  user, so tenant = null. Guards (`Tenant`, `Verification`, `Vertical`) are
  either bypassed for `@Public` or use cached org lookups with fail-open, so
  they aren't the 502 source.

---

## Exact cause (draft conclusion)

> The production 502 on login for the Car Wash multi-business user is caused by
> the post-login auth flow calling `myOrganizations` → `VerticalProfilesService.getProfile`,
> which **lazily INSERTs a `CarWashProfile` row on a read path**. In production
> that write either hits a schema that does not have the Car Wash tables
> (`db push`/migrations not applied → `P2021`), or collides with a concurrent
> insert (`P2002`), and because it runs on the login-critical fan-out the
> reverse proxy converts the failed upstream into a **502**. The `*Profile`
> models are additionally missing from the Prisma tenant-scoping sets, so the
> write is not tenant-scoped. The JWT/cookie size (~4.3 KB) is under the
> header limit and is not the cause.

---

## Remediation plan

### P0 — stop the 502 (auth path must not write)

1. **Make `getProfile` non-writing on the read path.**
   `vertical-profiles.service.ts`: replace lazy `create()` with
   `upsert({ where: { organizationId }, update: {}, create: { organizationId } })`
   and/or return vertical defaults in-memory when the row is absent. Prefer
   `upsert` to eliminate the race, and never let a profile create fail the
   request.
2. **Decouple `myOrganizations` from profile creation.**
   In `tenants.service.ts:52`, stop calling `getProfile` (which writes); read
   only, or move profile creation to an explicit "business settings" write.
   Keep the existing `try/catch` so a profile miss can never break the list.
3. **Guarantee the schema is applied in prod.**
   - Confirm the deploy actually runs migrations for `20261007000000_car_wash_vertical`
     (and the two pending ones `20261010000000_inter_shop_credit`,
     `20261011000000_unify_purchases`).
   - Remove the `--accept-data-loss` `db push` from the runtime entrypoint in
     favour of `prisma migrate deploy`, or run a one-shot migration job, so
     schema drift can't silently produce `P2021` at request time.
4. **Run the Car Wash backfills if missing** (they seed profile/role/price data
   for existing Car Wash orgs):
   `prisma/backfill-carwash-role-permissions.ts`,
   `backfill-carwash-vehicle-types.ts`, `backfill-carwash-wash-types.ts`.

### P1 — tenant scoping correctness

5. Add the profile models to the Prisma middleware:
   - `TENANT_MODELS`: `RetailProfile`, `HospitalityProfile`,
     `ManufacturingProfile`, `ServiceProfile`, `CarWashProfile` — **or**
   - `TENANT_FIELD_BY_MODEL`: map each to `organizationId`.
   Add a unit/integration test that asserts every `*Profile` model is scoped.
6. Fix `jwt.strategy.ts` `validate()`: cache only **resolved** promises
   (evict on rejection) so a transient DB error doesn't pin a rejected
   promise for 10 s.

### P2 — payload/header hardening (not the fix, but reduces risk)

7. Stop embedding the full `permissions[]` (and non-essential membership
   fields) in the JWT. Sign a minimal `{ sub, organizationId }` token; the
   frontend already fetches `/auth/me` on mount and the JwtStrategy already
   reloads the payload from the DB on every request. This shrinks the token to
   a few hundred bytes.
8. Optionally stop setting the httpOnly cookie entirely (the frontend uses
   Bearer + `localStorage`), or scope the cookie to the API path.
9. Add a response/header size assertion in CI (e.g. 16 KB budget).

### Verification steps (after fixes)

- `PROD=1` run with `SKIP_MIGRATIONS=1` against a DB **without** Car Wash tables
  and confirm login + `/auth/me` + `/tenants/me` return 200 (no profile write).
- Concurrent-load test: fire 10 parallel `/tenants/me` for the Car Wash owner;
  assert no `P2002` and no 5xx.
- Confirm `prisma migrate deploy` reports the Car Wash migration applied.
- Assert a Car Wash org's JWT payload and `Set-Cookie` are < 1 KB post-change.

## Files to touch

- `inventory-backend/src/vertical-profiles/vertical-profiles.service.ts` (P0)
- `inventory-backend/src/tenants/tenants.service.ts` (P0, `myOrganizations`)
- `inventory-backend/src/prisma/prisma.service.ts` (P1, tenant sets)
- `inventory-backend/src/common/strategies/jwt.strategy.ts` (P1, promise cache)
- `inventory-backend/src/common/user-payload.util.ts` + `auth.service.ts` (P2, payload trim)
- `docker/entrypoint.sh` / migration step (P0, schema application)
