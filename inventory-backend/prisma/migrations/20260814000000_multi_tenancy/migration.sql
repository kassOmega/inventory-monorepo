-- Multi-tenancy foundation: Organization (tenant), Membership, tenantId columns.
-- Backward-compatible: adds NULLABLE tenant columns, backfills a default
-- organization for the existing electrical business, and swaps global unique
-- constraints for tenant-scoped composite uniques.

-- 1) New enums
CREATE TYPE "OrgStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "BusinessType" AS ENUM ('ELECTRICAL', 'CAR_PARTS', 'GENERAL_GOODS', 'BOUTIQUE', 'CHILDREN_ACCESSORIES', 'HOTEL', 'RESTAURANT');

-- 2) Organization & Membership tables
CREATE TABLE "Organization" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "businessType" "BusinessType" NOT NULL DEFAULT 'ELECTRICAL',
    "currency" TEXT NOT NULL DEFAULT 'ETB',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Addis_Ababa',
    "status" "OrgStatus" NOT NULL DEFAULT 'ACTIVE',
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

CREATE TABLE "Membership" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "roleId" INTEGER,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Membership_userId_organizationId_key" ON "Membership"("userId", "organizationId");
CREATE INDEX "Membership_organizationId_idx" ON "Membership"("organizationId");
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) Tenant columns on role + business tables (nullable first)
ALTER TABLE "Role" ADD COLUMN "organizationId" INTEGER;
ALTER TABLE "LocationCategory" ADD COLUMN "tenantId" INTEGER;
ALTER TABLE "Location" ADD COLUMN "tenantId" INTEGER;
ALTER TABLE "Category" ADD COLUMN "tenantId" INTEGER;
ALTER TABLE "Product" ADD COLUMN "tenantId" INTEGER;
ALTER TABLE "Unit" ADD COLUMN "tenantId" INTEGER;
ALTER TABLE "PriceHistory" ADD COLUMN "tenantId" INTEGER;
ALTER TABLE "Inventory" ADD COLUMN "tenantId" INTEGER;
ALTER TABLE "StockRequest" ADD COLUMN "tenantId" INTEGER;
ALTER TABLE "RequestItem" ADD COLUMN "tenantId" INTEGER;
ALTER TABLE "Sale" ADD COLUMN "tenantId" INTEGER;
ALTER TABLE "SaleItem" ADD COLUMN "tenantId" INTEGER;
ALTER TABLE "Return" ADD COLUMN "tenantId" INTEGER;
ALTER TABLE "ReturnItem" ADD COLUMN "tenantId" INTEGER;
ALTER TABLE "PaymentMethod" ADD COLUMN "tenantId" INTEGER;
ALTER TABLE "Customer" ADD COLUMN "tenantId" INTEGER;
ALTER TABLE "CreditSale" ADD COLUMN "tenantId" INTEGER;
ALTER TABLE "CreditSaleItem" ADD COLUMN "tenantId" INTEGER;
ALTER TABLE "CreditPayment" ADD COLUMN "tenantId" INTEGER;
ALTER TABLE "Purchase" ADD COLUMN "tenantId" INTEGER;
ALTER TABLE "Notification" ADD COLUMN "tenantId" INTEGER;
ALTER TABLE "AuditLog" ADD COLUMN "tenantId" INTEGER;

-- 4) Backfill: create the default organization (the current electrical business),
--    scope existing roles, assign every existing row to it, and create memberships.
DO $$
DECLARE
    org_id INTEGER;
