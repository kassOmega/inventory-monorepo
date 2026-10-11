# Plan: Guest order → sale (branch + central) and drop the manual "Free table" button

## Goal

1. **Remove the manual "Free table" button** from the Guest Orders inbox. A
   table must free itself when its payment is settled (this already happens in
   the POS), not via a separate button.
2. **Define what happens after the operator accepts a guest order**, and provide
   a single **"Add as sale"** action for retail guest orders that works from
   **both a branch and central**. Central must pick the **branch** the sale is
   registered under.

## Current state (verified in code)

- `GuestOrdersService.free()` + `POST /guest-orders/:id/free` set the
  `GuestOrder` to `DROPPED` and do nothing else. The frontend renders it as a
  **"Free table"** button in the detail modal
  (`frontend/app/dashboard/guest-orders/page.tsx`).
- Table freeing already lives in the restaurant POS, not in guest orders:
  - `RestaurantService.createOrder` sets `DiningTable.status = OCCUPIED`.
  - `RestaurantService.settleOrderInTransaction` (PAID) and
    `updateOrderStatus` (PAID / CANCELLED) set `DiningTable.status = FREE`.
  So for F&B the requested behavior already exists; the manual button is
  redundant and confusing.
- Retail (`PRODUCT`) guest orders never produce a working sale today:
  - `review` only marks `REVIEWED` (it does **not** convert retail items).
  - The old path is `route → branch respond → assign`, and `assign` calls
    `GuestOrderConversionService.toSale`, which passes `saleType: 'FULLY_PAID'`
    but **no `paymentMethodId`** → `SalesService.createSale` throws
    `"Payment method is required"` and the failure is swallowed into
    `CONVERT_FAILED`.
- `SalesService.createSale` already supports branch choice: `shopId =
  user.locationId ?? dto.shopId`. A central user has `locationId: null`, so
  central must pass `shopId` (this is the "select a branch" mechanism that
  `SaleForm` already uses for the owner shop selector).

## Part 1 — Remove the manual "Free table" action

### Backend
- Delete `POST /guest-orders/:id/free` from
  `guest-orders.controller.ts`.
- Delete `GuestOrdersService.free()`.
- Keep `reject` — rejecting an order **before** review means the table was never
  occupied, so nothing needs freeing.
- No schema change. Leave `GuestOrderStatus.DROPPED` in the enum (unused) so we
  don't need a migration; remove it later if desired.
- Clarify in code comments: after review, a table's lifecycle is owned by the
  restaurant POS (settle/cancel), not by guest orders.

### Frontend
- In `frontend/app/dashboard/guest-orders/page.tsx`, remove the **"Free table"**
  button and its `api.post(.../free)` call. Keep **Reject**.
- Remove the `guestOrders.free` i18n key from `en` and `am` locale files.

## Part 2 — What happens after the operator accepts (the clarified lifecycle)

| Item kind | After `review` (accept) | Payment settled → table freed |
|---|---|---|
| `MENU_ITEM` (F&B) | `RestaurantService.createOrder` runs immediately; table → `OCCUPIED`. | Settling the order (`PAID`) or cancelling it (`CANCELLED`) frees the table. Already implemented. |
| `SERVICE_ITEM` | `ServiceService.createBooking` runs immediately. | n/a (no table). |
| `ROOM_TYPE` | `HotelService.createReservation` runs immediately. | n/a (room availability, not a table). |
| `PRODUCT` (retail) | Marks `REVIEWED` only. The operator then uses **Add as sale** (Part 3). | The sale is created (default `FULLY_PAID`). No table. |

So "accept" keeps its current meaning for F&B/service/rooms (auto-convert), and
for retail it becomes a two-step: **accept → add as sale**.

## Part 3 — "Add as sale" for retail (branch + central)

### Backend

1. **Fix the conversion payment gap** in
   `guest-order-conversion.service.ts`:
   - Extend `convert(..., opts)` and `toSale(..., opts)` to accept
     `paymentMethodId?: number`, `saleType?: 'FULLY_PAID' | 'PARTIALLY_PAID' | 'CREDITED'`,
     `paidAmount?: number`, and forward them to `SalesService.createSale`.
   - Keep the default `FULLY_PAID`, but now require/forward a payment method the
     same way `SalesService` does (required unless `CREDITED`).

