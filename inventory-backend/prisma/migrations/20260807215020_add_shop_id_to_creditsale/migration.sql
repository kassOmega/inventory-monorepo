/*
  Warnings:

  - Added the required column `shopId` to the `CreditSale` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "CreditSale" ADD COLUMN     "shopId" INTEGER NOT NULL;

-- AddForeignKey
ALTER TABLE "CreditSale" ADD CONSTRAINT "CreditSale_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
