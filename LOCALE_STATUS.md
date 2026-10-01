# Multi-Tenant Amharic (አማርኛ) Localization — Status Ledger

Cross-cutting i18n foundation + partial module coverage. Everything below type-checks
(`npx tsc --noEmit` green in both apps). Three gate scripts measure what is left — see
section 0.

## 0. Amharic sweep baseline (Phase 0, measured)

| Gate | Command | Baseline |
| --- | --- | --- |
| Catalog (frontend) | `cd frontend && node scripts/i18n-check.mjs` | **all gates clean** — parity 3778/3778 ✓, no identical-value misses, 0 glossary violations |
| Catalog (backend) | `cd inventory-backend && node scripts/i18n-check.mjs` | **all gates clean** — parity 218/218 ✓, no identical-value misses, 0 glossary violations |
| Frontend UI | `cd frontend && node scripts/i18n-audit.mjs [--list --file X --strict]` | **178 files scanned, 0 dirty, 0 hits** |
| Backend messages | `cd inventory-backend && node scripts/i18n-audit.mjs [--list --strict]` | 667 `throw` sites, 424 localized, 243 remaining (243 static + **0 interpolated**) |

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
  **Hospitality** (all 9 files under `app/dashboard/hospitality/**` — see the batch note below),
  **Service vertical** (overview, catalog, tickets, bookings, clients, settings — see below),
  **Accounts** (chart-of-accounts list, type filter, CRUD modal; previously missing
  `common.all`/`common.delete` + two placeholder keys added),
  **Reports page** (retail + hospitality tab sets, date/location filters, inventory-breakdown table w/
  variant expansion, low-stock + quick stock request modal, dead-stock, staff activity, audit trail,
  CSV/PDF export buttons).
  Generic verbs shared via new `common.*` catalog group (loading/cancel/save/edit/del/add/search);
  vertical terminology (`getVerticalTerminology`) is now locale-aware via `terms.hosp.*`/`terms.svc.*`.

**Foundation only (helper exists, sweep still required):**
- Remaining module pages (see audit output): platform **Admin** (shell + overview done — `adm.*`
  group; `businesses` 51, `verification` 45, `owners` 29 hits remain), Businesses/Verification
  (owner side), AI Agent drawers and the platform **Settings** pages. Roles and Users pages
  converted (`roles.*`/`users.*` groups).
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
- **Hospitality** (done): `app/dashboard/hospitality/**` audits **0 hits across all 9 files**
  (129 hits at the start of the batch). New `hospitality.*` catalog group with three subtrees —
  `hospitality.types.*` (pass plans), `hospitality.mem.*` (customer memberships) and
  `hospitality.pkg.*` (packages & entitlements) — deliberately kept apart from the pre-existing
  `terms.hosp.*` terminology group. Reused shared keys wherever the English matched exactly
  (`facility.checkInMember|searchMembersPh|searching|checkIn|checkingIn|noActiveMembers|
  sellDayPassTitle|selectDayPass|paymentMethodPh|sellAndCheckIn|endsOn`,
  `hotel.guestName|phoneOptional|checkinStepRoom`, `orders.birr|allStatuses`, `menu.assign`,
  `hotel.guestName`, `fin.colCredit` for the CREDIT entitlement, `common.*` verbs, `filters.search`).
  Membership statuses render through a `STATUS_LABELS` enum→key map resolved via `t()`
  (`status.active|cancelled` reused, generic `status.expired|suspended` added to the shared
  `status` group); the reservation picker maps `CONFIRMED|CHECKED_IN` to
  `status.confirmed|checkedIn` via `RES_STATUS_LABELS`. Amounts now go through `orders.birr`
  (ETB → ብር) including the entitlement suffixes (`hospitality.pkg.perUnit|perDay`) and the
  compensation-preview sentence (`hospitality.pkg.previewItem`), the un-audited template-literal
  `confirm(\`Delete pass "${name}"?\`)` / `confirm(\`Cancel membership for "${name}"?\`)` strings
  were localized (the former on the memberships/types page), `t` shadowing in
  `.map((t) =>`/`types.find((t) =>` locals was renamed to `tp`, and `t` was added to the
  `load` `useCallback` dependency arrays. Known gap (tracked for the `lib` batch): the static
  facility names returned by `hospitalityServiceName()`/`HOSPITALITY_SERVICE_LABELS`
  (`lib/verticals.ts`) are still English — they are catalogued under `hospitalityServices.*`
  with `i18nKey === serviceType`, so making that helper `t`-aware localizes every call site at once.
  Repo totals after this batch: **476 hits / 37 dirty files** (from 614 / 42 at the Phase-0
  measurement), catalog **3434 en / 3434 am keys, all gates clean**.
