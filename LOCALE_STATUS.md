# Multi-Tenant Amharic (አማርኛ) Localization — Status Ledger

Cross-cutting i18n foundation + partial module coverage. Everything below type-checks
(`npx tsc --noEmit` green in both apps). Three gate scripts measure what is left — see
section 0.

## 0. Amharic sweep baseline (Phase 0, measured)

| Gate | Command | Baseline |
| --- | --- | --- |
| Catalog | `cd frontend && node scripts/i18n-check.mjs` | **all gates clean** — parity 3339/3339 ✓, no identical-value misses, 0 glossary violations |
| Frontend UI | `cd frontend && node scripts/i18n-audit.mjs [--list --file X --strict]` | 178 files scanned, 42 dirty, 614 hardcoded strings |
| Backend messages | `cd inventory-backend && node scripts/i18n-audit.mjs [--list --strict]` | 667 `throw` sites, 239 localized, 428 remaining (398 static + 30 interpolated) |

- `docs/i18n-glossary.md` is the single source of truth for terminology; `i18n-check.mjs`
  parses its table and fails on an avoided variant.
- **Placeholder bug fixed (sweep-wide).** 12 catalog keys used single-brace placeholders
  (`"Room {number}"`, `"{count} orders"`, `"Only {n} left of {variant}"`, `"Export {label} CSV"`,
  `hotel.idTypesMovedHint`, …). react-i18next only interpolates `{{ }}`, so every call site
  rendered the token literally. All 12 now use double braces (24 values, en + am); a scanner
  confirms no single-brace token is left anywhere in either catalog.
- **Scanner recalibration (`app/components` batch).** `i18n-audit.mjs` no longer reads
  (a) continuation lines of a multi-line `import { … } from "…"` list, or (b) runs of CSS
  utility classes (`"px-3 rounded-lg text-sm"`, colour-token arrays) as prose. Verified by
  diffing the whole-repo hit list before/after: all 40 removed strings are import identifiers
  or class lists, no real prose lost. Repo total 860 → 804 at that point.
- **`i18n-check.mjs` gained `ALLOW_IDENTICAL_PREFIX`** — a whole subtree can stay Latin behind
  one documented reason (`fiscal.receipt.*`: the thermal preview mirrors the MoR / Antica fiscal
  device template, whose labels live in the printer firmware — translating them would desync the
  preview from the paper it reproduces and overflow the fixed 300px receipt width). Prefix
  children are reported as stale the moment one is translated, so Phase 5 cannot silently
  forget them.
- Phase 0 corrected 308 catalog values in two passes — terminology (133): Location
  አካባቢ→ቦታ (20), Variant አይነት/ልዩነት/ቫሪያንት→ተለዋጭ (60), Unit ክፍል→አሃድ (13), COGS→የሸቀጦች ወጪ (7),
  Total ድምር→ጠቅላላ (4), Invoice ኢንቮይስ→ደረሰኝ (3), Business ቢዝነስ→ንግድ (1), Take-away→ያዙና ሂዱ (1);
  register + destructive wording (175), per the decision recorded in the glossary — polite
  plural imperative everywhere, and Delete (ያጥፉ) separated from Cancel (ይሰርዙ).
- Audit counts are heuristic and deliberately over-report; `// i18n-ignore` silences a
  known-good line. The previous ledger figure (~1017 hits) came from a wider-net matcher
  that counted arrow functions and JSX tags, so it is not comparable.
- The frontend scanner gained a real JSX-text pass (`jtext`): inline `>text<` segments plus
  multi-line prose continuation, with guards that keep code out (statement keywords, `foo(`
  call syntax, lines after `(`/`{`/`,`/`=>`/`=`, JSDoc/block comments, `? …`/`"…"` ternary
  arms). Re-measured on unchanged code it lifted the count 1091 → 1459 (368 genuinely
  localizable prose lines the older matcher never saw), so 1459 is the recalibrated
  pre-batch baseline; the sweep below is measured against it, not the old 1091.
- `i18n-check.mjs` gained two allowlist entries for the catalogue: `mfg.catalog.skuLabel`
  ("SKU") and `mfg.catalog.mediaPlaceholder` (a placeholder URL) — both stay Latin on purpose.
- Open: imperative register (77 values) and Delete-vs-Cancel wording — see the glossary.

## 1. Architecture (working)

