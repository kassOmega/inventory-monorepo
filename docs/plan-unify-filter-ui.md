# Plan: reuse the Sales filter UI everywhere (as-is + simple collapse)

> **STATUS: IMPLEMENTED.** New `CollapsibleFilterPanel` wraps the existing
> `FilterPanel` (unchanged) behind a chevron toggle that starts expanded.
> Migrated: purchases, credits, products, customers, requests, service/clients,
> finance/ledger, and the manufacturing pages (jobs, production, boms, receipts,
> catalog, purchasing). `ListFilters`/`FilterRow` retired.

## Goal
Show the **exact Sales filtering UI**, unchanged, on purchases, credits, and the
other list pages — wrapped in a plain collapsible so it can be hidden. Expanded =
the Sales filters exactly as they are today. Collapsed = hidden. Nothing else
changes.

## What "the Sales filter UI" is (reproduce unchanged)
From `app/dashboard/sales/page.tsx`:
- **`<FilterPanel>`** — the white card
  (`w-full max-w-full bg-white p-2 sm:p-4 rounded-xl shadow-sm border mb-4 sm:mb-6`):
  - optional **`DateFilter`** row (Today / Week / Month / Year + custom range),
  - **`FilterBar`**: search input, then category / location selects in
    `grid grid-cols-2 md:grid-cols-3 gap-1.5 sm:gap-3`.
- **A trailing row of selects below the card** (Sales' sale-type / payment-method):
  `flex flex-wrap gap-2 mb-4 items-center` with
  `<select className="border p-2 rounded-lg bg-white text-sm">`.

These already exist as `FilterPanel` / `FilterBar` / `DateFilter` — **no visual
changes to any of them.**

## Plan

### 1. One small reusable wrapper with a collapse toggle
Add a lightweight **`CollapsibleFilterPanel`** (or a `collapsible` prop on
`FilterPanel`) that:
- renders a slim header with a chevron toggle (`aria-expanded` + `rotate-180`,
  same idiom as the purchase stats summary / sidebar),
- renders the existing `<FilterPanel …/>` (and the trailing selects row) verbatim
  inside,
- **starts expanded**; clicking the header hides/shows the whole block.

That's it: no restyle, no new controls, no state machine beyond open/closed.

### 2. Use it on the pages
Swap each page's bespoke toolbar for the shared filter UI (same state + onChange
handlers, so filtering behaves identically):
- **purchases**: search, status, payment-status, vendor, shop, date row.
- **credits**: search, location, "unpaid only".
- **requests**, **products**, and any other list with hand-rolled filters.

Keep whatever controls each page has — they just render inside the same
Sales-styled panel + trailing row instead of a custom toolbar.

### 3. Retire the duplicate abstractions
`ListFilters.tsx` / `FilterRow.tsx` usages move onto the shared component so there
is a single filter UI.

## Files to touch
- `app/components/FilterPanel.tsx` — add the tiny collapse wrapper (or a new
  `CollapsibleFilterPanel.tsx`); **do not change the visuals**.
- `app/dashboard/purchases/page.tsx`, `credits/page.tsx`, `requests/page.tsx`,
  `products/page.tsx` — render the shared filter UI.
- Retire `ListFilters.tsx` / `FilterRow.tsx`.
- i18n only if a label is missing (en + am in sync).

## Verification
- Pages show the **identical** Sales filter panel (unchanged) with the collapse
  toggle above it.
- Expanded by default; collapse hides it; chevron rotates.
- Same filters → same results as before (presentation-only change).
- Mobile 360 px matches Sales; no horizontal scroll.
- `tsc` + `next build --webpack` clean.

## Confirmed decisions
1. A **new `CollapsibleFilterPanel`** component (wraps the existing
   `FilterPanel` — no visual changes to the panel itself).
2. **Starts expanded** (no persistence of any collapsed choice).
3. Migrate **all list pages in one pass**.

## Open questions
(none — all confirmed above)
