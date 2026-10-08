# Plan — Clear ("X") button in search / dropdown input fields

## Decision (confirmed)

**Option B:** the X shows when the field has **either** typed text **or** a
selected value. Clicking it clears both the typed text and the selected value
(effectively a full reset of that field), refocuses the input, and resets the
dropdown options list.

## Goal

Add a clear ("X") button inside search-type inputs across the UI, including the
autocomplete dropdowns (Shop Location, Vendor, Product, Customer) and the
plain search filter boxes. Requirements:

1. An "X" icon inside the right edge of the input.
2. Rendered **only when the input has a non-empty query string**.
3. Click resets the search query to `""`, **refocuses** the input, and
   re-triggers/resets the dropdown options list.
4. `e.stopPropagation()` so the click doesn't select a dropdown item or close
   the menu prematurely.

## Findings (verified)

### Two families of search inputs

1. **`SearchableSelect`** (`frontend/app/components/SearchableSelect.tsx`) — the
   autocomplete dropdown used by the examples (Shop Location, Vendor, Product,
   Customer). Used in 13 files, e.g. `SaleForm`, `PurchaseForm`,
   `purchases/page.tsx`, `credits/[id]`, `carwash/*`, `admin/businesses`,
   `StockProductSheet`, `DualExpenseModal`, `requests`.
   - It **already has** an ✕ mechanism, but:
     - it only renders when the caller passes **`clearable`** (only 3 call sites
       do: `purchases/page.tsx`, `StockProductSheet` ×2);
     - visibility is based on the *displayed value*
       (`open ? query : cleared ? "" : selected?.label`), not strictly on a
       non-empty **query string**;
     - it uses a literal `✕` text, not a Lucide `X` icon (`lucide-react` is a
       dependency);
     - it does **not** call `stopPropagation` (it relies on `preventDefault`);
     - clearing sets `cleared` (a display flag) and leaves the value untouched.

2. **Plain `<input>` search filters** — 13 inline inputs with
   `value={search} onChange=...` (products, customers, credits, ledger,
   manufacturing lists, service clients, `PriceListModal`, `FacilityDashboard`)
   plus the reusable `SearchField` in `ListFilters.tsx`. **None** have an X.

### Lucide

`lucide-react@^1.31.0` is available, so `import { X } from "lucide-react"` works.

## Design decision

- **One shared clearable input** so behaviour/appearance is identical everywhere
  instead of duplicating markup:
  - Update **`SearchableSelect`** to always render the X (Option B) whenever it
    has a **non-empty query `query`** *or* a **selected value** — no `clearable`
    opt-in needed. Use `X` from Lucide.
  - Add a small reusable **`ClearableInput`** (and extend `SearchField`) so the
    plain search filters also get the X.
- **Clear semantics (Option B):** the X clears **both** the typed text and the
  selected value:
  - `setQuery("")`; `setCleared(false)`; call `onChange("")` so the selection is
    released; call `onInputChange?.("")` so a server-driven search resets; keep
    `open` true so the full option list returns; `inputRef.current?.focus()`.
- **Visibility rule:** `query.trim() !== "" || value !== ""`. The X must not
  appear on an untouched, empty field.
- **Event handling:** `onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}`
  and `onClick={(e) => { e.stopPropagation(); clear(); }}` so the outside-click
  handler and option `<li>/<button>` handlers never fire.
- The existing 3 `clearable` call sites (purchases vendor filter, StockProductSheet
  ×2) now get this behaviour by default; their `clearable`/`clearLabel` props
  become redundant (kept as accepted no-ops for compatibility).

## Work plan

### A. `SearchableSelect` — always-clearable X (Option B)

File: `frontend/app/components/SearchableSelect.tsx`.

- Import `{ X } from "lucide-react"`; replace the literal `✕`.
- Show the X when `query.trim() !== "" || value !== ""`.
- X behaviour: `setQuery("")`, `setCleared(false)`, `onChange("")`,
  `onInputChange?.("")`, `setOpen(true)` (full list returns), refocus.
- `e.stopPropagation()` + `preventDefault` on both `mousedown` and `click`.
- Keep `clearable`/`clearLabel` as accepted props (no longer required to show
  the X); when present, use `clearLabel` for the tooltip/aria-label.
- Position inside the right edge (`absolute right-2 top-1/2 -translate-y-1/2`)
  and always reserve right padding (`pr-8`) so text never runs under the icon.