BEGIN
    INSERT INTO "Organization" ("name", "slug", "businessType", "currency", "timezone", "status", "createdAt", "updatedAt")
    VALUES ('Nejat Electrical', 'nejat-electrical', 'ELECTRICAL', 'ETB', 'Africa/Addis_Ababa', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    RETURNING "id" INTO org_id;

    UPDATE "Role" SET "organizationId" = org_id WHERE "organizationId" IS NULL;

    UPDATE "LocationCategory" SET "tenantId" = org_id WHERE "tenantId" IS NULL;
    UPDATE "Location" SET "tenantId" = org_id WHERE "tenantId" IS NULL;
    UPDATE "Category" SET "tenantId" = org_id WHERE "tenantId" IS NULL;
    UPDATE "Product" SET "tenantId" = org_id WHERE "tenantId" IS NULL;
    UPDATE "Unit" SET "tenantId" = org_id WHERE "tenantId" IS NULL;
    UPDATE "PriceHistory" SET "tenantId" = org_id WHERE "tenantId" IS NULL;
    UPDATE "Inventory" SET "tenantId" = org_id WHERE "tenantId" IS NULL;
    UPDATE "StockRequest" SET "tenantId" = org_id WHERE "tenantId" IS NULL;
    UPDATE "RequestItem" SET "tenantId" = org_id WHERE "tenantId" IS NULL;
    UPDATE "Sale" SET "tenantId" = org_id WHERE "tenantId" IS NULL;
    UPDATE "SaleItem" SET "tenantId" = org_id WHERE "tenantId" IS NULL;
    UPDATE "Return" SET "tenantId" = org_id WHERE "tenantId" IS NULL;
    UPDATE "ReturnItem" SET "tenantId" = org_id WHERE "tenantId" IS NULL;
    UPDATE "PaymentMethod" SET "tenantId" = org_id WHERE "tenantId" IS NULL;
    UPDATE "Customer" SET "tenantId" = org_id WHERE "tenantId" IS NULL;
    UPDATE "CreditSale" SET "tenantId" = org_id WHERE "tenantId" IS NULL;
    UPDATE "CreditSaleItem" SET "tenantId" = org_id WHERE "tenantId" IS NULL;
    UPDATE "CreditPayment" SET "tenantId" = org_id WHERE "tenantId" IS NULL;
    UPDATE "Purchase" SET "tenantId" = org_id WHERE "tenantId" IS NULL;
    UPDATE "Notification" SET "tenantId" = org_id WHERE "tenantId" IS NULL;
    UPDATE "AuditLog" SET "tenantId" = org_id WHERE "tenantId" IS NULL;

    INSERT INTO "Membership" ("userId", "organizationId", "roleId", "status")
    SELECT "id", org_id, "roleId", 'ACTIVE' FROM "User" WHERE "roleId" IS NOT NULL;
END $$;

-- 5) Foreign key for role -> organization
ALTER TABLE "Role" ADD CONSTRAINT "Role_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6) Indexes for tenant columns
CREATE INDEX "Role_organizationId_idx" ON "Role"("organizationId");
CREATE INDEX "LocationCategory_tenantId_idx" ON "LocationCategory"("tenantId");
CREATE INDEX "Location_tenantId_idx" ON "Location"("tenantId");
CREATE INDEX "Category_tenantId_idx" ON "Category"("tenantId");
CREATE INDEX "Product_tenantId_idx" ON "Product"("tenantId");
CREATE INDEX "Unit_tenantId_idx" ON "Unit"("tenantId");
CREATE INDEX "PriceHistory_tenantId_idx" ON "PriceHistory"("tenantId");
CREATE INDEX "Inventory_tenantId_idx" ON "Inventory"("tenantId");
CREATE INDEX "StockRequest_tenantId_idx" ON "StockRequest"("tenantId");
CREATE INDEX "RequestItem_tenantId_idx" ON "RequestItem"("tenantId");
CREATE INDEX "Sale_tenantId_idx" ON "Sale"("tenantId");
CREATE INDEX "SaleItem_tenantId_idx" ON "SaleItem"("tenantId");
CREATE INDEX "Return_tenantId_idx" ON "Return"("tenantId");
CREATE INDEX "ReturnItem_tenantId_idx" ON "ReturnItem"("tenantId");
CREATE INDEX "PaymentMethod_tenantId_idx" ON "PaymentMethod"("tenantId");
CREATE INDEX "Customer_tenantId_idx" ON "Customer"("tenantId");
CREATE INDEX "CreditSale_tenantId_idx" ON "CreditSale"("tenantId");
CREATE INDEX "CreditSaleItem_tenantId_idx" ON "CreditSaleItem"("tenantId");
CREATE INDEX "CreditPayment_tenantId_idx" ON "CreditPayment"("tenantId");
CREATE INDEX "Purchase_tenantId_idx" ON "Purchase"("tenantId");
CREATE INDEX "Notification_tenantId_idx" ON "Notification"("tenantId");
CREATE INDEX "AuditLog_tenantId_idx" ON "AuditLog"("tenantId");

-- 7) Replace global unique constraints with tenant-scoped composite uniques
DROP INDEX "Role_name_key";
DROP INDEX "LocationCategory_name_key";
DROP INDEX "Category_name_key";
DROP INDEX "Product_sku_key";
DROP INDEX "Unit_name_key";
DROP INDEX "Sale_invoiceNumber_key";
DROP INDEX "PaymentMethod_name_key";

CREATE UNIQUE INDEX "Role_organizationId_name_key" ON "Role"("organizationId", "name");
CREATE UNIQUE INDEX "LocationCategory_tenantId_name_key" ON "LocationCategory"("tenantId", "name");
CREATE UNIQUE INDEX "Category_tenantId_name_key" ON "Category"("tenantId", "name");
CREATE UNIQUE INDEX "Product_tenantId_sku_key" ON "Product"("tenantId", "sku");
CREATE UNIQUE INDEX "Unit_tenantId_name_key" ON "Unit"("tenantId", "name");
CREATE UNIQUE INDEX "Sale_tenantId_invoiceNumber_key" ON "Sale"("tenantId", "invoiceNumber");
CREATE UNIQUE INDEX "PaymentMethod_tenantId_name_key" ON "PaymentMethod"("tenantId", "name");

