-- Unified hospitality service onboarding (Chunk 1).
--  1. HospitalityServiceType gains the full service catalog: ROOM_MANAGEMENT is
--     renamed to ACCOMMODATION (rooms / pensions / lodging) and SPA_AND_WELLNESS
--     + EVENT_AND_HALL_RENTAL are added. Existing rows keep their identity — a
--     RENAME VALUE preserves every HospitalityService row and FK.
--  2. Organization.enabledHospitalityServices denormalizes the enabled service
--     lines so list responses and dashboard nav gating need no join. It is
--     backfilled from the existing HospitalityService rows.
--  3. MenuItem.durationMins records spa/wellness treatment durations.
-- All statements are additive (RENAME VALUE is data-preserving; zero DROPs).

-- AlterEnum
ALTER TYPE "HospitalityServiceType" RENAME VALUE 'ROOM_MANAGEMENT' TO 'ACCOMMODATION';

-- AlterEnum
ALTER TYPE "HospitalityServiceType" ADD VALUE IF NOT EXISTS 'SPA_AND_WELLNESS';

-- AlterEnum
ALTER TYPE "HospitalityServiceType" ADD VALUE IF NOT EXISTS 'EVENT_AND_HALL_RENTAL';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "enabledHospitalityServices" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN "durationMins" INTEGER;

-- Backfill: mirror the currently enabled service rows into the denormalized
-- array. Cast to text so the newly added enum values are never referenced
-- inside this transaction.
UPDATE "Organization" o
SET "enabledHospitalityServices" = COALESCE(
  (
    SELECT array_agg(DISTINCT hs."serviceType"::text)
    FROM "HospitalityService" hs
    WHERE hs."organizationId" = o."id" AND hs."isEnabled" = true
  ),
  ARRAY[]::TEXT[]
);
