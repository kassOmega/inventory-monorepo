-- Prune foreign-group grants from ALL car-wash roles (including hand-made).
-- A car-wash role must never hold another vertical permission. Idempotent.
-- Mirrors backfill-carwash-permission-prune.ts.

DELETE FROM "RolePermission" rp
USING "Role" r, "Organization" o, "Permission" p
WHERE rp."roleId" = r."id" AND o."id" = r."organizationId" AND rp."permissionId" = p."id"
  AND o."businessType" = 'CAR_WASH'
  AND p."group" NOT IN ('Dashboard', 'Car Wash - Washers', 'Car Wash - Prices', 'Car Wash - Vehicles', 'Car Wash - Bookings', 'Car Wash - Washes', 'Car Wash - Equipment', 'Car Wash - Expenses', 'Car Wash - Collections', 'Car Wash - Reports', 'Car Wash - Settings', 'Customers', 'Users', 'Roles', 'Finance', 'Reports', 'AI', 'Agent');
