// src/common/customer-role-permissions.spec.ts
// The CRM (`customers.*`) role baseline: what each default role must be able to
// do, and the additive-only rule the backfill script relies on.
import { PERMISSIONS } from './permissions';
import {
  CUSTOMER_PERMISSION_KEYS,
  CUSTOMER_ROLE_GRANTS,
  CUSTOMER_ROLE_KEYS,
  missingRoleGrants,
} from './customer-role-permissions';

describe('customer permission baseline', () => {
  it('covers every CRM key plus dashboard access', () => {
    const catalogCustomerKeys = PERMISSIONS.filter(
      (p) => p.group === 'Customers',
    ).map((p) => p.key);
    expect(catalogCustomerKeys).toEqual(['customers.view', 'customers.manage']);
    expect(CUSTOMER_PERMISSION_KEYS).toEqual([
      ...catalogCustomerKeys,
      'dashboard.view',
    ]);
  });

  it('gives Owner every CRM key, including ones added later', () => {
    for (const key of CUSTOMER_PERMISSION_KEYS) {
      expect(CUSTOMER_ROLE_GRANTS.OWNER).toContain(key);
    }
  });

  it('defines a baseline for every CRM role', () => {
    expect(Object.keys(CUSTOMER_ROLE_GRANTS).sort()).toEqual(
      [...CUSTOMER_ROLE_KEYS].sort(),
    );
    for (const role of CUSTOMER_ROLE_KEYS) {
      expect(CUSTOMER_ROLE_GRANTS[role]).toContain('dashboard.view');
    }
  });

  it('lets the shop-floor roles keep the whole customer book', () => {
    for (const role of [
      'STOREKEEPER',
      'SHOPKEEPER',
      'STANDALONE_SHOPKEEPER',
      'MANAGER',
    ]) {
      expect(CUSTOMER_ROLE_GRANTS[role]).toEqual(
        expect.arrayContaining(['customers.view', 'customers.manage']),
      );
    }
  });

  it('gives the till and the front desk a read-only customer lookup', () => {
    for (const role of ['CASHIER', 'RECEPTIONIST']) {
      expect(CUSTOMER_ROLE_GRANTS[role]).toContain('customers.view');
      expect(CUSTOMER_ROLE_GRANTS[role]).not.toContain('customers.manage');
    }
  });

  it('never smuggles cross-vertical grants into the backfill', () => {
    for (const [role, keys] of Object.entries(CUSTOMER_ROLE_GRANTS)) {
      for (const key of keys) {
        expect(`${role}:${CUSTOMER_PERMISSION_KEYS.includes(key)}`).toBe(
          `${role}:true`,
        );
      }
      expect(keys).not.toContain('credits.manage');
      expect(keys).not.toContain('sales.create');
      expect(keys).not.toContain('finance.manage');
      expect(keys).not.toContain('products.view');
    }
  });
});

describe('missingRoleGrants (CRM)', () => {
  it('returns only what is missing, in target order', () => {
    expect(missingRoleGrants(['customers.view'], ['customers.view', 'customers.manage'])).toEqual([
      'customers.manage',
    ]);
    expect(
      missingRoleGrants(['customers.view', 'customers.manage'], CUSTOMER_PERMISSION_KEYS),
    ).toEqual(['dashboard.view']);
  });

  it('is additive only — it never revokes a key', () => {
    const result = missingRoleGrants(['credits.manage'], ['customers.view']);
    expect(result).toEqual(['customers.view']);
    expect(result).not.toContain('credits.manage');
  });
});
