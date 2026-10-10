# Plan: Guest ordering via public QR links (hotel / retail / car-wash / …)

## The idea (as proposed)
Print a QR on each table (hotel), each shop/branch, each wash bay, etc. A guest
scans it → a **public web page** opens (no login) → they see the relevant
menu/catalog/resource and place an order. The order is **reviewed by a privileged
user** before it reaches the station/queue/kitchen. Retailers get a
conversation: the privileged user routes the guest order to **one or more
branches**, and a branch accepts → makes the sale.

## Verdict: yes, this works — with strict separation of public vs internal.
The design below makes the guest link a **capability URL keyed by a public ID that
is only useful for that one public surface**, never for the internal API. That is
the security crux, and it is achievable with the pieces already in the codebase.

## What already exists (reuse)
- **Public UUIDs**: models already carry `publicId @unique @default(gen_random_uuid())`.
- **`@Public()` decorator** + JWT guard bypass → public endpoints pattern exists.
- **QR generation** on the frontend (`qrcode.react`, `html5-qrcode`).
- **Customers** with `phone` (unique per org) → autofill on phone is a lookup.
- **Order/request/sale** flows: restaurant orders (+ station routing via
  `RestaurantStation.roleId`), `StockRequest` (inter-location), `Sale`.
- **Permissions** catalog + role system for the "privileged" approval step.
- Single-origin deployment (`/api` rewrite) — the guest page and API share an origin.

## Security model (the important part)

### 1. Public tokens, never internal IDs
Do **not** expose `CarWash.id`, `Organization.id`, table ids, etc. Introduce a
**dedicated public entry token** per QR target:

```
model PublicEntry {
  id           Int    @id
  token        String @unique  // high-entropy, URL-safe (not a sequential id)
  kind         PublicEntryKind // TABLE | SHOP | CARWASH_BAY | ROOM | KIOSK
  tenantId     Int
  locationId   Int?            // the branch
  // target: tableId (restaurant), resourceId, or null for a shop-level menu
  targetId     Int?
  active       Boolean @default(true)
  rotateAt     DateTime?       // optional rotation
  createdAt    DateTime
}
```
- `token` is **random 128-bit** (`crypto.randomUUID()` or `nanoid(32)`), not the
  row's numeric id and not any internal id. It is a **capability**: knowing it
  grants only the public ordering surface for that target.
- The QR encodes `https://<host>/o/<token>` (a public route). The token is the
  **only** thing in the URL.

### 2. Public API is a thin, separate surface
- New `public` module with `@Public()` endpoints under `/public/...`:
  - `GET  /public/entry/:token` → resolves the entry → returns **only** the
    public-safe payload (business name/logo, the menu/catalog for that target,
    allowed actions). No internal ids, no other tenant data.
  - `POST /public/orders` (token-scoped) → create a **GuestOrder** (below).
  - `GET  /public/orders/:orderToken` → status of a guest's own order.
  - `POST /public/customers/lookup` (scoped by entry token) → autofill by phone
    (returns just name/id for that tenant), rate-limited.
- Every public endpoint:
  - is **tenant-scoped via the token** (the token → `tenantId`/`locationId`),
    never via `X-Tenant-Id`/JWT,
  - returns **only whitelisted fields** (DTO-mapped),
  - is **rate-limited** (Throttler already global) and **CSRF-safe** (no cookies;
    stateless tokens),
  - never reveals whether a phone exists beyond the minimal autofill contract.

### 3. The public ID is not an internal id
- Internal APIs keep using numeric ids / JWT; the public token lives **only** in
  `PublicEntry` and the created `GuestOrder`. There is **no route** that accepts an
  internal id from the public side.
- Enforce with a rule: public controllers may only import the `public` service and
  must not accept `:id` params for internal entities.

### 4. Abuse controls
- Rate-limit per token + per IP (Throttler keyed by token), a max open orders per
  token, and a short-lived signed **order token** so a guest can only view their
  own order (no enumeration).
- Optional: token **rotation** (`rotateAt`) and quick **disable** (deactivate a
  compromised/printed QR) from the admin side.
- Captcha/phone-verification optional for high-risk flows (see open questions).

