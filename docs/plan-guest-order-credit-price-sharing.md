# Plan: Guest-order confirm/sale flow, routed-order rules, customer info & price sharing

## Goal

1. **Credit/partial guest sales** must only go through when the customer is
   **registered** and **allowed to take credit**, with a clear error otherwise.
2. **Show the guest's name and phone** in the Guest Order detail (a small span).
3. **Retailers**: hide prices on the public QR page **by default**; the business
   can configure whether prices are shown. Same for the **business info
   (name/address/phone)** shown on the public page — configurable show/hide.
4. Add a **"Share prices"** action for orders that have items, generating a
   price list **in the same format as the existing price-list generator**
   (two-column Item | Price PDF, download/share), with a business-level
   configuration to **show or hide business information** in the header.
5. **Prevent multiple acceptances** on routed orders — once one branch accepts,
   no other branch can accept.
6. **Rename "Accept & review" to "Accept"** and clarify the semantics:
   - Hospitality: **Accept** confirms the guest (by phone or table) and the
     order is passed to the station.
   - Retail: **Accept** only confirms the guest's validity (that's why the phone
     is captured); after that the operator has **two options** — **route to
     branches** or **register as a sale**.
7. **Notify** on routed orders: branches when an order is routed to them, and
   the central desk when a branch replies.
8. **Public route toggles**: business-configurable show/hide for **prices** and
   **business information** (name/address/phone) on `/o/[token]`.

## Current state (verified)

- **Credit gate**: `SalesService.assertCustomerMayTakeCredit` blocks
  `PARTIALLY_PAID`/`CREDITED` for a customer with `canTakeCredit=false`, but the
  guest-order layer creates/links the customer inside `toSale` and the error
  fires inside the sale transaction rather than as a clean pre-check.
- **Customer info**: the inbox table shows name/phone; the detail modal shows
  only items/total/note.
- **Public prices**: `PublicService.view()` always returns `price`; the public
  page always renders item prices and the cart total.
- **Price list**: `PriceListModal.tsx` + `lib/priceListPdf.ts` +
  `lib/shareFile.ts` already build the two-column customer-safe PDF
  (download/share); header reads `GET /fiscal/config` (address/phone) + org
  name, but there is no persistent business config.
- **Routed orders**: `respond()` lets any `REQUESTED` route flip to `ACCEPTED`;
  nothing stops a second branch from accepting after the first. No branch/central
  notifications exist on route/respond.
- **Button copy**: the inbox button reads "Accept & review" (`review`).

## Changes

### 1. Credit customer gate (backend)

`guest-order-conversion.service.ts`:
- `ensureCustomer(order)` returns `{ id, name, phone, canTakeCredit }`.
- If `canTakeCredit === false`, throw
  `BadRequestException(tr('errors.customerCreditBlocked', { name }))` **before**
  `SalesService.createSale`.
- Keep `SalesService.assertCustomerMayTakeCredit` (defense in depth).
- Always link the resolved/created `customerId` back onto `GuestOrder.customerId`
  for credit/partial sales.

`guest-orders.service.ts` `convert`/`assign`:
- For `saleType === 'CREDITED' || 'PARTIALLY_PAID'`, resolve/create the customer
  and run the `canTakeCredit` check **before** `conversion.convert(...)`, so the
  operator gets a clean error and no sale transaction is started.

### 2. Customer info span (frontend)

In the guest-orders detail modal, above the items list:

```
Customer: {customerName || "—"} · {customerPhone}
```

- `detail.customerName` / `detail.customerPhone`.
- When both are empty (F&B on a table), show the table/entry label instead.

### 3. Public route visibility (prices + business info)

Backend `public.service.ts`:
- Read `settings` in `view()` (`select: { ..., settings: true }`), and read the
  tenant's `TenantFiscalConfig` for `address`/`phone` (best effort).
- Add to `PublicEntryView` (both return sites):
  - `showPrices: boolean`
  - `showBusinessInfo: boolean`
  - `businessAddress: string | null`, `businessPhone: string | null`
- `showPrices = settings.showPublicPrices ?? (businessType !== 'RETAIL')` —
  retail defaults to **hidden**, everyone else shows.
- `showBusinessInfo = settings.showPublicBusinessInfo ?? true`.
- `submit()` unchanged (server still resolves real prices internally).

Frontend `app/o/[token]/page.tsx`:
- Add `showPrices`, `showBusinessInfo`, `businessAddress`, `businessPhone` to
  the `EntryView` interface.
- Prices: when `entry.showPrices` is false, hide item/variant prices and the
  cart total (cart summary shows `name × qty` without a price); "Place order"
  still works.
- Business info: when `entry.showBusinessInfo` is true, show the business name +
  address + phone in the header; when false, fall back to a neutral
  "Order here" header (no name/address/phone).

Business settings `app/dashboard/businesses/settings/page.tsx`:
- Add toggle **"Show prices on the public ordering page"** →
  `settings.showPublicPrices`.
- Add toggle **"Show business information on the public ordering page"** →
  `settings.showPublicBusinessInfo` (default true).
- Both saved via the existing `PATCH /tenants/:id/settings`.

### 4. Ordered-item price sharing + business-info config

Reuse `buildPriceListPdf`, `priceListFileName`, `shareFile`, `fmtCurrency`.

