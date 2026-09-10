-- ============================================================================
-- migrate-rbac.sql — data-preserving migration to custom roles & permissions
-- ============================================================================
-- Run this ONCE against production (psql "$DATABASE_URL" -f prisma/migrate-rbac.sql)
-- BEFORE the next deploy that runs `prisma db push`.
--
-- It backs up the old role assignments, swaps the `Role` enum for `Role`/
-- `Permission`/`RolePermission` tables, backfills every user's role, then drops
-- the old enum columns. After this runs, `prisma db push` is a no-op for these
-- changes and no user/role data is lost.
-- ============================================================================

BEGIN;

-- 1. Back up old enum values before dropping anything
CREATE TEMP TABLE _role_backup ON COMMIT DROP AS
SELECT "id" AS user_id, "role"::text AS role_name FROM "User";

CREATE TEMP TABLE _notif_backup ON COMMIT DROP AS
SELECT "id" AS notif_id, "targetRole"::text AS role_name
FROM "Notification" WHERE "targetRole" IS NOT NULL;

-- 2. Drop the old enum columns and type (frees the "Role" name for the table)
ALTER TABLE "User" DROP COLUMN IF EXISTS "role";
ALTER TABLE "Notification" DROP COLUMN IF EXISTS "targetRole";
DROP TYPE IF EXISTS "Role";

-- 3. Create the new RBAC tables (DDL matches Prisma exactly)
CREATE TABLE IF NOT EXISTS "Role" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Permission" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RolePermission" (
    "roleId" INTEGER NOT NULL,
    "permissionId" INTEGER NOT NULL,
    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Role_name_key" ON "Role"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "Permission_key_key" ON "Permission"("key");

-- 4. Seed the permission catalog
INSERT INTO "Permission" ("key", "label", "group") VALUES
('dashboard.view','View Dashboard','Dashboard'),
('products.view','View Products','Products'),
('products.create','Create Products','Products'),
('products.edit','Edit Products','Products'),
('products.delete','Delete Products','Products'),
('products.adjust-stock','Adjust Stock','Products'),
('categories.create','Create Categories','Categories'),
('categories.edit','Edit Categories','Categories'),
('categories.delete','Delete Categories','Categories'),
('locations.manage','Manage Locations','Locations'),
('sales.view','View Sales','Sales'),
('sales.create','Create Sales','Sales'),
('sales.edit','Edit Sales','Sales'),
('sales.delete','Delete Sales','Sales'),
('sales.return','Process Returns','Sales'),
('purchases.view','View Purchases','Purchases'),
('purchases.create','Create Purchases','Purchases'),
('purchases.approve','Approve Purchases','Purchases'),
('requests.view','View Requests','Stock Requests'),
('requests.create','Create Requests','Stock Requests'),
('requests.approve','Approve Requests','Stock Requests'),
('requests.dispatch','Dispatch Requests','Stock Requests'),
('requests.confirm','Confirm Receipt','Stock Requests'),
('restock.create','Restock Products','Restock'),
('credits.view','View Credits','Credits'),
('credits.manage','Manage Credits','Credits'),
('reports.view','View Reports','Reports'),
('reports.full','Full Reports & Exports','Reports'),
('prices.view','View Price History','Price History'),
('users.view','View Users','Users'),
('users.manage','Manage Users','Users'),
('roles.manage','Manage Roles & Permissions','Roles')
ON CONFLICT ("key") DO NOTHING;

-- 5. Seed the three default roles (Owner is the locked system role)
INSERT INTO "Role" ("name", "description", "isSystem") VALUES
('Owner','Full access to everything',true),
('Storekeeper','Manages store stock and dispatches',false),
('Shopkeeper','Runs a shop: sales, purchases, returns',false)
ON CONFLICT ("name") DO NOTHING;

-- 6. Owner role gets every permission
INSERT INTO "RolePermission" ("roleId","permissionId")
SELECT r."id", p."id"
FROM "Role" r, "Permission" p
WHERE r."name" = 'Owner'
ON CONFLICT DO NOTHING;

-- 7. Storekeeper permission set (matches the old STOREKEEPER role)
INSERT INTO "RolePermission" ("roleId","permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."key" IN (
  'dashboard.view','products.view','products.create','products.edit','products.adjust-stock',
  'categories.create','sales.view','sales.create','requests.view','requests.create',
  'requests.dispatch','requests.confirm','credits.view','credits.manage','reports.view'
)
WHERE r."name" = 'Storekeeper'
ON CONFLICT DO NOTHING;

-- 8. Shopkeeper permission set (matches the old SHOPKEEPER role)
INSERT INTO "RolePermission" ("roleId","permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."key" IN (
  'dashboard.view','products.view','sales.view','sales.create','sales.edit','sales.return',
  'purchases.view','purchases.create','requests.view','requests.create','requests.confirm',
  'credits.view','credits.manage','reports.view'
)
WHERE r."name" = 'Shopkeeper'
ON CONFLICT DO NOTHING;

-- 9. Add User.roleId + FK
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "roleId" INTEGER;
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_roleId_fkey";
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 10. Backfill every user's role from the backup (old enum -> new role)
UPDATE "User" u
SET "roleId" = r."id"
FROM _role_backup b
JOIN "Role" r ON r."name" = CASE b.role_name
  WHEN 'OWNER' THEN 'Owner'
  WHEN 'STOREKEEPER' THEN 'Storekeeper'
  WHEN 'SHOPKEEPER' THEN 'Shopkeeper'
  ELSE NULL
END
WHERE u."id" = b.user_id;

-- 11. Add Notification.targetRoleId + FK
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "targetRoleId" INTEGER;
ALTER TABLE "Notification" DROP CONSTRAINT IF EXISTS "Notification_targetRoleId_fkey";
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_targetRoleId_fkey"
    FOREIGN KEY ("targetRoleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 12. Owner-targeted notifications keep their owner target; location-targeted
--     notifications (old SHOPKEEPER/STOREKEEPER) become location-targeted (null role).
UPDATE "Notification" n
SET "targetRoleId" = r."id"
FROM _notif_backup b
JOIN "Role" r ON r."name" = 'Owner'
WHERE n."id" = b.notif_id
AND b.role_name = 'OWNER';

COMMIT;

