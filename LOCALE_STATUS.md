# Multi-Tenant Amharic (አማርኛ) Localization — Status Ledger

Cross-cutting i18n foundation + partial module coverage. Everything below type-checks
(`npx tsc --noEmit` green in both apps). Run `cd frontend && node scripts/i18n-audit.mjs`
to re-measure remaining hardcoded strings per module (heuristic, ~1017 hits at time of writing).

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
- `lib/datetime.ts` → `formatDate`/`formatDateTime`/`timeAgo`:
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
- Remaining module pages (see audit output): Manufacturing, Businesses/Verification
  (owner + admin incl. admin Businesses/Owners/Verification), AI Coach/Agent/photo picker
  drawers. Roles and Users pages converted (`roles.*`/`users.*` catalog groups).
- Shared component sweep: **complete** — `DualExpenseModal` (1158) converted (new `de.*` catalog
  group), finishing every shared component.
- Shared primitives done so far: all report components — `ProfitLossSummary`,
  `ItemizedPerformanceTable`, `FinanceComparison`, `FinancialBreakdown`, `SalesReport`,
  `HospitalityReport`, `HospitalityInventoryReport`, `ActivityAuditReport` — plus `FilterBar`,
  `DateFilter`, `FilterPanel`, `RowActionsMenu`, `CategoriesManager`, `ProductDetailModal`,
  `CreditSaleForm`, `ProductForm`, `DualExpenseModal`; new catalog groups `filters.*`, `fin.*`,
  `sr.*`, `hr.*`, `hinv.*`, `act.*`, `cat.*`, `cs.*`, `pdm.*`, `pf.*`, `de.*`, `reports.pl*`,
  `bd*` keys, `common.actions`.
  Amounts in reports now follow the active locale currency (`orders.birr`), and hospitality
  status/role tokens are localized via `orders.st.*`/`act.role*`.
- Fiscal print preview & PDF exports (Ethiopic font work).
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
5. Receipt/PDF: localize `FiscalPrintPreviewModal` labels; embed Noto Sans Ethiopic in pdfkit export.