### Frontend (`frontend/`)
| Piece | Where |
| --- | --- |
| `react-i18next` / `i18next` installed, catalogs bundled | `lib/i18n.ts` (static `en` + `am`) |
| Language state + resolution (tenant → user → device → browser) | `context/LanguageContext.tsx` |
| Per-user/device/tenant persistence | `ui.locale` + `ui.locale.tenant.<orgId>` (localStorage) + `PUT /auth/profile {preferredLanguage}` |
| `<html lang>` + module-level locale cache | `lib/locale.ts` (`setActiveLocale` / `getActiveLocale`) |
| API locale headers (`x-locale`, `Accept-Language`) | `lib/api.ts` request interceptor |
| Top-bar switcher 🇪🇹/🇬🇧 | `app/components/LanguageSwitcher.tsx` (mounted in dashboard header, login, signup) |
| Enum/status label helper | `lib/statusLabel.ts` (`statusLabel("PARTIALLY_APPROVED")` → `በከፊል ጸድቋል`) |
| Amharic font stack | `app/globals.css` (Noto Sans Ethiopic, Nyala, …) |

### Formatting (Phase 3 core)
- `lib/currency.ts` → `fmtCurrency`/`fmtNumber`: Amharic = **Western digits + `ብር`** (`1,234.00 ብር`);
  English keeps the configured `ETB`/`Br` prefix with thousands separators.
- `lib/datetime.ts` → `formatDate`/`formatDateTime`/`timeAgo`/`formatWeekdayDate`/`weekdayShort`:
  - `en` = Gregorian (unchanged style);
  - `am` = **Ethiopian calendar with native month names** (`ሰኔ 21, 2018 …`) with Western digits,
    matching the approved "Amharic month/day names" example; storage/filters stay Gregorian.
  - Calendar choice is centralized in `amFormatter()` (swap `calendar: "ethiopic"` ↔ `"gregory"` in one place).

### Backend (`inventory-backend/`)
| Piece | Where |
| --- | --- |
| Locale AsyncLocalStorage + middleware (guards can translate) | `src/i18n/i18n.context.ts`, `i18n.middleware.ts`, registered in `main.ts` |
| Dictionaries `en`/`am` + `tr()` helper | `src/i18n/backend.en.ts`, `backend.am.ts`, `i18n.service.ts` |
| Global module | `src/i18n/i18n.module.ts` (+ `AppModule`) |
| Localized JSON column resolution (server-side) | `src/i18n/localized.util.ts` (`pickLocalized`/`mergeLocalized`) |
| Auto-localize every API response carrying `nameI18n`/… | `src/common/interceptors/localized-response.interceptor.ts` (registered as APP_INTERCEPTOR) |
| Tenant `defaultLanguage` + user `preferredLanguage` | Prisma `Organization`/`User` + migration `prisma/migrations/20260902000000_i18n_languages/` |
| Payload plumbing (`/auth/me`, login/signup, memberships, tenants list/get/create) | `common/user-payload.util.ts`, `jwt-payload.interface.ts`, `auth.service.ts`, `tenants.service.ts` + DTOs |

### Database localization (Phase 2 — schema added, responses auto-resolved)
`nameI18n`/`descriptionI18n` (and `brandI18n`, `baseNameI18n`, `roleNameI18n`) JSON `{en,am}`
columns added to: `Category`, `Product`, `Unit`, `Location`, `PaymentMethod`,
`RestaurantStation`, `MenuCategory`, `MenuItem`.
New hospitality orgs seed Amharic stations (ኩሽና/ባር/ባሪስታ), menu categories, and goods
categories automatically (`tenants.service.ts`, `common/verticals.ts`).

## 2. String coverage status

**Fully localized (verified by tsc + visual scan):**
- Auth shell: login, signup (all fields/banners/errors), home loading, language switcher.
- Dashboard shell: sidebar/nav (all verticals), header, agent pill, AI Coach, notifications bell/toasts.
- Shared primitives: `Loading`, `ConfirmProvider`, `Modal` consumers, API error fallbacks
  (`errors.*` catalog).
