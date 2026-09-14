-- Hotel PMS refactor: billing creator metadata, guest identification, and a
-- tenant-configurable guest ID-type registry.
--  1. Billing creators: every folio line records the staff member who posted it
--     (FolioEntry.createdBy / GuestFolioEntry.createdBy) and the stay folio
--     records who opened/settled it (Folio.createdBy / Folio.settledBy,
--     GuestFolio.settledBy). FolioEntry.orderId links POS lines to their order.
--  2. Guest registration: HotelReservation captures contact + ID details and the
--     receptionist who checked the guest in.
--  3. GuestIdType: replaces the planned static enum with a tenant-scoped,
--     owner-managed registry (never hard-deleted, deactivate only).
-- All statements are additive; nothing is dropped.

-- CreateTable
CREATE TABLE "GuestIdType" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameI18n" JSONB,
    "requiresExpiry" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestIdType_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Folio" ADD COLUMN     "createdById" INTEGER,
ADD COLUMN     "settledById" INTEGER;

-- AlterTable
ALTER TABLE "FolioEntry" ADD COLUMN     "orderId" INTEGER;

-- AlterTable
ALTER TABLE "GuestFolioEntry" ADD COLUMN     "createdById" INTEGER;

-- AlterTable
ALTER TABLE "HotelReservation" ADD COLUMN     "address" TEXT,
ADD COLUMN     "checkedInById" INTEGER,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "emergencyContactName" TEXT,
ADD COLUMN     "emergencyContactPhone" TEXT,
ADD COLUMN     "idDocumentUrl" TEXT,
ADD COLUMN     "idExpiryDate" TIMESTAMP(3),
ADD COLUMN     "idNumber" TEXT,
ADD COLUMN     "idTypeId" INTEGER,
ADD COLUMN     "nationality" TEXT;

-- CreateIndex
CREATE INDEX "GuestIdType_tenantId_idx" ON "GuestIdType"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "GuestIdType_tenantId_code_key" ON "GuestIdType"("tenantId", "code");

-- CreateIndex
CREATE INDEX "FolioEntry_orderId_idx" ON "FolioEntry"("orderId");

-- CreateIndex
CREATE INDEX "HotelReservation_idTypeId_idx" ON "HotelReservation"("idTypeId");

-- AddForeignKey
ALTER TABLE "HotelReservation" ADD CONSTRAINT "HotelReservation_idTypeId_fkey" FOREIGN KEY ("idTypeId") REFERENCES "GuestIdType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HotelReservation" ADD CONSTRAINT "HotelReservation_checkedInById_fkey" FOREIGN KEY ("checkedInById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folio" ADD CONSTRAINT "Folio_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folio" ADD CONSTRAINT "Folio_settledById_fkey" FOREIGN KEY ("settledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FolioEntry" ADD CONSTRAINT "FolioEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestFolio" ADD CONSTRAINT "GuestFolio_settledById_fkey" FOREIGN KEY ("settledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestFolioEntry" ADD CONSTRAINT "GuestFolioEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
