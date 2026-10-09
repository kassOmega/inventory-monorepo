# Plan: Tenant subscriptions (pricing, receipts, AI review, enforcement)

## Goal
Give the platform a full subscription lifecycle:
- Platform admin sets **default prices per business type** and can **override per
  tenant**; supports **monthly / 3-month / 6-month / yearly** terms plus a
  **lifetime (eternal)** option.
- Admin sets the **bank accounts** clients pay into.
- Client **submits a bank receipt**; an **AI agent reviews it** (name / account /
  amount) and either **auto-extends the subscription** or **flags it to admin**.
- Near/after expiry the system **prompts renewal** (pop-ups + a submit page in
  "My Business"); **2-day grace** after expiry, then restricted.
- Admin can grant **free tenants** (no subscription, no payment).
- Polish/update the **admin pages** to manage all of this.

## What already exists (reuse, don't rebuild)
- **`Organization`** model (businessType, status, `aiTrialEndsAt`, settings).
- **`VerificationDocument`** — upload + file storage + `aiResult` + `status`,
  with `VerificationAiService` (Gemini vision) and `GeminiService.analyzeImage`.
- **Admin module/controller** (`/admin/organizations`, verification approve/reject,
  document upload) and the frontend admin pages (`admin/page`, `admin/businesses`,
  `admin/owners`, `admin/verification`).
- **"My Business"** pages (`businesses/page`, `businesses/settings`) where the
  subscription UI will live.
- **AI module** (usage, quotas) — reuse for the review calls.

## Data model (new Prisma models + fields)
- `SubscriptionPlan` (defaults per business type):
  - `businessType` (nullable → a global default), `term`
    (`MONTHLY|QUARTERLY|SEMIANNUAL|YEARLY`), `price`, `currency`, `active`.
  - Unique on `(businessType, term)`. Seeded with sensible defaults; admin edits.
- `TenantSubscription` (the live state per org):
  - `organizationId` @unique, `status`
    (`ACTIVE|GRACE|EXPIRED|PAID|FREE|LIFETIME`), `term`, `startedAt`, `expiresAt`
    (nullable for LIFETIME/FREE), `freeForever Boolean`, `autoRenew Boolean`,
    `priceOverride Float?` (per-tenant price for the term), `notes`.
- `BankAccount` (admin-managed receiving accounts): `bankName`, `accountName`,
  `accountNumber`, `branch?`, `active`, `sortOrder`, optional `businessType`.
- `SubscriptionPayment` (receipt submissions):
  - `organizationId`, `submittedById` (user), `term`, `amount`, `currency`,
    `receiptFile` fields (fileName/mime/size/path), `bankAccountId?`,
    `payerName`, `status` (`PENDING|APPROVED|REJECTED|FLAGGED`),
    `aiResult Json?`, `aiDecision`, `reviewedById?`, `reviewedAt`, `adminNote`,
    `periodStart`, `periodEnd`, `createdAt`. Index `(organizationId, createdAt)`.
- `Organization`: add `freeForever Boolean @default(false)` (or keep it on
  `TenantSubscription`), and treat `status` for gating (already `OrgStatus`).

## Backend

### 1. Subscription pricing (admin)
- `GET/PUT /admin/subscription-plans` — list/update default prices per business
  type + term (incl. creating an override row). `GET /subscriptions/plans`
  (public to a logged-in owner) returns the price grid for their business type.
- `GET/PUT /admin/organizations/:id/subscription` — read/set a tenant's
  subscription: term, per-tenant price override, `freeForever`, `LIFETIME`,
  manual expiry, notes.

### 2. Bank accounts (admin)
- `GET/POST/PATCH/DELETE /admin/bank-accounts` (CRUD + activate/order).
- `GET /subscriptions/bank-accounts` — the active accounts shown to clients
  (filtered by their business type when a type-specific account exists).

### 3. Receipt submission + AI review (client)
- `POST /subscriptions/payments` (multipart) — client uploads a receipt, picks the
  term + bank account, and enters payer name/amount.
- AI review pipeline (`SubscriptionAiService`, patterned on
  `VerificationAiService`): given the receipt image + the **expected** data
  (payer/business name, admin's account name + number, expected amount for the
  term), ask Gemini to extract and compare:
  - name match, account number match, amount ≥ expected, date plausibility,
    duplicate suspicion.
  - Result → `{ decision: 'APPROVE' | 'FLAG' | 'REJECT', confidence, extracted:
    { payerName, accountNumber, amount, bankName, date }, reasons }`.
- On `APPROVE` (high confidence, all match): create/extend the subscription —
  set `startsAt`, `expiresAt = end + term length`, `status=PAID/ACTIVE`,
  `paidAt`. Record a `SubscriptionPayment` row.
- On `FLAG`/`REJECT` (or AI unavailable): keep `PENDING`/`FLAGGED`, notify admin
  (reuse notifications), never block the client action (best-effort, like the
  audit-log rule).
- Admin endpoints: `GET /admin/subscription-payments` (queue, filterable by
  status), `POST /admin/subscription-payments/:id/approve|reject` (manual
  override → applies the same extension logic), with a note.
- **Same AI/queue for admin-set free/lifetime** (no payment, just a record).