## Data model (new)
```
enum PublicEntryKind { TABLE SHOP CARWASH_BAY ROOM KIOSK }
enum GuestOrderStatus {
  SUBMITTED      // guest placed it
  REVIEWED       // privileged user accepted/reviewed
  ROUTED         // sent to one/more branches (retail) or station (F&B)
  ACCEPTED       // the branch/station accepted it
  IN_PROGRESS / READY / COMPLETED / CANCELLED / REJECTED
}
enum GuestOrderSource { HOTEL_TABLE RETAIL_SHOP CARWASH_BOOKING ... }

model GuestOrder {
  id             Int    @id
  token          String @unique          // opaque, for the guest to re-open status
  entryId        Int    // PublicEntry
  tenantId       Int
  source         GuestOrderSource
  status         GuestOrderStatus @default(SUBMITTED)
  // customer info captured at submit (autofilled if phone matches a Customer)
  customerId     Int?                   // linked when phone matched an existing customer
  customerName   String
  customerPhone  String
  note           String?
  // where it should go (set at routing time): location(s) / station / resource
  routeLocationIds Int[]  @default([])
  stationRouteId Int?
  // link to the resulting internal record once accepted
  orderId        Int?                   // F&B order
  saleId         Int?                   // retail sale
  bookingId      Int?                   // car-wash booking
  items          GuestOrderItem[]
  activities     GuestOrderActivity[]   // the review/route/accept conversation log
  createdAt      DateTime
  updatedAt      DateTime
}
model GuestOrderItem { id, guestOrderId, productId/menuItemId?, nameSnapshot, qty, unitPrice, notes }
model GuestOrderActivity { id, guestOrderId, actorId?, action, note, createdAt }

// The owner's control over the public surface.
model PublicEntrySchedule {
  id        Int
  entryId   Int            // which QR/link
  // null start = immediately; null end = open-ended (until dropped)
  liveFrom  DateTime?
  liveUntil DateTime?
  state     PublicEntryState // LIVE | HELD | DROPPED
  updatedById Int?
}
enum PublicEntryState { LIVE HELD DROPPED }

// Block a phone from placing orders (per business).
model GuestBlocklist {
  id             Int
  tenantId       Int
  phone          String
  reason         String?
  createdAt      DateTime
  @@unique([tenantId, phone])
}
```

### Public-entry state machine
- **LIVE** — QR works, guests can order/book.
- **HELD** — temporarily paused (owner-set), QR resolves but shows "temporarily
  unavailable".
- **DROPPED** — closed (e.g. table cleared / day ended); QR shows "closed".
- **Scheduled** — `liveFrom`/`liveUntil` flip LIVE/HELD automatically (a scheduled
  hold, e.g. only during service hours).
- Owner can also **block a phone** (`GuestBlocklist`); a blocked phone sees a
  polite "ordering unavailable" and cannot submit.

### Guest-order lifetime (privileged-controlled, no timer)
A submitted `GuestOrder` stays **active** until one of:
- the privileged user **rejects** it → the table/entry is **freed** immediately;
- the **table's payment is settled** (the resulting order/sale is paid) → freed;
- the user **frees it manually** (e.g. guest left, table reset).
The privileged user keeps getting **nagged** while the order is unrouted/unhandled
(no fixed auto-expire). "Free" = the table/entry becomes available for new orders
again.

## Flows

### Hotel / restaurant (table QR)
1. Guest scans TABLE token → `/o/<token>` → menu for that table's area.
2. Enters name + phone → **autofill** if we already have that Customer.
3. Adds items → submits → `GuestOrder(SUBMITTED)`.
4. A **privileged user** (waiter/manager) sees a **Guest Orders** inbox, reviews →
   `REVIEWED` → routes to the station (or converts into the existing restaurant
   order flow) → the kitchen station board picks it up as today.
5. Status streams back to the guest page (polling/SSE) until served.

### Retail (branch QR / catalog)
1. Guest scans SHOP token → the public **catalog** (products/prices the business
   chose to expose).
2. Places an order → `GuestOrder(SUBMITTED)`.
3. Privileged user **routes to one or more branches** → those branches see it in an
   inbox → a branch **accepts** → creates the internal `Sale` → the guest sees
   "accepted at <branch>".
   This is the "conversation between the privileged user and branch shops".

### Car wash (bay/booking QR)
→ public booking form → `GuestOrder(SUBMITTED)` → reviewed → `CarWashBooking`.

## Frontend

