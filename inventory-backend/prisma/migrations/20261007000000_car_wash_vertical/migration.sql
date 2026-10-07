-- Car Wash vertical: business type, enums and tenant-scoped models. Purely
-- additive — no existing columns are dropped or re-typed.

-- 1. New business type.
ALTER TYPE "BusinessType" ADD VALUE 'CAR_WASH';

-- 2. New enums.
CREATE TYPE "CarWashBookingStatus" AS ENUM ('PENDING', 'SERVING', 'COMPLETED', 'CANCELLED');
CREATE TYPE "CarWashStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- 3. Per-vertical profile.
CREATE TABLE "CarWashProfile" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "slotMinutes" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CarWashProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CarWashProfile_organizationId_key" ON "CarWashProfile"("organizationId");

-- 4. Washers (with optional linked login account).
CREATE TABLE "CarWashWasher" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "userId" INTEGER,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CarWashWasher_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CarWashWasher_userId_key" ON "CarWashWasher"("userId");
CREATE INDEX "CarWashWasher_tenantId_isActive_idx" ON "CarWashWasher"("tenantId", "isActive");

-- 5. Vehicle-type price list.
CREATE TABLE "CarWashPrice" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "vehicleType" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CarWashPrice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CarWashPrice_tenantId_vehicleType_key" ON "CarWashPrice"("tenantId", "vehicleType");
CREATE INDEX "CarWashPrice_tenantId_idx" ON "CarWashPrice"("tenantId");

-- 6. Customer vehicles.
CREATE TABLE "CarWashVehicle" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "customerId" INTEGER,
    "plateNumber" TEXT NOT NULL,
    "vehicleType" TEXT NOT NULL DEFAULT 'Car',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CarWashVehicle_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CarWashVehicle_tenantId_plateNumber_key" ON "CarWashVehicle"("tenantId", "plateNumber");
CREATE INDEX "CarWashVehicle_tenantId_idx" ON "CarWashVehicle"("tenantId");

-- 7. Bookings (time-slot + walk-in queue).
CREATE TABLE "CarWashBooking" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "customerId" INTEGER,
    "vehicleId" INTEGER,
    "washerId" INTEGER,
    "vehicleType" TEXT NOT NULL DEFAULT 'Car',
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isTimeSlotBooking" BOOLEAN NOT NULL DEFAULT false,
    "bookingDate" TIMESTAMP(3) NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "positionInQueue" INTEGER,
    "status" "CarWashBookingStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CarWashBooking_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CarWashBooking_tenantId_bookingDate_idx" ON "CarWashBooking"("tenantId", "bookingDate");
CREATE INDEX "CarWashBooking_tenantId_status_idx" ON "CarWashBooking"("tenantId", "status");

-- 8. Wash jobs (revenue). Primary + participant washers.
CREATE TABLE "CarWash" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "customerId" INTEGER,
    "vehicleId" INTEGER,
    "washerId" INTEGER,
    "vehicleType" TEXT NOT NULL DEFAULT 'Car',
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "CarWashStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "recordedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CarWash_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CarWash_tenantId_date_idx" ON "CarWash"("tenantId", "date");
CREATE INDEX "CarWash_tenantId_washerId_idx" ON "CarWash"("tenantId", "washerId");
CREATE INDEX "CarWash_tenantId_status_idx" ON "CarWash"("tenantId", "status");

-- 9. CarWash <-> CarWashWasher many-to-many (participant washers).
CREATE TABLE "_CarWashToCarWashWasher" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);
CREATE UNIQUE INDEX "_CarWashToCarWashWasher_AB_unique" ON "_CarWashToCarWashWasher"("A", "B");
CREATE INDEX "_CarWashToCarWashWasher_B_index" ON "_CarWashToCarWashWasher"("B");

-- 10. Equipment issued to washers.
CREATE TABLE "CarWashEquipmentIssue" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "washerId" INTEGER,
    "productId" INTEGER,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CarWashEquipmentIssue_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CarWashEquipmentIssue_tenantId_issuedAt_idx" ON "CarWashEquipmentIssue"("tenantId", "issuedAt");
CREATE INDEX "CarWashEquipmentIssue_tenantId_washerId_idx" ON "CarWashEquipmentIssue"("tenantId", "washerId");
CREATE INDEX "CarWashEquipmentIssue_tenantId_isPaid_idx" ON "CarWashEquipmentIssue"("tenantId", "isPaid");

-- 11. Daily money collection.
CREATE TABLE "CarWashCollection" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "collectedById" INTEGER,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dailyOwnerShare" DOUBLE PRECISION,
    "equipmentRevenue" DOUBLE PRECISION,
    "totalExpenses" DOUBLE PRECISION,
    "netAmountDue" DOUBLE PRECISION,
    "netProfit" DOUBLE PRECISION,
    "remainingBalance" DOUBLE PRECISION,
    "collectionDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CarWashCollection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CarWashCollection_tenantId_collectionDate_idx" ON "CarWashCollection"("tenantId", "collectionDate");

-- 12. Foreign keys.
ALTER TABLE "CarWashProfile" ADD CONSTRAINT "CarWashProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CarWashWasher" ADD CONSTRAINT "CarWashWasher_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CarWashWasher" ADD CONSTRAINT "CarWashWasher_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CarWashPrice" ADD CONSTRAINT "CarWashPrice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CarWashVehicle" ADD CONSTRAINT "CarWashVehicle_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CarWashVehicle" ADD CONSTRAINT "CarWashVehicle_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CarWashBooking" ADD CONSTRAINT "CarWashBooking_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CarWashBooking" ADD CONSTRAINT "CarWashBooking_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CarWashBooking" ADD CONSTRAINT "CarWashBooking_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "CarWashVehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CarWashBooking" ADD CONSTRAINT "CarWashBooking_washerId_fkey" FOREIGN KEY ("washerId") REFERENCES "CarWashWasher"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CarWash" ADD CONSTRAINT "CarWash_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CarWash" ADD CONSTRAINT "CarWash_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CarWash" ADD CONSTRAINT "CarWash_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "CarWashVehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CarWash" ADD CONSTRAINT "CarWash_washerId_fkey" FOREIGN KEY ("washerId") REFERENCES "CarWashWasher"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CarWash" ADD CONSTRAINT "CarWash_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "_CarWashToCarWashWasher" ADD CONSTRAINT "_CarWashToCarWashWasher_A_fkey" FOREIGN KEY ("A") REFERENCES "CarWash"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_CarWashToCarWashWasher" ADD CONSTRAINT "_CarWashToCarWashWasher_B_fkey" FOREIGN KEY ("B") REFERENCES "CarWashWasher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CarWashEquipmentIssue" ADD CONSTRAINT "CarWashEquipmentIssue_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CarWashEquipmentIssue" ADD CONSTRAINT "CarWashEquipmentIssue_washerId_fkey" FOREIGN KEY ("washerId") REFERENCES "CarWashWasher"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CarWashEquipmentIssue" ADD CONSTRAINT "CarWashEquipmentIssue_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CarWashCollection" ADD CONSTRAINT "CarWashCollection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CarWashCollection" ADD CONSTRAINT "CarWashCollection_collectedById_fkey" FOREIGN KEY ("collectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