- Accessible: `aria-label`/`title` from `common.clear` (fallback to a new
  `common.clearSearch`).

### B. Reusable clearable search input (plain filters)

Files: `frontend/app/components/ListFilters.tsx` (extend `SearchField`),
new `frontend/app/components/ClearableInput.tsx` (if a standalone is cleaner).

- Add the X to `SearchField` (used by `FilterPanel`/list filter panels): render
  when `value !== ""`, click → `onChange("")` + refocus, `stopPropagation`.
- Provide a `ClearableInput` for the 13 inline `<input value={search}>` sites so
  they can adopt the same control without bespoke markup. Migrate these:
  - products, customers, credits (+`[id]`), manufacturing (boms, catalog, jobs,
    production, purchasing, receipts), service/clients, purchases,
    `PriceListModal`, `FacilityDashboard`.
- These are filter boxes (no dropdown), so the X only needs to empty the query
  and refocus — no dropdown reset.

### C. Behaviour details (both families)

- **Option B visibility:** show the X when the field has text **or** a selected
  value (for `SearchableSelect`); for plain inputs, when `value !== ""`.
- On click: `stopPropagation` + `preventDefault`, clear the text **and** the
  selection, refocus, and keep/reset the option list (`SearchableSelect` sets
  `open` true and clears the filter so all options return).
- Keyboard: keep `tabIndex={-1}` so the X isn't a tab stop that steals focus;
  `Enter` in the input continues to work.

### D. i18n

Add `common.clearSearch` ("Clear search") to `frontend/lib/locales/en/common.json`
and `am/common.json` (fall back to the existing `common.clear` if present).

### E. Verification

- Frontend: `tsc --noEmit`; `next build --webpack`.
- Manual matrix:
  - Shop/Vendor/Product/Customer autocompletes: X appears only after typing,
    clears the text, refocuses, full list returns, no item selected/closing.
  - Plain filter boxes (products, customers, credits, manufacturing): X clears
    and refocuses.
  - `clearable` call sites (purchases vendor filter, StockProductSheet) now get
    the same behaviour by default.
  - RTL/mobile: X stays inside the field, text doesn't overlap.

## Risks / notes

- `SearchableSelect` is used in 22 places; the X now appears for **any** typed
  text or selected value in all of them (per Option B). Verify no dropdown layout
  depends on the previous lack of an X (they don't — the field only gains right
  padding when the X can show).
- Clearing now also **releases the selected value** (`onChange("")`), which is the
  requested Option B behaviour; callers that previously relied on `clearable`
  keeping the value should be re-checked (only the purchases vendor filter and
  StockProductSheet use `clearable` — both are filters where clearing to "none"
  is correct).
- Use `lucide-react`'s `X` (already a dependency) — no new package.
- No backend changes; purely frontend UI/UX.

---

## Implementation summary (delivered)

**`SearchableSelect` (autocomplete dropdowns)** — `frontend/app/components/SearchableSelect.tsx`:
- X always shows (Option B) when `query.trim() !== "" || value !== ""`.
- Uses Lucide `X`; `onMouseDown`/`onClick` both `preventDefault` +
  `stopPropagation`.
- `clearField()` clears the query **and** releases the selection (`onChange("")`),
  calls `onInputChange?.("")`, keeps the dropdown open (full list returns), and
  refocuses the input.
- `clearable` retained as an accepted (now non-gating) prop for compatibility.

**New `ClearableInput`** — `frontend/app/components/ClearableInput.tsx`: a plain
search input with the same inline X (text-only clear + refocus), used by every
list search box. Supports `onKeyDown`, `label`, custom class names.

**Migrated to `ClearableInput`** (inline plain search boxes):
- `ListFilters.SearchField` (so every `FilterPanel` search gets the X) and
  `FilterBar` search.
- products, customers, credits (+ `[id]` product search), purchases,
  service/clients, finance/ledger, food/menu (×2), hospitality/memberships,
  manufacturing (boms, catalog, jobs, production, purchasing, receipts),
  `PriceListModal`, `FacilityDashboard`, `FoodServicePanel` (×2).

**i18n:** reuses existing `common.clear` / `common.clearField`; no new keys.

**Verification:** frontend `tsc --noEmit` clean; `next build --webpack` compiles.