### Public (unauthenticated) pages — new route group `app/o/[token]`
- A **separate, minimal public shell** (no dashboard chrome, no auth, its own
  layout) — reuse `PublicHeader`. Mobile-first (QR = phone).
- Pages: landing (business name/logo), catalog/menu, cart, customer form
  (phone-autofill), submit → order status.
- i18n (en/am) shared with the app.
- No internal links; the only "next" is the public API.

### Admin: QR management (privileged)
- A **QR Codes** page (per business): generate/print QR for tables (hospitality),
  branches (retail), bays (car wash). Show the URL, a **print sheet** with the
  business logo + table/area label, and **disable/rotate** actions.
- **Guest Orders inbox** (privileged): review → route (choose branch(es)/station)
  → status; live updates.
- **Public catalog curation**: choose which products/menu items each public entry
  exposes (so a table shows the menu, a shop shows the catalog).

### Branch/station inbox
- Retail branches get a **Guest Orders** inbox (permission-gated); accepting
  creates the `Sale` via the existing sales flow.
- F&B stations keep using the **station board** (guest orders land there after
  review).

## Permissions
- New group: `guest-orders.view` / `guest-orders.manage` (inbox + routing),
  `qr.manage` (generate/disable QRs). Add to default roles per business type
  (Owner/Manager manage; branch staff view/accept where relevant).

## Delivery phases (each independently shippable/revertible)
1. **Foundation:** `PublicEntry` + token, `GET /public/entry/:token`, the public
   shell + catalog page (read-only). Proves the secure public surface.
2. **Guest orders (F&B):** submit → privileged inbox → route to station →
   status. QR print page for tables.
3. **Retail:** public catalog + route-to-branches + branch accept → Sale.
4. **Car wash:** booking entry + review → booking.
5. **Hardening:** rate limits, token rotation/disable, abuse telemetry, optional
   phone verification.

## Verification / security tests
- A public token **cannot** reach any internal endpoint; internal ids **never**
  appear in public responses or URLs.
- Tampering with the token → 404/403 with no data leak; disabled/rotated token
  stops working.
- Phone autofill only returns the minimal name for that tenant; rate-limited.
- Guest order flow end-to-end per business type → correct internal record
  (order/sale/booking) only **after** privileged review/accept.
- No cross-tenant leakage (token → exactly one tenant).

## Risks / things to decide
- **Spam/abuse** on an unauthenticated endpoint (rate limits, captcha, phone OTP).
- **Menu/catalog exposure**: only explicitly published items are shown.
- **Print scale**: QRs are physical; a wrong/compromised QR must be revocable.
- **Ordering vs POS**: guest orders must not bypass stock/price rules; the
  internal Sale/order still enforces them.

## Confirmed decisions
1. **Host:** same domain — public pages at `/o/<token>` on the existing site.
2. **Token:** opaque DB token (revocable), plus a short signed order-token for
   guest status. Not a JWT-per-QR.
3. **Guest identity:** **phone** only (autofill by phone when a `Customer`
   matches; create the `Customer` at review).
4. **Payment:** pay at counter for v1 (no online gateway).
5. **Catalog:** **published per entry** (each `PublicEntry` has its own published
   list of items/resources), not a global flag.
6. **Hotel/F&B:** a guest order becomes a restaurant `Order` **at review**.
7. **Retail routing:** if no branch accepts, **nag the privileged user** until they
   drop/handle it.
8. **Cover all business types** — retail, hospitality, car wash, **service**, and
   **manufacturing**.

### Additional confirmed behavior
- **F&B on a table:** **skip the customer profile inputs entirely** — the table
  number (from the token) is the identity; just submit the order. Phone/name form
  is only for non-table public entries (retail, car wash, room service, etc.).
- **Owner controls the public surface:** the owner can **hold**, **drop**, or
  **schedule** when a public link is live, and can **block users** (by phone) from
  placing orders.
- **Hospitality catalog follows the enabled services:** if F&B → the food & beverage
  menu; if Accommodation → **available rooms** (submit full stay documents); gym →
  gym, spa → spa — i.e. the public page shows exactly the service lines the
  business enabled, each with its own action (order / book / reserve).

