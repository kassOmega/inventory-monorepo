-- Reconcile role permissions to the code baselines (was a runtime backfill).
-- Idempotent: safe to re-run. Mirrors backfill-carwash-role-permissions.ts
-- and backfill-carwash-permission-prune.ts.

-- 1. Sync the permission catalog (adds new keys / refreshes labels).
INSERT INTO "Permission" ("key", "label", "group") VALUES
  ('dashboard.view', 'View Dashboard', 'Dashboard'),
  ('products.view', 'View Products', 'Products'),
  ('products.create', 'Create Products', 'Products'),
  ('products.edit', 'Edit Products', 'Products'),
  ('products.delete', 'Delete Products', 'Products'),
  ('products.adjust-stock', 'Adjust Stock', 'Products'),
  ('categories.create', 'Create Categories', 'Categories'),
  ('categories.edit', 'Edit Categories', 'Categories'),
  ('categories.delete', 'Delete Categories', 'Categories'),
  ('locations.manage', 'Manage Locations', 'Locations'),
  ('inventory.shared-view', 'View Shared Inventory (All Locations)', 'Locations'),
  ('inventory.all-locations', 'Restock & Count at Any Location', 'Locations'),
  ('sales.view', 'View Sales', 'Sales'),
  ('sales.create', 'Create Sales', 'Sales'),
  ('sales.edit', 'Edit Sales', 'Sales'),
  ('sales.delete', 'Delete Sales', 'Sales'),
  ('sales.return', 'Process Returns', 'Sales'),
  ('sales.view-profit', 'View Profit & Revenue', 'Sales'),
  ('purchases.view', 'View Quick Purchases', 'Quick Purchases'),
  ('purchases.create', 'Create Quick Purchases', 'Quick Purchases'),
  ('purchases.approve', 'Approve Quick Purchases', 'Quick Purchases'),
  ('requests.view', 'View Requests', 'Stock Requests'),
  ('requests.create', 'Create Requests', 'Stock Requests'),
  ('requests.approve', 'Approve Requests', 'Stock Requests'),
  ('requests.dispatch', 'Dispatch Requests', 'Stock Requests'),
  ('requests.delete', 'Delete Requests', 'Stock Requests'),
  ('requests.confirm', 'Confirm Receipt', 'Stock Requests'),
  ('restock.create', 'Restock Products', 'Restock'),
  ('credits.view', 'View Credits', 'Credits'),
  ('credits.manage', 'Manage Credits', 'Credits'),
  ('customers.view', 'View Customers', 'Customers'),
  ('customers.manage', 'Manage Customers', 'Customers'),
  ('reports.view', 'View Reports', 'Reports'),
  ('reports.full', 'Full Reports & Exports', 'Reports'),
  ('reports.view_cost_valuation', 'View Cost & Valuation', 'Reports'),
  ('prices.view', 'View Price History', 'Price History'),
  ('users.view', 'View Users', 'Users'),
  ('users.manage', 'Manage Users', 'Users'),
  ('roles.manage', 'Manage Roles & Permissions', 'Roles'),
  ('finance.view', 'View Finance', 'Finance'),
  ('finance.manage', 'Manage Finance', 'Finance'),
  ('restaurant.view', 'View Restaurant', 'Restaurant'),
  ('restaurant.manage', 'Manage Restaurant', 'Restaurant'),
  ('hotel.view', 'View Hotel', 'Hotel'),
  ('hotel.manage', 'Manage Hotel', 'Hotel'),
  ('restaurant.take-orders', 'Take Orders', 'Restaurant'),
  ('restaurant.serve', 'Serve Orders', 'Restaurant'),
  ('restaurant.settle', 'Settle Payments', 'Restaurant'),
  ('kitchen.view', 'View Kitchen Board', 'Kitchen'),
  ('kitchen.update', 'Update Kitchen Items', 'Kitchen'),
  ('bar.view', 'View Bar Board', 'Bar'),
  ('bar.update', 'Update Bar Items', 'Bar'),
  ('barista.view', 'View Barista Board', 'Barista'),
  ('barista.update', 'Update Barista Items', 'Barista'),
  ('cashier.view', 'View Payments', 'Cashier'),
  ('cashier.confirm', 'Confirm Payments', 'Cashier'),
  ('hotel.reception', 'Front Desk', 'Hotel'),
  ('hotel.housekeeping', 'View Room Board', 'Hotel'),
  ('hotel.housekeeping.update', 'Update Room Cleanliness Status', 'Hotel'),
  ('facility.view', 'View Facilities (Gym, Pool, Spa…)', 'Hospitality Facilities & Memberships'),
  ('facility.manage', 'Manage Facilities (config, closures)', 'Hospitality Facilities & Memberships'),
  ('facility.check-in', 'Check In Facility Guests (day passes, members)', 'Hospitality Facilities & Memberships'),
  ('memberships.view', 'View Memberships', 'Hospitality Facilities & Memberships'),
  ('memberships.manage', 'Manage Memberships (assign, extend, passes)', 'Hospitality Facilities & Memberships'),
  ('packages.view', 'View Hospitality Packages', 'Hospitality Packages & Folio'),
  ('packages.manage', 'Manage Packages & Entitlements', 'Hospitality Packages & Folio'),
  ('packages.redeem', 'Check In Package Guests & Redeem Entitlements', 'Hospitality Packages & Folio'),
  ('folios.view', 'View Guest Folios', 'Hospitality Packages & Folio'),
  ('folios.charge', 'Post Charges to Guest Folios', 'Hospitality Packages & Folio'),
  ('folios.settle', 'Settle Folios & Collect Payment', 'Hospitality Packages & Folio'),
  ('folios.manage', 'Manage Guest Folios (charges + settlement)', 'Hospitality Packages & Folio'),
  ('ai.view', 'View AI Forecast & Insights', 'AI'),
  ('ai.chat', 'Use AI Business Coach', 'AI'),
  ('ai.product-assist', 'Use AI Product Assistant (photo autofill)', 'AI'),
  ('ai.sales-assist', 'Use AI Product Scan in Sales', 'AI'),
  ('ai.requests-assist', 'Use AI Product Scan in Requests', 'AI'),
  ('agent.view', 'View Agent Dashboard & Actions', 'Agent'),
  ('agent.manage', 'Manage Agent Mode & Approvals', 'Agent'),
  ('service.view', 'View Service Catalog & Tickets', 'Service'),
  ('service.manage', 'Manage Service Catalog, Bookings & Tickets', 'Service'),
  ('manufacturing.view', 'View Manufacturing', 'Manufacturing'),
  ('manufacturing.manage', 'Manage Materials, BOMs & Production', 'Manufacturing'),
  ('carwash.washers.view', 'View Washers', 'Car Wash - Washers'),
  ('carwash.washers.create', 'Add Washers', 'Car Wash - Washers'),
  ('carwash.washers.edit', 'Edit Washers', 'Car Wash - Washers'),
  ('carwash.washers.delete', 'Delete Washers', 'Car Wash - Washers'),
  ('carwash.prices.view', 'View Prices', 'Car Wash - Prices'),
  ('carwash.prices.create', 'Add Prices', 'Car Wash - Prices'),
  ('carwash.prices.edit', 'Edit Prices', 'Car Wash - Prices'),
  ('carwash.prices.delete', 'Delete Prices', 'Car Wash - Prices'),
  ('carwash.vehicles.view', 'View Vehicles', 'Car Wash - Vehicles'),
  ('carwash.vehicles.create', 'Add Vehicles', 'Car Wash - Vehicles'),
  ('carwash.vehicles.edit', 'Edit Vehicles', 'Car Wash - Vehicles'),
  ('carwash.vehicles.delete', 'Delete Vehicles', 'Car Wash - Vehicles'),
  ('carwash.bookings.view', 'View Bookings', 'Car Wash - Bookings'),
  ('carwash.bookings.create', 'Create Bookings', 'Car Wash - Bookings'),
  ('carwash.bookings.edit', 'Update Bookings', 'Car Wash - Bookings'),
  ('carwash.bookings.delete', 'Delete Bookings', 'Car Wash - Bookings'),
  ('carwash.washes.view', 'View Washes', 'Car Wash - Washes'),
  ('carwash.washes.create', 'Record Washes', 'Car Wash - Washes'),
  ('carwash.washes.edit', 'Complete / Edit Washes', 'Car Wash - Washes'),
  ('carwash.washes.delete', 'Delete Washes', 'Car Wash - Washes'),
  ('carwash.equipment.view', 'View Issued Equipment', 'Car Wash - Equipment'),
  ('carwash.equipment.issue', 'Issue Equipment', 'Car Wash - Equipment'),
  ('carwash.equipment.edit', 'Update Issued Equipment', 'Car Wash - Equipment'),
  ('carwash.equipment.delete', 'Delete Issued Equipment', 'Car Wash - Equipment'),
  ('carwash.collections.view', 'View Collections', 'Car Wash - Collections'),
  ('carwash.collections.create', 'Record Collection', 'Car Wash - Collections'),
  ('carwash.expenses.view', 'View Expenses', 'Car Wash - Expenses'),
  ('carwash.expenses.create', 'Add Expenses', 'Car Wash - Expenses'),
  ('carwash.expenses.edit', 'Edit Expenses', 'Car Wash - Expenses'),
  ('carwash.expenses.delete', 'Delete Expenses', 'Car Wash - Expenses'),
  ('carwash.reports.view', 'View Car Wash Reports', 'Car Wash - Reports'),
  ('carwash.reports.financials', 'Reports: Financials (revenue, owner share, expenses, profit)', 'Car Wash - Reports'),
  ('carwash.reports.commission', 'Reports: Washer Commission & Earnings', 'Car Wash - Reports'),
  ('carwash.reports.inventory', 'Reports: Popular Items & Low Stock', 'Car Wash - Reports'),
  ('carwash.reports.equipment', 'Reports: Equipment (Paid / Unpaid)', 'Car Wash - Reports'),
  ('carwash.settings.view', 'View Car Wash Settings', 'Car Wash - Settings'),
  ('carwash.settings.edit', 'Edit Car Wash Settings', 'Car Wash - Settings')
