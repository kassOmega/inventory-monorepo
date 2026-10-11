# Plan: One QR per tenant (+ per branch) — catalogs, not per-item QRs

## What I misunderstood
I generated a QR **per resource** — per dining table, per service line, per hotel,
etc. That is wrong.

## The correct model (confirmed)
- **One QR per tenant** — the primary public link.
- **Plus one QR per branch** — **only if branches exist**.
- **Scanning that one QR shows:**
  - a **single catalog** when the business offers **one service** (e.g. a
    retailer's product catalog, a restaurant's menu, a car-wash's services), or
  - **catalogs per service** when it offers **several** (Food, Rooms, Spa, Gym…) —
    rendered as **tabs/navigation inside the same page**.
- **The customer just scans that one QR — that's all.** No table QR, no per-service
  QR, no manual link creation.

## Retirement of the over-split behavior
Replace `ensurePublicEntries()` (which fans out per table / per service / hotel /
bay) with the correct rule:

```
ensurePublicEntries():
  // Exactly one business-wide (central) entry per tenant.
  ensure a single PublicEntry { kind: <tenant kind>, locationId: null }
  // Plus one per branch, only when the business has branches.
  for each Location of the tenant:
     ensure a PublicEntry { kind: <tenant kind>, locationId: branch }
```

- **Kind** is derived from the business type (retail → catalog; hospitality →
  service page; car wash → services; service → services) — a single "public
  catalog" kind, not one entry per sub-resource.
- **No table entries, no per-service entries, no per-hotel entry.** A dining table
  is **not** a QR; the guest enters their **table number** on the page.
- Branches are **supplementary** — if none exist, there is exactly one QR.

## What a single scan shows (server-resolved from the token)
`GET /public/entry/:token` returns, based on the tenant's **enabled services**
(hospitality) or simply the business's catalog:
- **One catalog** → return `items` (menu / products / services / rooms).
- **Several services** → return `services: [{ key, label, items }]` (Food & Beverage,
  Rooms, Spa, Gym, Pool, Events, custom) so the page renders **tabs**.
- `rooms` are always resolved from **availability** (free rooms only).
- The **whole thing is one page**; the guest switches tabs, no second QR.

## Data-model simplification
- `PublicEntry` shrinks to: `(tenantId, locationId?)` + token + state/schedule.
  - **`locationId = null` → the central QR**; `locationId = branch` → that branch's
    QR. Both show the **same tenant-wide catalog**; the difference is **where the
    order is routed** (central → central desk routes; branch → straight to branch).
  - `kind` stays only as the tenant's public flavor (or can be dropped and derived
    on read). `tableId` is **no longer used** for entry creation (the guest types
    the table number instead).
- **F&B at a table:** the page asks for the **table number** (no per-table QR), and
  the order records that table number.

## Guest flow (unchanged except entrance)
1. Scan the **central QR** (or a **branch QR**).
2. Page loads → single catalog, or **service tabs** if multiple. The page shows an
   **"Order here"** heading and an optional **"Contact us"** block.
3. Pick items → if **F&B on a table**, enter the **table number**; if **not on a
   table / outside**, enter **phone → autofill name** (or **prompt for name**).
4. Submit →
   - scanned a **branch QR** → the order goes **straight to that branch** (still
     awaiting the branch's accept, per the approval gate);
   - scanned the **central QR** → the **central user routes** it to branch(es) and
     waits for accept/decline.
   Nothing reaches a station/queue until approved.
5. Notifications fire; the privileged user reviews in **Guest Orders**.

## Frontend
- `/dashboard/qr-codes`: show **the central QR** and, if branches exist, **one QR per
  branch** — nothing else. No table/service/per-hotel entries.
- `app/o/[token]`: single page; **"Order here"** heading; **service tabs** only when
  multiple services exist; **table-number field** for at-table F&B; phone
  autofill/name prompt otherwise; optional **"Contact us"** block.
- Remove the auto fan-out of table/service/bay entries from the backend.

## Backend
- `guest-orders.service.ensurePublicEntries()` → **central + per-branch only**.
- `public.service.view()` already returns `items` + `services[]` — keep, and it is
  the source of the single-page catalogs.
- Drop per-table/per-service entry creation.

## Verification
- A tenant **without branches**: exactly **one** QR; scanning shows its catalog (or
  service tabs).
- A tenant **with branches**: **one central QR + one per branch**; a branch QR shows
  the same catalog but scoped to that branch for order routing.
- Multi-service hospitality: **one QR** → page shows **Food / Rooms / Spa … tabs**.
- F&B: no table QR; the guest types the **table number** on the page.
- No table/service/hotel-per-item entries are generated.
- `tsc` + jest + `next build` clean.

## Open questions
(none — all confirmed)

## Confirmed (round 2)
1. **Branch QR:** show the **tenant-wide catalog** and **route the order to that
   branch**, **and still support a central entry** (so guests can order centrally
   too). So QR set = **one central + one per branch**.
2. **Central QR:** the guest just scans it — the **central user manages routing**
   (distributes to branch(es), which accept/decline). The guest does **not** pick a
   branch.
3. **Single tenant-QR page label:** a clear "Order here" heading, plus an optional
   **"Contact us"** block (business phone / address / hours) on the page.