- **Service vertical** (done): `app/dashboard/service/**` audits **0 hits across all 6 files**
  (70 hits at the start of the batch). The already-existing `svc.*` group (dashboard tiles from the
  `app/components` sweep) grew four subtrees — `svc.cat.*` (service catalog + category modal),
  `svc.tk.*` (tickets), `svc.bk.*` (bookings/appointments) and `svc.set.*` (settings) — plus
  `svc.title`/`svc.noClient`. Both list pages now render statuses through the shared
  `statusLabel()` helper (`lib/statusLabel.ts`, `status.open|inProgress|paid|cancelled|confirmed|
  completed`, with a generic `status.noShow` added to the `status` group for the booking
  no-show action) instead of printing raw enums, booking times go through `formatDateTime()`
  (locale-aware) instead of `toLocaleString()`, durations through `svc.cat.mins`
  (`{{value}} min` / `{{value}} ደቂቃ`). Vertical terminology keys were used for column headers
  that change per business type (`terms.svc.customer` → Client, `terms.svc.service`,
  `terms.svc.orders` → Tickets), and shared keys cover the rest (`common.*` verbs,
  `filters.category`, `menu.newCategory|categoryName`, `pdm.noCategory`,
  `mfg.settings.save`, `mfg.common.activate|deactivate`, `mfg.services.noServices`,
  `act.colItems`, `hotel.guestName`, `nav.serviceClients`,
  `hospitality.duration|servicePh`, `facility.searchMembersPh`). The `tickets` page map param
  that shadowed `t` was renamed to `ticket`, and `t` was added to the `load` `useCallback` deps.
  Repo totals after this batch: **406 hits / 31 dirty files**, catalog
  **3476 en / 3476 am keys, all gates clean** (`tsc --noEmit` green).
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
- **Long tail + first backend batch (latest)**: the frontend sweep is **complete** —
  `node scripts/i18n-audit.mjs` reports **178 files scanned, 0 dirty, 0 hits**. This batch
  covered the remaining pooled pages: `app/dashboard/agent` (29 → 0, new `agent.*` keys incl.
  `agent.action.*`/`agent.status.*` enum maps resolved through `actionLabel()`/`statusText()`
  with a de-underscored raw fallback), `app/dashboard/verification` (20 → 0, new `verification.*`
  group; `DOC_LABELS` now holds catalog keys and `StatusBadge` renders `statusLabel(status)`
  instead of the raw enum), `app/dashboard/forecast` (19 → 0, new `forecast.*` group with the
  report-language endonyms allowlisted in the audit script), `app/dashboard/page.tsx` (14 → 0,
  new `home.*` group), `app/dashboard/payment-methods` (17 → 0, new `paymentMethods.*` group —
  the page had no i18n at all), `food/menu`, `cashier`, `roles`, `users`, `taxes` and the
  restaurant redirect (new `common.redirecting`). Long-lived correctness fixes found on the way:
  `app/layout.tsx` + `app/manifest.ts` keep the product name/description in the default language
  (the `<head>`/manifest resolve before the client locale exists; documented with `i18n-ignore`),
  the service-worker push fallback became bilingual, and the two remaining raw
  `VERTICAL_LABELS[...]` renders (`admin/page.tsx`, `verification/page.tsx`) were switched to
  `verticalLabel()` — the map holds catalog keys now, so those printed `verticals.retail`.
  The `verticalName()` helpers in `admin/businesses` + `admin/verification` no longer fall back
  to a catalog key either (`defaultValue: type`). Backend (first batch): all **30 interpolated
  throw sites** converted to `tr('errors.*', {...})` — the `LocalizedExceptionFilter` can only
  reverse-map exact English text, so dynamic messages had to move to keys — covering ai-usage,
  credit-payments, customers, finance, fiscal, hotel (checkout/overpayment/booking clash),
  inventory, manufacturing, packages, payment-methods, products, restock, sales and service.
  `inventory-backend/scripts/i18n-check.mjs` is new: it mirrors the frontend gate (parity,
  identical-value, glossary — same `docs/i18n-glossary.md`) and its first run caught three
  `Location` values still using the avoided `አካባቢ` (now `ቦታ`). The **shared-modules batch**
  followed the same pattern for the static sites the filter can already reverse-map once
  cataloged: `auth`, `users` (system-owner guards, last-owner protection, own-account/status
  guards), `roles`, `taxes`, `cash`, `categories`, `locations`, `price-history`,
  `vertical-profiles`, `push`, `notifications`, `customers` and the cross-cutting guards/utils
  (`csrf`, `tenant`, `vertical`, `verification`, `jwt.strategy`, `tenant.context`) — reusing the
  existing `errors.*` keys wherever the English matched exactly. `assertNotDuplicate()` now takes
  a **catalog key** (default `errors.recordExists`) and translates inside, so its six call sites
  (purchases/sales ×2/service ×2/restaurant) localize the 409 text too. A **catalog-first
  rewrite pass** then converted every static throw whose exact English text is already in the
  catalog — 105 sites across 23 files (admin, verification, hotel, fiscal, finance, products,
  sales, restock, manufacturing, memberships, facilities, packages, tenants, credit-sales,
  restaurant, menu-recipe, inventory, hotel.controller ...) — plus the 21 platform-admin /
  verification keys that pass needed. The rewrite is mechanical and repeatable: the throw's
  literal is looked up in the en catalog and replaced with `tr('errors.<key>')`, so the way to
  finish the backend is *catalog the literals, then re-run the rewrite*. Backend audit after
  three batches: **667 throw sites, 424 localized, 243 remaining (0 interpolated)**.
  ⚠️ `npm run lint` runs `eslint --fix` repo-wide and rewrote 139 files (and, via
  `no-unnecessary-type-assertion`, removed casts the build needs) — use `npx eslint` without
  `--fix` (or `tsc -p tsconfig.build.json` + `jest`) as the gate instead.
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
1. ~~Convert remaining FE pages module-by-module~~ — **done**: `scripts/i18n-audit.mjs` is clean
   across all 178 frontend files. Keep it green (`--strict` in CI) and re-run `i18n-check.mjs`
   after every catalog edit.
2. Catalog + convert the remaining **243 static** backend throws, module by module
   (manufacturing 40, hotel 34, restock 18, finance 17, packages 14, products 13, sales 12,
   service 11, restaurant 11, facilities 11, ai-product 11, tenants 11, fiscal 8, admin 8,
   memberships 6, ai/gemini 10, verification 4, …). Static text is localized at the HTTP edge the
   moment its exact English value is in `backend.en.ts`/`backend.am.ts` (the
   `LocalizedExceptionFilter` reverse-maps it), so catalog first and re-run the literal → `tr()`
   rewrite in the same pass to keep the audit count moving.
3. Add Amharic input fields to product/menu/category/unit/location/payment DTOs + forms.
4. Notification template-key refactor + push/audit localization.
5. Receipt/PDF: embed Noto Sans Ethiopic in the pdfkit export, then unpin `fiscal.receipt.*`
   and the `products.priceList.*`/`products.qrSheet.*` allowlist entries (the gate reports them
   stale automatically once translated).
