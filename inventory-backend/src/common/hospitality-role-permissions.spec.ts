// src/common/hospitality-role-permissions.spec.ts
// The hospitality role baseline: what each default role must be able to do, and
// the additive-only rule the backfill script relies on.
import { PERMISSIONS } from './permissions';
import {
  HOSPITALITY_PERMISSION_KEYS,
  HOSPITALITY_ROLE_GRANTS,
  HOSPITALITY_ROLE_KEYS,
  missingRoleGrants,
} from './hospitality-role-permissions';

describe('hospitality permission baseline', () => {
  it('covers every hospitality module key plus dashboard access', () => {
    const catalogHospitalityKeys = PERMISSIONS.filter((p) =>
      [
        'Restaurant',
        'Hotel',
        'Kitchen',
        'Bar',
        'Barista',
        'Cashier',
        'Hospitality Facilities & Memberships',
        'Hospitality Packages & Folio',
      ].includes(p.group),
    ).map((p) => p.key);
    expect(HOSPITALITY_PERMISSION_KEYS).toEqual([
      ...catalogHospitalityKeys,
      'dashboard.view',
    ]);
  });

  it('gives Owner every hospitality key, including ones added later', () => {
    for (const key of HOSPITALITY_PERMISSION_KEYS) {
      expect(HOSPITALITY_ROLE_GRANTS.OWNER).toContain(key);
    }
  });

  it('defines a baseline for every hospitality default role', () => {
    expect(Object.keys(HOSPITALITY_ROLE_GRANTS).sort()).toEqual(
      [...HOSPITALITY_ROLE_KEYS].sort(),
    );
    for (const role of HOSPITALITY_ROLE_KEYS) {
      expect(HOSPITALITY_ROLE_GRANTS[role]).toContain('dashboard.view');
    }
  });

  it('lets the front desk run the folio surface end to end', () => {
    expect(HOSPITALITY_ROLE_GRANTS.RECEPTIONIST).toEqual(
      expect.arrayContaining([
        'dashboard.view',
        'hotel.view',
        'hotel.reception',
        'hotel.housekeeping',
        'folios.view',
        'folios.charge',
        'folios.settle',
        'folios.manage',
      ]),
    );
  });

  it('keeps housekeeping to the room board only', () => {
    const housekeeping = HOSPITALITY_ROLE_GRANTS.HOUSEKEEPING;
    expect(housekeeping).toEqual(
      expect.arrayContaining([
        'dashboard.view',
        'hotel.view',
        'hotel.housekeeping',
        'hotel.housekeeping.update',
      ]),
    );
    expect(housekeeping.some((k) => k.startsWith('folios.'))).toBe(false);
    expect(housekeeping).not.toContain('hotel.reception');
  });

  it('lets the cashier settle folios without configuring packages', () => {
    const cashier = HOSPITALITY_ROLE_GRANTS.CASHIER;
    expect(cashier).toEqual(
      expect.arrayContaining([
        'folios.view',
        'folios.settle',
        'cashier.confirm',
      ]),
    );
    expect(cashier).not.toContain('folios.charge');
    expect(cashier).not.toContain('packages.manage');
  });

  it('gives the waiter order keys but no folio money keys', () => {
    const waiter = HOSPITALITY_ROLE_GRANTS.WAITER;
    expect(waiter).toEqual(
      expect.arrayContaining([
        'restaurant.take-orders',
        'restaurant.serve',
        'restaurant.settle',
      ]),
    );
    expect(waiter.some((k) => k.startsWith('folios.'))).toBe(false);
  });

  it('never smuggles cross-vertical grants into the backfill', () => {
    for (const [role, keys] of Object.entries(HOSPITALITY_ROLE_GRANTS)) {
      for (const key of keys) {
        expect(`${role}:${HOSPITALITY_PERMISSION_KEYS.includes(key)}`).toBe(
          `${role}:true`,
        );
      }
      expect(keys).not.toContain('finance.manage');
      expect(keys).not.toContain('products.view');
      expect(keys).not.toContain('service.manage');
    }
  });
});

describe('missingRoleGrants', () => {
  it('returns only what is missing, in target order', () => {
    expect(missingRoleGrants(['a', 'b'], ['b', 'a', 'c', 'd'])).toEqual([
      'c',
      'd',
    ]);
    expect(missingRoleGrants(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([]);
    expect(missingRoleGrants([], ['x'])).toEqual(['x']);
  });

  it('is additive only — it never revokes a key', () => {
    const result = missingRoleGrants(['folios.manage'], ['folios.view']);
    expect(result).toEqual(['folios.view']);
    expect(result).not.toContain('folios.manage');
  });
});
