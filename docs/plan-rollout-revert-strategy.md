# Plan: Safe rollout & revert strategy for the uncommitted work

## Question
> "After pushing and testing in live, if we face any issue, can we revert it?"

**Short answer: yes — IF the work is committed and pushed first, and the deploy is
revertible.** Right now that is **not yet true**, because everything from the last
several features is **still uncommitted/unpushed** (56 changed files + 3 new
migrations). Until it is committed and pushed, there is **nothing to revert to on
the remote** — a bad live test would have no clean rollback point.

## Current state (verified)
- Branch `main`, remotes: `origin` and `backend-remote`. `main` is **0 behind / 0
  ahead** of `origin/main` — i.e. **no local commits pending push**; all work is
  in the **working tree**.
- Last pushed commit: `bb2ae8a` (the filter-search fix).
- Uncommitted pile (56 files, ~1400 insertions) includes **three new migrations**:
  - `20261016000000_tenant_subscriptions`
  - `20261017000000_employee_deductions`
  - `20261018000000_notification_dedupe`
- These touch **schema**, **auth/permissions**, **notification behavior**, **GL
  postings** (car-wash/credit), and **new admin/client pages** — i.e. a large,
  live-affecting change.

## Why "revert" is only partly true

### 1. Code revert is easy **once committed/pushed**
- `git revert <commit>` (or redeploy the previous image tag) rolls the app code
  back cleanly.
- The Docker workflow already tags images (`:sha-...`, `:latest`, branch) — so
  **redeploying the previous image tag** is the fastest rollback and needs no git
  surgery.

### 2. **Database migrations do NOT auto-revert**
This is the crux. The three new migrations are **forward-only** (as designed —
idempotent `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, guards).
Reverting the **code** does **not** undo the **schema**:
- Rolling back to `bb2ae8a` after the new migrations ran leaves the new tables/
  columns/enums in place. Old code ignores them — **usually safe**, but any change
  that *altered* existing behavior (not just added) needs care.
- If a migration had a **data** change (e.g. the subscription backfill that grants
  existing orgs a trial, the low-stock `dedupeKey` backfill), reverting code leaves
  that data change applied. It is additive/grandfathering, so low risk — but it is
  **not undone by a code revert**.
- So a clean rollback needs either (a) migrations that are safe to leave in place
  (they are: additive + guarded), or (b) a written **down-migration** for anything
  that must be undone. There is no automatic `migrate down` used here.

### 3. Reverting one commit vs. several
The work spans many logical changes (subscriptions, deductions, notifications, GL,
vertical enforcement, filters). A single "revert everything" commit is coarse. It
is better to land it as **several focused commits** so any one can be reverted
independently.

## Recommended rollout procedure

### Step 0 — commit in small, revertible units (do this first)
Split the pile into focused commits so each is independently revertible, e.g.:
1. `fix(gl): car-wash owner-share + per-washer + credit-payment postings`
2. `feat(vertical): always-on vertical enforcement`
3. `feat(subscriptions): plans, receipts, AI review, enforcement` (+ its migration)
4. `feat(deductions): employee loans & penalties` (+ its migration)
5. `feat(notifications): read-once + recipient rows` (+ its migration)
6. `feat(admin/ui): admin + client pages, filters, nav`
7. `docs: plans`

Commit **migrations with the code they belong to**, so reverting that feature also
reverts its migration file (the deployed DB row stays, but the repo is consistent).

### Step 1 — tag a known-good ref before deploying
- `git tag pre-subscriptions-rollout` (or note the current image digest) at the
  last verified point. This is the rollback anchor.

### Step 2 — push, let CI build, deploy
- Push to `main` → the Docker workflow builds and pushes image tags.
- Deploy the new image. Keep the **previous image tag/digest** handy.

### Step 3 — live-test with a rollback trigger pre-agreed
Define **what counts as "an issue"** and who decides to roll back. Smoke test:
- App boots, `/` 200; login; `/auth/me` + `/subscriptions/me`.
- A sale + a credit payment post balanced; trial balance `balanced === true`.
- Admin subscriptions/bank-accounts pages load; a receipt submit → AI decision.
- A deduction create/recover; a notification is read-once.
- Vertical enforcement: a cross-vertical call → 403.

### Step 4 — if something is wrong
Two levels, fastest first:

**A. App-level rollback (recommended first move)**
- Redeploy the **previous image tag** (`:sha-<prev>` / the tag you noted).
  Instant, no git rewrite. Because the new migrations are **additive**, the old
  code runs fine against the newer schema.
- Or `git revert <commit(s)>` + push (CI rebuilds the prior behavior).

**B. If a migration itself is the problem**
- Since there is **no down-migration**, fix forward with a **new** migration
  (e.g. drop the offending column/table, or a data fix). Guarded/idempotent SQL
  keeps this safe.
- Only if unavoidable: manually reverse the specific DDL on the DB, then revert
  the code. This is the riskiest path (data loss possible) — needs a backup.

### Step 5 — always have a DB backup point
Before deploying schema-changing work, take a **database backup/snapshot** so the
worst case (bad data migration) is recoverable independent of git.

## Guardrails to add to the plan (make rollback a non-event)
- **Migrations stay additive + idempotent** (already the pattern): `IF NOT EXISTS`,
  guarded FK/enums, no destructive `ALTER`/`DROP` in feature migrations. Then old
  code always tolerates the new schema and a code revert is safe.
- **Feature flags / env rollbacks** for the riskiest behavior changes (like the
  vertical-enforcement switch that was removed): where a behavior change is broad,
  keep a **code-level flag** (default on) so it can be turned off by env without a
  redeploy. (Note: for the tenant-isolation boundary we deliberately made it
  always-on; for other broad changes, a temporary flag may still be justified.)
- **Deploy the backend and frontend are the same image** (single container), so a
  rollback moves both together — no version skew to manage.
- **Prefer additive releases**: ship a migration, let it apply, then ship the code
  that uses it — so no single deploy is both schema- and behavior-breaking.

## Answer to the question, precise
- **Yes, you can revert** — *after* we commit and push, because then the remote
  has a rollback target and prior image tags exist.
- **A code revert is clean**, provided the deployed migrations are **additive**
  (they are) — old code keeps working against the newer schema.
- **A DB migration does not auto-revert**; undoing a *data* effect needs a
  forward-fix migration or a manual step + backup.
- **Therefore**: (1) commit in small units now, (2) take a DB snapshot, (3) tag the
  current image, (4) deploy, (5) roll back by redeploying the previous image tag
  if needed, (6) fix schema issues forward with a new guarded migration.

## Open questions
1. **Commit granularity:** do you want the pile split into the 6–7 focused commits
   above (recommended, each revertible), or one big commit (simpler, coarser
   rollback)?
2. **Rollback mechanism of choice:** redeploy previous image tag (fastest) or
   `git revert` + CI rebuild? (Image-tag rollback is recommended.)
3. **DB snapshot:** is taking a backup before this deploy possible in your hosting
   (managed Postgres snapshot), or do we rely purely on additive migrations?
4. **Feature flags:** do you want a temporary env flag for any of these (e.g.
   subscriptions/deductions) so it can be disabled without a full rollback, or
   keep everything straightforwardly on?
5. **Migration policy:** confirm we keep **additive-only** feature migrations so
   code rollbacks stay safe (recommended), and never destructive DDL in a feature
   release.