- Notification component chrome + relative time.
- Module pages: **Profile**, **Price History**, **Manage Locations**, **Quick Purchases**,
  **Chart of Accounts**, **Products** (list, variants, adjust-stock, QR printing, delete flows),
  **Restock/Purchasing** (owner+staff flows, variant & batch/expiry forms),
  **Credits** (customer list + customer detail: grouped sales, payment history, record/edit/delete payment),
  **Sales** (full POS: cart builder, sale types, payments, returns, view/delete-return/settle modals, fiscal batch print),
  **Requests** (full stock-request lifecycle: list/filters, manage modal with approvals/dispatch/store/receive + captions, create-request form, confirm-receipt-&-sell),
  **Food / Menu** (stations + route builder, menu categories, item CRUD w/ SIMPLE/BENCHMARK/PERPETUAL tracking,
  recipe/ingredient costing + quick ingredient + unit creation, item options, availability, ingredient quick-create),
  **Orders / FoodServicePanel** (take-order menu+cart, tables management, live/history order list with filters,
  per-order actions: serve/settle/details-timeline/cancel/delete, multi-order settle modal w/ VAT breakdown,
  fiscal batch printing, order detail modal, mobile sticky bar),
  **Station boards** (`StationBoard`: Kitchen/Bar/Barista/… dynamic boards w/ status advance, multi-hop handoff),
  **Orders wrapper page** + dynamic `/food/station/[key]`,
  **Cashier** (pending payment confirmations w/ waiter + date filters, consolidated fiscal batch printing,
  summary cards + by collector/payment method/station, floats, cash collections),
  **Hotel / Room Service** (room types + rooms w/ status control, reservations + check-in/check-out,
  guest folio charges/payments, all CRUD modals),
  **Taxes** (company tax settings + VAT/TIN, MoR E-Invoicing + fiscal printer/agent registration incl.
  certificate upload, tax-rate CRUD w/ direction/default/enabled badges and modal),
  **Accounts** (chart-of-accounts list, type filter, CRUD modal; previously missing
  `common.all`/`common.delete` + two placeholder keys added),
  **Reports page** (retail + hospitality tab sets, date/location filters, inventory-breakdown table w/
  variant expansion, low-stock + quick stock request modal, dead-stock, staff activity, audit trail,
  CSV/PDF export buttons).
  Generic verbs shared via new `common.*` catalog group (loading/cancel/save/edit/del/add/search);
  vertical terminology (`getVerticalTerminology`) is now locale-aware via `terms.hosp.*`/`terms.svc.*`.

**Foundation only (helper exists, sweep still required):**
- Remaining module pages (see audit output): Businesses/Verification
  (owner + admin incl. admin Businesses/Owners/Verification), AI Coach/Agent drawer leftovers.
  Roles and Users pages converted (`roles.*`/`users.*` catalog groups).
- Shared component sweep: **complete** — **`app/components/**` audits 0 hits across all 60 files.**
  This batch wired the primitives (`FilterRow`, `SearchableSelect` incl. a localized default
  placeholder/clear tooltip, `LanguageSwitcher` via `language.switchTo*`, `ActivityAuditReport`,
  `AiPhotoPicker`), the shared forms/tiles (`CustomerForm`, `ServiceDashboard`), the
  hospitality/service panels (`FoodServicePanel` billing modes + settlement notes,
  `DualExpenseModal` category creation), the fiscal print pair (`FiscalPrintButton` +
  `FiscalPrintPreviewModal` chrome — receipt body deliberately Latin, see `fiscal.receipt.*`),
  the AI surfaces (`AiSmartFeatures`, `AiCoachDrawer`) and the two big hospitality panels
  (`FoliosPanel` 49 hits, `FacilityDashboard` 44 hits). New catalog groups: `svc.*`, `fiscal.*`,
  `folios.*`, `facility.*`, `ai.*`, `coach.*`, plus `common.roomOrGuestPh`/`common.noResults`/
  `common.saveCustomer`/`common.updateCustomer`, `orders.billing*`/`orders.*Note`/`orders.noPackageGuest`,
  `de.newCatNamePh`/`de.newCategoryLink`/`de.categoryCreated`, `scan.ai*`. Amounts render through
  `orders.birr` (ETB → ብር), dates through `formatDateTime()`, and the `FacilityDashboard`/`FoliosPanel`
  locals that shadowed the translation function were renamed (`const t = …` → `pass`/`row`).
  Known limitation: AI answers, risk levels and liquidity descriptions are model output
  (`/ai/cashflow|pricing|churn`) and stay English until the backend prompts are localized;
  only the deterministic PO-draft status is mapped (`ai.statusDraft|statusSubmitted`).
- Shared primitives done so far: all report components — `ProfitLossSummary`,
  `ItemizedPerformanceTable`, `FinanceComparison`, `FinancialBreakdown`, `SalesReport`,
  `HospitalityReport`, `HospitalityInventoryReport`, `ActivityAuditReport` — plus `FilterBar`,
  `DateFilter`, `FilterPanel`, `RowActionsMenu`, `CategoriesManager`, `ProductDetailModal`,
  `CreditSaleForm`, `ProductForm`, `DualExpenseModal`; new catalog groups `filters.*`, `fin.*`,
  `sr.*`, `hr.*`, `hinv.*`, `act.*`, `cat.*`, `cs.*`, `pdm.*`, `pf.*`, `de.*`, `reports.pl*`,
  `bd*` keys, `common.actions`.
  Amounts in reports now follow the active locale currency (`orders.birr`), and hospitality
  status/role tokens are localized via `orders.st.*`/`act.role*`.
