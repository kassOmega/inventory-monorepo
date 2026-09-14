# Permissions & Dynamic Roles

Single source of truth: `inventory-backend/src/common/permissions.ts` (catalog,
group filters, default role sets). Everything below is generated from that file —
if this document and the code disagree, the code wins and this file needs a
follow-up edit.

Three places consume the catalog:

| Consumer | What it does |
|---|---|
| `PermissionsGuard` (`src/common/guards/permissions/permissions.guard.ts`) | Rejects an API call unless the caller's `user.permissions` contains **at least one** of the route's `@Permissions(...)` keys. `isSuperuser` (Owner role) always passes. |
| `RolesService.findPermissions` | Upserts every catalog key into the `Permission` table (once per process) and returns the rows filtered to the active org's business type, feeding the Roles & Permissions editor. |
| `TenantsService.createOrganization` | Clones the vertical's default roles and links each role to the keys in `DEFAULT_ROLE_PERMISSIONS`. |

`buildUserPayload` puts the **active membership's** role permissions into the JWT,
so switching organization switches privileges. Scoping is per-organization: the
same person can be Owner in one business and Housekeeping in another.

## 1. The catalog (79 keys)

Hospitality groups are marked **★**.

| Group | Permissions |
|---|---|
| Dashboard | `dashboard.view` |
| Products | `products.view`, `products.create`, `products.edit`, `products.delete`, `products.adjust-stock` |
| Categories | `categories.create`, `categories.edit`, `categories.delete` |
| Locations | `locations.manage`, `inventory.shared-view` |
| Sales | `sales.view`, `sales.create`, `sales.edit`, `sales.delete`, `sales.return`, `sales.view-profit` |
| Quick Purchases | `purchases.view`, `purchases.create`, `purchases.approve` |
| Stock Requests | `requests.view`, `requests.create`, `requests.approve`, `requests.dispatch`, `requests.delete`, `requests.confirm` |
| Restock | `restock.create` |
| Credits | `credits.view`, `credits.manage` |
| Reports | `reports.view`, `reports.full`, `reports.view_cost_valuation` |
| Price History | `prices.view` |
| Users | `users.view`, `users.manage` |
| Roles | `roles.manage` |
| Finance | `finance.view`, `finance.manage` |
| **★ Restaurant** | `restaurant.view`, `restaurant.manage`, `restaurant.take-orders`, `restaurant.serve`, `restaurant.settle` |
| **★ Hotel** | `hotel.view`, `hotel.manage`, `hotel.reception`, `hotel.housekeeping`, `hotel.housekeeping.update` |
| **★ Kitchen** | `kitchen.view`, `kitchen.update` |
| **★ Bar** | `bar.view`, `bar.update` |
| **★ Barista** | `barista.view`, `barista.update` |
| **★ Cashier** | `cashier.view`, `cashier.confirm` |
| **★ Hospitality Facilities & Memberships** | `facility.view`, `facility.manage`, `facility.check-in`, `memberships.view`, `memberships.manage` |
| **★ Hospitality Packages & Folio** | `packages.view`, `packages.manage`, `packages.redeem`, `folios.view`, `folios.charge`, `folios.settle`, `folios.manage` |
| AI | `ai.view`, `ai.chat`, `ai.product-assist`, `ai.sales-assist`, `ai.requests-assist` |
| Agent | `agent.view`, `agent.manage` |
| Service | `service.view`, `service.manage` |
| Manufacturing | `manufacturing.view`, `manufacturing.manage` |

Runtime-created keys (never in the constant; upserted when the owner creates the
object they belong to):

| Key pattern | Group | Created by |
|---|---|---|
| `station.<key>.view`, `station.<key>.update` | Stations | `RestaurantService.ensureStationAccess` — custom POS stations (built-ins `kitchen`/`bar`/`barista` reuse `kitchen.*`, `bar.*`, `barista.*`) |
| `production-flow.<id>.view`, `production-flow.<id>.update` | Production Flows | `ManufacturingService.ensureFlowAccess` |

### `folios.manage` is an umbrella

`folios.manage` predates the charge/settle split. It is kept, documented and
treated as implying **both** `folios.charge` and `folios.settle`: endpoints list
it alongside the granular keys and the UI checks `folios.charge || folios.manage`
(charge) and `folios.settle || folios.manage` (money). Never remove it from a
role that already has it.

### Which groups each vertical can assign

`PERMISSION_GROUPS_BY_BUSINESS_TYPE` filters the Roles editor:

