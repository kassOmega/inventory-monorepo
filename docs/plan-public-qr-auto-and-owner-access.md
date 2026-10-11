# Plan: Public QR guest ordering — auto-prepared QRs, table-number flow, per-service access, owner access

## What I got wrong before
- I built a **manual "create a public link"** admin flow (pick a kind, label, curate
  a catalog). You want QRs **prepared automatically** from what the business
  already has — no manual link creation.
- The guest page didn't collect a **table number** for the at-the-table case; it
  relied on the token's table.
- A multi-service hospitality business needs **per-service tabs**, not one flat
  catalog.
- The **owner** had no obvious way to reach the guest actions.

## The correct model (confirmed)

### 1. QRs are auto-prepared from existing records (not created by hand)
When the owner opens the **Guest QR** page, the system **generates/ensures** one
public entry per relevant resource of the active business, and shows the printable
QR + link for each:

| Business | Auto entries (one QR each) | Source record |
|---|---|---|
| **RETAIL / MANUFACTURING** | a **central** QR **+ one QR per branch** | `Location` (SHOP) + a synthetic "central" entry |
| **CAR_WASH** | one per bay (or one per branch) | `Location` / bay |
| **SERVICE** | one per branch (or one for the business) | `Location` |
| **HOSPITALITY** | one **per dining table**, one **hotel/rooms** QR, one **per enabled service line** (spa/gym/pool/events/custom) | `DiningTable`, rooms, `HospitalityService` |

- `ensurePublicEntries(tenantId)` **idempotently** fans out the entries for the
  active business (a stable `publicEntryId`/token per resource, recreated if
  missing, never duplicated). The existing `PublicEntry` model is reused, but it is
  now **system-managed**, keyed by `(tenantId, kind, tableId|locationId|serviceType)`.
- **No catalog curation UI**: what the guest sees is derived from the business's
  own data (menu, products, rooms, service items) as it already is on the public
  view. (A per-entry override list stays supported in the DB for the future, but is
  not required to publish.)

### 2. Guest flow
- **F&B at a table:** scan the **table QR** → menu → choose items → **submit with
  the table number** (the token already names the table; the guest can also type
  the table number to confirm) → **no phone/name** (the table is the identity).
- **F&B not at a table / outside the hotel:** scan the venue QR → menu → submit →
  enter **phone** → **autofill the name** if the phone matches a registered
  customer, else **prompt for the name**.
- **Retailer:** scan a **branch QR** → order goes **directly to that branch**; or
  scan the **central QR** → the **central desk** distributes to branch(es) and waits
  for **accept/decline**.
- **Hotel:** rooms → **list of free rooms** → reserve with the proper guest flow
  (name/phone + stay documents as the internal reservation does).
- **Everything else:** same pattern, per enabled service.

### 3. Per-service navigation (hospitality + multi-line businesses)
- The guest page shows **tabs/navigation per service** the business offers:
  **Food & Beverage**, **Rooms**, **Spa**, **Gym**, **Pool**, **Events**, custom —
  driven by `enabledHospitalityServices`. A single-service business simply shows one.
- The token identifies the venue; the guest switches tabs to see each service's
  catalog. (A table QR opens on the F&B tab; a hotel QR opens on Rooms; etc.)

### 4. Owner / privileged access to guest actions
- **Where the owner finds it:** a dedicated **"Guest Orders"** item in the
  dashboard nav (added), plus the **QR** page. The owner (and any role granted
  `guest-orders.view`/`manage`) sees the **list of guest orders** and can
  **approve / decline** them **before they reach the stations**.
- **Approval gate:** a guest order sits in **SUBMITTED**; the privileged user
  **approves (→ REVIEWED/ACCEPTED → becomes the internal order/sale/booking)** or
  **declines** (→ freed). Nothing reaches a station/queue until approved. This is
  already the inbox we built — we just make **access obvious** and ensure the
  flow is approve-before-station.
- **Notification:** every new guest order **notifies** the business's privileged
  users immediately (and the nag repeats while unhandled) — already implemented,
  kept.

### 5. Row of corrections to the current build
- **Remove the manual "Add link" UI** (kind/label/catalog curation) and replace it
  with an **auto-generated QR list** (`ensurePublicEntries` on page load).
- **Guest page:** add the **table-number field** for the at-table F&B case and the
  **phone→name autofill / name prompt** for the non-table case (both already
  supported server-side; wire the UI).
- **Guest page:** add **per-service tabs** for hospitality/multi-line businesses.
- **Nav:** surface **Guest Orders** clearly for owners; keep the QR page.
- Keep: token security, whitelist-only public DTOs, no internal ids, blocklist,
  notifications, read-once dedupe, approve/decline inbox, branch routing/replies.

## Backend changes
- `guest-orders.service`: replace `createEntry` with **`ensurePublicEntries()`**
  (idempotent fan-out by business type + enabled services) and `listEntries()`
  returning the auto entries (they already flow to the QR page).
- `public.constants`: `entryKindsFor(businessType, enabledServices)` (from the
  earlier plan) drives the fan-out.
