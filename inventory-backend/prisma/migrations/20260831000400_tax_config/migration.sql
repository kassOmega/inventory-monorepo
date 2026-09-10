-- Per-company tax configuration: tax rates with a real FK to Organization
-- (cascade delete), plus company-level tax settings on the Organization row.
-- The tenant middleware auto-scopes TaxRate by organizationId.

-- CreateEnum
CREATE TYPE "TaxDirection" AS ENUM ('OUTPUT', 'INPUT');

-- CreateTable
CREATE TABLE "TaxRate" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "rate" DOUBLE PRECISION NOT NULL,
    "direction" "TaxDirection" NOT NULL DEFAULT 'OUTPUT',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "taxEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "taxInclusive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "taxId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TaxRate_organizationId_name_key" ON "TaxRate"("organizationId", "name");
CREATE INDEX "TaxRate_organizationId_idx" ON "TaxRate"("organizationId");

-- AddForeignKey
ALTER TABLE "TaxRate" ADD CONSTRAINT "TaxRate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
