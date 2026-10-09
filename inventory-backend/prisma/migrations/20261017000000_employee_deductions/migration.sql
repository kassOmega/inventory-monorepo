-- Employee loans & penalties (deducted from salary / commission) + salary fields.
-- Idempotent so it can re-run safely on legacy `db push` databases.

-- --- Enums ------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "SalaryPeriod" AS ENUM ('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "EmployeeDeductionKind" AS ENUM ('LOAN', 'PENALTY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "EmployeeDeductionSource" AS ENUM ('SALARY', 'COMMISSION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "EmployeeDeductionStatus" AS ENUM ('OPEN', 'PARTIAL', 'PAID', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- Salary fields on User + CarWashWasher ----------------------------------
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "salaryAmount" DOUBLE PRECISION;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "salaryPeriod" "SalaryPeriod";
ALTER TABLE "CarWashWasher" ADD COLUMN IF NOT EXISTS "salaryAmount" DOUBLE PRECISION;
ALTER TABLE "CarWashWasher" ADD COLUMN IF NOT EXISTS "salaryPeriod" "SalaryPeriod";

-- --- EmployeeDeduction ------------------------------------------------------
CREATE TABLE IF NOT EXISTS "EmployeeDeduction" (
  "id"              SERIAL PRIMARY KEY,
  "tenantId"        INTEGER NOT NULL,
  "userId"          INTEGER,
  "washerId"        INTEGER,
  "kind"            "EmployeeDeductionKind" NOT NULL,
  "source"          "EmployeeDeductionSource" NOT NULL DEFAULT 'SALARY',
  "reason"          TEXT NOT NULL,
  "amount"          DOUBLE PRECISION NOT NULL,
  "recoveredAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status"          "EmployeeDeductionStatus" NOT NULL DEFAULT 'OPEN',
  "issuedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueAt"           TIMESTAMP(3),
  "notes"           TEXT,
  "createdById"     INTEGER,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "EmployeeDeduction_tenantId_userId_idx" ON "EmployeeDeduction" ("tenantId", "userId");
CREATE INDEX IF NOT EXISTS "EmployeeDeduction_tenantId_washerId_idx" ON "EmployeeDeduction" ("tenantId", "washerId");
CREATE INDEX IF NOT EXISTS "EmployeeDeduction_tenantId_status_idx" ON "EmployeeDeduction" ("tenantId", "status");
CREATE INDEX IF NOT EXISTS "EmployeeDeduction_tenantId_dueAt_idx" ON "EmployeeDeduction" ("tenantId", "dueAt");

DO $$ BEGIN
  ALTER TABLE "EmployeeDeduction"
    ADD CONSTRAINT "EmployeeDeduction_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "EmployeeDeduction"
    ADD CONSTRAINT "EmployeeDeduction_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "EmployeeDeduction"
    ADD CONSTRAINT "EmployeeDeduction_washerId_fkey"
    FOREIGN KEY ("washerId") REFERENCES "CarWashWasher"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- EmployeeDeductionRecovery ----------------------------------------------
CREATE TABLE IF NOT EXISTS "EmployeeDeductionRecovery" (
  "id"          SERIAL PRIMARY KEY,
  "deductionId" INTEGER NOT NULL,
  "tenantId"    INTEGER NOT NULL,
  "amount"      DOUBLE PRECISION NOT NULL,
  "recoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "note"        TEXT,
  "createdById" INTEGER,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "EmployeeDeductionRecovery_tenantId_deductionId_idx"
  ON "EmployeeDeductionRecovery" ("tenantId", "deductionId");

DO $$ BEGIN
  ALTER TABLE "EmployeeDeductionRecovery"
    ADD CONSTRAINT "EmployeeDeductionRecovery_deductionId_fkey"
    FOREIGN KEY ("deductionId") REFERENCES "EmployeeDeduction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --- Permissions ------------------------------------------------------------
INSERT INTO "Permission" ("key", "label", "group") VALUES
  ('deductions.view',   'View Employee Deductions',   'Deductions'),
  ('deductions.manage', 'Manage Employee Deductions', 'Deductions')
ON CONFLICT ("key") DO UPDATE SET "label" = EXCLUDED."label", "group" = EXCLUDED."group";

-- Owner roles already hold every key via the seed; grant to Manager by default.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."key" IN ('deductions.view', 'deductions.manage')
WHERE r."systemKey" = 'MANAGER'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- --- Default account: Employee Loans Receivable (asset, 1120) ---------------
INSERT INTO "Account" ("tenantId", "name", "code", "type", "isSystem")
SELECT o."id", 'Employee Loans Receivable', '1120', 'ASSET', false
FROM "Organization" o
WHERE NOT EXISTS (
  SELECT 1 FROM "Account" a WHERE a."tenantId" = o."id" AND a."name" = 'Employee Loans Receivable'
);
