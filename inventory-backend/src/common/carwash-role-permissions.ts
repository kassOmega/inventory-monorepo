// src/common/carwash-role-permissions.ts
// Baseline car-wash permissions per default role, and the pure helper the
// backfill script uses to repair existing car-wash organizations (mirrors
// hospitality-role-permissions.ts / customer-role-permissions.ts).
import {
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
} from './permissions';

/** Catalog groups that belong to the car-wash module. */
export const CAR_WASH_PERMISSION_GROUPS = [
  'Car Wash - Washers',
  'Car Wash - Prices',
  'Car Wash - Vehicles',
  'Car Wash - Bookings',
  'Car Wash - Washes',
  'Car Wash - Equipment',
  'Car Wash - Expenses',
  'Car Wash - Collections',
  'Car Wash - Reports',
  'Car Wash - Settings',
] as const;

const CAR_WASH_GROUP_SET = new Set<string>(CAR_WASH_PERMISSION_GROUPS);

/** Every car-wash permission key, in catalog order, plus `dashboard.view`. */
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

// Customer lookup/creation is needed on the Record Wash form (customer dropdown +
// inline "+"), so every car-wash role gets the two CRM permissions regardless of
// their default role grants.
const CAR_WASH_EXTRA_ROLE_KEYS = ['customers.view', 'customers.manage'];

export const CAR_WASH_ROLE_GRANTS: Record<string, string[]> =
  Object.fromEntries(
    CAR_WASH_ROLE_KEYS.map((key) => [
      key,
      [
        ...(key === 'OWNER'
          ? ALL_PERMISSION_KEYS
          : (DEFAULT_ROLE_PERMISSIONS[key] ?? [])
        ).filter((k) => CAR_WASH_KEY_SET.has(k)),
        ...CAR_WASH_EXTRA_ROLE_KEYS,
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