ON CONFLICT ("key") DO UPDATE SET "label" = EXCLUDED."label", "group" = EXCLUDED."group";

-- 2. Grant each car-wash system role its baseline permission set.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Organization" o ON o."id" = r."organizationId"
JOIN "Permission" p ON p."key" IN ('dashboard.view', 'customers.view', 'customers.manage', 'reports.view', 'reports.full', 'reports.view_cost_valuation', 'users.view', 'users.manage', 'roles.manage', 'finance.view', 'finance.manage', 'ai.view', 'ai.chat', 'ai.product-assist', 'ai.sales-assist', 'ai.requests-assist', 'agent.view', 'agent.manage', 'carwash.washers.view', 'carwash.washers.create', 'carwash.washers.edit', 'carwash.washers.delete', 'carwash.prices.view', 'carwash.prices.create', 'carwash.prices.edit', 'carwash.prices.delete', 'carwash.vehicles.view', 'carwash.vehicles.create', 'carwash.vehicles.edit', 'carwash.vehicles.delete', 'carwash.bookings.view', 'carwash.bookings.create', 'carwash.bookings.edit', 'carwash.bookings.delete', 'carwash.washes.view', 'carwash.washes.create', 'carwash.washes.edit', 'carwash.washes.delete', 'carwash.equipment.view', 'carwash.equipment.issue', 'carwash.equipment.edit', 'carwash.equipment.delete', 'carwash.collections.view', 'carwash.collections.create', 'carwash.expenses.view', 'carwash.expenses.create', 'carwash.expenses.edit', 'carwash.expenses.delete', 'carwash.reports.view', 'carwash.reports.financials', 'carwash.reports.commission', 'carwash.reports.inventory', 'carwash.reports.equipment', 'carwash.settings.view', 'carwash.settings.edit', 'customers.view', 'customers.manage')
WHERE o."businessType" = 'CAR_WASH' AND r."systemKey" = 'OWNER'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Organization" o ON o."id" = r."organizationId"
JOIN "Permission" p ON p."key" IN ('dashboard.view', 'finance.view', 'finance.manage', 'reports.view', 'reports.full', 'customers.view', 'customers.manage', 'carwash.washers.view', 'carwash.washers.create', 'carwash.washers.edit', 'carwash.washers.delete', 'carwash.prices.view', 'carwash.prices.create', 'carwash.prices.edit', 'carwash.prices.delete', 'carwash.vehicles.view', 'carwash.vehicles.create', 'carwash.vehicles.edit', 'carwash.vehicles.delete', 'carwash.bookings.view', 'carwash.bookings.create', 'carwash.bookings.edit', 'carwash.bookings.delete', 'carwash.washes.view', 'carwash.washes.create', 'carwash.washes.edit', 'carwash.washes.delete', 'carwash.equipment.view', 'carwash.equipment.issue', 'carwash.equipment.edit', 'carwash.equipment.delete', 'carwash.collections.view', 'carwash.collections.create', 'carwash.expenses.view', 'carwash.expenses.create', 'carwash.expenses.edit', 'carwash.expenses.delete', 'carwash.reports.view', 'carwash.reports.financials', 'carwash.reports.commission', 'carwash.reports.inventory', 'carwash.reports.equipment', 'carwash.settings.view', 'carwash.settings.edit', 'customers.view', 'customers.manage')
WHERE o."businessType" = 'CAR_WASH' AND r."systemKey" = 'MANAGER'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Organization" o ON o."id" = r."organizationId"
JOIN "Permission" p ON p."key" IN ('dashboard.view', 'carwash.reports.view', 'carwash.reports.commission')
WHERE o."businessType" = 'CAR_WASH' AND r."systemKey" = 'WASHER'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r
JOIN "Organization" o ON o."id" = r."organizationId"
JOIN "Permission" p ON p."key" IN ('dashboard.view', 'customers.view', 'carwash.washes.view', 'carwash.bookings.view', 'carwash.collections.view', 'carwash.collections.create', 'carwash.expenses.view', 'carwash.reports.view', 'carwash.reports.equipment', 'customers.view', 'customers.manage')
WHERE o."businessType" = 'CAR_WASH' AND r."systemKey" = 'CASHIER'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- 3. Revoke grants outside the baseline for car-wash system roles.
DELETE FROM "RolePermission" rp
USING "Role" r, "Organization" o, "Permission" p
WHERE rp."roleId" = r."id" AND o."id" = r."organizationId" AND rp."permissionId" = p."id"
  AND o."businessType" = 'CAR_WASH' AND r."systemKey" = 'OWNER'
  AND p."key" NOT IN ('dashboard.view', 'customers.view', 'customers.manage', 'reports.view', 'reports.full', 'reports.view_cost_valuation', 'users.view', 'users.manage', 'roles.manage', 'finance.view', 'finance.manage', 'ai.view', 'ai.chat', 'ai.product-assist', 'ai.sales-assist', 'ai.requests-assist', 'agent.view', 'agent.manage', 'carwash.washers.view', 'carwash.washers.create', 'carwash.washers.edit', 'carwash.washers.delete', 'carwash.prices.view', 'carwash.prices.create', 'carwash.prices.edit', 'carwash.prices.delete', 'carwash.vehicles.view', 'carwash.vehicles.create', 'carwash.vehicles.edit', 'carwash.vehicles.delete', 'carwash.bookings.view', 'carwash.bookings.create', 'carwash.bookings.edit', 'carwash.bookings.delete', 'carwash.washes.view', 'carwash.washes.create', 'carwash.washes.edit', 'carwash.washes.delete', 'carwash.equipment.view', 'carwash.equipment.issue', 'carwash.equipment.edit', 'carwash.equipment.delete', 'carwash.collections.view', 'carwash.collections.create', 'carwash.expenses.view', 'carwash.expenses.create', 'carwash.expenses.edit', 'carwash.expenses.delete', 'carwash.reports.view', 'carwash.reports.financials', 'carwash.reports.commission', 'carwash.reports.inventory', 'carwash.reports.equipment', 'carwash.settings.view', 'carwash.settings.edit', 'customers.view', 'customers.manage');

