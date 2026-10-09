# Plan: Car-wash washer % in the GL + complete financial-activity ledger

> **STATUS: PART 1 + CAR-WASH COLLECTIONS + CREDIT PAYMENTS IMPLEMENTED.**
> Car-wash posting rewritten to a balanced, per-washer, owner-share-receivable
> model; collections post Dr Cash / Cr Owner Share Receivable; customer credit
> payments post Dr Cash|Bank / Cr AR (with reversal on update/delete); a
> `assertBalancedLines` guardrail added. 451/451 tests pass. Remaining: verify
> the credit-**sales** origin path (only posts when no linked Sale) and audit
> any other gaps.

## Goal (two parts)
1. **Car-wash GL posting must reflect the washer's percentage** and balance.
2. **Every financial activity posts to the GL / book-keeping** (double-entry).

## Confirmed decisions
1. **Per-washer** commission lines in the car-wash journal entry.
2. **Independent receivable is the standard.** Credit sales already raise AR at
   sale time (Sales module → `postSaleIncome`); `CreditSale`/`CreditPayment` are
   the sub-ledger; collections settle AR. `credit-sales.create` posts only when
   there is **no linked `Sale`** (otherwise it would double-count).
3. Car-wash **collections are a real cash movement**.
4. **Skip** correcting any already-posted (unbalanced) car-wash entries.

## The car-wash money model (decided, from the code)
In this vertical the **washer collects the cash from the customer**; the
**owner share (revenue − Σ washer %) is handed over to the business owner (the
tenant) later** — that is the "money on the air" / "gap" and the **collection**.
So:
- the business's **revenue is the owner share** (its own earnings), not the gross;
- the washer's % is the **washer's** money, never the shop's;
- while the cash is with the washer, the shop holds a **receivable**.

### Correct double-entry
**Settle wash (CWJ-<id>)** — balanced:
| Account | Debit | Credit |
|---|---|---|
| Owner Share Receivable (asset, "cash on the air") | `O` | |
| Car Wash Revenue | | `O` |
where `O = revenue − Σ washer commission`. (Washer commission is **not** a shop
expense in this model — it is the washer's own cut of cash they collected, so it
never touches the shop's P&L; it is optionally recorded for information only.)

**Collect (collection id)** — balanced:
| Account | Debit | Credit |
|---|---|---|
| Cash | `amount` | |
| Owner Share Receivable | | `amount` |

**Equipment revenue** (store items the shop sells) is ordinary revenue:
Dr Cash / Cr Equipment Revenue.

> Rationale: this books revenue = owner share (matches `netProfit = ownerShare −
> expenses`), records the receivable while the cash is "on the air", and clears it
> on collection — proper double-entry. (An earlier draft used an "Owner Share
> Payable" liability, which is the mirror-image model where the shop holds the
> cash and owes the owner; that is **not** what the collection flow here does.)

### Accounts to add (car-wash vertical)
- **Owner Share Receivable** — ASSET (code 1110). (Replaces the earlier
  "Owner Share Payable" liability idea.)
- Keep `Washer Commission Expense` for the informational per-washer split if we
  choose to book it (see open question 1), but the primary model does not expense
  it against shop revenue.

## Part 1 — car-wash posting (the bug)
Today `postCarWashIncome` debits the revenue account a second time on the
commission leg, so the entry is **unbalanced** (`Σdebit = revenue + 2·commission`,
`Σcredit = revenue`). Replace it with the owner-share-receivable entry above,
posting a **per-washer** breakdown (informational lines / a split record) and a
single **Owner Share Receivable** debit. Idempotent by wash id (`CWJ-<washId>`).

## Part 2 — ledger coverage gaps to close
1. **Customer credit payments** (`src/credit-payments`) — **Dr Cash / Cr Accounts
   Receivable**, one entry per payment (`CRP-<id>`), idempotent.
2. **Credit sales** (`src/credit-sales`) — post **Dr AR / Cr Revenue** ONLY when
   the `CreditSale` has **no linked `Sale`** (no double-count otherwise).
3. **Car-wash collections** — **Dr Cash / Cr Owner Share Receivable** (per §model),
   idempotent by collection id.
4. Verify purchases-credit / vendor-settlement / inter-shop-credit paths post;
   fill any gaps.

### Guardrail
Add `postBalanced(tx, { reference, lines })` used by every poster: asserts
`Σdebit === Σcredit` (logs+skips or throws), and centralizes idempotency by
`reference`. Prevents this class of silent unbalanced-entry bug recurring.

## Files to touch
- `src/common/verticals.ts` — add **Owner Share Receivable** (asset) for CAR_WASH;
  drop the earlier "Owner Share Payable" liability.
- `src/finance/finance.service.ts` — rewrite `postCarWashIncome` (balanced,
  owner-share-receivable, per-washer informational), add `postBalanced`,
  `postCreditPayment`, and (if needed) the credit-sale origin poster.
- `src/carwash/carwash.service.ts` — pass per-washer commissions; post collections.
- `src/credit-payments/credit-payments.service.ts` — post on settlement.
- `src/credit-sales/*` — post only when no linked Sale.
- Tests: assert CWJ entry balances and revenue == owner share; CRP balances; AR
  returns to 0 after full collection.

## Verification
- Settle a wash, washers at 50%/30%: CWJ balances; revenue booked == owner share;
  Owner Share Receivable == owner share.
- Collect: Cash +, Owner Share Receivable − , balanced; receivable returns to 0.
- Credit payment: AR −, Cash +, balanced, idempotent.
- `getGlTrialBalance().balanced === true` after mixed activity.
- `tsc` + jest clean.

## Open questions
1. **Washer commission in the books:** since the washer's % is the washer's own
   cash (never the shop's), should it be **omitted from the shop's GL entirely**
   (recommended — it isn't a shop expense), or recorded as informational
   (zero-sum) lines so it is visible in the ledger? The per-washer requirement is
   satisfied either way (informational split vs a `CarWashCommissionSplit` record).
2. **Equipment revenue** — confirm it is normal shop revenue (Dr Cash / Cr
   Equipment Revenue), posted per equipment-issue.
3. Collections currently settle the **whole day's owner share**; confirm the AR
   account is per-day (no per-washer receivable split needed).
