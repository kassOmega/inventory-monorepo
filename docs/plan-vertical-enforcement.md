# Plan: VerticalGuard enforcement is OFF (VERTICAL_ENFORCEMENT)

> **STATUS: RESOLVED — enforcement is now always-on in code.** The env-var
> rollback switch was removed (a tenant-isolation boundary must fail closed, not
> open), the startup warning is gone, the guard spec was updated to prove it is
> enforced with no opt-out, and `.env.example` documents the change. 449/449
> tests pass.

## Symptom
On startup the backend logs:

```
WARN [VerticalGuard] VerticalGuard enforcement is OFF
(VERTICAL_ENFORCEMENT !== "true"): controllers marked @Vertical(...)
will answer for every business type.
```

## What it means (this is a warning, not a crash)
`VerticalGuard` is the boundary that stops one business type from reaching
another's endpoints through the API. It is **opt-in via an exact env string**:

```ts
if (process.env.VERTICAL_ENFORCEMENT === 'true') return true;   // enforced
// otherwise: log a one-time warning and let everything through
```

So the warning = **the guard is off**; `@Vertical(...)` controllers currently
answer for every business type.

## Why it's off in your environment
- `.env.example` documents `VERTICAL_ENFORCEMENT=true`, but the **local `.env`
  has no `VERTICAL_ENFORCEMENT` line** (confirmed), so the app falls back to
  "disabled". `ConfigModule.forRoot({ isGlobal: true })` loads `.env`, so simply
  adding the line flips it on.
- The production Dockerfile does **not** set it either (no `ENV`, and the
  entrypoint doesn't export it). `docker run --env-file inventory-backend/.env`
  is the documented way env reaches the container — so prod inherits whatever is
  in that env file. If the deployed `.env` lacks the var, prod is off too.

## What it protects (only decorated controllers)
`@Vertical(...)` is currently applied to:
- `carwash/carwash.controller.ts`
- `manufacturing/manufacturing.controller.ts`
- `service/service.controller.ts`

Retail/hospitality routes are **not** decorated, so they are unaffected either
way. With enforcement off, a RETAIL or HOSPITALITY org could call SERVICE /
MANUFACTURING / CAR_WASH endpoints if its role template happened to carry the
permission key (role templates are shared across verticals). With it on, those
calls return 403 `errors.verticalNotAvailable`.

The guard is designed safe to enable:
- business type is read from the **active** org (`req.tenantId`), not the stale
  first-membership value in the JWT;
- **platform admins are exempt**; owners are still checked per active org;
- it **fails open** if the org lookup errors;
- there is a unit spec (`vertical.guard.spec.ts`) covering on/off + the checks.

## Options

### A. Enable it (recommended) — turn the boundary on
Set `VERTICAL_ENFORCEMENT=true` wherever the backend runs.
- **Local**: add `VERTICAL_ENFORCEMENT=true` to `inventory-backend/.env`.
- **Docker/prod**: add it to the env file passed via `--env-file` (and/or add a
  default `ENV VERTICAL_ENFORCEMENT=true` in the Dockerfile's runtime stage so a
  missing value doesn't silently disable the boundary).
- **Effect**: `@Vertical` controllers reject cross-vertical calls with 403.
  Verify the app's own verticals still work (a CAR_WASH org can use car-wash,
  a SERVICE org can use service, etc.).

### B. Leave it off deliberately
If any current tenant legitimately needs cross-vertical access (e.g. a mixed
business, or a staff role shared across verticals), keep the flag off — but make
that an **explicit, documented decision** rather than an environment gap. The
warning should then be treated as expected.

### C. Make the default safe (config hardening, independent of A/B)
Today "off" is the default when the var is missing, which is the risky side. A
small hardening: require the flag to be an explicit `true`/`false`, or log the
warning as a **one-time startup banner** (already does) and add the var to the
Docker image default so production can't silently drift to disabled.

## Recommendation
**Option A + C.** Enable enforcement (local `.env` + Docker runtime env default)
and treat the var as required in production. The guard is written to be safe
(fail-open on lookup errors, admin-exempt, active-org based) and has tests, so
turning it on closes a real cross-tenant data-access gap with low risk. If a
specific tenant needs cross-vertical access later, address that with an explicit
allow-list rather than by leaving the global boundary off.

## Verification
- With `VERTICAL_ENFORCEMENT=true`: a RETAIL token calling a `@Vertical('SERVICE')`
  route returns 403 `errors.verticalNotAvailable`; the matching business type's
  own routes still return 200.
- Car-wash / manufacturing / service verticals work end-to-end for their own
  orgs after enabling.
- Platform-admin calls are unaffected.
- No startup warning once the var is `true`.
- Backend `tsc` + jest (incl. `vertical.guard.spec.ts`) clean.

## Files to touch
- `inventory-backend/.env` — add `VERTICAL_ENFORCEMENT=true` (local).
- `inventory-backend/.env.example` — already documents it (keep).
- `Dockerfile` (runtime stage) — optional `ENV VERTICAL_ENFORCEMENT=true` default.
- No code change needed; the guard already works.

## Open questions
1. Is any current tenant intentionally **mixed-vertical** (needs cross-vertical
   access)? If yes, we keep it off or add an allow-list instead of global enable.
2. Should production **default to enabled** in the Dockerfile (so a missing env
   can't silently disable the boundary), or stay strictly env-driven?
3. Do you want the warning escalated (e.g. a startup banner / health signal) when
   it's off, so an environment that forgot the flag is obvious?
