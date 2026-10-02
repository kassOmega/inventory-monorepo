// src/common/customer-role-permissions.ts
// Baseline CRM (`customers.*`) permissions per default role, and the pure helper
// the backfill script uses to repair existing organizations.
//
// Why this exists: default roles are cloned into an organization *once*, at
// creation time (TenantsService.createOrganization). When the catalog grows — as
// it did when the Customers group (`customers.view` / `customers.manage`) was
// introduced with the CRM module — every existing organization keeps the old
// set, so a Cashier created before the CRM landed cannot pick the customer a
// credit sale is billed to. The backfill grants the missing keys; this module
// owns exactly *which* keys the platform considers the baseline for each role.
//
// Deliberately scoped to the Customers group (+ `dashboard.view`): cross-vertical
// grants (credits, sales, finance, reports…) are never touched, so a tenant that
// trimmed those from its Storekeeper role is left alone.
import {
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
} from './permissions';

/** Catalog groups that belong to the CRM module. */
export const CUSTOMER_PERMISSION_GROUPS = ['Customers'] as const;

const CUSTOMER_GROUP_SET = new Set<string>(CUSTOMER_PERMISSION_GROUPS);

/**
 * Every CRM permission key, in catalog order. `dashboard.view` is added
 * explicitly — no HTTP request (and therefore no role) works without it.
 */
export const CUSTOMER_PERMISSION_KEYS: string[] = [
  ...PERMISSIONS.filter((p) => CUSTOMER_GROUP_SET.has(p.group)).map(
    (p) => p.key,
  ),
  'dashboard.view',
];

const CUSTOMER_KEY_SET = new Set(CUSTOMER_PERMISSION_KEYS);

/**
 * Default roles the platform expects to hold CRM keys. Kept in sync with the
 * `customers.*` entries in DEFAULT_ROLE_PERMISSIONS: Storekeeper/Shopkeeper
 * roles own the customer book end-to-end, while the till and the front desk get
 * the read-only lookup they need to bill or greet somebody.
 */
export const CUSTOMER_ROLE_KEYS = [
  'OWNER',
  'STOREKEEPER',
  'SHOPKEEPER',
  'STANDALONE_SHOPKEEPER',
  'MANAGER',
  'CASHIER',
  'RECEPTIONIST',
] as const;

/**
 * systemKey -> CRM keys that role is expected to hold. Derived from the live
 * catalog + DEFAULT_ROLE_PERMISSIONS so new keys are picked up with no extra
 * bookkeeping: Owner (which holds ALL_PERMISSION_KEYS) automatically owns every
 * future CRM key.
 */
export const CUSTOMER_ROLE_GRANTS: Record<string, string[]> =
  Object.fromEntries(
    CUSTOMER_ROLE_KEYS.map((key) => [
      key,
      (key === 'OWNER'
        ? ALL_PERMISSION_KEYS
        : (DEFAULT_ROLE_PERMISSIONS[key] ?? [])
      ).filter((k) => CUSTOMER_KEY_SET.has(k)),
    ]),
  );

/** Keys from `target` that `existing` is missing, in target order. */
export function missingRoleGrants(
  existing: readonly string[],
  target: readonly string[],
): string[] {
  const have = new Set(existing);
  return target.filter((key) => !have.has(key));
}
