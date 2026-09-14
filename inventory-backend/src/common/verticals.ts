// src/common/verticals.ts
// Central registry describing each business vertical: which feature modules are
// enabled, default categories/units (retail), and the default chart of accounts
// (finance). The frontend reads the feature flags (via the active org's
// businessType) to show the right navigation and screens.
import { AccountType, BusinessType } from '@prisma/client';

export interface DefaultAccount {
  name: string;
  code?: string;
  type: AccountType;
  isSystem?: boolean;
}

export const DEFAULT_CHART_OF_ACCOUNTS: DefaultAccount[] = [
  { name: 'Cash', code: '1000', type: AccountType.ASSET, isSystem: true },
  { name: 'Bank', code: '1010', type: AccountType.ASSET, isSystem: true },
  { name: 'Accounts Receivable', code: '1100', type: AccountType.ASSET },
  { name: 'Input VAT Receivable', code: '1101', type: AccountType.ASSET },
  { name: 'Inventory Asset', code: '1200', type: AccountType.ASSET },
  { name: 'Accounts Payable', code: '2000', type: AccountType.LIABILITY },
  { name: 'Output VAT Payable', code: '2100', type: AccountType.LIABILITY },
  { name: 'Owner Equity', code: '3000', type: AccountType.EQUITY },
  { name: 'Sales Revenue', code: '4000', type: AccountType.INCOME, isSystem: true },
  { name: 'Other Income', code: '4100', type: AccountType.INCOME, isSystem: true },
  { name: 'Cost of Goods Sold', code: '5000', type: AccountType.EXPENSE, isSystem: true },
  { name: 'Cost of Service', code: '5010', type: AccountType.EXPENSE, isSystem: true },
  { name: 'Rent', code: '6000', type: AccountType.EXPENSE },
  { name: 'Salaries & Wages', code: '6100', type: AccountType.EXPENSE },
  { name: 'Utilities', code: '6200', type: AccountType.EXPENSE },
  { name: 'Supplies', code: '6300', type: AccountType.EXPENSE },
  { name: 'Marketing', code: '6400', type: AccountType.EXPENSE },
  { name: 'Maintenance', code: '6500', type: AccountType.EXPENSE },
  { name: 'Equipment & Tools', code: '6600', type: AccountType.EXPENSE },
  { name: 'Licenses & Permits', code: '6700', type: AccountType.EXPENSE },
  { name: 'Insurance', code: '6800', type: AccountType.EXPENSE },
  { name: 'Bank & Transaction Fees', code: '6900', type: AccountType.EXPENSE },
  { name: 'Logistics', code: '7000', type: AccountType.EXPENSE },
  { name: 'Spoilage & Wastage', code: '7100', type: AccountType.EXPENSE },
  { name: 'Inventory Adjustment', code: '7200', type: AccountType.EXPENSE },
];

export const VERTICAL_ACCOUNTS: Partial<Record<BusinessType, DefaultAccount[]>> = {
  [BusinessType.HOSPITALITY]: [
    { name: 'Food Sales', code: '4010', type: AccountType.INCOME },
    { name: 'Beverage Sales', code: '4020', type: AccountType.INCOME },
    { name: 'Room Revenue', code: '4030', type: AccountType.INCOME },
    { name: 'Food Cost', code: '5020', type: AccountType.EXPENSE },
    { name: 'Beverage Cost', code: '5030', type: AccountType.EXPENSE },
    { name: 'Housekeeping', code: '6610', type: AccountType.EXPENSE },
  ],
  [BusinessType.MANUFACTURING]: [
    { name: 'Production Revenue', code: '4010', type: AccountType.INCOME },
    { name: 'Raw Materials Cost', code: '5020', type: AccountType.EXPENSE },
    { name: 'Direct Labor', code: '5030', type: AccountType.EXPENSE },
  ],
  [BusinessType.SERVICE]: [
    { name: 'Service Revenue', code: '4010', type: AccountType.INCOME, isSystem: true },
  ],
};

