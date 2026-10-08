-- Car-wash bookings carry multiple vehicles (one row per vehicle) with their
-- own wash type and price. Existing bookings become a single-item booking so no
-- data is lost.

-- CreateTable
CREATE TABLE "CarWashBookingItem" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "bookingId" INTEGER NOT NULL,
    "vehicleId" INTEGER,
    "vehicleType" TEXT NOT NULL DEFAULT 'Car',
    "washTypeId" INTEGER,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "date" TIMESTAMP(3),
    "startsAt" TIMESTAMP(3),
    "washId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarWashBookingItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CarWashBookingItem_tenantId_idx" ON "CarWashBookingItem"("tenantId");

-- CreateIndex
CREATE INDEX "CarWashBookingItem_bookingId_idx" ON "CarWashBookingItem"("bookingId");

-- AddForeignKey
ALTER TABLE "CarWashBookingItem" ADD CONSTRAINT "CarWashBookingItem_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "CarWashBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarWashBookingItem" ADD CONSTRAINT "CarWashBookingItem_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "CarWashVehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarWashBookingItem" ADD CONSTRAINT "CarWashBookingItem_washTypeId_fkey" FOREIGN KEY ("washTypeId") REFERENCES "CarWashWashType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarWashBookingItem" ADD CONSTRAINT "CarWashBookingItem_washId_fkey" FOREIGN KEY ("washId") REFERENCES "CarWash"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every existing booking becomes one item carrying its vehicle,
-- price and time, so the booking list keeps showing what it did before.
INSERT INTO "CarWashBookingItem" ("tenantId", "bookingId", "vehicleId", "vehicleType", "amount", "date", "startsAt")
SELECT "tenantId", "id", "vehicleId", "vehicleType", "amount", "bookingDate", "startsAt"
FROM "CarWashBooking";
