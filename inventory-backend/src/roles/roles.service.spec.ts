// src/roles/roles.service.spec.ts
// The Roles list/detail must only expose permissions from the ACTIVE business's
// catalog — an OWNER holds every key in the DB, but a car-wash business must
// never see retail/manufacturing/service groups in its role editor or viewer.
import { RolesService } from './roles.service';
import { tenantContext } from '../common/tenant/tenant.context';

function setup(businessType: string) {
  const permissions = [
    { id: 1, key: 'dashboard.view', label: 'Dashboard', group: 'Dashboard' },
    { id: 2, key: 'carwash.washes.view', label: 'Washes', group: 'Car Wash - Washes' },
    { id: 3, key: 'products.view', label: 'Products', group: 'Products' },
    { id: 4, key: 'restaurant.view', label: 'Restaurant', group: 'Restaurant' },
  ];
  const role = {
    id: 10,
    name: 'Owner',
    isSystem: true,
    _count: { users: 1 },
    permissions: permissions.map((p) => ({ permission: p })),
  };
  const prisma: any = {
    organization: {
      findUnique: jest.fn(() => Promise.resolve({ businessType })),
    },
    permission: { findMany: jest.fn(() => Promise.resolve(permissions)) },
    role: {
      findMany: jest.fn(() => Promise.resolve([role])),
      findUnique: jest.fn(() => Promise.resolve(role)),
    },
  };
  return { svc: new RolesService(prisma), prisma };
}

describe('RolesService business-filtered permissions', () => {
  it('findAll filters each role to the active business groups', async () => {
    const { svc } = setup('CAR_WASH');
    const roles = await tenantContext.run(1, () => svc.findAll());
    const groups = roles[0].permissions.map((rp: any) => rp.permission.group);
    expect(groups).toContain('Car Wash - Washes');
    expect(groups).toContain('Dashboard');
    expect(groups).not.toContain('Products');
    expect(groups).not.toContain('Restaurant');
  });

  it('findOne filters the single role the same way', async () => {
    const { svc } = setup('CAR_WASH');
    const role = await tenantContext.run(1, () => svc.findOne(10));
    const keys = role.permissions.map((rp: any) => rp.permission.key);
    expect(keys).toEqual(['dashboard.view', 'carwash.washes.view']);
  });

  it('findPermissions returns only the business catalog', async () => {
    const { svc } = setup('CAR_WASH');
    const perms = await tenantContext.run(1, () => svc.findPermissions());
    const groups = perms.map((p: any) => p.group);
    expect(groups).not.toContain('Products');
    expect(groups).toContain('Car Wash - Washes');
  });
});
