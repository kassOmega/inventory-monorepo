-- Tenant subscriptions: pricing plans, per-tenant state, admin bank accounts, and
-- client receipt submissions (with AI review). Idempotent so it can re-run safely
-- on legacy `db push` databases that already have the tables.

-- --- Enums ------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "SubscriptionTerm" AS ENUM ('MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SubscriptionStatus" AS ENUM ('FREE', 'LIFETIME', 'ACTIVE', 'GRACE', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SubscriptionPaymentStatus" AS ENUM ('PENDING', 'APPROVED', 'FLAGGED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- SubscriptionPlan (default prices per business type + term) -------------
CREATE TABLE IF NOT EXISTS "SubscriptionPlan" (
  "id"           SERIAL PRIMARY KEY,
  "businessType" "BusinessType",
  "term"         "SubscriptionTerm" NOT NULL,
  "price"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "currency"     TEXT NOT NULL DEFAULT 'ETB',
  "active"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Unique (businessType, term). Postgres treats NULLs as distinct, so the global
-- fallback (businessType IS NULL) needs its own partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionPlan_businessType_term_key"
  ON "SubscriptionPlan" ("businessType", "term")
  WHERE "businessType" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionPlan_global_term_key"
  ON "SubscriptionPlan" ("term")
  WHERE "businessType" IS NULL;

-- --- TenantSubscription (live state, 1:1 with Organization) -----------------
CREATE TABLE IF NOT EXISTS "TenantSubscription" (
  "id"             SERIAL PRIMARY KEY,
  "organizationId" INTEGER NOT NULL,
  "status"         "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "term"           "SubscriptionTerm",
  "priceOverride"  DOUBLE PRECISION,
  "startedAt"      TIMESTAMP(3),
  "expiresAt"      TIMESTAMP(3),
  "autoRenew"      BOOLEAN NOT NULL DEFAULT true,
  "isTrial"        BOOLEAN NOT NULL DEFAULT false,
  "note"           TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "TenantSubscription_organizationId_key"
  ON "TenantSubscription" ("organizationId");
CREATE INDEX IF NOT EXISTS "TenantSubscription_status_idx" ON "TenantSubscription" ("status");
CREATE INDEX IF NOT EXISTS "TenantSubscription_expiresAt_idx" ON "TenantSubscription" ("expiresAt");

-- Adding isTrial to databases that already created the table above.
ALTER TABLE "TenantSubscription" ADD COLUMN IF NOT EXISTS "isTrial" BOOLEAN NOT NULL DEFAULT false;

-- --- SubscriptionSetting (single-row platform config) -----------------------
CREATE TABLE IF NOT EXISTS "SubscriptionSetting" (
  "id"        INTEGER PRIMARY KEY DEFAULT 1,
  "trialDays" INTEGER NOT NULL DEFAULT 14,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "SubscriptionSetting" ("id", "trialDays") VALUES (1, 14)
  ON CONFLICT ("id") DO NOTHING;

DO $$ BEGIN
  ALTER TABLE "TenantSubscription"
    ADD CONSTRAINT "TenantSubscription_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- BankAccount (admin-managed receiving accounts) -------------------------
CREATE TABLE IF NOT EXISTS "BankAccount" (
  "id"            SERIAL PRIMARY KEY,
  "bankName"      TEXT NOT NULL,
  "accountName"   TEXT NOT NULL,
  "accountNumber" TEXT NOT NULL,
  "branch"        TEXT,
  "businessType"  "BusinessType",
  "active"        BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"     INTEGER NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "BankAccount_active_sortOrder_idx" ON "BankAccount" ("active", "sortOrder");

-- --- SubscriptionPayment (receipt submissions + AI review) ------------------
CREATE TABLE IF NOT EXISTS "SubscriptionPayment" (
  "id"             SERIAL PRIMARY KEY,
  "organizationId" INTEGER NOT NULL,
  "submittedById"  INTEGER NOT NULL,
  "term"           "SubscriptionTerm" NOT NULL,
  "amount"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  "currency"       TEXT NOT NULL DEFAULT 'ETB',
  "bankAccountId"  INTEGER,
  "payerName"      TEXT,
  "transactionRef" TEXT,
  "fileName"       TEXT NOT NULL,
  "mimeType"       TEXT NOT NULL,
  "size"           INTEGER NOT NULL,
  "filePath"       TEXT NOT NULL,
  "status"         "SubscriptionPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "aiResult"       JSONB,
  "aiDecision"     TEXT,
  "reviewedById"   INTEGER,
  "reviewedAt"     TIMESTAMP(3),
  "adminNote"      TEXT,
  "periodStart"    TIMESTAMP(3),
  "periodEnd"      TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "SubscriptionPayment_organizationId_createdAt_idx"
  ON "SubscriptionPayment" ("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "SubscriptionPayment_status_createdAt_idx"
  ON "SubscriptionPayment" ("status", "createdAt");

-- A bank reference is unique per tenant so the same receipt cannot be replayed.
ALTER TABLE "SubscriptionPayment" ADD COLUMN IF NOT EXISTS "transactionRef" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionPayment_organizationId_transactionRef_key"
  ON "SubscriptionPayment" ("organizationId", "transactionRef");

DO $$ BEGIN
  ALTER TABLE "SubscriptionPayment"
    ADD CONSTRAINT "SubscriptionPayment_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SubscriptionPayment"
    ADD CONSTRAINT "SubscriptionPayment_submittedById_fkey"
    FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SubscriptionPayment"
    ADD CONSTRAINT "SubscriptionPayment_bankAccountId_fkey"
    FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SubscriptionPayment"
    ADD CONSTRAINT "SubscriptionPayment_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- Seed sensible default plans (per business type + term) -----------------
-- Editable later from the admin Subscriptions page. ON CONFLICT keeps any prices
-- an admin has already set.
INSERT INTO "SubscriptionPlan" ("businessType", "term", "price", "currency") VALUES
  ('RETAIL',        'MONTHLY',    1500, 'ETB'),
  ('RETAIL',        'QUARTERLY',  4000, 'ETB'),
  ('RETAIL',        'SEMIANNUAL', 7500, 'ETB'),
  ('RETAIL',        'YEARLY',    14000, 'ETB'),
  ('HOSPITALITY',   'MONTHLY',    2500, 'ETB'),
  ('HOSPITALITY',   'QUARTERLY',  6500, 'ETB'),
  ('HOSPITALITY',   'SEMIANNUAL', 12000, 'ETB'),
  ('HOSPITALITY',   'YEARLY',    22000, 'ETB'),
  ('MANUFACTURING', 'MONTHLY',    2500, 'ETB'),
  ('MANUFACTURING', 'QUARTERLY',  6500, 'ETB'),
  ('MANUFACTURING', 'SEMIANNUAL', 12000, 'ETB'),
  ('MANUFACTURING', 'YEARLY',    22000, 'ETB'),
  ('SERVICE',       'MONTHLY',    1500, 'ETB'),
  ('SERVICE',       'QUARTERLY',  4000, 'ETB'),
  ('SERVICE',       'SEMIANNUAL', 7500, 'ETB'),
  ('SERVICE',       'YEARLY',    14000, 'ETB'),
  ('CAR_WASH',      'MONTHLY',    1200, 'ETB'),
  ('CAR_WASH',      'QUARTERLY',  3200, 'ETB'),
  ('CAR_WASH',      'SEMIANNUAL', 6000, 'ETB'),
  ('CAR_WASH',      'YEARLY',    11000, 'ETB')
ON CONFLICT DO NOTHING;

INSERT INTO "SubscriptionPlan" ("businessType", "term", "price", "currency") VALUES
  (NULL, 'MONTHLY',    1500, 'ETB'),
  (NULL, 'QUARTERLY',  4000, 'ETB'),
  (NULL, 'SEMIANNUAL', 7500, 'ETB'),
  (NULL, 'YEARLY',    14000, 'ETB')
ON CONFLICT DO NOTHING;

-- --- Backfill existing businesses ------------------------------------------
-- Every organization gets a subscription row so it is managed from day one.
-- Existing businesses (created before subscriptions existed) are grandfathered
-- with a trial of the configured length, counted from now, so no live tenant is
-- suddenly locked out.
INSERT INTO "TenantSubscription" ("organizationId", "status", "isTrial", "startedAt", "expiresAt")
SELECT
  o."id",
  'ACTIVE',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP + (COALESCE((SELECT "trialDays" FROM "SubscriptionSetting" WHERE "id" = 1), 14) * INTERVAL '1 day')
FROM "Organization" o
WHERE NOT EXISTS (
  SELECT 1 FROM "TenantSubscription" s WHERE s."organizationId" = o."id"
);
