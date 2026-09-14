// src/common/hospitality-role-permissions.ts
// Baseline hospitality permissions per default role, and the pure helper the
// backfill script uses to repair existing organizations.
//
// Why this exists: default roles are cloned into an organization *once*, at
// creation time (TenantsService.createOrganization). When the catalog grows —
// as it did when `hotel.housekeeping.update`, `folios.charge`, `folios.settle`,
// `packages.redeem` and `facility.check-in` were introduced — every existing
// organization keeps the old set: a Receptionist created before the folio split
// has no `folios.view`, so the front desk cannot open the folio surface. The
// backfill grants the missing keys; this module owns exactly *which* keys the
// platform considers the baseline for each hospitality role.
//
// Deliberately scoped to hospitality-module keys (+ `dashboard.view`): cross
// vertical grants (finance, reports, inventory, service) are never touched, so a
// tenant that trimmed those from its Manager role is left alone.
import {
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
} from './permissions';

/** Catalog groups that belong to the hospitality module. */
export const HOSPITALITY_PERMISSION_GROUPS = [
  'Restaurant',
  'Hotel',
  'Kitchen',
  'Bar',
  'Barista',
  'Cashier',
  'Hospitality Facilities & Memberships',
  'Hospitality Packages & Folio',
  // 'Stations' is intentionally excluded: per-station keys are created and
  // re-linked at runtime by RestaurantService.ensureStationAccess.
] as const;

const HOSPITALITY_GROUP_SET = new Set<string>(HOSPITALITY_PERMISSION_GROUPS);

/**
 * Every hospitality-module permission key, in catalog order. `dashboard.view` is
 * added explicitly — no HTTP request (and therefore no role) works without it.
 */
export const HOSPITALITY_PERMISSION_KEYS: string[] = [
  ...PERMISSIONS.filter((p) => HOSPITALITY_GROUP_SET.has(p.group)).map(
    (p) => p.key,
  ),
  'dashboard.view',
];

const HOSPITALITY_KEY_SET = new Set(HOSPITALITY_PERMISSION_KEYS);

/** Default roles that make up a hospitality organization's role catalogue. */
export const HOSPITALITY_ROLE_KEYS = [
  'OWNER',
  'MANAGER',
  'WAITER',
  'CHEF',
  'BARMAN',
  'BARISTA',
  'CASHIER',
  'RECEPTIONIST',
  'HOUSEKEEPING',
] as const;

/**
 * systemKey -> hospitality keys that role is expected to hold. Derived from the
 * live catalog + DEFAULT_ROLE_PERMISSIONS so new keys are picked up with no
 * extra bookkeeping: Owner (which holds ALL_PERMISSION_KEYS) automatically owns
 * every future hospitality key.
 */
export const HOSPITALITY_ROLE_GRANTS: Record<string, string[]> =
  Object.fromEntries(
    HOSPITALITY_ROLE_KEYS.map((key) => [
      key,
      (key === 'OWNER'
        ? ALL_PERMISSION_KEYS
        : (DEFAULT_ROLE_PERMISSIONS[key] ?? [])
      ).filter((k) => HOSPITALITY_KEY_SET.has(k)),
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
