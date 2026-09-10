-- Weighted-Average Cost (WAC): each inventory row tracks a moving average
-- unit cost, reweighted on inflows and consumed on outflows for COGS.

-- AlterTable
ALTER TABLE "Inventory" ADD COLUMN "avgCost" DOUBLE PRECISION NOT NULL DEFAULT 0;
-- Backfill: seed existing rows with the current buy price so historical COGS
-- behaviour (cost at currentBuyPrice) is preserved until the first inflow
-- starts the moving average.
UPDATE "Inventory" i SET "avgCost" = p."currentBuyPrice"
FROM "Product" p WHERE i."productId" = p."id";
