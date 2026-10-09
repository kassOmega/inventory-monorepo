# Plan — Payment method on car-wash settlement + payment breakdown in reports

## Confirmed decisions

1. **Cash is seeded as the default payment method** for every tenant; the settle
   **modal always appears** (never a no-options case), with an inline
   **"+ Add payment method"**.
   - Payment Methods become a **CRUD permission group** (`paymentMethods.view`
     / `.create` / `.edit` / `.delete`); **`paymentMethods.view` is checked by
     default for Cashier and Manager** (owner can grant the rest).
2. Use the recommended approach: a **dedicated car-wash payment-methods report**
   and require a method in the modal (Cash is always available).
3. Washes UI: when status is **Washed**, show **only "Paid"** (remove
   "Washed & paid").
4. Washes UI: put the status counters **in one row**, with slightly smaller /
   lighter font.

## Requested work

1. When settling a car-wash vehicle (**Paid**), open a **modal to choose the
   payment method** the money was received in. (The same for the "Washed & paid"
   action — but see item 3.)
2. Add the **payment breakdown** to the reports page for car wash.
3. When a vehicle's status is **Washed**, show **only the "Paid" action** — remove
   the "Washed & paid" option.

## Findings (verified)

- **`PaymentMethod`** model: `id`, `tenantId?`, `name`, `nameI18n`, `isDigital`,
  `account`, and relations from `Sale`, `CreditPayment`, `Purchase`,
  `OrderPayment`, … **but no relation from `CarWash`**.
- Endpoint `GET /payment-methods` (`PaymentMethodsService.list`) returns the
  tenant's methods — already used by `SaleForm`, `PurchaseForm`, credit/facility
  flows. Reusable.
- **Settlement**: `PATCH /carwash/washes/:id/settle` → `settleWash(id, userId)`.
  It sets `status = SETTLED`, `settledAt`, posts the GL income, and audits — but
  records **no payment method**.
- `CarWash` has no `paymentMethodId`; the settle DTO has no body.
- **Washes UI** (`carwash/washes/page.tsx`): `statusActions(w)` currently returns,
  for `COMPLETED` (Washed), **two** actions — `Paid` and `Washed & paid` — both
  calling `runAction(w, "settle", "SETTLED")`. No modal.
- **Reports**: `getPaymentMethodsBreakdown(user, ...)` aggregates **sales**
  payment methods (retail). The hospitality dashboard builds its own from
  `OrderPayment`. Neither includes car-wash settlements.
- The reports page renders the retail `SalesReport` (with a payment-methods card)
  only for retail; the car-wash tab renders `CarWashReport` (no payment
  breakdown).

## Design decisions

### A. Record the payment method on settlement
- **Schema**: add `paymentMethodId Int?` + relation
  `paymentMethod PaymentMethod?` to `CarWash` (nullable; old settled rows have
  none). Add the inverse relation on `PaymentMethod` (`carWashWashes CarWash[]`).
  Migration is additive.
- **Default "Cash"**: seed a `Cash` payment method for a tenant when it has none
  (lazy `ensureCashPaymentMethod(tenantId)` in `PaymentMethodsService.findAll` /
  on settle, and/or on org creation). This guarantees the settle modal always
  has at least Cash.
- **DTO**: `SettleWashDto { paymentMethodId?: number }`.
- **Service** `settleWash(id, userId, paymentMethodId?)`: validate the method
  belongs to the tenant, store it, keep the GL posting + audit (include the
  method name in the audit details). Idempotent on repeat settle.
- **Controller**: `PATCH washes/:id/settle` accepts the DTO body; `GET
  /payment-methods` already serves the list.
- **Permissions**: add a **Payment Methods** CRUD permission group to the
  catalog:
  - `paymentMethods.view` (View Payment Methods)
  - `paymentMethods.create` (Create Payment Methods)
  - `paymentMethods.edit` (Edit Payment Methods)
  - `paymentMethods.delete` (Delete Payment Methods)
  Default grants: **`paymentMethods.view` is granted to Cashier and Manager**
  (and Owner, who holds all keys); create/edit/delete default to Owner only, so
  the owner can grant them per role from the roles editor. Apply the same on the
  car-wash role baseline.
- **Repoint the payment-methods endpoints at the new keys**:
  - `GET /payment-methods` → `paymentMethods.view` (plus the existing
    money-collection keys so every settling flow keeps read access),
  - `POST` → `paymentMethods.create` || `paymentMethods.edit`,
  - `PATCH` → `paymentMethods.edit`,
  - `DELETE` → `paymentMethods.delete`,
  - keep `finance.manage` as an accepted alternative so owners/managers with the
    broad finance key are unaffected.
- Ensure the car-wash Cashier has `paymentMethods.view` after the reconcile
  backfill (extend `carwash-role-permissions.ts`).

