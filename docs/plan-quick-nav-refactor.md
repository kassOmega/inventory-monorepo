# Plan — Refactor the floating quick-action nav + fix mobile overlap

## Goal

1. Replace the large **expandable vertical overlay** with a **concise row of 4–5
   direct links**, chosen per active tenant context (no expandable child list).
2. Fix the **overlap/hiding** issue on sub-pages that pin their own bottom bar
   (esp. **Stock In** `/dashboard/restock` and **Stock Count**
   `/dashboard/adjust-stock`), so the floating button never covers bottom form
   elements / sticky action buttons (e.g. "Add to stock").
3. Increase the auto-collapse idle time to **5 seconds**.

## Current state (verified)

- `frontend/app/components/MobileQuickNav.tsx`:
  - Renders **one pill per primary group** (`primaryNavGroups(nav)`), and tapping
    a pill opens a **large expanding popover** (`max-h-[60vh]`, full width) with
    the group's children. This is the "large expandable vertical overlay".
  - Collapses to a circle after `IDLE_COLLAPSE_MS = 3000`.
  - `HIDDEN_PREFIXES = ["/dashboard/food", "/dashboard/adjust-stock",
    "/dashboard/restock"]` — it already **returns null** on those two stock
    routes.
- The **sticky action bar** lives in `StockProductSheet.tsx` (used by restock
  "Stock In" and adjust-stock "Stock Count"): when not `embedded` it renders
  `fixed bottom-0 left-0 right-0 z-30 …` and the sheet adds `pb-28` clearance.
- The quick nav is `fixed bottom-4 z-50` — **higher z-index** than the stock
  bar (z-30), so wherever both are present the nav covers the "Add to stock"
  button. It is currently hidden on the two named routes, but the overlap can
  still occur on **other** pages that pin a bottom bar, and on the stock pages
  during route/transition moments.
- `layout.tsx` mounts `<MobileQuickNav nav={dashboardNav} pathname={pathname} />`
  inside `<main className="flex-1 overflow-y-auto h-full">`, before
  `<div className="p-4 md:p-8 ...">{children}</div>`.
- Nav data comes from `buildDashboardNav` (`nav.groups`, `nav.loose`); groups
  are `overview`, `carwash`, `inventory`, `salesPayments`, `finance`,
  `administration`; hospitality/service items are in `nav.loose`.

## Design decisions

### A. Concise per-tenant quick actions (no expander)
Define a small, ordered **quick-action list** per business type, resolved by
**href lookup into the already permission-filtered `nav`**, so it only shows
links the user may open (role, station and service gated automatically).

- **Car Wash** (`isCarWash`): `/dashboard`, `/dashboard/carwash/reports`,
  `/dashboard/carwash/washes`, `/dashboard/carwash/expenses`,
  `/dashboard/carwash/washers`.
- **Retail / inventory** (`isRetail`): `/dashboard`, `/dashboard/sales`,
  `/dashboard/purchases`, `/dashboard/credits`, `/dashboard/finance`,
  `/dashboard/reports` (Audit log tab).
- **Hospitality** (`isHospitality`): `/dashboard`, `/dashboard/food/orders`,
  `/dashboard/hotel`, `/dashboard/hospitality/folios`, `/dashboard/cashier` —
  each included only when present in the nav (permissions + enabled service
  lines); the Orders entry falls back to the user's station board if they have a
  station but no take-orders permission.
- **Service** (`isService`): `/dashboard/service`, `/dashboard/service/catalog`,
  `/dashboard/service/bookings`, `/dashboard/service/tickets`,
  `/dashboard/service/clients`.
- **Manufacturing** (`isManufacturing`): `/dashboard`,
  `/dashboard/manufacturing/production`, `/dashboard/manufacturing/orders`,
  `/dashboard/manufacturing/materials`, `/dashboard/manufacturing/services`.

Implementation:
- `quickActionsFor(nav, hrefs)` — for each href, find the matching item across
  `nav.groups[].items` and `nav.loose` (exact href or `match` prefix); keep the
  found ones in order. Missing hrefs are simply skipped (never rendered without
  permission).
- The component learns the tenant from new props passed by `layout.tsx`:
  `businessType`, `stations` (for hospitality), so it can choose the href list.
