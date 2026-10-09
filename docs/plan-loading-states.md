# Plan: loading state for all buttons, menus, and nav

> **STATUS: FOUNDATION + FIRST VERTICAL LANDED.** The shared `Button`, the
> `RowActionsMenu` per-item spinner, the nav spinner-in-place, and the carwash
> `prices` page migration are implemented and verified. The remaining sweep
> (other carwash pages, shared forms, other verticals) is the mechanical
> application of the same pattern.

## Goal
Every control that triggers asynchronous work shows a busy state while it runs:
- **Buttons** (submit/save/delete/create/action) disable and show a spinner +
  label while the request is in flight, so users can't double-submit and know
  something happened.
- **Menus** (open/close popovers, row action menus, filter panels, chart toggle)
  reflect pending work where it matters (e.g. an action *inside* a menu that
  triggers a request).
- **Nav** (sidebar links, mobile quick nav, pagination, tabs) give feedback when
  navigating to a page that then loads data.

## Current state (from investigation)
- **Existing primitives (reuse, don't reinvent):**
  - `app/components/Loading.tsx` — `<Loading size="sm" />` is already the
    intended inline/button spinner; `<Loading />` is the full-area one.
  - `app/components/LoadingBar.tsx` — global top bar driven by the API layer's
    in-flight counter (`onApiPendingChange` in `lib/api.ts`).
  - `lib/api.ts` already tracks `pendingCount` + listeners, so a global "is
    anything in flight" signal exists.
- **126 files contain raw `<button>`.** ~72 already show a spinner or disable
  while busy (many forms set `loading`/`submitting` and render
  `<Loading size="sm" />`, e.g. `app/login/page.tsx`). ~48 use a
  `disabled={...ing}` guard. The rest do async work with **no** busy state.
- **No shared `Button` component.** Each button hand-writes Tailwind classes
  (`bg-blue-600 text-white ...` appears in many variants), so there is no single
  place to add loading behavior today.
- **Known concrete gaps** (async handlers with un-busy buttons), e.g.:
  - `app/dashboard/carwash/prices/page.tsx` — `submit`, `remove`,
    `submitWashType`, `removeWashType`, `submitVehicleType`,
    `removeVehicleType`, `createVehicleTypeInline`, `createWashTypeInline`.
  - Similar patterns across the carwash, manufacturing, service dashboards.
- **Nav/menus** already have *static* behavior but no pending feedback:
  `NavItemLink.tsx`, `SidebarMenu.tsx`, `MobileQuickNav.tsx`,
  `SectionedNavItems.tsx`, `RowActionsMenu.tsx`, `Pagination.tsx`, `StockTabs.tsx`.

## Approach

### 1. Introduce one shared `Button` (the single lever)
Add `app/components/Button.tsx` — a small wrapper that standardizes:
- `loading?: boolean` → disables the button, swaps content for
  `<Loading size="sm" />` + optional label, sets `aria-busy`.
- `variant` (`primary` / `secondary` / `danger` / `ghost`) + `size`
  (`sm`/`md`) to replace the hand-written class strings (kills the ~10
  duplicated `bg-blue-600 …` variants).
- Forwards all native button props (so drop-in for existing `<button>`s).
- Works for `<button>`; provide a `ButtonLink`/`asChild` path or a thin
  `NavButton` for link-styled controls.

Rationale: without a primitive, "add loading to all buttons" is a 126-file
find-and-replace with inconsistent results. With it, most files change one line
and the busy pattern is uniform and testable.

### 2. Buttons — adopt `Button` for async actions
For each async handler (`submit`, `remove`, `create*`, `save*`, `update*`,
`delete*`, `confirm*`, `approve*`, `generate*`, `print*`, …):
- Add a `busy`/`saving`/`deleting` state around the `await` (many files already
  have one — reuse it; otherwise add it).
- Render `<Button loading={busy} …>`.
- Keep the existing `disabled` conditions AND-ed with `loading`.
- Use `common.saving` / `common.deleting` / `common.loading` labels (already in
  `en`/`am`) or the button's own action label ("Saving…", "Deleting…").

### 3. Menus — busy where the menu triggers work
- `RowActionsMenu`: add optional per-item `loading` so the chosen action disables
  the whole menu and shows a spinner on that row until the action resolves; close
  on success.
- Filter panels / `FilterPanel` + `FilterBar` / `ListFilters`: show a spinner on
  the "Apply" action while the filtered fetch is in flight.
- `ChartCard`: the chart⇄table toggle is instant (no request) — no spinner
  needed, but if a menu action triggers a fetch, reflect it.
- Dropdowns that lazily load options (`SearchableSelect`) already can show a
  loading row — ensure it does.

### 4. Nav — navigation feedback
- `NavItemLink` / `SidebarMenu` / `MobileQuickNav`: on click, show a brief
  pending state (spinner replacing the label, or an active/pressed style) until
  the route commits. Next.js App Router exposes `useLinkStatus()` (or
  `useSelectedLayoutSegment` + a transition) — use `useLinkStatus` where
  available so the link itself shows pending without global state.
- `Pagination`: disable + spinner on the page-change action while new data loads.
- `StockTabs` / tab bars: mark the tab as pending while its content loads.
- The global `LoadingBar` already covers "any request in flight" — keep it as the
  coarse signal; the per-control states are the fine signal.

### 5. Guard against double-submit everywhere
Even where a spinner isn't visually needed, ensure `disabled` while busy. This is
already the pattern in ~48 spots; make it universal via `Button`.

## Reuse / conventions
- Single spinner: `Loading size="sm"`. No new ad-hoc `animate-spin` markup.
- i18n: reuse `common.loading|saving|deleting`; add `common.processing` and
  `common.working` to `en` + `am` only if needed.
- Keep existing UI flow/theme/structure; `Button` should render visually
  identical classes to today's primary/secondary/danger buttons.
- Accessibility: `aria-busy` while loading; keep the accessible name stable
  (label text stays, spinner is decorative) or set `aria-label`.

## Rollout (ordered, so each step is verifiable)
1. Add `Button.tsx` (+ tests) and migrate 2–3 representative files (login,
   carwash prices, product form) — prove the API.
2. Migrate the **carwash** pages (prices, washes, expenses, washers, bookings,
   collection, vehicles, equipment, store-items, settings) — highest-traffic new
   vertical, many gaps.
3. Migrate **shared components** with forms/actions: `ProductForm`, `SaleForm`,
   `PurchaseForm`, `CustomerForm`, `Modal`/`ConfirmProvider` actions,
   `DualExpenseModal`, `CheckoutModal`, `StockCountModal`, `StockProductSheet`,
   `VendorPaymentModal`, `CategoriesManager`, `VariantLinesEditor`.
4. Migrate **manufacturing / service / hospitality / retail** dashboard pages.
5. Menus + nav: `RowActionsMenu`, filter panels, `Pagination`, `StockTabs`,
   `NavItemLink`/`SidebarMenu`/`MobileQuickNav` pending feedback.
6. i18n keys (en + am) for any new labels.

## Verification
- `npx tsc --noEmit` clean; `npx next build --webpack` compiles.
- A runnable check / unit test for `Button` (renders spinner + disables when
  `loading`).
- Manual: submit a form, delete a row, run an inline create, change a page, open
  a row-action menu → each shows a spinner and can't be double-fired; nav links
  show pending while the next page loads.
- Grep gate: no remaining async `<button onClick={async …}>` without a busy
  state (track down the ~50 files in the "no loading" list and classify each:
  async action vs. pure UI toggle).

## Progress

### Done
- **`app/components/Button.tsx`** — shared button: `loading` (spinner + disable +
  `aria-busy`), `variant` (primary/secondary/danger/ghost), `size` (sm/md),
  `shape` (rounded/rounded-lg), `spinnerClassName`, `className` passthrough.
  Defaults reproduce the exact existing class strings, so swaps are
  visual-identical. Keeps the action label (decision #4).
- **`RowActionsMenu.tsx`** — per-item loading: an async `onClick` shows a spinner
  on that row, disables the others, and closes on success; sync handlers still
  close immediately (decision #3). `ActionItem.onClick` now allows a Promise.
- **`NavItemLink.tsx`** — spinner-in-place via Next `useLinkStatus()` inside the
  `<Link>`; the label is swapped for a small spinner while the route commits
  (decision #2). Shared by the sidebar and mobile quick nav.
- **`app/dashboard/carwash/prices/page.tsx`** — fully migrated: submit/save
  buttons use `<Button loading=…>`, delete links use `<Button variant="ghost">`
  with per-row busy, inline creates show a spinner; all async handlers use
  `try/finally` to clear the busy flag.
- Checks: `lib/button.check.tsx` (spinner + disabled + aria-busy + label kept +
  theme preserved).

### Remaining (mechanical)
- Migrate the other carwash pages, shared forms/modals, and the remaining
  verticals (see Rollout).
- Filter panels' Apply spinner; `Pagination`/`StockTabs` pending states.
- New i18n labels only if needed (reuse `common.saving|deleting|loading`).

## Confirmed decisions
1. **Shared `Button`** is the single lever — it must render **visually identical**
   classes to today's buttons (same theme/style), so migrating is a no-visual-change
   swap that only adds the loading behavior.
2. **Nav pending = spinner-in-place** (the link's label is replaced by/annexted
   with a small spinner while the route commits; use `useLinkStatus`).
3. **`RowActionsMenu` gets per-item loading** (the chosen action disables the
   menu and shows a spinner on that row until it resolves; close on success).
4. **Keep-action label policy**: the button keeps its own label ("Save",
   "Delete") and the spinner is added alongside; do **not** swap to a gerund.
   (Existing controls that already use a gerund like login stay as-is.)