## Per-vertical public surfaces
| Business | Public entry kind | What the guest sees | Action |
|---|---|---|---|
| Hospitality — F&B | TABLE | the menu for the table's area | order (no profile form) |
| Hospitality — Accommodation | HOTEL (room catalog) | **available room types** (grouped; taken ones hidden for the dates) | reserve + full stay documents |
| Hospitality — Spa / Gym / Pool / Event | SERVICE | that service's catalog/schedule | book |
| Retail | SHOP | published catalog | order → central desk → branch replies |
| Car wash | CARWASH_BAY | services/prices | book |
| Service | SERVICE | published service catalog | book/request |
| Manufacturing | SHOP/BRANCH | published product catalog | request/quote → central desk → branch replies |

## Per-vertical catalog resolution (server-side, whitelist-only)
`GET /public/entry/:token` resolves the entry and returns the **published catalog
for exactly that entry**, chosen by business type + enabled service lines:

- **Hospitality** — branch on `Organization.enabledHospitalityServices`:
  - `FOOD_AND_BEVERAGE` → the F&B menu for the table/area (published items only).
  - `ACCOMMODATION` → **available rooms** by `RoomType` (status AVAILABLE) with
    nightly price; the reserve action collects the **full stay documents**.
  - `SPA_AND_WELLNESS` / `GYM_AND_FITNESS` / `SWIMMING_POOL` / `EVENT_AND_HALL_RENTAL`
    → that service's `ServiceItem`/schedule (published).
  - `CUSTOM` → the owner-defined service.
- **Retail / Manufacturing** — the entry's **published product list** (per SHOP /
  BRANCH entry).
- **Car wash** — published wash types/prices + optional time slots.
- **Service** — published `ServiceItem` catalog.

### Per-entry published catalog
- New `PublicEntryItem` join (entryId, itemKind, itemId, sortOrder, priceOverride?)
  = exactly what a given QR exposes. The owner curates it in the QR page.
- The public response maps items to **public DTOs only** (display name, price,
  description, image) — no internal ids, no stock internals, no cost.

### Guest doc upload (accommodation)
- Room reservation collects the guest's **full stay documents** (ID, etc.) via the
  public surface using the **existing document-upload** plumbing, stored against
  the created reservation/customer — reviewed with the rest.

## Owner "public surface" controls (admin UI)
- A **QR & Public Links** page: create entries (tables/rooms/branches/bays), curate
  the published catalog, **print** the QR sheet, and set **state**: LIVE / HELD /
  DROPPED, or a **schedule** (service hours). Plus a **blocklist** (by phone).
- A **Guest Orders** inbox (privileged): review → route (station / branch(es)) →
  status; **nag** the privileged user (repeat reminder) while an order is
  unrouted/unaccepted, until they handle or drop it.

## Confirmed (round 3)
- **Integer PKs stay** (accepted). Keep the `publicId`/token pattern for anything
  client/URL-facing; no schema-wide UUID conversion.
- **"ROOM" entry = a room-type catalog**, exactly like the food menu: the guest
  picks a **room type**; individual **rooms are grouped by type**, and a type is
  **hidden when no room of that type is free for the requested dates**.
  - Availability is **date-range based** (reuse `listAvailableRooms`: a room is
    busy when a blocking reservation overlaps `[checkIn, checkOut)`). Not a simple
    "room status" flag.
  - The public page shows, per room type: name, description, `basePrice`/night,
    `totalForStay` for the chosen nights, and how many are available; selecting one
    opens the reservation form (mirrors the internal `createReservation`).
  - A room type with **0 available** for those dates is **omitted**.
- **Retail/manufacturing = one central privileged desk + branch replies:**
  a central manager reviews incoming public orders and **forwards to one or more
  branches**; each branch **replies whether it can handle it** (accept/decline),
  and the conversation is tracked. (This is the "conversation" model, formalized
  with branch replies.)

## Branch-reply model (retail / manufacturing)
- `GuestOrder` → central privileged user **routes** to N branches → each branch gets
  a **request** with **Accept** / **Decline** (+ optional note/ETA).
- The central desk sees every branch's reply; it can **assign** the order to a
  branch that accepted, **re-route** if all declined, or **drop** it.
- On assignment/accept, the branch **creates the `Sale`** through the existing
  PWA/retail sales flow (stock/price rules still enforced internally).
- Manufacturing public orders are **requests/quotes** (confirmed earlier) handled the
  same way (central desk → branch reply).
- Model: `GuestOrderRoute { id, guestOrderId, locationId, status: REQUESTED|
  ACCEPTED|DECLINED, note, respondedById, respondedAt }` — one row per branch
  asked, so replies are explicit and auditable.