- Render as a **single horizontally scrollable row** (`overflow-x-auto`, no wrap)
  of direct `<Link>`s, active-highlighted via `isNavItemActive`. No popover.
- Keep collapse-to-circle when idle.

### B. Overlap / hiding fix
Layered defenses so the button never obscures a bottom bar:

1. **Keep/extend `HIDDEN_PREFIXES`**: hide on any route that owns the bottom
   (`/dashboard/restock`, `/dashboard/adjust-stock`, `/dashboard/food/*`, and any
   others found). Make this list the single source of truth and reuse it.
2. **Auto-hide on scroll-down, show on scroll-up** (common pattern): hide the
   floating bar while the user scrolls down through a page and reveal it when
   they scroll up or stop near the top. This prevents covering content in long
   scrollable views even when not in `HIDDEN_PREFIXES`.
3. **Bottom clearance**: ensure page content can scroll clear of the bar — add a
   shared bottom spacer/padding to the `<main>` content wrapper
   (`pb-20 md:pb-8`) so the last form element/footer is reachable and never sits
   under the floating bar. (Stock sheets already use `pb-28`.)
4. **Lower z-index** below the sticky action bar when both are on screen, or keep
   the nav hidden in that region (option 2 covers it). The stock bar is `z-30`;
   keep the nav `z-40` but rely on hide-on-scroll + `HIDDEN_PREFIXES` so they
   don't co-appear.
5. **Safe-area inset**: add `env(safe-area-inset-bottom)` to the nav's bottom
   offset so it clears phone home indicators.

Chosen combination: **(1) hide on bottom-bar pages + (2) auto-hide on scroll +
(3) bottom padding clearance + (5) safe-area**. This is robust without relying on
z-index alone.

### C. Collapse timing
- Change `IDLE_COLLAPSE_MS` from `3000` to **`5000`**.
- Keep the "open popover pauses the timer" behavior only if a popover remains;
  with direct links there is no popover, so the timer just tracks idleness.

## Work plan

1. **`MobileQuickNav.tsx` refactor**:
   - New props `businessType`, `stations`; build the href list per tenant and
     resolve items from `nav` via `quickActionsFor(...)`.
   - Replace group pills + popover with the **horizontally scrollable direct-link
     row**; remove the popover markup (`SectionedNavItems`, `openGroup`,
     `shownGroup`, `useNavGroups`) and its imports; keep collapse-to-circle.
   - Active highlighting via `isNavItemActive`.
   - Bump `IDLE_COLLAPSE_MS` to **5000**.
   - Add scroll-direction auto-hide + `env(safe-area-inset-bottom)`.
2. **`dashboardNavigation.ts`**: add a pure `quickActionsFor(nav, hrefs)` helper
   (find items by href / `match`), exported for the component and tests.
3. **`layout.tsx`**: pass `businessType` + `stations` to `MobileQuickNav`; add
   bottom padding to the content wrapper (`p-4 pb-24 md:p-8`).
4. **`HIDDEN_PREFIXES`**: keep hiding on bottom-bar pages (`/dashboard/restock`,
   `/dashboard/adjust-stock`, `/dashboard/food/*`) and extend if others pin bars.
5. **i18n**: reuse `nav.*` / `reports.tabAudit` labels (no new strings expected).
6. **Tests**: `quickActionsFor` returns only permission-allowed hrefs in order;
   car-wash returns the 5 expected; a role without a permission omits it.
7. **Verify**: mobile viewport — quick actions per tenant; scrollable; permission
   changes hide actions; Stock In / Stock Count hide the bar and the "Add to
   stock" bar is fully tappable; idle collapse after ~5s.

## Confirmed decisions

1. **Horizontally scrollable** single row (shows every configured action; scrolls).
2. **Hospitality** quick actions = Overview, Orders, Rooms, Folios, Cashier —
   adapting to the user's **role/permissions and enabled stations/service lines**.
3. **Keep collapse-to-circle** when idle.
4. **Every action is permission-gated** (and station/service-gated for hospitality).

The built `nav` returned by `buildDashboardNav` is **already permission-filtered**
(`groups[].items` and `nav.loose` drop items the role lacks), so the quick-action
list is derived by **href lookup into that nav** — it inherits role, station and
service gating for free.