DELETE FROM "RolePermission" rp
USING "Role" r, "Organization" o, "Permission" p
WHERE rp."roleId" = r."id" AND o."id" = r."organizationId" AND rp."permissionId" = p."id"
  AND o."businessType" = 'CAR_WASH' AND r."systemKey" = 'MANAGER'
  AND p."key" NOT IN ('dashboard.view', 'finance.view', 'finance.manage', 'reports.view', 'reports.full', 'customers.view', 'customers.manage', 'carwash.washers.view', 'carwash.washers.create', 'carwash.washers.edit', 'carwash.washers.delete', 'carwash.prices.view', 'carwash.prices.create', 'carwash.prices.edit', 'carwash.prices.delete', 'carwash.vehicles.view', 'carwash.vehicles.create', 'carwash.vehicles.edit', 'carwash.vehicles.delete', 'carwash.bookings.view', 'carwash.bookings.create', 'carwash.bookings.edit', 'carwash.bookings.delete', 'carwash.washes.view', 'carwash.washes.create', 'carwash.washes.edit', 'carwash.washes.delete', 'carwash.equipment.view', 'carwash.equipment.issue', 'carwash.equipment.edit', 'carwash.equipment.delete', 'carwash.collections.view', 'carwash.collections.create', 'carwash.expenses.view', 'carwash.expenses.create', 'carwash.expenses.edit', 'carwash.expenses.delete', 'carwash.reports.view', 'carwash.reports.financials', 'carwash.reports.commission', 'carwash.reports.inventory', 'carwash.reports.equipment', 'carwash.settings.view', 'carwash.settings.edit', 'customers.view', 'customers.manage');

DELETE FROM "RolePermission" rp
USING "Role" r, "Organization" o, "Permission" p
WHERE rp."roleId" = r."id" AND o."id" = r."organizationId" AND rp."permissionId" = p."id"
  AND o."businessType" = 'CAR_WASH' AND r."systemKey" = 'WASHER'
  AND p."key" NOT IN ('dashboard.view', 'carwash.reports.view', 'carwash.reports.commission');

DELETE FROM "RolePermission" rp
USING "Role" r, "Organization" o, "Permission" p
WHERE rp."roleId" = r."id" AND o."id" = r."organizationId" AND rp."permissionId" = p."id"
  AND o."businessType" = 'CAR_WASH' AND r."systemKey" = 'CASHIER'
  AND p."key" NOT IN ('dashboard.view', 'customers.view', 'carwash.washes.view', 'carwash.bookings.view', 'carwash.collections.view', 'carwash.collections.create', 'carwash.expenses.view', 'carwash.reports.view', 'carwash.reports.equipment', 'customers.view', 'customers.manage');

