# Plan — Make the audit trail populate (AuditLog)

## Symptom

The Reports → **Audit Trail** tab is empty.

## Root cause (verified)

- The trail reads `AuditLog` via `ReportsService.getAuditTrail()`
  (`GET /reports/audit-trail`), which runs `auditLog.findMany` inside the request
  tenant context. `AuditLog` is in `TENANT_MODELS`, so the Prisma middleware
  auto-scopes the query to the **active tenant**.
- The DB has only **12** audit rows, all in tenants **47 / 51** (and one with
  `tenantId = null`). Most modules never write audit logs:
  - Writes exist in: `sales`, `purchases`, `products`, `customers`, `requests`,
    `finance`, `manufacturing`, `auth`, `users`.
  - **No writes** in: `carwash`, `credits`, `hotel`, `restaurant`.
- So for a Car Wash (or any tenant whose actions don't audit) the scoped query
  returns nothing → "No activity".
- Two secondary issues:
  1. `getAuditTrail()` has no `tenantId`/date filters of its own and no test.
  2. The `logs.map` assumes `log.user` is non-null (`log.user.id`); `AuditLog.userId`
     is required and the relation is non-null, so that's safe today, but a
     deleted user would break the map (no null guard).

## Goal

Audit-log every meaningful mutating action across all verticals (especially the
ones missing it), and make the trail reliable and filterable, so it is never
silently empty for an active business.

## Design decision

1. **One shared audit helper** so every service writes consistent rows:
   `frontend`-agnostic `frontend`? No — backend:
   `inventory-backend/src/common/audit.util.ts`
   - `audit(tx | prisma, { tenantId, userId, action, details })` — a thin wrapper
     over `auditLog.create` that never throws into the caller's flow (best-effort
     audit must not break the primary action), matching the existing `auth.audit`
     behaviour.
   - Reuse in services instead of each hand-rolling `auditLog.create`.

2. **Instrument the missing mutating actions** (the actual fix):
   - **carwash**: wash create/start/complete/settle/delete, booking
     create/status/delete, washer create/update/delete, price/wash-type/
     vehicle-type changes, equipment issue/return/delete, expense
     create/update/delete, collection record, settings update.
   - **credits**: credit sale create, credit payment create/update/delete,
     credit purchase approve/pay.
   - **hotel / restaurant**: order create/status/settle, room/reservation
     changes, folio charge/settle (the hospitality vertical).
   - **products/sales/purchases/customers/requests/finance/manufacturing**: keep
     existing; add any obvious missing mutators.
   - Keep action keys short and stable (e.g. `CARWASH_WASH_CREATED`), details
     human-readable with the entity id + key numbers.

3. **Reliable, filterable trail**:
   - `getAuditTrail()` gains optional `startDate`/`endDate`/`action`/`search`
     params (scoped by tenant automatically) and a higher, configurable limit; it
     must **not** crash when a user row is missing (left-join / null guard).
   - Frontend: add the common filter (date range + action search) to the Audit
     Trail tab, and keep the existing table; show the user's name or "System".

4. **Backfill (optional)**: existing rows are fine; no historical backfill is
   possible (events weren't recorded). Skip.

## Work plan

1. **`common/audit.util.ts`**: `auditBestEffort(prisma|tx, entry)`; a
   `deriveTenantId` fallback (use `getCurrentTenantId()` when the caller omits
   it).
2. **Carwash service**: add audit calls to every mutating method (list above),
   in the same transaction where one exists.
3. **Credits service**: same.
4. **Hotel / restaurant services**: same.
5. **Sweep** the other modules for missing mutators; standardise on the helper.
6. **`reports.service.getAuditTrail`**: add filters (startDate/endDate, action,
   search), null-safe user mapping, `AUDIT_TRAIL_LIMIT` bumped (e.g. 200) or
   paged.
7. **Reports controller**: accept the new query params.
8. **Frontend `reports/page.tsx` audit tab**: add the shared filter (date range +
   search) and refetch on change; keep the table; show "System" when no user.
9. **i18n**: action labels / filter labels (en + am) — reuse `reports.*`.
10. **Tests**: carwash audit rows created on create/start/complete/settle (assert
    `auditLog.create` called with the right action); `getAuditTrail` scoped +
    filterable.
11. **Verify**: `tsc`, `jest`, `next build`.

## Risks / notes

- **Audit inside transactions**: a failing audit must not roll back the primary
  action — use best-effort (catch) except where the transaction already commits
  atomically and an audit failure is acceptable to surface. Follow the existing
  `auth.audit` pattern (swallow errors).
- **Volume**: auditing every mutation grows the table; the trail is capped/paged
  and indexed by `tenantId` (add `createdAt` index if needed).
- **Tenant scoping** already applies via the middleware; keep passing `tenantId`
  explicitly in `create` data for clarity.
- No schema change strictly required; optionally add `@@index([tenantId,
  createdAt])` to `AuditLog` for the date-filtered trail.
- Keep existing services' audit formats working; the new helper is additive.
