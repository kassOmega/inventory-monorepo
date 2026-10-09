-- Add QUEUED and SETTLED to the car-wash status enum. Postgres allows
-- ADD VALUE outside a transaction; Prisma runs each migration in a transaction
-- unless the file opts out, so keep these as standalone statements.
ALTER TYPE "CarWashStatus" ADD VALUE IF NOT EXISTS 'QUEUED';
ALTER TYPE "CarWashStatus" ADD VALUE IF NOT EXISTS 'SETTLED';

-- New per-status timestamps + queue number on a wash.
ALTER TABLE "CarWash" ADD COLUMN IF NOT EXISTS "queueNumber" INTEGER;
ALTER TABLE "CarWash" ADD COLUMN IF NOT EXISTS "queuedAt" TIMESTAMP(3);
ALTER TABLE "CarWash" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3);
ALTER TABLE "CarWash" ADD COLUMN IF NOT EXISTS "settledAt" TIMESTAMP(3);

-- Backfill: an existing in-progress/complete wash was "started" on its date;
-- a completed wash keeps/sets its completion time. Do NOT reclassify
-- historical rows (they stay IN_PROGRESS / COMPLETED).
UPDATE "CarWash"
SET "startedAt" = "date"
WHERE "startedAt" IS NULL
  AND "status" IN ('IN_PROGRESS', 'COMPLETED');

UPDATE "CarWash"
SET "completedAt" = "date"
WHERE "completedAt" IS NULL
  AND "status" = 'COMPLETED';

-- New washes start in the queue.
ALTER TABLE "CarWash" ALTER COLUMN "status" SET DEFAULT 'QUEUED';
