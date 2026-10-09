> **STATUS: IMPLEMENTING.** All decisions confirmed (see below).

## Goal
Let a business record, for an employee (staff member or car-wash washer):
- a **loan** (money advanced) repaid over time, and
- a **penalty / punishment** (fine for damage, lateness, breach),
both **deducted from the employee's salary or commission**, with a running balance
and a **paid / partial / open** state, and every movement posted to the GL.

## Confirmed decisions
1. **Issue/recover** is a permission — add a `deductions.view|manage` group to the
   **permission catalog** (`common/permissions.ts`) for every business type,
   granted to Owner + Manager by default.
2. **Employees get salary fields**: `salaryAmount` + `salaryPeriod` (MONTHLY/…)
   and the deduction carries a **`dueAt`**. When the due date nears, the UI/reminders
   **nag** (surface the remainder); postings happen **on payment/recovery**.
3. **Penalty recovery = a reduction of labour expense** (contra to `Salaries &
   Wages`), which is the standard, conservative real-world treatment (fines/
   damages recovered net against the related expense, not recorded as revenue).
4. **Interest-free** staff loans.
5. Deductions may target a **washer with no login** (keyed to `CarWashWasher`).
6. **Recovery is capped at a configurable % of pay** (tenant setting, e.g. 30%),
   the cap is enforced so a recovery can never exceed it, and it **guards against
   duplicate loans** — a new loan may not push the outstanding total over the cap.

## Data model
```prisma
enum EmployeeDeductionKind   { LOAN PENALTY }
enum EmployeeDeductionStatus { OPEN PARTIAL PAID CANCELLED }
enum EmployeeDeductionSource { SALARY COMMISSION }
enum SalaryPeriod            { MONTHLY BIWEEKLY WEEKLY DAILY } // configurable set

// Salary on the staff member (User) and on the washer.
//  - User.salaryAmount / User.salaryPeriod   (staff)
//  - CarWashWasher keeps commissionRate; salary fields also allowed (optional)

model EmployeeDeduction {
  id              Int                     @id @default(autoincrement())
  tenantId        Int
  userId          Int?                    // staff member (nullable)
  washerId        Int?                    // car-wash washer (nullable)
  kind            EmployeeDeductionKind
  source          EmployeeDeductionSource @default(SALARY)
  reason          String
  amount          Float                   // total to recover
  recoveredAmount Float                   @default(0)
  status          EmployeeDeductionStatus @default(OPEN)
  issuedAt        DateTime                @default(now())
  dueAt           DateTime?               // when the remainder is due
  notes           String?
  createdById     Int?
  createdAt       DateTime                @default(now())
  updatedAt       DateTime                @updatedAt
  recoveries      EmployeeDeductionRecovery[]

  @@index([tenantId, userId])
  @@index([tenantId, washerId])
  @@index([tenantId, status])
  @@index([tenantId, dueAt])
}

model EmployeeDeductionRecovery {
  id          Int      @id @default(autoincrement())
  deductionId Int
  tenantId    Int
  amount      Float
  recoveredAt DateTime @default(now())
  note        String?
  createdById Int?
  createdAt   DateTime @default(now())
  @@index([tenantId, deductionId])
}
```
- Back-relations on `User`, `CarWashWasher`, `Organization`.
- Status derived (`PAID` when `recoveredAmount >= amount`, `PARTIAL` when `>0`).

### Salary fields
- Add `salaryAmount Float?` + `salaryPeriod SalaryPeriod?` to `User` (and to
  `CarWashWasher`, optional — washers are usually commission-based).
- **Tenant config** for the cap: store `deductionCapPercent` (default 30) in
  `Organization.settings` JSON (or a small typed column) — configurable per tenant.

## Backend (`src/employee-deductions/`)
- CRUD + `recover(id, amount, note?)`, `recoverMany(employee, source, payoutAmount)`,
  `summaryForEmployee`, `listForEmployee`, `dueSoon(days)`.
- **Cap enforcement** in `recover`/`recoverMany`: a single run's recovery may not
  exceed `deductionCapPercent%` of the employee's pay for the period (their salary,
  or the commission payout amount when recovering from commission). Also rejects
  any recovery that would exceed the deduction's remaining balance.
- **Duplicate-loan guard:** creating a loan is rejected if it would raise the
  employee's total outstanding LOAN balance above the same cap basis (prevents
  stacking loans that can never be recovered).
- **Permissions:** add the `deductions.view|manage` group; migration grants the
  defaults to the Owner + Manager system roles of every business type (idempotent,
  same pattern as `payment-methods.*`).

