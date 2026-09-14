// src/common/permissions.ts
// Central permission catalog. These keys are seeded into the `Permission`
// table so the owner can assign them to custom roles from the frontend.
import { BusinessType } from '@prisma/client';

export interface PermissionDefinition {
  key: string;
  label: string;
  group: string;
}

export const PERMISSIONS: PermissionDefinition[] = [
  { key: 'dashboard.view', label: 'View Dashboard', group: 'Dashboard' },
  { key: 'products.view', label: 'View Products', group: 'Products' },
  { key: 'products.create', label: 'Create Products', group: 'Products' },
  { key: 'products.edit', label: 'Edit Products', group: 'Products' },
  { key: 'products.delete', label: 'Delete Products', group: 'Products' },
  { key: 'products.adjust-stock', label: 'Adjust Stock', group: 'Products' },
  { key: 'categories.create', label: 'Create Categories', group: 'Categories' },
  { key: 'categories.edit', label: 'Edit Categories', group: 'Categories' },
  { key: 'categories.delete', label: 'Delete Categories', group: 'Categories' },
  { key: 'locations.manage', label: 'Manage Locations', group: 'Locations' },
  {
    key: 'inventory.shared-view',
    label: 'View Shared Inventory (All Locations)',
    group: 'Locations',
  },
  { key: 'sales.view', label: 'View Sales', group: 'Sales' },
  { key: 'sales.create', label: 'Create Sales', group: 'Sales' },
  { key: 'sales.edit', label: 'Edit Sales', group: 'Sales' },
  { key: 'sales.delete', label: 'Delete Sales', group: 'Sales' },
  { key: 'sales.return', label: 'Process Returns', group: 'Sales' },
  { key: 'sales.view-profit', label: 'View Profit & Revenue', group: 'Sales' },
  {
    key: 'purchases.view',
    label: 'View Quick Purchases',
    group: 'Quick Purchases',
  },
  {
    key: 'purchases.create',
    label: 'Create Quick Purchases',
    group: 'Quick Purchases',
  },
  {
    key: 'purchases.approve',
    label: 'Approve Quick Purchases',
    group: 'Quick Purchases',
  },
  { key: 'requests.view', label: 'View Requests', group: 'Stock Requests' },
  { key: 'requests.create', label: 'Create Requests', group: 'Stock Requests' },
  {
    key: 'requests.approve',
    label: 'Approve Requests',
    group: 'Stock Requests',
  },
  {
    key: 'requests.dispatch',
    label: 'Dispatch Requests',
    group: 'Stock Requests',
  },
  {
    key: 'requests.delete',
    label: 'Delete Requests',
    group: 'Stock Requests',
  },
  {
    key: 'requests.confirm',
    label: 'Confirm Receipt',
    group: 'Stock Requests',
  },
  { key: 'restock.create', label: 'Restock Products', group: 'Restock' },
  { key: 'credits.view', label: 'View Credits', group: 'Credits' },
  { key: 'credits.manage', label: 'Manage Credits', group: 'Credits' },
  { key: 'reports.view', label: 'View Reports', group: 'Reports' },
  { key: 'reports.full', label: 'Full Reports & Exports', group: 'Reports' },
  {
    key: 'reports.view_cost_valuation',
    label: 'View Cost & Valuation',
    group: 'Reports',
  },
  { key: 'prices.view', label: 'View Price History', group: 'Price History' },
  { key: 'users.view', label: 'View Users', group: 'Users' },
  { key: 'users.manage', label: 'Manage Users', group: 'Users' },
  { key: 'roles.manage', label: 'Manage Roles & Permissions', group: 'Roles' },
  { key: 'finance.view', label: 'View Finance', group: 'Finance' },
  { key: 'finance.manage', label: 'Manage Finance', group: 'Finance' },
  { key: 'restaurant.view', label: 'View Restaurant', group: 'Restaurant' },
  { key: 'restaurant.manage', label: 'Manage Restaurant', group: 'Restaurant' },
  { key: 'hotel.view', label: 'View Hotel', group: 'Hotel' },
  { key: 'hotel.manage', label: 'Manage Hotel', group: 'Hotel' },
  { key: 'restaurant.take-orders', label: 'Take Orders', group: 'Restaurant' },
  { key: 'restaurant.serve', label: 'Serve Orders', group: 'Restaurant' },
  { key: 'restaurant.settle', label: 'Settle Payments', group: 'Restaurant' },
  { key: 'kitchen.view', label: 'View Kitchen Board', group: 'Kitchen' },
  { key: 'kitchen.update', label: 'Update Kitchen Items', group: 'Kitchen' },
  { key: 'bar.view', label: 'View Bar Board', group: 'Bar' },
  { key: 'bar.update', label: 'Update Bar Items', group: 'Bar' },
  { key: 'barista.view', label: 'View Barista Board', group: 'Barista' },
  { key: 'barista.update', label: 'Update Barista Items', group: 'Barista' },
  { key: 'cashier.view', label: 'View Payments', group: 'Cashier' },
  { key: 'cashier.confirm', label: 'Confirm Payments', group: 'Cashier' },
  { key: 'hotel.reception', label: 'Front Desk', group: 'Hotel' },
  { key: 'hotel.housekeeping', label: 'View Room Board', group: 'Hotel' },
  {
    key: 'hotel.housekeeping.update',
    label: 'Update Room Cleanliness Status',
    group: 'Hotel',
  },
  {
    key: 'facility.view',
    label: 'View Facilities (Gym, Pool, Spa…)',
    group: 'Hospitality Facilities & Memberships',
  },
  {
    key: 'facility.manage',
    label: 'Manage Facilities (config, closures)',
    group: 'Hospitality Facilities & Memberships',
  },
  {
    key: 'facility.check-in',
    label: 'Check In Facility Guests (day passes, members)',
    group: 'Hospitality Facilities & Memberships',
  },
  {
    key: 'memberships.view',
    label: 'View Memberships',
    group: 'Hospitality Facilities & Memberships',
  },
  {
    key: 'memberships.manage',
    label: 'Manage Memberships (assign, extend, passes)',
    group: 'Hospitality Facilities & Memberships',
  },
  {
    key: 'packages.view',
    label: 'View Hospitality Packages',
    group: 'Hospitality Packages & Folio',
  },
  {
    key: 'packages.manage',
    label: 'Manage Packages & Entitlements',
    group: 'Hospitality Packages & Folio',
  },
  {
    key: 'packages.redeem',
    label: 'Check In Package Guests & Redeem Entitlements',
    group: 'Hospitality Packages & Folio',
  },
  {
    key: 'folios.view',
    label: 'View Guest Folios',
    group: 'Hospitality Packages & Folio',
  },
  {
    key: 'folios.charge',
    label: 'Post Charges to Guest Folios',
    group: 'Hospitality Packages & Folio',
  },
  {
    key: 'folios.settle',
    label: 'Settle Folios & Collect Payment',
    group: 'Hospitality Packages & Folio',
  },
  {
    // Legacy umbrella kept for backwards compatibility: it is treated as
    // implying both `folios.charge` and `folios.settle` wherever folio money is
    // handled, so roles granted before the split keep working untouched.
    key: 'folios.manage',
    label: 'Manage Guest Folios (charges + settlement)',
    group: 'Hospitality Packages & Folio',
  },
  { key: 'ai.view', label: 'View AI Forecast & Insights', group: 'AI' },
  { key: 'ai.chat', label: 'Use AI Business Coach', group: 'AI' },
  {
    key: 'ai.product-assist',
    label: 'Use AI Product Assistant (photo autofill)',
    group: 'AI',
  },
  {
    key: 'ai.sales-assist',
    label: 'Use AI Product Scan in Sales',
    group: 'AI',
  },
  {
    key: 'ai.requests-assist',
    label: 'Use AI Product Scan in Requests',
    group: 'AI',
  },
  {
    key: 'agent.view',
    label: 'View Agent Dashboard & Actions',
    group: 'Agent',
  },
  {
    key: 'agent.manage',
    label: 'Manage Agent Mode & Approvals',
    group: 'Agent',
  },
  {
    key: 'service.view',
    label: 'View Service Catalog & Tickets',
    group: 'Service',
  },
  {
    key: 'service.manage',
    label: 'Manage Service Catalog, Bookings & Tickets',
    group: 'Service',
  },
  {
    key: 'manufacturing.view',
    label: 'View Manufacturing',
    group: 'Manufacturing',
  },
  {
    key: 'manufacturing.manage',
    label: 'Manage Materials, BOMs & Production',
    group: 'Manufacturing',
  },
];

