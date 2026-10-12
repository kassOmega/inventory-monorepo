-- AlterTable
-- IF NOT EXISTS: safe to replay when the schema was already synced by db push.
ALTER TABLE "PublicEntry" ADD COLUMN IF NOT EXISTS "serviceType" "HospitalityServiceType";

-- AlterTable
ALTER TABLE "GuestOrder" ADD COLUMN IF NOT EXISTS "tableNumber" TEXT,
ADD COLUMN IF NOT EXISTS "startsAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "checkIn" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "checkOut" TIMESTAMP(3);
