// src/common/carwash-role-permissions.ts
// Baseline car-wash permissions per default role, and the pure helper the
// backfill script uses to repair existing car-wash organizations (mirrors
// hospitality-role-permissions.ts / customer-role-permissions.ts).
import {
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_GROUPS_BY_BUSINESS_TYPE,
} from './permissions';

/**
 * The full set of groups a car-wash business may use (not just the `Car Wash - *`
 * module): the shared catalog groups (Dashboard, Customers, Users, Roles,
 * Finance, AI, Agent) are valid for a car-wash owner/manager too. Derived from
 * the business-type allow-list so the roles editor, the nav, and the reconcile
 * backfill all agree.
 */
export const CAR_WASH_PERMISSION_GROUPS = [
  ...(PERMISSION_GROUPS_BY_BUSINESS_TYPE.CAR_WASH ?? []),
] as const;

const CAR_WASH_GROUP_SET = new Set<string>(CAR_WASH_PERMISSION_GROUPS);

/** Every permission key a car-wash business may hold, in catalog order. */
export const CAR_WASH_PERMISSION_KEYS: string[] = [
  ...PERMISSIONS.filter((p) => CAR_WASH_GROUP_SET.has(p.group)).map(
    (p) => p.key,
  ),
  'dashboard.view',
];

const CAR_WASH_KEY_SET = new Set(CAR_WASH_PERMISSION_KEYS);

/** Default roles a car-wash organization starts with. */
export const CAR_WASH_ROLE_KEYS = [
  'OWNER',
  'MANAGER',
  'WASHER',
  'CASHIER',
] as const;

// Customer lookup/creation is needed on the Record Wash / booking forms for the
// roles that actually use them. The Washer baseline is deliberately just the
// dashboard + own report, so the owner grants anything extra explicitly.
const CAR_WASH_EXTRA_ROLE_KEYS: Record<string, string[]> = {
  OWNER: ['customers.view', 'customers.manage'],
  MANAGER: ['customers.view', 'customers.manage'],
  CASHIER: ['customers.view', 'customers.manage'],
  WASHER: [],
};

export const CAR_WASH_ROLE_GRANTS: Record<string, string[]> =
  Object.fromEntries(
    CAR_WASH_ROLE_KEYS.map((key) => [
      key,
      [
        ...(key === 'OWNER'
          ? ALL_PERMISSION_KEYS
          : (DEFAULT_ROLE_PERMISSIONS[key] ?? [])
        ).filter((k) => CAR_WASH_KEY_SET.has(k)),
        ...(CAR_WASH_EXTRA_ROLE_KEYS[key] ?? []),
      ],
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