export const ALL_PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

/**
 * Which permission groups a business type is allowed to see/assign. Groups are
 * the module-level containers in the PERMISSIONS catalog; the Roles &
 * Permissions editor filters the list by the active org's businessType so a
 * retail shop never sees Restaurant/Hotel/Kitchen/etc. permissions and vice
 * versa. Generic groups (Dashboard, Reports, Users, Roles, Finance, AI, Agent)
 * are shared by every vertical.
 */
export const PERMISSION_GROUPS_BY_BUSINESS_TYPE: Record<
  BusinessType,
  string[]
> = {
  [BusinessType.RETAIL]: [
    'Dashboard',
    'Products',
    'Categories',
    'Locations',
    'Sales',
    'Quick Purchases',
    'Stock Requests',
    'Restock',
    'Credits',
    'Reports',
    'Price History',
    'Users',
    'Roles',
    'Finance',
    'AI',
    'Agent',
  ],
  [BusinessType.HOSPITALITY]: [
    'Dashboard',
    'Restaurant',
    'Hotel',
    'Hospitality Facilities & Memberships',
    'Hospitality Packages & Folio',
    'Stations',
    'Kitchen',
    'Bar',
    'Barista',
    'Cashier',
    // Custom hospitality service lines (HospitalityServiceType.CUSTOM) map to
    // generic facility dashboards, but the vertical also reuses the Service
    // catalog keys for its service page — keep them assignable here.
    'Service',
    'Reports',
    'Users',
    'Roles',
    'Finance',
    'AI',
    'Agent',
  ],
  [BusinessType.MANUFACTURING]: [
    'Dashboard',
    'Products',
    'Categories',
    'Manufacturing',
    'Reports',
    'Users',
    'Roles',
    'Finance',
    'AI',
    'Agent',
  ],
  [BusinessType.SERVICE]: [
    'Dashboard',
    'Service',
    'Cashier',
    'Reports',
    'Users',
    'Roles',
    'Finance',
    'AI',
    'Agent',
  ],
};

