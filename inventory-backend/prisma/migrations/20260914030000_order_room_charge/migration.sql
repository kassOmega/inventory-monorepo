-- Charge-to-room from the POS (Option A: package guests AND standard stays).
--  1. Order.hotelReservationId links a POS order to the guest's stay so the
--     charge can be deferred to that reservation's folio. Package guests keep
--     routing through packageGuestId (GuestFolioEntry); a standard stay posts
--     itemized FolioEntry lines on the reservation folio.
--  2. Order.netChargeMode persists the settlement intent chosen at order time
--     (PAY_NOW | DEFER_TO_FOLIO); null falls back to the company policy.
--  3. FolioEntry gains sourceService + unitPrice so the stay folio itemizes
--     exactly like the guest folio.
-- All statements are additive; existing rows are backfilled, never dropped.

-- AlterTable
ALTER TABLE "FolioEntry" ADD COLUMN     "sourceService" TEXT,
ADD COLUMN     "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "hotelReservationId" INTEGER,
ADD COLUMN     "netChargeMode" TEXT;

-- CreateIndex
CREATE INDEX "Order_hotelReservationId_idx" ON "Order"("hotelReservationId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_hotelReservationId_fkey" FOREIGN KEY ("hotelReservationId") REFERENCES "HotelReservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: historical folio lines were single-amount entries, so the unit
-- price snapshot equals the line amount.
UPDATE "FolioEntry" SET "unitPrice" = "amount";
