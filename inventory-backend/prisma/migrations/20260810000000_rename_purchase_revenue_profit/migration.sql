-- Rename expectedRevenue → revenue, expectedProfit → profit
ALTER TABLE "Purchase" RENAME COLUMN "expectedRevenue" TO "revenue";
ALTER TABLE "Purchase" RENAME COLUMN "expectedProfit" TO "profit";
