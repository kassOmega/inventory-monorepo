-- Chunk 3: cross-service packages, entitlement kinds and package check-ins.
--  1. HospitalityPackage.hospitalityServiceId becomes nullable so a package can
--     span services (Room + Spa voucher + Gym access). The FK switches to
--     ON DELETE SET NULL so removing a service keeps the package.
--  2. PackageEntitlement gains entitlementKind (ITEM | CREDIT | PASS), a
--     hospitalityServiceId (service-scoped credits/passes) and a
--     membershipTypeId (a PASS for a specific pass plan).
--  3. FacilityVisitType gains PACKAGE: a check-in billed against a package
--     guest's entitlement instead of a walk-in day pass.
-- All statements are additive/backfilled; existing rows default to ITEM.

-- AlterEnum
ALTER TYPE "FacilityVisitType" ADD VALUE IF NOT EXISTS 'PACKAGE';

-- AlterTable
ALTER TABLE "HospitalityPackage" ALTER COLUMN "hospitalityServiceId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PackageEntitlement" ADD COLUMN "entitlementKind" TEXT NOT NULL DEFAULT 'ITEM';

-- AlterTable
ALTER TABLE "PackageEntitlement" ADD COLUMN "hospitalityServiceId" TEXT;

-- AlterTable
ALTER TABLE "PackageEntitlement" ADD COLUMN "membershipTypeId" TEXT;

-- CreateIndex
CREATE INDEX "PackageEntitlement_hospitalityServiceId_idx" ON "PackageEntitlement"("hospitalityServiceId");

-- DropIndex + CreateIndex (the uniqueness now accounts for the new targets)
DROP INDEX "PackageEntitlement_packageId_stationId_menuCategoryId_menuItemId_key";
CREATE UNIQUE INDEX "PackageEntitlement_packageId_stationId_menuCategoryId_menuI_key" ON "PackageEntitlement"("packageId", "stationId", "menuCategoryId", "menuItemId", "hospitalityServiceId", "entitlementKind", "membershipTypeId");

-- Swap the package -> service FK to SET NULL for optional primary service
ALTER TABLE "HospitalityPackage" DROP CONSTRAINT "HospitalityPackage_hospitalityServiceId_fkey";
ALTER TABLE "HospitalityPackage" ADD CONSTRAINT "HospitalityPackage_hospitalityServiceId_fkey" FOREIGN KEY ("hospitalityServiceId") REFERENCES "HospitalityService"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageEntitlement" ADD CONSTRAINT "PackageEntitlement_hospitalityServiceId_fkey" FOREIGN KEY ("hospitalityServiceId") REFERENCES "HospitalityService"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageEntitlement" ADD CONSTRAINT "PackageEntitlement_membershipTypeId_fkey" FOREIGN KEY ("membershipTypeId") REFERENCES "MembershipType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
