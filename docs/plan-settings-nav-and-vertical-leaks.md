# Plan: Settings nav link + fix vertical leakage (business settings & staff deductions)

## Goal

1. **Add a menu link** to Business Settings (`/dashboard/businesses/settings`) so
   owners can actually reach it.
2. **Stop showing irrelevant cards/copy** in Business Settings:
   - "Hospitality Packages & Guest Folio Policy" must only appear for
     **HOSPITALITY** businesses.
   - The public-prices hint must not say "Retail hides prices by default" inside
     a hospitality (or any non-retail) business.
3. **Stop the staff Loans & Penalties page from calling `/carwash/washers`** for
   non-car-wash businesses (that unrelated request is a bug).

## Current state (verified)

- `frontend/lib/dashboardRoutes.ts` already declares
  `/dashboard/businesses/settings` (owner-only), but
  `frontend/lib/dashboardNavigation.ts` only links `/dashboard/businesses` and
  `/dashboard/verification` for owners — there is **no nav item** for settings.
- `frontend/app/dashboard/businesses/settings/page.tsx` renders:
  - the "Public ordering & price-list visibility" card unconditionally (all
    business types), with the retail-specific hint
    `biz.set.showPublicPricesHint`;
  - the "Hospitality Packages & Guest Folio Policy" card unconditionally, even
    for RETAIL / SERVICE / CAR_WASH / MANUFACTURING.
- `frontend/app/dashboard/staff-deductions/page.tsx` always fetches
  `/carwash/washers` in `load()` to populate the employee picker, even when the
  business is not a car wash.

## Changes

### 1. Nav link for Business Settings

`frontend/lib/dashboardNavigation.ts`:
- In the owner block of the overview group, after "My Businesses", add:
  `{ href: "/dashboard/businesses/settings", label: t("nav.businessSettings") }`.

i18n (`en`/`am`):
- Add `nav.businessSettings` = "Business Settings" / "የንግድ ቅንብሮች".

### 2. Business Settings vertical gating

`frontend/app/dashboard/businesses/settings/page.tsx`:
- Destructure `activeMembership` from `useAuth()` and add a `businessType`
  state (set from `o.data?.businessType` in `load()`; fallback to
  `activeMembership?.businessType`).
- Wrap the **"Hospitality Packages & Guest Folio Policy"** card so it renders
  only when `businessType === "HOSPITALITY"`.
- Keep the **"Public ordering & price-list visibility"** card for all business
  types (public QR ordering exists for retail/hospitality/service/car-wash), but
  make the price hint generic.

i18n (`en`/`am`):
- Change `biz.set.showPublicPricesHint` to a type-neutral sentence, e.g.
  "Show item prices and the cart total on the public ordering page." /
  "በህዝብ ትዕዛዝ ገጽ ላይ የዕቃ ዋጋዎችን እና ጠቅላላውን አሳይ።"

### 3. Stop the unrelated `/carwash/washers` fetch

`frontend/app/dashboard/staff-deductions/page.tsx`:
- Read the active business type (`activeMembership?.businessType`).
- Only include the `/carwash/washers` request in the `Promise.all` when
  `businessType === "CAR_WASH"`; otherwise use `[]` for washers.
- Keep the user list (`/users`) and cap (`/employee-deductions/cap`) as today.

## Verification

- Nav: owner account sees **Business Settings** under the overview group and it
  opens `/dashboard/businesses/settings`.
- Retail business settings: no "Hospitality Packages & Guest Folio Policy" card;
  public card shows the generic price hint.
- Hospitality business settings: policy card present; public card present with
  the generic price hint (no "Retail hides prices...").
- Staff Loans & Penalties on a non-car-wash business: the network tab no longer
  calls `/carwash/washers`; the employee picker still lists staff users.
- Staff Loans & Penalties on a car-wash business: washers are still listed.
- `tsc` clean (frontend + backend untouched backend, but confirm), locale JSON
  valid.