- **RETAIL** — Dashboard, Products, Categories, Locations, Sales, Quick Purchases, Stock Requests, Restock, Credits, Reports, Price History, Users, Roles, Finance, AI, Agent
- **HOSPITALITY** — Dashboard, Restaurant, Hotel, Hospitality Facilities & Memberships, Hospitality Packages & Folio, Stations, Kitchen, Bar, Barista, Cashier, Service, Reports, Users, Roles, Finance, AI, Agent
- **MANUFACTURING** — Dashboard, Products, Categories, Manufacturing, Reports, Users, Roles, Finance, AI, Agent
- **SERVICE** — Dashboard, Service, Cashier, Reports, Users, Roles, Finance, AI, Agent

Owner roles always hold **every** key (`ALL_PERMISSION_KEYS`), including keys a
future release adds.


### Vertical boundaries (`service.*`, `manufacturing.*`)

Role templates are shared between verticals, so a key can exist on a role that
has no use for it: a hospitality **Manager** carries `service.*` (the `MANAGER`
template is shared with the SERVICE vertical) and a retail **Storekeeper**
carries `manufacturing.*`. In hospitality these keys are **inert** — no
hospitality page or endpoint checks them; hospitality's own service lines are
gated by `restaurant.*`, `hotel.*` and `facility.*` (see §1).

What actually separates the modules is the vertical, enforced in two places:

| Layer | Mechanism | Behaviour |
|---|---|---|
| Backend | `@Vertical(BusinessType.X)` + `VerticalGuard` | `service.controller.ts` is SERVICE-only, `manufacturing.controller.ts` is MANUFACTURING-only. A mismatched org gets **403 "This feature is not available for your industry."** Enabled by `VERTICAL_ENFORCEMENT=true` (rollback switch: any other value disables it and the guard logs a warning once on the first request). `isSuperuser` is **not** exempt — only platform admins are. |
| Frontend | `verticalRoutePrefixes` + `verticalForRoute()` in `lib/dashboardNavigation.ts`, enforced in `app/dashboard/layout.tsx` | `/dashboard/service*` → SERVICE, `/dashboard/manufacturing*` → MANUFACTURING, `/dashboard/hotel`, `/dashboard/food`, `/dashboard/hospitality*` → HOSPITALITY. Any other business type is redirected to `/dashboard`, so a typed URL cannot open another vertical's module. |

The backend guard resolves the type from the **active organization**
(`req.tenantId`), never from the JWT's first membership, so switching business
switches the boundary (verified: one token that owns both a hospitality and a
SERVICE organization gets 403 / 200 respectively).

Not (yet) locked: the hospitality controllers (`hotel`, `restaurant`, `packages`,
`facilities`) carry no `@Vertical(HOSPITALITY)`. They are unreachable from the
menu and now blocked at the route level, but the API itself still answers for
another vertical's Owner (who holds every key). Adding the decorator would close
that too — the caveat is that SERVICE-type spa/salon tenants would then be unable
to use `/hospitality/facilities/*`, so that decision belongs with the product
direction for spas.

## 2. Default roles

Roles are cloned per organization at creation with an immutable `systemKey`
(so renames and notifications survive) and are fully editable through
`/dashboard/roles` afterwards. `DEFAULT_ROLE_PERMISSIONS` in the same file is the
baseline.

**Hospitality** (`HOSPITALITY_ROLES` in `src/common/verticals.ts`):

| Role (`systemKey`) | Permissions |
|---|---|
| Owner (`OWNER`, system) | every key (79) |
| Manager (`MANAGER`) | dashboard.view, restaurant.view/manage, hotel.view/manage/reception/housekeeping/housekeeping.update, facility.view/manage/check-in, memberships.view/manage, packages.view/manage/redeem, folios.view/charge/settle/manage, cashier.view, finance.view/manage, reports.view/full, service.view/manage |
| Receptionist (`RECEPTIONIST`) | dashboard.view, hotel.view, hotel.reception, hotel.housekeeping, folios.view, folios.charge, folios.settle, folios.manage |
| Housekeeping (`HOUSEKEEPING`) | dashboard.view, hotel.view, hotel.housekeeping, hotel.housekeeping.update |
| Cashier (`CASHIER`) | dashboard.view, restaurant.view, cashier.view, cashier.confirm, folios.view, folios.settle, service.view |
| Waiter (`WAITER`) | dashboard.view, restaurant.view, restaurant.take-orders/serve/settle, service.view |
| Chef (`CHEF`) | dashboard.view, restaurant.view, kitchen.view, kitchen.update |
| Barman (`BARMAN`) | dashboard.view, restaurant.view, bar.view, bar.update |
| Barista (`BARISTA`) | dashboard.view, restaurant.view, barista.view, barista.update |

**Retail**: Owner (all), Storekeeper, Shopkeeper, Standalone Shopkeeper.
**Manufacturing**: Owner (all), Production Manager (`STOREKEEPER`), Operator (`SHOPKEEPER`).
**Service**: Owner (all), Manager, Provider (`WAITER`), Cashier.

### Drift repair