## Superseded earlier note (context)
The earlier table implied a single "ROOM" entry; that is refined above to a
**room-type catalog grouped from available rooms**.

### Confirmed (round 2)
1. **Room reservation documents:** mirror the **existing room reservation flow** —
   the public accommodation entry collects the same `GuestRegistrationDto` fields
   (`email`, `address`, `nationality`, `idTypeId` from the tenant's `GuestIdType`
   registry, `idNumber`, `idExpiryDate`, `emergencyContactName/Phone`) plus guest
   name/phone/check-in/check-out, and creates a `HotelReservation` (its ID document
   stored via the existing guest-ID upload path). No new document system.
2. **Manufacturing public order:** a **request/quote** routed to the privileged
   user (not an automatic branch sale).
3. **Guest-order lifetime — privileged decides:** an order is held/active until the
   privileged person **rejects** it (→ freed) or until the **table's payment is
   settled** (→ freed); the user can also **free it manually**. No fixed auto-expiry
   timer.

## Q&A (added)

### Q1 — Is the token different per tenant?
**Yes — and it should be, for two reasons:**
- **Per-entry, not per-tenant.** Every QR gets its **own** token (one `PublicEntry`
  per table / room / branch / bay). Two tables in the same hotel have different
  tokens; two branches of the same retailer have different tokens. The token is the
  identity of *that printed QR*.
- **Tokens are globally unique and high-entropy** (128-bit random, `@unique` across
  the whole table), so they are effectively independent per tenant as a side effect
  of being random.
- **Each token resolves to exactly one tenant + one location/target** server-side.
  The token is the *only* tenant scope for public endpoints — never `X-Tenant-Id`.
  A token from tenant A can never read tenant B (the resolver maps token → one
  `tenantId`).
- **Rotation/disable is per token**, so one compromised QR is revoked without
  touching others.

### Q2 — Can we replace all integer IDs with UUIDs?
**Technically yes, but we should NOT do it** (not now, and probably not ever). Here
is the honest assessment:

**Scale in this codebase:** 136 models use `Int @id @default(autoincrement())`,
156 models total, ~665 integer fields (many are FKs). Only **8** models already have
a `publicId` UUID alongside the int id (created by
`20260910000000_public_ids_business_numbers`).

**Why replacing all int PKs is a bad idea here:**
1. **Massive migration + downtime.** Every PK and every FK (composite keys too, e.g.
   `RolePermission @@id([roleId, permissionId])`) must be rewritten. Live FK chains
   mean a full, careful, ordered rewrite per table. High risk of a botched deploy.
2. **Storage & index cost** (Postgres): a UUID is 16 bytes vs 4 for `int`; secondary
   indexes and FKs store the key too, so indexes grow substantially.
3. **Write/locality cost:** random UUIDv4 PKs scatter B-tree inserts (page splits),
   which hurts insert throughput vs sequential ints.
4. **No real benefit for us.** Internals already avoid exposing ids outside the
   app: the tenant middleware scopes everything, and the few public surfaces use
   `publicId`. The **guest-ordering plan already solves the actual requirement**
   with opaque tokens — internal ids stay internal.
5. **Huge blast radius** across ~55 spec suites, the tenant middleware, the public-id
   resolver, DTOs, and the frontend (which passes numeric ids around).

**What I recommend instead (already the pattern):**
- Keep **`Int` PKs internally** (fast, small, sequential).
- Expose **`publicId` (UUID) on any model a client/URL/QR must reference** — already
  done for Customer, Membership, Sale, StockRequest, Credit*, etc. Extend it to the
  few new public-referenced models in this plan.
- For guest/public surfaces, use the **opaque `PublicEntry.token`** (or a `publicId`
  UUID), never the int id.

**If you still want UUIDs**, do it as a **dedicated, separate initiative** (not
bundled here): add a UUID `publicId` column everywhere (like the 8 existing ones),
switch the **client/URL-facing layer** to it, and leave PKs as ints. That gets the
"no sequential ids leak" benefit with far less risk and downtime. A true PK rewrite
would be a large migration project with a maintenance window and a full backup.

### Net
- **Token per printed QR** (globally unique, one tenant each) — as planned.
- **Keep int PKs; add `publicId` where something must be addressed by a client/URL**
  — do not convert the whole schema to UUID PKs.
