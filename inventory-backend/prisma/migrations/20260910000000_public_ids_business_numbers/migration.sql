-- AlterTable
ALTER TABLE "CreditSale" ADD COLUMN     "number" INTEGER,
ADD COLUMN     "publicId" UUID NOT NULL DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "number" INTEGER,
ADD COLUMN     "publicId" UUID NOT NULL DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "number" INTEGER,
ADD COLUMN     "publicId" UUID NOT NULL DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "StockRequest" ADD COLUMN     "number" INTEGER,
ADD COLUMN     "publicId" UUID NOT NULL DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "publicId" UUID NOT NULL DEFAULT gen_random_uuid();

-- CreateTable
CREATE TABLE "TenantCounter" (
    "tenantId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TenantCounter_pkey" PRIMARY KEY ("tenantId","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditSale_publicId_key" ON "CreditSale"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditSale_tenantId_number_key" ON "CreditSale"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_publicId_key" ON "Customer"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_organizationId_number_key" ON "Customer"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_publicId_key" ON "Membership"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_organizationId_number_key" ON "Membership"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "StockRequest_publicId_key" ON "StockRequest"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "StockRequest_tenantId_number_key" ON "StockRequest"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "User_publicId_key" ON "User"("publicId");


-- ---------------------------------------------------------------------------
-- Business-number backfill: pad existing rows per business (001, 002, ...)
-- ---------------------------------------------------------------------------
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY id) AS rn
  FROM "Customer"
)
UPDATE "Customer" t SET "number" = r.rn FROM ranked r
WHERE t.id = r.id AND t."number" IS NULL;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY COALESCE("tenantId", 0) ORDER BY id) AS rn
  FROM "CreditSale"
)
UPDATE "CreditSale" t SET "number" = r.rn FROM ranked r
WHERE t.id = r.id AND t."number" IS NULL;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY COALESCE("tenantId", 0) ORDER BY id) AS rn
  FROM "StockRequest"
)
UPDATE "StockRequest" t SET "number" = r.rn FROM ranked r
WHERE t.id = r.id AND t."number" IS NULL;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY id) AS rn
  FROM "Membership"
)
UPDATE "Membership" t SET "number" = r.rn FROM ranked r
WHERE t.id = r.id AND t."number" IS NULL;

-- Seed the per-business counters to the current maximum so new rows continue.
INSERT INTO "TenantCounter" ("tenantId", "key", "value")
SELECT COALESCE("organizationId", 0), 'customer', COALESCE(MAX("number"), 0)
FROM "Customer" GROUP BY 1
ON CONFLICT ("tenantId", "key")
DO UPDATE SET "value" = GREATEST("TenantCounter"."value", EXCLUDED."value");

INSERT INTO "TenantCounter" ("tenantId", "key", "value")
SELECT COALESCE("tenantId", 0), 'credit', COALESCE(MAX("number"), 0)
FROM "CreditSale" GROUP BY 1
ON CONFLICT ("tenantId", "key")
DO UPDATE SET "value" = GREATEST("TenantCounter"."value", EXCLUDED."value");

INSERT INTO "TenantCounter" ("tenantId", "key", "value")
SELECT COALESCE("tenantId", 0), 'request', COALESCE(MAX("number"), 0)
FROM "StockRequest" GROUP BY 1
ON CONFLICT ("tenantId", "key")
DO UPDATE SET "value" = GREATEST("TenantCounter"."value", EXCLUDED."value");

INSERT INTO "TenantCounter" ("tenantId", "key", "value")
SELECT COALESCE("organizationId", 0), 'member', COALESCE(MAX("number"), 0)
FROM "Membership" GROUP BY 1
ON CONFLICT ("tenantId", "key")
DO UPDATE SET "value" = GREATEST("TenantCounter"."value", EXCLUDED."value");

-- ---------------------------------------------------------------------------
-- Auto-assign numbers on insert (no application-flow changes needed).
-- Each inserted row atomically bumps its business counter; numbers restart at
-- 1 per business and may repeat across businesses.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assign_business_number() RETURNS trigger AS $$
DECLARE
  counter_key text := TG_ARGV[0];
  tenant_col  text := TG_ARGV[1];
  tenant_val  int;
  next_val    int;
BEGIN
  IF NEW.number IS NOT NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format('SELECT ($1).%I', tenant_col) INTO tenant_val USING NEW;
  tenant_val := COALESCE(tenant_val, 0);

  INSERT INTO "TenantCounter" ("tenantId", "key", "value")
  VALUES (tenant_val, counter_key, 1)
  ON CONFLICT ("tenantId", "key")
  DO UPDATE SET "value" = "TenantCounter"."value" + 1
  RETURNING "value" INTO next_val;

  NEW.number := next_val;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_business_number ON "Customer";
CREATE TRIGGER set_business_number BEFORE INSERT ON "Customer"
  FOR EACH ROW EXECUTE FUNCTION assign_business_number('customer', 'organizationId');

DROP TRIGGER IF EXISTS set_business_number ON "CreditSale";
CREATE TRIGGER set_business_number BEFORE INSERT ON "CreditSale"
  FOR EACH ROW EXECUTE FUNCTION assign_business_number('credit', 'tenantId');

DROP TRIGGER IF EXISTS set_business_number ON "StockRequest";
CREATE TRIGGER set_business_number BEFORE INSERT ON "StockRequest"
  FOR EACH ROW EXECUTE FUNCTION assign_business_number('request', 'tenantId');

DROP TRIGGER IF EXISTS set_business_number ON "Membership";
CREATE TRIGGER set_business_number BEFORE INSERT ON "Membership"
  FOR EACH ROW EXECUTE FUNCTION assign_business_number('member', 'organizationId');