### 4. Enforcement + reminder lifecycle
- A `SubscriptionsService.evaluate(org)` returns effective state from
  `expiresAt`: `ACTIVE` / `GRACE` (0–2 days past) / `EXPIRED` (> 2 days past),
  honoring `freeForever`/`LIFETIME`.
- Middleware/guard (extend the existing tenant guard or a new
  `SubscriptionGuard`): when `EXPIRED`, restrict mutating endpoints (or gate to a
  "renew" surface) — **grace stays fully usable** for the 2 days.
- Reminder: surface the state in `/auth/me` (or a `GET /subscriptions/me`) so the
  client sees the banner/pop-up. A scheduled job (or lazy check) marks
  expiring-soon tenants and (re)uses the notification system to remind **2 days
  before** expiry.

## Frontend

### Admin (polish + new)
- **Admin nav**: add "Subscriptions" and "Bank Accounts" entries (in
  `dashboardNavigation.ts` for `isPlatformAdmin`).
- **`/dashboard/admin/subscriptions`** (new, or a tab on admin overview):
  - Default price table: rows = business types, columns = terms
    (Monthly / 3-mo / 6-mo / Yearly) — inline editable numbers.
  - Per-tenant overrides: pick a tenant → set price override, term, `freeForever`
    / `LIFETIME`, manual expiry.
  - Payment review queue: list of `SubscriptionPayment` with AI decision +
    reasons, receipt preview, and Approve / Reject (with note). Reuses the
    verification-page preview pattern.
- **`/dashboard/admin/bank-accounts`** (new): CRUD list (bank, account name,
  number, branch, active, order).
- **`/dashboard/admin/businesses`**: show each tenant's subscription status +
  expiry + price in the row; quick actions (grant free, set lifetime, extend).
- **`/dashboard/admin`** overview: add subscription KPIs (active / expiring soon /
  in grace / expired / unpaid revenue).

### Client ("My Business")
- **`/dashboard/businesses`**: a prominent **Subscription card** — current plan,
  status badge (Active / Grace / Expires in N days / Expired / Free / Lifetime),
  expiry date, and a **Renew** button.
- **`/dashboard/businesses/subscription`** (new): the submission page:
  - shows the price for the chosen term, the **admin bank accounts** (copyable
    account numbers), and a **receipt upload** (drag/photo).
  - payer name + amount fields; submit → shows AI review + queue status.
  - Also shows past submissions and their review outcome.
- **Renewal pop-up**: when within **2 days of expiry** (or in grace), show a
  dismissible modal prompting renewal with a link to the submission page. Reuse
  `Modal`; trigger from the dashboard layout / auth-driven subscription state.
- **Free/Lifetime tenants** never see the prompt.

### Polish
- Use the shared `Button`, `Modal`, `Loading`, `CollapsibleFilterPanel`, and the
  smart-cards pattern for consistency.
- Admin pages: consistent cards/tables, empty states, loading (first-load-only
  spinners per the recent pattern).

## i18n
- New `subscription.*` and `adm.subscriptions.*` namespaces; keep **en + am** in
  sync. Term labels, statuses, and the receipt form copy.

## Migrations
- Add the new tables/fields via a committed, **idempotent** SQL migration
  (follow the established pattern: `IF NOT EXISTS`, guarded FK). Seed default
  `SubscriptionPlan` rows and, if needed, a starter `BankAccount`.
- Add the file to the legacy `db push` replay list in `docker/entrypoint.sh`
  only if it also contains DATA (schema-only files are applied by `db push`).

## Security / correctness
- Strict tenant scoping (existing tenant middleware) — a user only sees their
  org's subscription + payments; admin endpoints are platform-admin only
  (`@Roles`/guard already used by `/admin`).
- AI review is **best-effort**: failure → `FLAGGED` for manual review, never a
  hard error on submit.
- Amount/name/account checks are verified server-side from admin-configured data;
  never trust client-sent expected values.
- Receipt files stored like verification documents (same upload config + limits).

## Verification
- Admin: set default prices per business type; override one tenant; add a bank
  account; grant a tenant free & another lifetime.
- Client: renew flow uploads a receipt → AI approves (extends correctly for each
  term) → or flags → admin approves manually → subscription extends.
- Grace: set expiry to yesterday → still usable; to 3 days ago → restricted;
  reminder pop-up appears within 2 days of expiry.
- Free/lifetime tenant never sees prompts and never expires.
- `tsc` + backend jest + `next build --webpack` clean.

## Confirmed decisions
1. **Term lengths = fixed days**: Monthly = **30 days**, 3-month = **90**,
   6-month = **180**, Yearly = **365**. `expiresAt = periodStart + termDays`.
2. **Expired behavior = read-only + renewal page only**: an `EXPIRED` tenant can
   view data and reach the subscription/renewal surfaces, but mutating/operational
   endpoints are blocked. **Grace (first 2 days past expiry) stays fully usable.**
3. **Free tenants = permanent** until an admin revokes it, and they **see no
   subscription UI or prompts** at all.
4. **Lifetime = admin-granted only** (no price/term; never expires, never billed).
   Clients cannot buy it.
5. **AI** reuses the existing Gemini key/config (`GeminiService`).
6. **Single currency** = the org's `currency` (default ETB) for all prices.

## Open questions
(none — all confirmed above)
