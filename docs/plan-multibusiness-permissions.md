# Plan — Reports empty + audit empty for a multi-business user (root cause found)

## Symptom

A user with **two businesses** (org 48 = RETAIL, org 61 = CAR_WASH) registered
washes in the Car Wash business. The **Reports** API returns everything redacted
(`totalRevenue: null`, `washCount: null`, `washerEarnings: []`) and the **Audit
Trail** appears empty.

## Root cause (verified end-to-end)

**Permissions are computed from the user's FIRST membership, not the active
tenant.**

- `buildUserPayload` (`src/common/user-payload.util.ts`) sets
  `permissions` from `user.memberships[0].role.permissions`, and
  `organizationId`/`businessType`/`roleName`/`isSuperuser` from
  `memberships[0]` too.
- Verified: for `standalone@inventory.com`, `memberships[0]` is **org 48
  (RETAIL)**, so `payload.permissions` contains **retail** keys and **not**
  `carwash.reports.*`; `payload.organizationId = 48`.
- The request is sent with `X-Tenant-Id: 61`, so `TenantGuard` makes the active
  tenant **61** and the queries run against org 61's data — but `req.user`
  still carries **org 48's** permissions.
- The car-wash report redaction (`reportsBreakdown`) keys on
  `user.permissions`: with no `carwash.reports.*` keys it nulls every figure →
  the API returns empty-looking data.
- The same stale `permissions` backs the **sidebar**, `PermissionsGuard`,
  `VerticalGuard`, and every page gate — so switching businesses shows the wrong
  menu/features and denies actions.

**Audit trail note:** the trail itself works (verified: `/reports/audit-trail`
for tenant 61 returns the `CARWASH_WASH_*` rows). It appeared empty because (a)
it is date-filtered to the page's default **today** range and (b) the user may
have been viewing a **stale running build**. Once the permission fix lands and
the page uses a sensible default range, it shows up.

## Evidence

- DB: org 61 has 7 washes (3 today) and 3 `CARWASH_WASH_*` audit rows.
- Service-level test: `reportsBreakdown('2026-10-09','2026-10-09')` for org 61
  returns `washCount=3, totalRevenue=572` — so the data and query are correct.
- API as the owner: returns all-null because `req.user.permissions` are the
  retail set (org 48).
- `buildUserPayload` logs `payload.organizationId = 48`,
  `permissions.includes('carwash.reports.financials') = false`.

## Fix (backend-first; frontend follows)

### A. Make `req.user` tenant-accurate (authoritative fix)

After `TenantGuard` resolves the active tenant, the request's user must carry
**that** tenant's role/permissions. Add a step that, when `req.tenantId` is set
and the user's payload `organizationId` differs, resolves the **membership for
`req.tenantId`** and rebuilds `permissions` / `roleId` / `roleName` /
`isSuperuser` / `businessType` accordingly.

- Options:
  1. **Extend `TenantGuard`**: after computing `tenantId`, if
     `user.organizationId !== tenantId`, load `membership{ userId, tenantId }`
     with role+permissions and overwrite `req.user` fields. (One extra query per
     switched request; cacheable.)
  2. A dedicated `ActiveTenantPermissionsInterceptor` right after the guards.
- Recommended: option 1 (guard already needs the membership for the header
  check, so it can reuse/expand that lookup).
- Keep the JWT payload as the "default org" seed; the guard overrides per
  request.

### B. Stop relying on first-membership in payload fields used per-request

- `isSuperuser`, `roleName`, `organizationId`, `businessType` are used in
  guards/services — they must reflect the **active** tenant. `TenantGuard`
  overriding `req.user` (A) covers this. The token itself can keep the default
  (the strategy rebuilds from DB anyway).

### C. Frontend: refresh permissions on business switch

- `AuthContext.switchOrganization` currently sets `activeOrganizationId` and
  calls `router.refresh()` but keeps the **old** `user.permissions`.
- After switching, re-fetch `/auth/me` **with the new `X-Tenant-Id`** so the
  returned `permissions`/`memberships` reflect the active business, then
  `setUser`. Alternatively, `/auth/me` should accept the active tenant and
  return tenant-scoped permissions (mirroring A).
- This fixes the sidebar + page gates when switching businesses.

### D. Reports default range

- The shared reports page defaults to **today**; a user who registered washes
  "yesterday" sees nothing. Change the default to a **7-day** window (or
  "this month") so recent activity shows. Also ensure the Car Wash report tab
  uses the same range.

### E. (Already done) Audit trail

- `getAuditTrail` filtering + the reports audit-tab filter bar are in place; no
  change needed beyond making the default range sensible (D).

## Verification

1. **Backend unit/integration**: for a user with memberships in two orgs, with
   `X-Tenant-Id` = the second org, `req.user.permissions` contains that org's
   keys; `reportsBreakdown` returns the figures (not null) for the second org.
2. **API**: `GET /carwash/reports/breakdown?...` as the multi-business owner with
   `X-Tenant-Id: 61` returns `washCount>0` and non-null totals.
3. **Frontend**: switching business updates the sidebar and page gates; reports
   and audit trail show data.
4. `tsc`, `jest`, `next build`.

## Risks / notes

- **Security**: the guard override must **only** grant permissions from a
  membership the user actually has in `req.tenantId` (never merge across orgs).
  This tightens isolation — a user can no longer carry business A's permissions
  into business B.
- Performance: one extra membership query per request when the active tenant
  differs from the payload default; can reuse the existing `TenantGuard`
  membership lookup and/or a short TTL cache (like `VerticalGuard`).
- This is a **core auth change** — add tests before/after and verify the
  existing permission-guard behaviour for single-business users is unchanged.

---

## Resolved — this was the cause (not the default range)

Confirmed: even a wide range returns all-null for the Car Wash business, because
`req.user.permissions` carried the FIRST business's (retail) keys.

Fixes applied:
- `TenantGuard`: when the active tenant differs from the payload's default org,
  it now loads the active org's membership and attaches a **shallow clone** of the
  user (not a mutation — the JwtStrategy caches and shares the payload object) with
  `organizationId`/`businessType`/`roleId`/`roleName`/`isSuperuser`/`permissions`
  scoped to that org. Never merges across organizations.
- `buildUserPayload(user, activeOrganizationId?)`: returns permissions for the
  requested active org (falls back to the first membership when omitted).
- `AuthService.getMe(userId, activeOrganizationId?)` + `AuthController.getMe`
  forward `req.tenantId`, so `/auth/me` returns **active-tenant-scoped**
  permissions.
- Frontend `AuthContext.switchOrganization` re-fetches `/auth/me` (with the new
  `X-Tenant-Id`) so the sidebar/gates update on business switch.

Verified live:
- `GET /carwash/reports/breakdown` (X-Tenant-Id: 61) → `totalRevenue 832`,
  `washCount 6`, `washerEarnings [...]` (was all-null).
- `GET /auth/me` (X-Tenant-Id: 61) → `businessType CAR_WASH`,
  `permissions` include `carwash.reports.financials`.
- `GET /auth/me` (X-Tenant-Id: 48) → `businessType RETAIL`, `products.view`
  present and `carwash.reports.financials` absent.

Tests: `tenant.guard.spec.ts` (re-scope to active tenant; leave single-business
untouched; never mutate the shared cached payload). Full suite 50/438.