export function getDefaultAccounts(businessType: BusinessType): DefaultAccount[] {
  return [...DEFAULT_CHART_OF_ACCOUNTS, ...(VERTICAL_ACCOUNTS[businessType] ?? [])];
}

/** Default menu categories seeded for hospitality/service businesses, mapped to stations. */
// Default menu categories per vertical. `stationKey` maps to the org's station
// slug (kitchen/bar/barista are auto-seeded for hospitality orgs; owners can
// add more and re-route categories).
export const DEFAULT_MENU_CATEGORIES: Array<{
  name: string;
  stationKey: string;
  amName?: string;
}> = [
  { name: 'Appetizers', stationKey: 'kitchen', amName: 'መክሰስ' },
  { name: 'Main Courses', stationKey: 'kitchen', amName: 'ዋና ምግቦች' },
  { name: 'Dessert', stationKey: 'kitchen', amName: 'ጣፋጮች' },
  { name: 'Water', stationKey: 'bar', amName: 'ውሃ' },
  { name: 'Beer', stationKey: 'bar', amName: 'ቢራ' },
  { name: 'Wine', stationKey: 'bar', amName: 'ወይን ጠጅ' },
  { name: 'Alcohol', stationKey: 'bar', amName: 'አልኮል' },
  { name: 'Hot Drinks', stationKey: 'barista', amName: 'ሙቅ መጠጦች' },
  { name: 'Latte', stationKey: 'barista', amName: 'ላቴ' },
];

export interface VerticalFeatures {
  inventory: boolean;
  retail: boolean;
  pos: boolean;
  kitchen: boolean;
  tables: boolean;
  reservations: boolean;
  rooms: boolean;
  folio: boolean;
  finance: boolean;
}

export type Sector = 'RETAIL' | 'HOSPITALITY' | 'MANUFACTURING' | 'SERVICE';

export interface DefaultRoleDef {
  name: string;
  description: string;
  isSystem?: boolean;
  permissionKey: string;
}

const RETAIL_ROLES: DefaultRoleDef[] = [
  { name: 'Owner', description: 'Full access to everything', isSystem: true, permissionKey: 'OWNER' },
  { name: 'Storekeeper', description: 'Manages store stock and dispatches', permissionKey: 'STOREKEEPER' },
  { name: 'Shopkeeper', description: 'Runs a shop: sales, purchases, returns', permissionKey: 'SHOPKEEPER' },
];

const HOSPITALITY_ROLES: DefaultRoleDef[] = [
  { name: 'Owner', description: 'Full access to everything', isSystem: true, permissionKey: 'OWNER' },
  { name: 'Manager', description: 'Oversees operations and cash collection', permissionKey: 'MANAGER' },
  { name: 'Waiter', description: 'Takes orders and serves customers', permissionKey: 'WAITER' },
  { name: 'Chef', description: 'Prepares meals from the kitchen board', permissionKey: 'CHEF' },
  { name: 'Barman', description: 'Prepares beverages from the bar board', permissionKey: 'BARMAN' },
  { name: 'Barista', description: 'Prepares hot drinks from the barista board', permissionKey: 'BARISTA' },
  { name: 'Cashier', description: 'Collects and confirms payments', permissionKey: 'CASHIER' },
  { name: 'Receptionist', description: 'Manages reservations and front desk', permissionKey: 'RECEPTIONIST' },
  { name: 'Housekeeping', description: 'Updates room cleanliness status', permissionKey: 'HOUSEKEEPING' },
];

const MANUFACTURING_ROLES: DefaultRoleDef[] = [
  { name: 'Owner', description: 'Full access to everything', isSystem: true, permissionKey: 'OWNER' },
  { name: 'Production Manager', description: 'Manages raw materials and finished goods', permissionKey: 'STOREKEEPER' },
  { name: 'Operator', description: 'Runs production and records output', permissionKey: 'SHOPKEEPER' },
];

