# Plan: Make public-link (QR) entry types business-type specific

## Problem
The QR/public-link page offers **every** entry kind regardless of the active
business: a **retailer sees "Dining table"**, a **hotel sees "Shop/branch"**, etc.
Entry kinds must be **scoped to the business type** (and, for hospitality, to the
**enabled service lines**).

## Current state
- `PublicEntryKind = TABLE | HOTEL | SHOP | CARWASH_BAY | SERVICE` (one enum for
  all businesses).
- Frontend `/dashboard/qr-codes` hardcodes `KINDS = [TABLE, HOTEL, SHOP,
  CARWASH_BAY, SERVICE]` and offers them all.
- Backend `GuestOrdersService.createEntry` accepts any kind.
- The active business type is available server-side (`req.tenantId` → org →
  `businessType`, and `enabledHospitalityServices`). On the client,
  `AuthContext.activeMembership.businessType` is known, but
  `enabledHospitalityServices` is **not** in the JWT payload.

## Which kinds belong to which business

| Business | Allowed entry kinds | Why |
|---|---|---|
| **RETAIL** | `SHOP` | one QR per branch → published product catalog |
| **MANUFACTURING** | `SHOP` | branch/quote request |
| **CAR_WASH** | `CARWASH_BAY` | per-bay booking |
| **SERVICE** | `SERVICE` | service catalog booking |
| **HOSPITALITY** | `TABLE` (only if **F&B** enabled), `HOTEL` (only if **Accommodation** enabled), `SERVICE` (if any other service line enabled) | a hotel with only F&B shows TABLE; rooms-only shows HOTEL; spa/gym/pool/events → SERVICE |

So **TABLE is never offered to a retailer**, **SHOP is never offered to a hotel**,
etc. Hospitality is further narrowed by its enabled service lines.

## Design

### 1. Backend — a single source of truth
- Add `allowedEntryKinds(businessType, enabledHospitalityServices): PublicEntryKind[]`
  (in `src/public/public.constants.ts`):
  - RETAIL/MANUFACTURING → `['SHOP']`
  - CAR_WASH → `['CARWASH_BAY']`
  - SERVICE → `['SERVICE']`
  - HOSPITALITY → `TABLE` if `FOOD_AND_BEVERAGE`, `HOTEL` if `ACCOMMODATION`,
    `SERVICE` if any of `SPA_AND_WELLNESS|GYM_AND_FITNESS|SWIMMING_POOL|EVENT_AND_HALL_RENTAL|CUSTOM`.
- **Enforce on create:** `createEntry` resolves the active org's type + services
  and **rejects** a kind not allowed (`BadRequestException`). A retailer can never
  create a TABLE entry, even by calling the API directly.

### 2. Backend — expose the allowed kinds to the client
- New `GET /guest-orders/qr/entry-kinds` (or include `allowedKinds` in
  `GET /guest-orders/qr/entries`) returning the **server-computed** list for the
  active business, so the UI never guesses.

### 3. Frontend — filter the create form
- `/dashboard/qr-codes`: replace the hardcoded `KINDS` with the fetched
  `allowedKinds`. If only one kind is allowed, pre-select it. Hide kind options
  that don't apply (no "Dining table" for retail, no "Shop" for hotels).
- The **table picker** shows only for `TABLE` (already gated) and only when the
  business is hospitality; the **location picker** shows for kinds that need a
  branch (`SHOP`, `CARWASH_BAY`, `SERVICE`).

### 4. (Optional) Model hardening
- The `PublicEntryKind` enum stays global (it's a union of all kinds); scoping is a
  **policy** check, not a schema change. If you prefer, a DB CHECK or a per-kind
  "business" map could enforce it, but the service check is enough and simplest.
- The **public view** (`/public/entry/:token`) already returns only what the entry
  publishes, so an existing wrong-kind entry (if any were created before this
  change) is harmless; optionally add a validation that an entry's kind is allowed
  when it is served.

## Files to touch
- `inventory-backend/src/public/public.constants.ts` — `allowedEntryKinds(...)`.
- `inventory-backend/src/guest-orders/guest-orders.service.ts` — enforce on
  `createEntry`; add `allowedEntryKinds()` for the active tenant; return them with
  the entries list (or a new endpoint).
- `inventory-backend/src/guest-orders/guest-orders.controller.ts` — expose the
  allowed kinds.
- `frontend/app/dashboard/qr-codes/page.tsx` — drive the kind dropdown from the
  server's allowed list; gate table/location pickers accordingly.
- i18n: no new labels expected (kinds already have `qr.kind_*`).

## Verification
- As a **RETAIL** business: the create form offers **only "Shop/branch"**; a direct
  API create with `kind=TABLE` → 400.
- As a **CAR_WASH** business: only "Car-wash bay".
- As a **SERVICE** business: only "Service".
- As **HOSPITALITY with F&B only**: only "Dining table"; adding Accommodation also
  offers "Hotel"; adding Spa offers "Service".
- Backend `tsc` + jest; frontend `tsc` + `next build`.

## Open questions
1. **Manufacturing**: reuse `SHOP` (branch), or a distinct "Factory/quote" kind?
   (Recommend reusing SHOP — the routing/branch model is the same.)
2. **Multi-service hospitality**: should each enabled service get its **own QR
   entry** (e.g. a gym QR vs a spa QR), i.e. multiple `SERVICE` entries, or a
   single "Services" entry? (Recommend multiple SERVICE entries, labeled.)
3. **Existing entries** created before this rule: leave them (harmless) or
   auto-deactivate any whose kind is not allowed for the business?
