-- CreateEnum
CREATE TYPE "RequestType" AS ENUM ('SHOP_TO_STORE', 'STORE_TO_OWNER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RequestItemStatus" ADD VALUE 'STORED';
ALTER TYPE "RequestItemStatus" ADD VALUE 'RECEIVED';

-- AlterEnum
ALTER TYPE "RequestStatus" ADD VALUE 'CLOSED';

-- DropForeignKey
ALTER TABLE "StockRequest" DROP CONSTRAINT "StockRequest_shopId_fkey";

-- AlterTable
ALTER TABLE "RequestItem" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedById" INTEGER,
ADD COLUMN     "quantityStored" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "quantityRequested" DROP NOT NULL;

-- AlterTable
ALTER TABLE "StockRequest" ADD COLUMN     "requestType" "RequestType" NOT NULL DEFAULT 'SHOP_TO_STORE',
ALTER COLUMN "shopId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "StockRequest" ADD CONSTRAINT "StockRequest_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