- `public.service.view`: for HOSPITALITY, return **per-service groups**
  (`services: [{ key, label, items }]`) so the guest page can render tabs; keep
  the flat `items` for single-service businesses.
- Approve-before-station is already enforced (orders are REVIEWED→converted; the
  station board only sees converted orders).

## Frontend changes
- `/dashboard/qr-codes`: show the **auto entries** (table QRs, branch QRs,
  central, rooms, services) with a **print sheet each**; remove the manual
  create/curate UI.
- `app/o/[token]`: table-number input (at-table F&B) + phone autofill / name
  prompt (non-table); **service tabs** when multiple services exist.
- Nav: ensure **Guest Orders** is visible to owners/managers.

## Verification
- Owner opens the QR page → sees auto QRs for every table/branch/service (no manual
  creation); printing one and scanning it opens the right guest page.
- F&B at table: order submits with the table number, no phone; **appears in the
  owner's Guest Orders**; **approve** → a restaurant order exists (station sees it);
  **decline** → freed.
- Non-table F&B / retail: phone → autofills name or prompts for it.
- Retail: branch QR routes straight to the branch; central QR → central desk →
  branch accept/decline.
- Hotel: rooms tab lists **free rooms**; reserve works.
- Multi-service (F&B + Rooms + Spa): guest page shows **tabs per service**.
- Notification fires on submit; nag repeats while unhandled.
- `tsc` + jest + `next build` clean.

## Open questions
1. **Auto-QR granularity for car wash / service** — one QR per business, per branch,
   or per bay/station? (Recommend per branch; car wash may want per bay.)
2. **Central QR for retail** — a dedicated "central" entry (business-wide) plus a
   QR per branch — confirmed? (This is what the request describes.)
3. **Table number**: at-table QR already names the table — should the guest still
   be **required to type** it (verification), or is it prefilled and optional?
4. **Station gate**: confirm nothing is sent to the kitchen/queue until the
   privileged user **approves** (my plan) — or should some services auto-approve?

## Confirmed (round 2)
1. **Auto-QR granularity:** **per branch** for retail/manufacturing/car-wash/service,
   **per table** + **rooms** + **per service line** for hospitality.
2. **Central QR for retail:** yes — a business-wide **central** entry **plus** one
   per branch.
3. **Table number:** required/confirmed at an at-table QR.
4. **Station gate:** **wait for approval** — nothing reaches the kitchen/queue
   until the privileged user approves.

## `publicId` vs token for the public URL (analysis)

You asked to expose the **catalog** by `publicId` instead of the opaque token. Here
is the honest trade-off:

### Entropy / guessability — effectively equivalent
- `publicId` is `@default(dbgenerated("gen_random_uuid()")) @db.Uuid` → a **random
  v4 UUID (~122 bits)**. The token I used is a 128-bit random string. Both are
  **unguessable**; neither is a sequential integer. So for "can a stranger guess
  another tenant's link?", they are **equivalent** — good.

### Differences that matter
| | `PublicEntry.token` (current) | `publicId` on a business record |
|---|---|---|
| **Scope** | A dedicated public row → one tenant + one target, **revocable/disable-able, schedulable (LIVE/HELD/DROPPED)** | The record's identity → it's the **same id used internally** as the public id; not inherently single-purpose |
| **Is it already exposed anywhere?** | No — brand new | `publicId` is **already returned** in some authenticated payloads (`/auth/me` memberships? customers, users, sales refs…) and used as a client ref across the app |
| **Reuse risk** | A token only works for the public surface | A `publicId` that also appears elsewhere (printed, in a URL, in a payload) can be **replayed against the public surface** if it's ever reused as both internal ref and public link |
| **Revocation** | Rotate the token → old QRs stop working | You'd rotate a **table/branch's** publicId, which also changes every internal reference to it |
| **Table/branch need publicId** | Not required (token lives in `PublicEntry`) | Would require **adding `publicId` to DiningTable/Location/Room** (they have none today) |

### The security rule you stated earlier (still holds)
> "the ID must not be used for internal use."

If we use `publicId` for the public URL, we must guarantee that id is **never** used
as an internal reference. Today that is **not** the case for several models
(`publicId` is used as a client ref internally), so switching the public surface to
`publicId` would mean:
- **not** using those records' `publicId` as an internal ref anywhere, and
- adding `publicId` to tables/branches/rooms that lack it.

That is more work and a weaker invariant than the dedicated `PublicEntry.token`.

### Recommendation: keep the **token**, but it can be "the publicId" conceptually
- The QR already encodes `/o/<token>` where the token **is** a random UUID — i.e. it
  *looks and behaves exactly like a publicId*, but it is a **dedicated, single-purpose,
  revocable** capability (`PublicEntry.token`) rather than reusing a record's id.
- Net: you get the "public UUID in the URL" experience you want **without** the
  reuse/revocation hazard, and without adding `publicId` to tables/branches/rooms.
- If you still prefer the literal `publicId` of a record: do it **only** for
  `PublicEntry`-style rows (a new dedicated table per resource that holds a
  `publicId`), which is what the token already is.

**Bottom line:** identical unguessability; the token is strictly safer (revocable,
single-purpose, no internal reuse). Keep the token; it plays the role of a public id.