### B. Settlement modal in the washes UI
- The single **Paid** action opens a **modal** (always shown):
  - loads `GET /payment-methods` (Cash present by default),
  - a required **Payment method** select,
  - an inline **"+ Add payment method"** (name field → `POST /payment-methods`,
    then select it),
  - Confirm → `PATCH /carwash/washes/:id/settle { paymentMethodId }`.
- Works from both the row action and the detail modal; show the chosen method in
  the wash **detail modal**.

### C. Status-based actions (Washed shows only "Paid")
- `statusActions`:
  - `QUEUED` → **Start washing**
  - `IN_PROGRESS` → **Washed**
  - `COMPLETED` (washed) → **Paid** only (opens the settlement modal)
  - `SETTLED` → no action
- Remove the "Washed & paid" button and its i18n key.

### D. Payment breakdown in reports (car wash)
- **Backend**: `GET /carwash/reports/payment-methods` (gated by
  `carwash.reports.view`) — settled car washes in range grouped by
  `paymentMethod.name`, returning `[{ method, count, totalAmount }]`; rows with
  no method appear under "Unspecified".
- **Frontend** (`CarWashReport.tsx`): a "Payment methods" table (method, count,
  amount + totals) under the `financials` detail permission.

### E. Washes cards layout
- Status counters: `grid-cols-4` (one row on desktop, 2×2 on mobile) with a
  smaller, lighter number font (`text-lg font-semibold` instead of `text-xl
  font-bold`).


### E. i18n
- Modal labels: `carwash.selectPaymentMethod`, `carwash.paymentMethod`,
  `carwash.confirmPayment`; reuse `carwash.actionPaid`.
- Reports: reuse `sr.paymentMethods` / `sr.method` / `sr.count` / `sr.total`.

## Work plan

1. **Schema + migration**: `CarWash.paymentMethodId` (+ relation, index) and the
   inverse on `PaymentMethod`.
2. **DTO**: `SettleWashDto`.
3. **Service**: `settleWash(id, userId, paymentMethodId?)` — validate + store +
   audit; keep GL posting.
4. **Controller**: accept the DTO on settle.
5. **Washes UI**: single **Paid** action → settlement modal (payment-method
   select, loads `/payment-methods`); remove "Washed & paid"; show the method in
   the detail modal.
6. **Reports backend**: `GET /carwash/reports/payment-methods` (settled washes,
   grouped by method, date-filtered).
7. **CarWashReport**: add the payment-methods card/table.
8. **i18n** (en + am).
9. **Tests**: settle with a method stores it + audits; grouped payment-methods
   report returns the right counts/totals; every status shows the correct action
   set.
10. **Verify**: `tsc`, `jest`, `next build`; manual: washed → Paid → modal →
    choose method → status Complete; reports show the breakdown.

## Risks / notes

- Existing `SETTLED` washes have no method → they'll appear under "Unspecified"
  in the report; acceptable.
- The GL posting stays on settle (unchanged); only the method is added.
- Keep `paymentMethodId` optional in the DTO so a business with no configured
  methods can still settle; the UI requires it when methods exist.
- No change to the collection flow (owner share) — the method is per-vehicle
  settlement only.

---

## Implementation summary (delivered)

- **Schema + migration** `20261015000000_carwash_payment_method`: `CarWash.paymentMethodId`
  (nullable) + FK `PaymentMethod` (SetNull) + inverse relation + index.
- **Payment Methods CRUD permissions** (`payment-methods.view|create|edit|delete`,
  group "Payment Methods"), added to **every** business-type group list:
  - Manager → view + create + edit (no delete), Cashier → view, Owner → all.
  - Migration `20261015000001_payment_methods_permissions` inserts the catalog keys
    and grants the defaults to every `MANAGER`/`CASHIER` system role (all orgs).
  - Payment-methods endpoints repointed at the new keys (GET keeps the money-flow
    keys for read).
- **Cash default**: `PaymentMethodsService.findAll` lazily creates a `Cash` method
  when a tenant has none, so the settle modal always has options.
- **Settle with method**: `SettleWashDto { paymentMethodId? }`;
  `settleWash(id, userId, paymentMethodId?)` validates the method is the tenant's,
  stores it (GL posting + audit unchanged); `listWashes` includes `paymentMethod`.
- **Washes UI**: single **Paid** action opens a settlement modal (method select,
  Cash preselected) with **inline "+ Add payment method"**; "Washed & paid"
  removed; the detail modal shows the payment method; `PATCH /washes/:id/settle`
  now sends the body.
- **Reports**: `GET /carwash/reports/payment-methods` (settled washes grouped by
  method, "Unspecified" for legacy rows) + a "Payment methods" table in
  `CarWashReport` under the `financials` section.
- **Washes cards**: one row (`grid-cols-4`, 2×2 on small screens) with a smaller,
  lighter number (`text-base font-semibold`).
- **i18n**: `carwash.paymentMethod`, `carwash.addPaymentMethod`, `carwash.noData`
  (en + am).
- **Tests**: settle records the method; breakdown groups by method incl.
  "Unspecified". Full suite 50/440; tsc clean; next build compiles.
