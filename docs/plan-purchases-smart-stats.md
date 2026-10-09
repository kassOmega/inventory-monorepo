# Plan: smart, collapsible stats summary for Quick Purchase

> **STATUS: IMPLEMENTED.** Collapsible smart-cards summary on
> `app/dashboard/purchases/page.tsx`: collapsed by default (header keeps the
> headline number), remembered via localStorage, compact color-accented card
> groups per settlement, day-cash as its own group.

## Goal
Replace the Quick Purchase page's current **single wrapping inline stats strip**
with a **compact set of smart cards** that take minimal space, plus a
**collapsible wrapper** so the whole summary can collapse on small screens and
never eat the vertical space the purchase list needs.

## Current state
`frontend/app/dashboard/purchases/page.tsx` (~line 380) renders one
`div` (white card) containing, inline and wrapping:
- **Paid** group: total cost → revenue, profit (owner), pending count.
- **Credit** group: total taken, paid back, outstanding, unpaid count, recorded
  margin (owner).
- **Day-sheet** group: opening cash, inflow, outflow, closing.

Problems:
- It is one dense sentence of numbers separated by `·`, hard to scan.
- It always occupies its full height (several wrapped rows on a 360 px phone),
  pushing the table down.
- No way to collapse it.

## Proposed design

### 1. Collapsible container (default collapsed on mobile, expanded on desktop)
- A slim header row: a title/label ("This period" / existing `purchases.*`
  strings) + a chevron toggle button (reuse the `SidebarMenu` chevron pattern:
  `aria-expanded` + `rotate-180`). The header also shows a **one-line hint** so a
  collapsed state is still useful — e.g. the total cost (paid) or outstanding
  (credit) as a single key number.
- State: `const [statsOpen, setStatsOpen] = useState(false)`; initialize to
  `false` on mobile. Prefer CSS-only responsiveness: render collapsed by default
  and let a `useState`/`matchMedia` open it on `lg` (or simply keep it collapsed
  everywhere since the header hint carries the headline number). Recommend:
  **collapsed by default on all sizes** for consistency, with the hint number.
- Persist the open/closed choice in `localStorage` (optional) so it doesn't
  reset on every visit.

### 2. Smart cards grid
When expanded, render a responsive grid instead of the inline strip:
- `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2`
- Each card = one metric: small label (gray, `text-[11px] uppercase`), value
  (semibold, colored by meaning: red cost, blue revenue, green profit/paid-back,
  red outstanding), and an optional tiny sub-line.
- Cards are **compact**: `rounded-lg border p-2.5`, tight padding, `leading-tight`
  numbers, so a 360 px phone shows 2 per row without horizontal scroll.
- Group them with a tiny section label ("Paid" / "Credit" / "Day cash") or a
  colored left accent, so the three settlements stay distinguishable.
- Only show a group when it applies (same conditions as today:
  `tab !== "CREDIT" && stats?.paid`, `tab !== "PAID" && stats?.credit`,
  `daySheet`). Owner-only figures (profit, margin) stay owner-gated.

### 3. Space discipline (mobile first)
- Collapsed = exactly one row (~40 px) — the header + hint.
- Expanded grid cards are small; no card holds more than 2 lines.
- Use `min-w-0` + `truncate` on the header hint so long currency strings never
  wrap the header to two lines.
- Keep the existing `overflow-hidden` guard so nothing forces a sideways scroll.
- No wide fixed widths; everything is grid/flex with `gap`, so it reflows.

### 4. Reuse existing pieces
- Chevron toggle markup/classes from `SidebarMenu.tsx` (same `rotate-180` +
  `aria-expanded` idiom) — no new component needed, or a tiny local
  `StatCard`/`StatGroup` helper inside the page for readability.
- Keep `fmtCurrency`, `isOwner`, `daySheet`, `creditMargin` as-is — this is a
  view-only refactor; no data/query changes.
- Reuse existing i18n keys under `purchases.*` (modePaid, modeCredit,
  totalCost→revenue labels, creditPaidBack, creditOutstanding, openingCash,
  inflow, outflow, closingCash, profit, recordedMargin, pending). Add a couple of
  new keys only if a card needs a shorter label (e.g. `purchases.statsTitle`).

## Files to touch
- `frontend/app/dashboard/purchases/page.tsx` — replace the stats strip `div`
  with the collapsible + card grid; add `statsOpen` state (and optional
  `localStorage` persistence).
- `frontend/lib/locales/{en,am}/common.json` — only if a new short label is
  needed (keep en/am in sync).

## Verification
- Mobile 360 px: collapsed summary is a single slim row; opening it shows 2
  cards per row, no horizontal scroll, table still visible below.
- Tablet/desktop: cards reflow to 3–4 columns; still collapsible.
- Owner vs non-owner: profit/margin cards hidden for non-owners as today.
- Tabs: Paid-only shows the Paid cards; Credit-only shows the Credit cards; ALL
  shows both + day cash.
- `tsc` + `next build --webpack` clean.

## Open questions
1. **Default state**: collapsed everywhere (recommended, header shows the key
   number) or auto-expanded on desktop / collapsed on mobile only?
2. **Remember choice** across visits (`localStorage`) or always start collapsed?
3. Keep the **day-cash** line as its own compact row (it is secondary) or fold it
   into a card group too?
4. Card style: neutral white cards, or a subtle color accent per settlement
   (Paid/blue, Credit/amber, Day/gray)?
