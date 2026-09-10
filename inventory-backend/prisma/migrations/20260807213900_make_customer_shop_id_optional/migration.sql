-- DropForeignKey
ALTER TABLE "Customer" DROP CONSTRAINT "Customer_shopId_fkey";

-- AlterTable
ALTER TABLE "Customer" ALTER COLUMN "shopId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
