-- Link legacy car-wash washers (no login account) to a User so they can sign in
-- by phone. Idempotent: already-linked washers are skipped, and the email is a
-- deterministic placeholder per phone. The password hash is a fixed bcrypt hash
-- of the default password '123456' (washers reset it / owners set a password).
--
-- Mirrors backfill-carwash-washer-accounts.ts for databases where that TS script
-- cannot run. New washers are provisioned by the service at create time.

-- 1. Create a User for each unlinked washer that has a phone.
INSERT INTO "User" ("email", "password", "name", "phone", "status", "createdAt", "updatedAt")
SELECT
  'washer+' || regexp_replace(w."phone", '[^0-9]', '', 'g') || '@carwash.local',
  '$2b$10$tnBKV6rdWvYEB2FxjhW2.Og0MtlnGdbzt2n0TBxlY2HFtrBkth2mK',
  w."name",
  '+' || regexp_replace(w."phone", '[^0-9]', '', 'g'),
  'ACTIVE',
  now(),
  now()
FROM "CarWashWasher" w
WHERE w."userId" IS NULL
  AND w."phone" IS NOT NULL
  AND regexp_replace(w."phone", '[^0-9]', '', 'g') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "User" u
    WHERE u."email" = 'washer+' || regexp_replace(w."phone", '[^0-9]', '', 'g') || '@carwash.local'
  );

-- 2. Link each washer row to its account.
UPDATE "CarWashWasher" w
SET "userId" = u."id"
FROM "User" u
WHERE w."userId" IS NULL
  AND w."phone" IS NOT NULL
  AND u."email" = 'washer+' || regexp_replace(w."phone", '[^0-9]', '', 'g') || '@carwash.local';

-- 3. Give each newly-linked washer an ACTIVE membership with the WASHER role.
INSERT INTO "Membership" ("userId", "organizationId", "roleId", "status")
SELECT w."userId", w."tenantId", r."id", 'ACTIVE'
FROM "CarWashWasher" w
JOIN "Role" r ON r."organizationId" = w."tenantId" AND r."systemKey" = 'WASHER'
WHERE w."userId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Membership" m
    WHERE m."userId" = w."userId" AND m."organizationId" = w."tenantId"
  );
