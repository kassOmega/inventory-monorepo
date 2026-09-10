-- Give customers an explicit relationship to the business they belong to.
-- Previously the link was only the implicit, nullable `tenantId` convention;
-- now it is a real, required FK to "Organization" (the middleware tags
-- `organizationId` for Customer the same way it tags `tenantId` elsewhere).

ALTER TABLE "Customer" ADD COLUMN "organizationId" INTEGER;

UPDATE "Customer" SET "organizationId" = "tenantId" WHERE "organizationId" IS NULL AND "tenantId" IS NOT NULL;

ALTER TABLE "Customer" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "Customer" ADD CONSTRAINT "Customer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Customer_organizationId_idx" ON "Customer"("organizationId");

DROP INDEX IF EXISTS "Customer_tenantId_idx";
ALTER TABLE "Customer" DROP COLUMN "tenantId";
