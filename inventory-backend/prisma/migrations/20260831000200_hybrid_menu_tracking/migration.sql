-- Progressive Hybrid Menu Tracking.
-- SIMPLE -> revenue only (no COGS entry, no stock deduction).
-- BENCHMARK -> estimated COGS entry (estimatedCogs), no stock deduction.
-- PERPETUAL -> exact recipe-based COGS + raw-ingredient stock deduction.

-- CreateEnum
CREATE TYPE "MenuItemTrackingMode" AS ENUM ('SIMPLE', 'BENCHMARK', 'PERPETUAL');

-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN "trackingMode" "MenuItemTrackingMode" NOT NULL DEFAULT 'SIMPLE';
ALTER TABLE "MenuItem" ADD COLUMN "estimatedCogs" DOUBLE PRECISION;

-- Backfill: preserve the pre-migration settlement behavior exactly.
--  Items WITH a recipe -> PERPETUAL (recipe COGS + stock deduction, as today).
--  Items WITHOUT a recipe but with a manual cost -> BENCHMARK (estimated COGS
--  = the stored cost; same COGS as before, still no stock deduction).
--  Everything else -> SIMPLE (default: revenue only).
UPDATE "MenuItem" SET "trackingMode" = 'PERPETUAL'
WHERE "id" IN (SELECT DISTINCT "menuItemId" FROM "MenuItemIngredient");

UPDATE "MenuItem" SET "trackingMode" = 'BENCHMARK', "estimatedCogs" = "cost"
WHERE "trackingMode" = 'SIMPLE' AND "cost" > 0;
