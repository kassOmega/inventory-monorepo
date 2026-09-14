-- Chunk 2: itemized folio lines + facility/package bridge + checkout safety.
--  1. GuestFolioEntry gains the fields the itemized bill needs beyond raw
--     totals: the service line it was consumed under (sourceService) and the
--     item's unit-price snapshot (unitPrice; totalPrice = unitPrice x quantity).
--  2. FacilityVisit.packageGuestId links a gym/pool/spa check-in to the guest's
--     package so entitlements can be consumed at $0 (walk-ins keep a day pass).
-- All statements are additive; existing rows are backfilled, never dropped.

-- AlterTable
ALTER TABLE "GuestFolioEntry" ADD COLUMN "sourceService" TEXT;

-- AlterTable
ALTER TABLE "GuestFolioEntry" ADD COLUMN "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "FacilityVisit" ADD COLUMN "packageGuestId" TEXT;

-- CreateIndex
CREATE INDEX "FacilityVisit_packageGuestId_idx" ON "FacilityVisit"("packageGuestId");

-- AddForeignKey
ALTER TABLE "FacilityVisit" ADD CONSTRAINT "FacilityVisit_packageGuestId_fkey" FOREIGN KEY ("packageGuestId") REFERENCES "PackageGuest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: derive the unit price from the historical gross price so folios
-- created before this migration still itemize correctly.
UPDATE "GuestFolioEntry"
SET "unitPrice" = CASE
  WHEN "quantity" > 0 THEN "grossPrice" / "quantity"
  ELSE "grossPrice"
END;
