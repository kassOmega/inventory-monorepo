-- AlterTable
ALTER TABLE "PublicEntry" ADD COLUMN     "serviceType" "HospitalityServiceType";

-- AlterTable
ALTER TABLE "GuestOrder" ADD COLUMN     "tableNumber" TEXT,
ADD COLUMN     "startsAt" TIMESTAMP(3),
ADD COLUMN     "checkIn" TIMESTAMP(3),
ADD COLUMN     "checkOut" TIMESTAMP(3);