2. **New endpoint** `POST /guest-orders/:id/convert`
   (`@Permissions('guest-orders.manage')`):

   ```ts
   body: {
     locationId?: number;      // required for central, ignored for branch users
     paymentMethodId?: number; // required unless saleType === 'CREDITED'
     saleType?: 'FULLY_PAID' | 'PARTIALLY_PAID' | 'CREDITED';
     paidAmount?: number;      // PARTIALLY_PAID only
   }
   ```

   Behavior:
   - Load the order tenant-scoped (`get`), assert it is open.
   - Require at least one `PRODUCT` item.
   - Resolve the branch: `const branchId = user.locationId ?? body.locationId;`
     - Central (`user.locationId == null`) → `body.locationId` is **required**
       and must be a `Location` of the same tenant.
     - Branch user → ignore `body.locationId`, force their own `user.locationId`.
   - Call `conversion.convert(order, actor, { locationId: branchId, paymentMethodId, saleType, paidAmount })`.
   - Conversion already: creates the `Sale` (stock/price/GL enforced), sets
     `GuestOrder.saleId`, and marks the order `ACCEPTED`. Add a
     `SALE_CREATED` activity line with the branch + sale number.
   - Return the updated order (with `saleId`, `sale`, routes).

3. **Keep** `route` / `respond` / `assign` as-is for the manufacturing
   request/quote conversation. Do **not** remove them in this change; the new
   `convert` endpoint is the retail "register the sale now" path and does not
   depend on a prior `ACCEPTED` route.
   - (Optional follow-up: route `assign` through the same payment-aware
     `toSale` so manufacturing assign also gets a payment method.)

### Frontend (`app/dashboard/guest-orders/page.tsx`)

In the detail modal, for orders that contain `PRODUCT` items and are still open
(`SUBMITTED` / `REVIEWED` / `ROUTED`), replace the route/assign dance for retail
with an **Add as sale** panel:

- **Central** (`user.locationId == null`):
  - Branch `<select>` populated from `/locations` (required).
  - Payment method `<select>` populated from `/payment-methods` (required unless
    `CREDITED`).
  - Sale type selector defaulting to `FULLY_PAID`.
  - `Add as sale` → `POST /guest-orders/:id/convert`.
- **Branch** (`user.locationId != null`):
  - No branch selector (their branch is fixed); show it as read-only text.
  - Payment method + sale type as above.
  - `Add as sale` → `POST /guest-orders/:id/convert` (no `locationId`).
- After success, reload the order and show the linked **Sale # + branch** in the
  detail modal (reuse `formatDateTime` / status pill styles).
- Remove the **Free table** button (Part 1). Keep **Reject**.

### Branch inbox scoping (supporting, small)

So a branch can actually reach its orders and add the sale, scope the list/get
for branch users:

- `GET /guest-orders` and `GET /guest-orders/:id` accept `req.user`; when
  `user.locationId != null`, filter to orders where
  `entry.locationId == user.locationId` **or** `routes.some(locationId ==
  user.locationId)`.
- Central keeps the full tenant-wide inbox.
- (Branch **respond** buttons remain out of scope here unless needed; the new
  action is "Add as sale".)

## Verification

- **Free table removed:** the Guest Orders modal has no "Free table" button;
  `POST /guest-orders/:id/free` returns 404.
- **F&B table lifecycle:** scan a TABLE QR → submit → accept → a restaurant
  `Order` is created and the table shows `OCCUPIED`. Settle the order (or cancel
  it) → the table shows `FREE`, with no guest-order action involved.
- **Retail branch sale:** as a branch user, open a `PRODUCT` guest order →
  **Add as sale** with a payment method → a `Sale` is created at the branch,
  `GuestOrder` becomes `ACCEPTED` with `saleId` set, stock is deducted, and the
  sale appears in the branch's sales list.
- **Retail central sale:** as a central user, open the same order → pick a
  branch + payment method → **Add as sale** → the `Sale` is registered under the
  chosen branch (`sale.shopId == branch`), and central's sales list shows it with
  that branch.
- **Guardrails:** central without a branch gets a clear error; a branch user
  cannot register the sale under a different branch; a non-`PRODUCT` order
  rejects `convert` with a clear message; `tsc` + jest + `next build` clean.

## Open questions

1. ~~**Default sale type**~~ — **Resolved:** offer all three (`FULLY_PAID` / `PARTIALLY_PAID` / `CREDITED`) in the modal.
2. ~~**Manufacturing**~~ — **Resolved:** route `assign` through the same payment-aware conversion (`assign` now accepts `paymentMethodId`/`saleType`/`paidAmount`).
3. ~~**`DROPPED` status**~~ — **Resolved:** leave the enum value unused for now.
4. ~~**Branch respond buttons**~~ — **Resolved:** add branch Accept/Decline buttons in the inbox (implemented).

## Confirmed (round 2)
1. **Sale types** — offer `FULLY_PAID`, `PARTIALLY_PAID`, `CREDITED`.
2. **Manufacturing** — `assign` uses the same payment-aware conversion as `convert`.
3. **Branch buttons** — branch users get Accept/Decline (respond) buttons for orders routed to them, plus the branch-scoped inbox.
4. **Permissions** — grant `guest-orders.view`/`guest-orders.manage` to `MANAGER`, `SHOPKEEPER`, `STOREKEEPER` (TS defaults + idempotent SQL migration).