Default roles are cloned **once**. When the catalog grows, existing organizations
keep the old set — e.g. org 23's Receptionist was missing `folios.view`, so the
front desk could not open the folio surface at all. Run:

```bash
cd inventory-backend
npx ts-node prisma/backfill-hospitality-role-permissions.ts --dry-run   # preview
npx ts-node prisma/backfill-hospitality-role-permissions.ts             # apply
```

The script matches roles by `systemKey` and grants only the missing
**hospitality-module** keys (plus `dashboard.view`). It never removes a key, never
touches hand-made roles (no `systemKey`) and never touches cross-vertical grants
(finance, reports, inventory, service). Its baseline lives in
`src/common/hospitality-role-permissions.ts` and is covered by
`src/common/hospitality-role-permissions.spec.ts`.

## 3. Hospitality surface → API → permission

Class-level `@Permissions` gates every route in a controller; a method-level
decorator **replaces** it (`getAllAndOverride`), which is how the POS lookups
reopen a route to waiters and cashiers.

### Hotel (`/dashboard/hotel`)

| Action | API | Permission (any of) |
|---|---|---|
| view room types / rooms | `GET /hotel/room-types`, `GET /hotel/rooms` | `hotel.view` (class gate) |
| create/edit/delete room types & rooms | `/hotel/room-types`, `/hotel/rooms` writes | `hotel.manage` |
| set room cleanliness (AVAILABLE/DIRTY/MAINTENANCE) | `PATCH /hotel/rooms/:id/status` | `hotel.manage`, `hotel.housekeeping.update` |
| guest ID type registry | read: the hotel page + check-in modal (`hotel.view`) · manage: **Hospitality Services settings** (owner-only page, writes `hotel.manage`) — `GET` (class) · `POST`/`PATCH /hotel/settings/id-types` | `hotel.view` · `hotel.manage` |
| list reservations · availability | `GET /hotel/reservations`, `GET /hotel/rooms/available` | `hotel.view` |
| create / edit a reservation | `POST /hotel/reservations`, `PATCH /hotel/reservations/:id` | `hotel.manage`, `hotel.reception` |
| delete a reservation | `DELETE /hotel/reservations/:id` | `hotel.manage` |
| check in (registration + room re-pick) | `POST /hotel/reservations/:id/check-in` | `hotel.manage`, `hotel.reception` |
| upload / view the ID scan | `POST` · `GET /hotel/reservations/:id/id-document` | `hotel.manage`, `hotel.reception` · `hotel.view`, `hotel.reception` |
| check out (legacy, releases the room) | `POST /hotel/reservations/:id/check-out` | `hotel.manage`, `hotel.reception` |
| checkout summary · consolidated bill | `GET …/checkout-preview`, `GET …/itemized-bill` | `hotel.view`, `hotel.reception`, `folios.view` |
| **atomic checkout (collects money)** | `POST /hotel/reservations/:id/checkout` | `folios.settle`, `folios.manage`, `hotel.manage`, `hotel.reception` |
| read a stay folio | `GET /hotel/reservations/:id/folio` | `hotel.view` |
| POS charge-to-room lookup | `GET /hotel/chargeable-rooms` | `restaurant.take-orders`, `restaurant.manage`, `hotel.reception`, `hotel.manage`, `folios.charge`, `folios.view` |

### Folios (`/dashboard/hospitality/folios`)

| Action | API | Permission (any of) |
|---|---|---|
| list stays / package guests, read a ledger | `GET /hospitality/guests`, `GET /hospitality/guests/:id/folio`, `GET /hospitality/folios/:id/itemized-bill` | `folios.view` |
| post a charge / payment line to a stay | `POST /hotel/reservations/:id/folio` | `folios.charge`, `folios.manage`, `hotel.manage`, `hotel.reception` |
| settle a stay folio | `POST /hotel/reservations/:id/settle` | `folios.settle`, `folios.manage`, `hotel.manage`, `hotel.reception` |
| settle & release a package guest | `POST /hospitality/guests/:id/check-out` | `folios.settle`, `folios.manage`, `hotel.reception` |

### Packages & facilities

