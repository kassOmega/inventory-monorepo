/*
  Warnings:

  - Added the required column `expectedProfit` to the `Purchase` table without a default value. This is not possible if the table is not empty.
  - Added the required column `expectedRevenue` to the `Purchase` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sellPrice` to the `Purchase` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN     "expectedProfit" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "expectedRevenue" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "sellPrice" DOUBLE PRECISION NOT NULL;
