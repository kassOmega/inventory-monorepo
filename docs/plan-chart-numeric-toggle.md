# Plan — Chart ⇄ Numeric view toggle on dashboard & report cards

## Goal

Add a per-card **view toggle** (top-right of each card header) that switches
between the existing chart rendering and a styled numeric/table view, using
Lucide `BarChart2` (chart) and `Table` (numeric) icons.

Targets named in the request:
- Sales Trend, Sales Distribution, Payment Methods, Top Selling Products
  (`SalesReport`),
- car wash reports (dashboard + report),
- service, hospitality, manufacturing dashboards/reports.

## Findings (verified)

### There is already a page-level toggle in `SalesReport`, not per-card
- `frontend/app/components/SalesReport.tsx` has a `view: "summary" | "charts"`
  state and a pill toggle at the **top of the page**, switching the whole report
  between a text-summary block and the chart grid. The individual cards
  ("Sales Trend", "Sales Distribution", "Payment Methods Pie", "Top Selling
  Products") have **no** per-card toggle.
- `SalesReport` already fetches everything a numeric view needs: `summary`,
  `trend` (`{date, sales, flips, collections}`), `mostSold`
  (`{name, qty, ...}`), `paymentBreakdown` (`{method, count, totalAmount}`),
  `unified`.
- The chart is used by the shared **reports page** (`reports/page.tsx` renders
  `<SalesReport .../>` for the Retail "sales" tab and for the retail dashboard
  home) and the retail dashboard.

### Charts live in these components (candidate cards)

| Component | Cards with charts |
|---|---|
| `SalesReport.tsx` | Sales Trend (Line), Sales Distribution (Pie), Payment Methods (Pie), Top Selling Products (Bar) |
| `CarWashReport.tsx` | Revenue Breakdown (Bar), Washer Earnings (Bar), Paid vs Unpaid (Pie) |
| `CarWashDashboard.tsx` | Today Income (Bar), My Commission 7-day (Bar, washer view) + stat tiles |
| `HospitalityReport.tsx` | Revenue by Station (Bar), Top Selling Items (progress bars), Payment Methods (table) |
| `ManufacturingReport.tsx` | KPI tiles + status pills + orders table (no recharts bar currently; charts live in `ManufacturingDashboard.tsx`) |
| `ManufacturingDashboard.tsx` | status/summary cards (check for chart) |
| `frontend/app/dashboard/page.tsx` | Stock Overview (horizontal Bar) |
| `HospitalityDashboard.tsx` | station breakdown / top selling (progress bars) |
| `ServiceDashboard.tsx` | (check — appears tile-based) |

### Shared building blocks available
- `recharts` (`Bar/Line/Pie`), Tailwind card styling
  (`bg-white rounded-xl shadow-sm border p-4 sm:p-6` + `<h3>` header),
  `fmtCurrency` (`@/lib/currency`), `useTranslation`.
- Lucide is a dependency (`lucide-react`), so `BarChart2`/`Table` are available.

## Design decision

- Build **one reusable card shell + toggle** so every chart card behaves the
  same instead of duplicating state/markup:

  `frontend/app/components/ChartCard.tsx`
  - Props: `title`, optional `headerExtra`, `chart: ReactNode`,
    `numeric: ReactNode`, optional `defaultView?: "chart" | "numeric"`.
  - Owns local state `view` (per-card, requirement 2).
  - Renders the card header with the title on the left and the toggle on the
    **top-right** (requirement 1), using `BarChart2` (active when chart) and
    `Table` (active when numeric).
  - Body renders `view === "chart" ? chart : numeric`.
  - Keeps the existing card wrapper classes so the look is unchanged.

- Add small **numeric-view helpers** (in the same file or
  `components/report/`):
  - `NumericTable({ columns, rows, totals })` — compact table with a totals row
    and optional share % column (requirement 3).
  - `StatGrid({ items })` — metric stat cards (`{label, value, sub?}`) for trend
    / payment breakdowns (requirement 3).

- **Card-specific numeric content:**
  - **Sales Distribution** (pie of `mostSold`) → table: Product, Qty, Share %,
    (revenue if available) + totals row.
  - **Top Selling Products** (bar) → same compact table, sorted desc, totals.
  - **Payment Methods** (pie) → metric stat cards per method (count + total +
    share %) or a small table with totals (matches the existing summary table).
  - **Sales Trend** (line) → totals/stat cards (total sales, quick purchases,
    collections, avg/day, peak day) + a compact per-date table.
  - **Car wash** Revenue Breakdown / Washer Earnings / Paid-vs-Unpaid →
    tables/stat cards with totals + shares.
  - **Hospitality** Revenue by Station / Top Items → tables with totals.
  - **Manufacturing** KPI/summary → numeric table/stat cards where a chart
    exists (or a totals table for the dashboard cards).
  - **Retail dashboard Stock Overview** (bar) → numeric table (product, qty,
    value) with totals.
  - **Service** → numeric tables/stat cards for any chart cards.

- Keep the existing **page-level** toggle in `SalesReport` working; the new
  per-card toggles are additive. (Optionally retire the page-level toggle later,
  but not required.)

## Work plan

1. **Create `ChartCard.tsx`** (`frontend/app/components/ChartCard.tsx`):
   header + right-aligned `BarChart2`/`Table` icon toggle + local `view` state +
   chart/numeric slots. Export `NumericTable` and `StatGrid` helpers.
2. **`SalesReport.tsx`**: wrap each of the four cards in `ChartCard` with the
   appropriate numeric view:
   - Sales Trend → `StatGrid` + per-date `NumericTable`.
   - Sales Distribution → `NumericTable` (qty + share %).
   - Payment Methods → `StatGrid` (or `NumericTable` with totals).
   - Top Selling Products → `NumericTable` (qty + share % + totals).
   - Reuse the existing fetched data; no API changes.
3. **`CarWashReport.tsx`** and **`CarWashDashboard.tsx`**: wrap the chart cards
   in `ChartCard` with numeric tables/stat cards.
4. **`HospitalityReport.tsx`**, **`HospitalityDashboard.tsx`**,
   **`ManufacturingReport.tsx`**, **`ManufacturingDashboard.tsx`**,
   **`ServiceDashboard.tsx`**: wrap chart cards similarly.
5. **`frontend/app/dashboard/page.tsx`** Stock Overview bar → `ChartCard` with a
   numeric table.
6. **i18n**: add `common.chartView` / `common.tableView` (or `reports.*`) labels
   for the toggle tooltips/aria-labels to `en` + `am`. Reuse existing metric
   labels where possible.
7. **Verify**: `tsc --noEmit`, `next build --webpack`, and a manual pass on each
   card (toggle switches, numeric view shows totals/shares, chart unchanged).

## Risks / notes

- The components are used in more than one place (`SalesReport` in the reports
  page **and** the dashboard home; `CarWashReport` in the shared reports page and
  the carwash reports page). The per-card toggle is local state, so each instance
  is independent — no shared-state bugs.
- Keep the existing card wrappers/classes so spacing and theme don't shift; the
  toggle only adds two icon buttons in the header.
- `SalesReport`'s existing page-level `summary/charts` toggle overlaps the new
  numeric views. Decide: keep both (chart cards each get their toggle; the
  page-level "Summary" stays as-is) — recommended to avoid a larger refactor.
- No API changes: all numeric views derive from data already fetched by each
  component (recharts `data` arrays + summary objects).
- Mobile: the header toggle must not wrap; place it with
  `flex items-center justify-between` and keep icons small (`size={16}`).

---

## Implementation summary (delivered)

**New shared components**
- `frontend/app/components/ChartCard.tsx` — card header with a top-right
  `BarChart2`/`Table` toggle and local per-card `view` state; `chart`/`numeric`
  slots. Exports `NumericTable` (columns/rows/optional totals + share % column)
  and `StatGrid` (metric stat cards).
- i18n: `common.chartView`, `common.tableView`, `common.share`, `common.total`
  (+ the `sr/hr/hdb/home/fin` keys the numeric views need) in en + am.

**Cards wrapped with ChartCard**
- `SalesReport.tsx`: Sales Trend (stat cards + per-date table), Sales
  Distribution (qty + share % + totals), Payment Methods (table + totals +
  share), Top Selling Products (table + share + totals). The existing page-level
  Summary/Charts toggle is kept.
- `CarWashReport.tsx`: Revenue Breakdown, Washer Earnings, Paid-vs-Unpaid.
- `CarWashDashboard.tsx`: Today Income, My Commission (7-day).
- `HospitalityReport.tsx`: Revenue by Station, Top Selling Items.
- `HospitalityDashboard.tsx`: Top Selling, Top Categories.
- `frontend/app/dashboard/page.tsx`: Stock Overview.
- `frontend/app/dashboard/carwash/collection/page.tsx`: Today Breakdown.
- `frontend/app/dashboard/carwash/washer-reports/page.tsx`: Washer Performance.
- `FinanceComparison.tsx`: Revenue vs COGS, Revenue vs Overhead, Net Profit &
  Margin.

**Left as-is (no charts to toggle)**
- `ServiceDashboard`, `ManufacturingDashboard`, `ManufacturingReport`: these are
  stat tiles / lists / tables only — no recharts — so a chart/numeric toggle
  would be meaningless. No change.
- `forecast/page.tsx`: out of the requested scope (can wrap later).

**Verification:** frontend `tsc --noEmit` clean; `next build --webpack` compiles.
Every component that renders recharts now uses `ChartCard`.