- **Finance** (latest batch): the tabbed dashboard (Overview/Breakdown/Comparison/Expenses/
  Income/Itemized tabs, P&L + vertical cards, expense & income ledgers, income-category form),
  the **Account Mappings** settings page, and the **General Ledger** page — its `ledger.*` group now
  covers the journal-entry modal, the journal table (expandable lines, filters, pagination, footer
  totals), trial balance, per-account ledger and the coverage/posting-health cards, plus the
  CSV/print exports. `fin.*` gained the dashboard/mapping keys, and the module-level label maps
  (`SOURCE_KEYS`, `MODULE_OPTIONS`, `STATUS_OPTIONS`) now hold catalog keys resolved through
  `t()`/`i18n.t()` instead of literals. `app/dashboard/finance/**` audits **0 hits**.
- **Manufacturing** (done): the `mfg.*` catalog now carries `mfg.common` (shared verbs:
  save/cancel/edit/delete/remove/updated/updateFailed/activate/deactivate/noneYet/optional) plus
  the screens wired so far — `mfg.machines`, `mfg.workers`, `mfg.teams`, `mfg.shifts`,
  `mfg.production` (work-order completion + COGM estimate), `mfg.materials` (issue/return),
  `mfg.flows` (process builder), `mfg.catalog` (design catalog + categories), `mfg.receipts`
  (GRN + receive modal), `mfg.rejected` (quarantine panel), `mfg.vendors` (list + form modal),
  `mfg.backorders`, `mfg.purchasing` (PO list/create/detail), `mfg.bills` (vendor bills / AP),
  `mfg.directBuy` and `mfg.orders` (the pipeline board) — alongside the already-wired
  `mfg.boms`, `mfg.workOrders`, `mfg.settings`, `mfg.jobs`, `mfg.services`. Enum label maps
  (`MSTATUS_KEY`, `DISPOSITION_KEY`, `STATUS_KEY` for PO and vendor-bill status) hold catalog keys
  resolved via `t()`, statuses render through `statusLabel()`, and weekday/receipt/expiry/due dates
  go through `weekdayShort()`/`formatWeekdayDate()`/`formatDate()`/`formatDateTime()` so they follow
  the active language (Amharic = `am-ET` short weekday names, Ethiopian calendar). `window.confirm`
  in the catalog now uses the shared `useConfirm` dialog. `app/dashboard/manufacturing/**` audits
  **0 hits across all 21 files**, and `status.purchasingMaterials` was corrected
  (አጭር ቁሳቁሶችን መግዛት → ቁሳቁሶችን መግዛት).
- Fiscal print preview & PDF exports (Ethiopic font work): the preview/button chrome is localized
  and the receipt body is pinned Latin in `i18n-check.mjs` (`fiscal.receipt.*`) until the Ethiopic
  font work lands.
- Forms gaining **optional Amharic name fields** (write `nameI18n.am`, backend DTO `IsObject`
  + `mergeLocalized`) — DTOs not yet extended for every entity.
- Backend exception/validation messages: translator + dictionaries exist and `auth`/`tenants`
  throws are converted. Phase B progress: `requests` (48 new `errors.req*` keys) and
  `restaurant` (7 new `errors.res*` keys) fully converted to `tr('errors.*')`; build green.
- **API-error boundary localization added**: `LocalizedExceptionFilter` (global, registered in
  main.ts) reverse-maps any English error message found in the `errors.*` catalog into the
  request locale at the HTTP edge — covering guards, class-validator/DTO message arrays and
  still-unconverted service throws automatically once their literal is cataloged. Localized
  `{ statusCode, message }` responses; build green.
  Remaining cataloging by module (~205 HTTP-exception sites; sales 18, verification 18,
  hotel 17, fiscal 17, admin 17, restock 15, service 13, manufacturing 11, finance 10,
  purchases 8, users 8, controllers/guards ~12, plus ai/agent/taxes/inventory/cash/etc.).
- Notifications/push/audit: content still created in English at write time. Recommended next
  step: store `templateKey`+`params` and hydrate per viewer language; until then the FE shows
  the stored text.

## 3. How to run

```bash
# Backend: apply schema (or prisma migrate deploy for prod), then build
cd inventory-backend && npx prisma db push && npm run build

# Frontend
cd frontend && npm install && npm run dev   # http://localhost:3001
```

Language: use the 🇪🇹/🇬🇧 pill in the top-right of the dashboard (and on login/signup).

## 4. Immediate next steps (recommended order)
1. Convert remaining FE pages module-by-module using `useTranslation` + the audit script as gate.
2. Add Amharic input fields to product/menu/category/unit/location/payment DTOs + forms.
3. Convert remaining backend throw sites → `tr()` keys; add validation-message localization.
4. Notification template-key refactor + push/audit localization.
5. Receipt/PDF: embed Noto Sans Ethiopic in the pdfkit export, then unpin `fiscal.receipt.*`
   and the `products.priceList.*`/`products.qrSheet.*` allowlist entries (the gate reports them
   stale automatically once translated).
