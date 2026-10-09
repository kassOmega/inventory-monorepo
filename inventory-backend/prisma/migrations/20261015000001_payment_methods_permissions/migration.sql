-- Payment Methods permissions: add the new catalog keys and grant the defaults
-- to every business type's system roles. Idempotent.
--
-- Manager: view + create + edit (NOT delete — owner-only).
-- Cashier: view only.
-- Owner roles already hold every key via the seed; the upsert below is a no-op
-- safety net.

INSERT INTO "Permission" ("key", "label", "group") VALUES
  ('payment-methods.view',   'View Payment Methods',   'Payment Methods'),
  ('payment-methods.create', 'Create Payment Methods', 'Payment Methods'),
  ('payment-methods.edit',   'Edit Payment Methods',   'Payment Methods'),
  ('payment-methods.delete', 'Delete Payment Methods', 'Payment Methods')
ON CONFLICT ("key") DO UPDATE SET "label" = EXCLUDED."label", "group" = EXCLUDED."group";

-- Manager: view/create/edit (all business types).
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."key" IN ('payment-methods.view', 'payment-methods.create', 'payment-methods.edit')
WHERE r."systemKey" = 'MANAGER'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- Cashier: view only (all business types).
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."key" = 'payment-methods.view'
WHERE r."systemKey" = 'CASHIER'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