Frontend `app/dashboard/guest-orders/page.tsx`:
- Add **"Share prices"** next to the accept button (two-button row), visible
  **only when `detail.items?.length > 0`** — **all item kinds**
  (menu/service/room/product).
- Rows use **unit price** (per decision 1b), like the products price list:
  - `item: nameSnapshot`
  - `price: fmtCurrency(unitPrice)`
- Download + Share (Share only where `canShareFiles()`).
- Header (business name/address/phone) is included only when the org setting
  `showPriceListBusinessInfo` is true (default true). Fetch address/phone from
  `GET /fiscal/config` (best effort).

`PriceListModal.tsx`:
- Default its `includeHeader` from the same `showPriceListBusinessInfo` org
  setting, keeping the per-generation checkbox as an override.

Business settings:
- Add toggle **"Show business information on shared price lists"** →
  `settings.showPriceListBusinessInfo` (default true).

### 5. Single acceptance on routed orders

`guest-orders.service.ts` `respond()`:
- Before applying any reply, check whether another route on this order already
  has `status === 'ACCEPTED'`. If one does, **block all further responses**
  (`ACCEPT` and `DECLINE`) with
  `BadRequestException('This order is already accepted by another branch')`.
- This freezes the conversation after the first acceptance; the central desk
  then assigns/drops, or that branch registers the sale.

### 6. Accept semantics + rename

- Rename the i18n key/button `guestOrders.acceptReview` → **"Accept"** (en/am).
- Update the status copy so `REVIEWED` reads as **"Confirmed"** in the UI (the
  internal enum stays `REVIEWED`; no migration).
- Add a short hint in the detail modal:
  - Retail: "Confirm the customer (name/phone), then route to branches or add
    the sale."
  - Hospitality: "Confirm the guest (phone or table), then the order is sent to
    the station."
- Keep the backend `review()` semantics unchanged:
  - Hospitality/service/rooms → auto-convert to the internal record on accept.
  - Retail/manufacturing → mark confirmed; the operator then chooses
    **Route** or **Add as sale** (both already exist in the modal; make the two
    options visually distinct after accept).

### 7. Notifications for routed orders

`guest-orders.service.ts` (reuse the injected `NotificationsService`):
- **On route** (`route()`): for each branch, call
  `notifications.notifyLocation('New guest order', 'Order #N was routed to your branch', locationId, { link: '/dashboard/guest-orders', dedupeKey: 'GUEST_ORDER_ROUTED:<orderId>:<locationId>' })`.
- **On respond** (`respond()`): call
  `notifications.notifyOwner('Guest order update', 'Branch <name> accepted/declined order #N', { link: '/dashboard/guest-orders', dedupeKey: 'GUEST_ORDER_BRANCH_REPLY:<orderId>:<locationId>' })`.
- **On assign/convert** (optional, consistent): notify the assigned branch via
  `notifyLocation` that the order is accepted/sale created.
- All `.catch(() => {})` best-effort (same pattern as public.service submit).

## Config summary (Organization.settings JSON — no migration)

| Key | Default | Meaning |
|---|---|---|
| `showPublicPrices` | `false` for RETAIL, `true` otherwise | Show prices on `/o/[token]` |
| `showPublicBusinessInfo` | `true` | Show business name/address/phone on `/o/[token]` |
| `showPriceListBusinessInfo` | `true` | Include business name/address/phone in generated price lists |

## Files touched

- `inventory-backend/src/guest-orders/guest-order-conversion.service.ts`
- `inventory-backend/src/guest-orders/guest-orders.service.ts`
- `inventory-backend/src/public/public.service.ts`
- `frontend/app/o/[token]/page.tsx`
- `frontend/app/dashboard/guest-orders/page.tsx`
- `frontend/app/dashboard/businesses/settings/page.tsx`
- `frontend/app/components/PriceListModal.tsx`
- i18n `en`/`am` (`guestOrders.*`, `public.*`, `biz.set.*`)

## Verification

- **Credit gate**: `CREDITED` conversion with a `canTakeCredit=false` customer →
  clear error, no sale; with a new/active customer → sale created and
  `GuestOrder.customerId` linked.
- **Customer span**: detail modal shows the guest's name + phone.
- **Public prices**: retail QR hides prices/total by default; toggling
  `showPublicPrices` reveals them; non-retail still shows by default.
- **Share prices**: button appears for orders with items (all kinds); PDF shows
  `nameSnapshot` / `unitPrice` rows; header follows `showPriceListBusinessInfo`;
  download + share work.
- **Single acceptance**: route to two branches → branch A accepts → branch B's
  reply (accept or decline) is blocked with "already accepted by another
  branch".
- **Notifications**: routing notifies each branch; a branch reply notifies the
  central desk (bell/toast + `/dashboard/guest-orders` link).
- **Public business info**: toggling `showPublicBusinessInfo` shows/hides the
  business name/address/phone in the public header; `showPublicPrices` hides
  prices/total independently.
- `tsc` (frontend + backend) clean; jest green.

## Confirmed decisions (round 2)

1. **After one branch accepts**, the routed conversation freezes for all other
   branches (both accept and decline are blocked) until central assigns/drops.
2. **`REVIEWED` status pill → "Confirmed"** in the UI (internal enum unchanged).
3. **Public route toggles** — add both `showPublicPrices` and
   `showPublicBusinessInfo` (name/address/phone) as business settings.