/** Permission sets that reproduce the old hardcoded OWNER/SHOPKEEPER/STOREKEEPER behaviour. */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  OWNER: ALL_PERMISSION_KEYS,
  STOREKEEPER: [
    'dashboard.view',
    'products.view',
    'products.create',
    'products.edit',
    'products.adjust-stock',
    'categories.create',
    'sales.view',
    'sales.create',
    'requests.view',
    'requests.create',
    'requests.dispatch',
    'requests.confirm',
    'restock.create',
    'credits.view',
    'credits.manage',
    'reports.view',
    'manufacturing.view',
    'manufacturing.manage',
  ],
  SHOPKEEPER: [
    'dashboard.view',
    'products.view',
    'sales.view',
    'sales.create',
    'sales.edit',
    'sales.return',
    'purchases.view',
    'purchases.create',
    'requests.view',
    'requests.create',
    'requests.confirm',
    'credits.view',
    'credits.manage',
    'reports.view',
    'manufacturing.view',
  ],
  MANAGER: [
    'dashboard.view',
    'restaurant.view',
    'restaurant.manage',
    'hotel.view',
    'hotel.manage',
    'hotel.reception',
    'hotel.housekeeping',
    'hotel.housekeeping.update',
    'facility.view',
    'facility.manage',
    'facility.check-in',
    'memberships.view',
    'memberships.manage',
    'packages.view',
    'packages.manage',
    'packages.redeem',
    'folios.view',
    'folios.charge',
    'folios.settle',
    'folios.manage',
    'cashier.view',
    'finance.view',
    'finance.manage',
    'reports.view',
    'reports.full',
    'service.view',
    'service.manage',
  ],
  WAITER: [
    'dashboard.view',
    'restaurant.view',
    'restaurant.take-orders',
    'restaurant.serve',
    'restaurant.settle',
    'service.view',
  ],
  CHEF: ['dashboard.view', 'restaurant.view', 'kitchen.view', 'kitchen.update'],
  BARMAN: ['dashboard.view', 'restaurant.view', 'bar.view', 'bar.update'],
  BARISTA: [
    'dashboard.view',
    'restaurant.view',
    'barista.view',
    'barista.update',
  ],
  CASHIER: [
    'dashboard.view',
    'restaurant.view',
    'cashier.view',
    'cashier.confirm',
    // The till also settles guest folios (day passes, package guests and the
    // front-desk box office) — read the ledger and collect money, nothing else.
    'folios.view',
    'folios.settle',
    'service.view',
  ],
  // Front desk: checks guests in/out, takes reservations and settles folios.
  // `folios.view` / `folios.charge` / `folios.settle` are what the unified folio
  // surface (room ledger + linked package guests) is gated on; `hotel.housekeeping`
  // is the read-only room board so reception can see cleanliness at a glance.
  RECEPTIONIST: [
    'dashboard.view',
    'hotel.view',
    'hotel.reception',
    'hotel.housekeeping',
    'folios.view',
    'folios.charge',
    'folios.settle',
    'folios.manage',
  ],
  // Housekeeping maintains room cleanliness: see the board, flip the status.
  // Deliberately no folio/billing/reception keys.
  HOUSEKEEPING: [
    'dashboard.view',
    'hotel.view',
    'hotel.housekeeping',
    'hotel.housekeeping.update',
  ],
  // Standalone shop: a single shop that manages its own inventory (no separate
  // store). The shopkeeper requests restocks, the owner approves, and the
  // shopkeeper confirms receipt; sales are registered directly.
  STANDALONE_SHOPKEEPER: [
    'dashboard.view',
    'products.view',
    'sales.view',
    'sales.create',
    'sales.edit',
    'sales.return',
    'restock.create',
    'requests.view',
    'requests.create',
    'requests.confirm',
    'credits.view',
    'credits.manage',
    'reports.view',
  ],
};