const SERVICE_ROLES: DefaultRoleDef[] = [
  { name: 'Owner', description: 'Full access to everything', isSystem: true, permissionKey: 'OWNER' },
  { name: 'Manager', description: 'Oversees operations and cash collection', permissionKey: 'MANAGER' },
  { name: 'Provider', description: 'Delivers services and takes orders', permissionKey: 'WAITER' },
  { name: 'Cashier', description: 'Collects and confirms payments', permissionKey: 'CASHIER' },
];

/**
 * Common terminology across service businesses. Hospitality keeps menu/table
 * language; SERVICE verticals use "Catalog / Service / Ticket / Booking".
 * These labels feed the UI and the AI agent's prompts/tools.
 */
export type VerticalLabels = Record<string, string>;

const HOSPITALITY_LABELS: VerticalLabels = {
  catalog: 'Menu',
  service: 'Menu Item',
  order: 'Order',
  orders: 'Orders',
  booking: 'Reservation',
  customer: 'Customer',
};

const SERVICE_LABELS: VerticalLabels = {
  catalog: 'Catalog',
  service: 'Service',
  order: 'Ticket',
  orders: 'Tickets',
  booking: 'Booking',
  customer: 'Client',
};

export function getVerticalLabels(businessType: BusinessType): VerticalLabels {
  return businessType === BusinessType.SERVICE ? SERVICE_LABELS : HOSPITALITY_LABELS;
}

/** Human label for a business type, e.g. RETAIL → "Retail & Distribution". */
export function getVerticalLabel(businessType: BusinessType): string {
  return VERTICALS[businessType]?.label ?? businessType;
}

export interface VerticalDefinition {
  label: string;
  sector: Sector;
  defaultRoles: DefaultRoleDef[];
  features: VerticalFeatures;
  defaultCategories: string[];
  defaultUnits: string[];
  labels?: VerticalLabels;
  /** Which 1:1 profile table this vertical uses (see *Profile models). */
  profileModel: 'RetailProfile' | 'HospitalityProfile' | 'ManufacturingProfile' | 'ServiceProfile';
}

const retailFeatures = (): VerticalFeatures => ({
  inventory: true, retail: true, pos: false, kitchen: false, tables: false, reservations: false, rooms: false, folio: false, finance: true,
});

export const VERTICALS: Record<BusinessType, VerticalDefinition> = {
  [BusinessType.RETAIL]: {
    label: 'Retail & Distribution',
    sector: 'RETAIL',
    defaultRoles: RETAIL_ROLES,
    features: retailFeatures(),
    defaultCategories: ['General', 'Beverages'],
    defaultUnits: ['piece', 'pack', 'kg', 'liter'],
    profileModel: 'RetailProfile',
  },
  [BusinessType.HOSPITALITY]: {
    label: 'Hospitality',
    sector: 'HOSPITALITY',
    defaultRoles: HOSPITALITY_ROLES,
    features: { inventory: false, retail: false, pos: true, kitchen: true, tables: true, reservations: true, rooms: true, folio: true, finance: true },
    defaultCategories: [],
    defaultUnits: [],
    profileModel: 'HospitalityProfile',
  },
  [BusinessType.MANUFACTURING]: {
    label: 'Manufacturing & Production',
    sector: 'MANUFACTURING',
    defaultRoles: MANUFACTURING_ROLES,
    features: { inventory: true, retail: false, pos: false, kitchen: false, tables: false, reservations: false, rooms: false, folio: false, finance: true },
    defaultCategories: ['Raw Materials', 'Work In Progress', 'Finished Goods'],
    defaultUnits: ['piece', 'kg', 'liter', 'meter'],
    profileModel: 'ManufacturingProfile',
  },
  [BusinessType.SERVICE]: {
    label: 'Services & Consulting',
    sector: 'SERVICE',
    defaultRoles: SERVICE_ROLES,
    features: { inventory: false, retail: false, pos: true, kitchen: false, tables: false, reservations: true, rooms: false, folio: false, finance: true },
    defaultCategories: [],
    defaultUnits: [],
    labels: SERVICE_LABELS,
    profileModel: 'ServiceProfile',
  },
};