## GL / book-keeping (standard, balanced)
- **Issue LOAN:** Dr **Employee Loans Receivable** (asset, 1120) / Cr Cash —
  reference `ELN-<id>`. (Cash actually leaves the till.)
- **Issue PENALTY:** no GL on issue (a memo until recovered).
- **Recover LOAN** (`ERR-<id>`): Dr **Salaries & Wages Payable** (or Salaries &
  Wages expense) / Cr **Employee Loans Receivable** — a **balance-sheet**
  settlement (clears the receivable; no P&L impact).
- **Recover PENALTY** (`ERRP-<id>`): Dr **Salaries & Wages Payable** / Cr
  **Salaries & Wages** (contra) — i.e. the fine **reduces the labour expense**,
  the accepted real-world treatment (not revenue).
- **Cancel** an open/partial deduction: reverse the posted legs (`ERRC-<id>` /
  `ELNC-<id>`), keep all history.
- Add accounts via `ensureDefaultAccounts` (so existing orgs get them):
  **Employee Loans Receivable** (asset 1120) and, for the contra, use the existing
  **Salaries & Wages** (6100) — no new income account needed under the contra model.
- All postings use a `tx` + `assertBalancedLines`, idempotent by reference.

## Payout integration
- **Car-wash commission payout:** sweep open deductions with
  `recoverMany(washer, { source: COMMISSION, payoutAmount })`, respecting the cap.
  `commissions` / `washerReports` gain a **deductions** column and a **net payout**
  (= earned − recovered).
- **Salary:** expose the outstanding balance per employee so a payroll run (or a
  manual "record payment") can sweep it; `recoverMany` is the API for that run.
- **Due-date nagging:** `/employee-deductions/due-soon` (and a reminder via the
  notification system) surfaces deductions whose `dueAt` is close and still
  outstanding.

## Frontend
- **Staff (`/dashboard/users`)**: a **Deductions** panel per employee — salary
  (amount + period), the list of loans/penalties with outstanding balance, status
  badge, add (loan/penalty + due date), and **Record recovery** (capped). Config
  for the **cap %** in the business settings.
- **Car-wash → Washers**: outstanding deductions per washer + **Recover from
  commission**; washer report shows earned / deductions / net.
- **i18n** `deductions.*` (en + am); reuse `Button`, `Modal`, `Loading`,
  `CollapsibleFilterPanel`.
- **Due-soon banner** near the staff/deductions surfaces when a `dueAt` is close.

## Files to touch
- `prisma/schema.prisma` + idempotent migration (models, enums, `User`/
  `CarWashWasher` salary fields, permission keys + grants, default accounts).
- `src/employee-deductions/*` (module/controller/service/DTO) + `app.module.ts`.
- `src/finance/finance.service.ts` — `postEmployeeLoan`, `postDeductionRecovery`,
  `postDeductionCancel`; `ensureDefaultAccounts` adds **Employee Loans Receivable**.
- `src/common/permissions.ts` — the new group across business types.
- `src/carwash/*` — deductions in commissions/washer reports + payout sweep.
- Frontend: `app/dashboard/users/*`, `app/dashboard/carwash/washers/*`,
  `app/components/DeductionsPanel.tsx`, `lib/locales/{en,am}`.

## Verification
- Loan issued → GL Dr Loans Receivable / Cr Cash (balanced). Penalty issued → no GL.
- Recovery capped at the configured % of pay; over-cap attempt rejected.
- Duplicate loan beyond the cap rejected.
- Partial → PARTIAL, full → PAID, balance 0.
- Penalty recovery reduces Salaries & Wages (contra), no revenue.
- Commission payout sweeps deductions → net = earned − recovered.
- Cancel reverses GL; history preserved.
- Trial balance stays `balanced === true`; `tsc` + jest clean.

## Open questions
(none — all confirmed)

## Confirmed final details
1. **Cap basis** = `deductionCapPercent%` of the employee's **total period pay for
   the payout run**: for a salaried employee, their base salary for the period;
   for a commission worker, their commission payout for that period. A recovery
   run may not exceed that maximum.
2. **Cancelled** is the single terminal state for both accidental postings and
   managerial forgiveness — no separate "waived" state.
3. Salary periods: **DAILY · WEEKLY · BIWEEKLY · MONTHLY** (daily/weekly for
   informal/day-labour/commission washers; biweekly/monthly for permanent staff).
4. **Due-soon reminder:** both **in-app** and **push** (reuse the notification
   system).