| Action | API | Permission (any of) |
|---|---|---|
| list packages / entitlements | `GET /hospitality/packages`, `…/:id/entitlements` | `packages.view` · + POS keys on `lookup` |
| define / edit / delete a package | `POST/PATCH/DELETE /hospitality/packages` | `packages.manage` |
| check a package guest in (redeem entitlements) | `POST /hospitality/guests` | `packages.manage`, `packages.redeem`, `hotel.reception` |
| POS package lookup (Room #/name → guest) | `GET /hospitality/packages/lookup` | `packages.view`, `restaurant.take-orders`, `restaurant.settle`, `hotel.reception`, `folios.charge`, `folios.view` |
| facility dashboard · member search | `GET /hospitality/facilities/:serviceId/dashboard` · `…/members` | `facility.view` · `facility.view`, `memberships.view` |
| day-pass / member check-in & check-out | `POST …/check-in`, `POST …/check-out/:visitId` | `facility.check-in`, `facility.manage` |

### Restaurant · cashier (F&B alongside the hotel)

| Action | API | Permission (any of) |
|---|---|---|
| take orders | `POST /restaurant/orders` | `restaurant.view` + `restaurant.take-orders` |
| station board (Kitchen/Bar/Barista/custom) | `GET /restaurant/kitchen?station=` | `restaurant.view` + `kitchen.view` / `bar.view` / `barista.view` / `station.<key>.view`, or `restaurant.manage` |
| serve · advance an item | `POST /restaurant/orders/:id/mark-served`, `…/advance` | `restaurant.serve`, `restaurant.manage` |
| settle / batch settle | `POST /restaurant/orders/:id/settle`, `/orders/batch-settle` | `restaurant.settle`, `restaurant.manage` |
| menu & station administration | `/restaurant/menu-*`, `/restaurant/stations` writes | `restaurant.manage` |
| till · confirm payments | `/cash…` | `cashier.view` · `cashier.confirm` |
| read payment methods (any money screen) | `GET /payment-methods` | `finance.view`, `restaurant.view`, `cashier.view`, `sales.create`, `purchases.create`, `credits.manage`, `requests.confirm`, `hotel.view`, `hotel.reception` |

### Frontend enforcement

- `frontend/lib/dashboardNavigation.ts` — `routePermissionMap` (exact path) gates
  deep links; the sidebar items carry the same keys.
- `frontend/app/dashboard/layout.tsx` — redirects to `/dashboard` when the key is
  missing; station boards and `/dashboard/hospitality/service/<customKey>` are
  matched by regex because their permission is only known at runtime.
- `verticalRoutePrefixes` (same file) keeps each vertical's routes inside its own
  business type.
- Page-level flags mirror the API (`canManageRooms`, `canFrontDesk`,
  `canHousekeep`, `canReadFolio`, `canCharge`, `canSettle`, `canRedeem`,
  `canCheckIn`) so no button is offered that the backend would reject.
- **Guest ID Types** are configured once on `/dashboard/settings/hospitality-services`
  (owner-only) via the shared `app/components/GuestIdTypesCard.tsx`; the hotel page
  only reads the active list to populate the check-in modal.




## 4. Recipes

**Add a permission**
1. Add the entry to `PERMISSIONS` in `src/common/permissions.ts` (`key`, `label`,
   `group`). Keys are `module.action` and unique — enforced by
   `src/common/permissions.spec.ts`.
2. A hospitality key is picked up automatically by
   `HOSPITALITY_PERMISSION_KEYS` (derived from the group list). If a default role
   should hold it, add it to that role in `DEFAULT_ROLE_PERMISSIONS` and run the
   backfill so existing organizations get it too.
3. Use it: `@Permissions('module.action', …)` on the controller route and
   `hasPermission("module.action")` on the page.
4. Run `npx jest src/common src/hotel/hospitality-permissions.spec.ts`.

**Add a dynamic role for an owner-created object**
Follow `RestaurantService.ensureStationAccess` /
`ManufacturingService.ensureFlowAccess`: upsert the permission rows
(`<prefix>.<id>.view|update`, group `Stations` / `Production Flows`), find-or-create
the role by name with an immutable `systemKey`,
`rolePermission.createMany({ skipDuplicates: true })`, then store the role id on
the object and return `permissionView`/`permissionUpdate` so the frontend can
filter the menu. Idempotent — safe to call on every read.

**Add a gated page**
Add the route to `routePermissionMap` (or a prefix rule in `layout.tsx` when the
segment is dynamic), gate the menu item with the same key, and mirror the API's
`@Permissions` list in the component's capability flags.

## 5. Verification

```bash
# backend
cd inventory-backend
npx prisma validate
npx tsc -p tsconfig.build.json --noEmit
npm test                       # includes permissions + vertical-guard specs

# frontend
cd ../frontend
npx tsc --noEmit

# data drift (permissions are rows — this is never a schema migration)
cd ../inventory-backend
npx ts-node prisma/backfill-hospitality-role-permissions.ts --dry-run

# vertical separation must be switched on (see .env.example)
grep VERTICAL_ENFORCEMENT .env
```

`src/hotel/hospitality-permissions.spec.ts` pins the `@Permissions` metadata per
route, so a widened gate (e.g. check-in moving to `hotel.view`) fails the suite
instead of shipping. `src/common/guards/vertical/vertical.guard.spec.ts` pins the
business-type boundary: mismatched vertical → 403, matching → allow, disabled →
no-op with a one-time warning, platform admins exempt, owners **not** exempt.

