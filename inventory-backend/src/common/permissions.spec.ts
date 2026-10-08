// src/common/permissions.spec.ts
// Guards on the permission catalog itself: keys must stay unique and
// well-formed, every default role must reference real keys, and the hospitality
// baseline used by the role backfill must stay aligned with the catalog.
import {
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_GROUPS_BY_BUSINESS_TYPE,
  PERMISSIONS,
} from './permissions';
import {
  HOSPITALITY_PERMISSION_KEYS,
  HOSPITALITY_ROLE_GRANTS,
  missingRoleGrants,
} from './hospitality-role-permissions';
import { BusinessType } from '@prisma/client';

const KEYS = PERMISSIONS.map((p) => p.key);
const KEY_SET = new Set(KEYS);

describe('permission catalog', () => {
  it('has unique, well-formed keys', () => {
    expect(KEYS.length).toBe(new Set(KEYS).size);
    for (const p of PERMISSIONS) {
      expect(p.key).toMatch(/^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)+$/);
      expect(p.label.trim().length).toBeGreaterThan(0);
      expect(p.group.trim().length).toBeGreaterThan(0);
    }
    expect(ALL_PERMISSION_KEYS).toEqual(KEYS);
  });

  it('exposes the granular hospitality keys the pages and APIs gate on', () => {
    for (const key of [
      'hotel.reception',
      'hotel.housekeeping',
      'hotel.housekeeping.update',
      'folios.view',
      'folios.charge',
      'folios.settle',
      'folios.manage',
      'packages.redeem',
      'facility.check-in',
      'restaurant.take-orders',
      'restaurant.serve',
      'restaurant.settle',
      'cashier.confirm',
    ]) {
      expect(KEY_SET.has(key)).toBe(true);
    }
  });

  it('every allowed group for a business type exists (or is dynamic)', () => {
    // Groups created at runtime (per station / per production flow) have no
    // static catalog entry, so they are allowed to appear in the filter list.
    const dynamicGroups = new Set(['Stations', 'Production Flows']);
    const catalogGroups = new Set(PERMISSIONS.map((p) => p.group));
    for (const businessType of Object.values(BusinessType)) {
      for (const group of PERMISSION_GROUPS_BY_BUSINESS_TYPE[businessType]) {
        expect(catalogGroups.has(group) || dynamicGroups.has(group)).toBe(true);
      }
    }
  });

  it('lets a hospitality owner assign every hospitality module group', () => {
    const allowed =
      PERMISSION_GROUPS_BY_BUSINESS_TYPE[BusinessType.HOSPITALITY];
    for (const group of [
      'Restaurant',
      'Hotel',
      'Stations',
      'Kitchen',
      'Bar',
      'Barista',
      'Cashier',
      'Hospitality Facilities & Memberships',
      'Hospitality Packages & Folio',
      'Service',
      'Finance',
      'Roles',
    ]) {
      expect(allowed).toContain(group);
    }
  });

  it('only references real keys from the default role sets', () => {
    for (const [role, keys] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      const unknown = keys.filter((key) => !KEY_SET.has(key));
      expect(`${role}: ${unknown.join(',')}`).toBe(`${role}: `);
    }
  });

  it('keeps the CAR_WASH catalog car-wash specific', () => {
    // The Roles & Permissions editor renders exactly this group list, so it must
    // never leak another vertical's groups (the bug this guards against is a
    // car-wash role editor showing Products/Categories/Sales/…). `Reports` and
    // `Finance` ARE allowed: the car-wash vertical shows the shared reports page
    // and the standard finance surface.
    const allowed = PERMISSION_GROUPS_BY_BUSINESS_TYPE[BusinessType.CAR_WASH];
    const foreign = [
      'Products',
      'Categories',
      'Restaurant',
      'Hotel',
      'Kitchen',
      'Bar',
      'Barista',
      'Sales',
      'Credits',
      'Manufacturing',
    ];
    for (const group of foreign) {
      expect(allowed).not.toContain(group);
    }
    // …and it still lets a car-wash owner assign every relevant group.
    for (const group of [
      'Car Wash - Washers',
      'Car Wash - Washes',
      'Car Wash - Reports',
      'Car Wash - Collections',
      'Car Wash - Expenses',
      'Customers',
      'Users',
      'Roles',
      'Finance',
      'Reports',
    ]) {
      expect(allowed).toContain(group);
    }
  });
});
