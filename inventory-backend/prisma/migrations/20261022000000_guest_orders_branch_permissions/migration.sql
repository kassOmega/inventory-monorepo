-- Guest-order branch access: branch roles (SHOPKEEPER / STOREKEEPER) and MANAGER
-- need the guest-orders inbox + actions so they can accept/reject routed orders
-- and register them as sales (see plan-guest-order-sale-and-free-table.md).
-- Idempotent: rolePermission pairs are skipped when they already exist.

INSERT INTO "Permission" ("key", "label", "group") VALUES
  ('guest-orders.view',   'View Guest Orders',   'Guest Orders'),
  ('guest-orders.manage', 'Manage Guest Orders', 'Guest Orders')
ON CONFLICT ("key") DO UPDATE
  SET "label" = EXCLUDED."label", "group" = EXCLUDED."group";

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."key" IN ('guest-orders.view', 'guest-orders.manage')
WHERE r."systemKey" IN ('MANAGER', 'SHOPKEEPER', 'STOREKEEPER')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
