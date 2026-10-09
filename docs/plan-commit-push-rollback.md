# Plan: Commit, push, and prepare a rollback mechanism

## Goal
Commit the current uncommitted work in **small, independently revertible units**,
push it to the deploy remote, and have a **tested rollback mechanism** ready
before it goes live — so any live issue can be undone quickly and safely.

## Verified current state
- Repo to deploy from: **`origin` = `kassOmega/inventory-monorepo`** (has the
  root `Dockerfile` + `.github/workflows/docker-publish.yml`). `main` tracks it.
  (`backend-remote` / `frontend-remote` are separate mirrors — **not** the deploy
  target for the combined image.)
- `main` is **0 ahead / 0 behind** `origin/main` at `bb2ae8a` → no local commits
  pending; **all work is in the working tree**.
- Pending: **34 tracked files changed (+1397/−203)** and **23 untracked paths**,
  including **3 new migrations**:
  `20261016000000_tenant_subscriptions`, `20261017000000_employee_deductions`,
  `20261018000000_notification_dedupe`.
- No git tags exist yet.

## Why this plan
A code revert is clean; a **DB migration does not auto-revert** (no down-migration
here). Our migrations are **additive + idempotent** (`CREATE TABLE IF NOT EXISTS`,
`ADD COLUMN IF NOT EXISTS`, guarded enums/FKs, no destructive DDL), so **old code
runs fine against the newer schema** — meaning an **image-tag rollback** is safe
even after the migrations have applied. The plan leans on that.

## Step 1 — Establish a rollback anchor (BEFORE any commit)
So we can return to the exact current state if a commit/push goes wrong:
- `git branch backup/pre-rollout@bb2ae8a bb2ae8a` (local safety branch), and/or
- `git tag pre-rollout` at `bb2ae8a` (a named ref of the last verified point).
- Record the current deploy image reference/digest if one is running (the fastest
  rollback is redeploying that image).
- **Take a database snapshot** (managed-Postgres backup) if your host supports it.

## Step 2 — Commit in focused, revertible units
Each commit is self-contained so it can be reverted alone. Migrations are committed
**with the feature they belong to**.

Order (dependency-safe):
1. **docs**: the plan files (`docs/plan-*.md`).
2. **fix(gl)**: car-wash owner-share + per-washer + credit-payment + collection
   postings, `assertBalancedLines`, accounts. (`finance.service.ts`,
   `carwash.service.ts`, `credit-payments/*`, `common/verticals.ts`, specs.)
3. **feat(vertical)**: always-on `VerticalGuard` + `.env.example`. (guard + spec.)
4. **feat(subscriptions)**: `src/subscriptions/*`, `guards/subscription/*`,
   `allow-expired` decorator, `app.module`, `admin.service`, `tenants.service`,
   schema + migration `20261016000000_tenant_subscriptions`, `users` salary DTO.
5. **feat(deductions)**: `src/employee-deductions/*`, permissions catalog,
   schema + migration `20261017000000_employee_deductions`.
6. **feat(notifications)**: read-once service + schema + migration
   `20261018000000_notification_dedupe`, `requests`/`purchases`/`verification`
   keys, `notificationLink.ts`.
7. **feat(admin-ui)**: admin subscriptions/bank-accounts pages, businesses/admin
   KPI bits, businesses subscription card + page, staff-deductions page,
   `DeductionsPanel`, `SubscriptionCard`, `SubscriptionRenewalPrompt`,
   `subscriptions.ts`, nav + routes + i18n.

Commit message format: imperative, with a body listing files/behavior and the
migration name where relevant (so `git log` tells us what to revert).

## Step 3 — Verify locally before pushing
- Backend: `npx tsc --noEmit -p tsconfig.json` + `npx jest` (expect all green).
- Frontend: `npx tsc --noEmit` + `npx next build --webpack`.
- Confirm each migration applies + is idempotent against a scratch/DB copy.
- Only then proceed.

## Step 4 — Push
- `git push origin main` (CI builds/pushes the GHCR image tags:
  `:main`, `:latest`, `:sha-<commit>`).
- Because each change is its own commit, `git log origin/main` now shows a clean,
  individually-revertible history.

## Step 5 — Deploy with the rollback ready
- Deploy the new image; **keep the previous image tag/digest** and the
  `pre-rollout` tag.
- Smoke test (rollback trigger list): app boots + `/` 200; login +
  `/auth/me` + `/subscriptions/me`; a sale and a credit payment post **balanced**
  (trial balance `balanced===true`); admin subscriptions/bank-accounts pages load;
  a receipt submit yields an AI decision; a deduction create/recover; a
  notification is **read-once**; a cross-vertical call returns **403**.

## Step 6 — Rollback mechanism (prepared, two levels)

### A. Fastest — redeploy the previous image tag (recommended)
- Re-point the deploy to the previous `:sha-<prev>` (or the running digest).
- Safe because migrations are additive: the old code tolerates the new schema.
- No git rewrite, no rebuild.

### B. git-level revert
- `git revert <commit>` for a single feature (or a range) → push → CI rebuilds the
  rolled-back behavior. Small commits make this surgical.
- Or reset the branch to `pre-rollout` and force-push **only** if the team accepts
  rewriting history (avoid on `main`).

### C. If a migration is the problem
- We have **no down-migration** by design. **Fix forward**: add a new guarded,
  idempotent migration (drop the offending column/table, or a data correction).
- Manual DDL reversal is the last resort (needs the DB snapshot) — data-loss risk.

## Guardrails (keep rollback a non-event)
- **Additive-only feature migrations** — never destructive DDL in a feature
  release, so code rollbacks stay safe.
- **Single image** (backend + frontend together) — one rollback moves both, no
  version skew.
- **Prefer additive releases** — ship the migration, let it apply, then ship the
  code that uses it (avoids a deploy that is both schema- and behavior-breaking).
- **DB snapshot** before schema-changing deploys where the host supports it.

## Responsibilities / decision points
- **Who decides to roll back** and based on which smoke-test failure.
- **Which mechanism** is the default (recommend: previous image tag).
- Keep the `pre-rollout` tag referenced in the release notes.

## Open questions
1. **Confirm the deploy remote is `origin`** (`inventory-monorepo`) — the
   Dockerfile/CI live there. Push there, not `backend-remote`/`frontend-remote`?
2. **Commit granularity**: the 7 focused commits above (recommended) or fewer?
3. **Rollback default**: redeploy previous image tag (recommended) or `git revert`?
4. **DB snapshot** available on your host for the pre-deploy backup?
5. **Push now or hold?** — the plan can stop after committing locally so you review
   the commit list before it leaves the machine.
