-- Notifications: read-once support. Adds a stable per-event dedupe key and a
-- resolution timestamp, so the same business event never regenerates a
-- notification once it exists (and once read stays gone). Idempotent.

ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Notification_tenantId_dedupeKey_targetUserId_idx"
  ON "Notification" ("tenantId", "dedupeKey", "targetUserId");

-- Backfill a dedupe key for existing low-stock alerts so they suppress correctly
-- going forward (mirrors the key the service builds).
UPDATE "Notification"
SET "dedupeKey" = 'LOW_STOCK:' || COALESCE("tenantId"::text, '') || ':' ||
                  COALESCE("productId"::text, '') || ':' ||
                  COALESCE("variantId"::text, '0') || ':' ||
                  COALESCE("locationId"::text, '') || ':' ||
                  COALESCE("targetRoleId"::text, '0') || ':' ||
                  COALESCE("targetLocationId"::text, '0')
WHERE "type" = 'LOW_STOCK' AND "dedupeKey" IS NULL;
