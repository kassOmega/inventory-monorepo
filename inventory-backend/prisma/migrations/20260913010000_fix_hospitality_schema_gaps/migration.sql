-- Hospitality schema rectification (items 1-4):
--  1. PackageGuest.hotelReservationId bridges ROOM_CHARGE billing to the hotel stay
--     (roomNumber is kept for POS display and legacy string lookups).
--  2. Role.systemKey + partial unique index lets notifications target immutable
--     role keys (CASHIER, RECEPTIONIST, CHEF, STATION_<KEY>, ...) instead of names.
--  3. Strict tenancy: Product/Sale/Order/Inventory tenantId is NOT NULL with an
--     Organization FK. Additive for main: no columns are dropped.

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "systemKey" TEXT;

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Inventory" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Sale" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "PackageGuest" ADD COLUMN     "hotelReservationId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Role_organizationId_systemKey_key" ON "Role"("organizationId", "systemKey");

-- CreateIndex
CREATE INDEX "PackageGuest_hotelReservationId_idx" ON "PackageGuest"("hotelReservationId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageGuest" ADD CONSTRAINT "PackageGuest_hotelReservationId_fkey" FOREIGN KEY ("hotelReservationId") REFERENCES "HotelReservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

