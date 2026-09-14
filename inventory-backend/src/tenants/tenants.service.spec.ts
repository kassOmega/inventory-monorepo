// src/tenants/tenants.service.spec.ts
import { BusinessType, HospitalityServiceType } from '@prisma/client';
import { TenantsService } from './tenants.service';

/**
 * Hospitality service onboarding:
 *  - the creation multi-select is persisted on Organization.enabledHospitalityServices
 *    and seeds one HospitalityService row per selectable service line,
 *  - F&B is the only service that seeds Kitchen/Bar/Barista stations and menu
 *    categories (a rooms-only pension gets neither),
 *  - non-hospitality businesses never carry hospitality services.
 */
describe('TenantsService hospitality service onboarding', () => {
  const created = {
    stations: [] as any[],
    menuCategories: [] as any[],
    services: [] as any[],
    guestIdTypes: [] as any[],
    orgCreate: null as any,
  };

  function makeService() {
    let seq = 100;
    const tx: any = {
      organization: {
        create: jest.fn(({ data }: any) => {
          created.orgCreate = data;
          return Promise.resolve({ id: 42, ...data });
        }),
      },
      permission: { upsert: jest.fn(() => Promise.resolve({ id: ++seq })) },
      role: { create: jest.fn(() => Promise.resolve({ id: ++seq })) },
      rolePermission: { createMany: jest.fn(() => Promise.resolve({ count: 0 })) },
      account: {
        createMany: jest.fn(() => Promise.resolve({ count: 0 })),
        findMany: jest.fn(() => Promise.resolve([])),
      },
      accountMapping: { createMany: jest.fn(() => Promise.resolve({ count: 0 })) },
      restaurantStation: {
        create: jest.fn(({ data }: any) => {
          created.stations.push(data);
          return Promise.resolve({ id: created.stations.length, ...data });
        }),
      },
      menuCategory: {
        create: jest.fn(({ data }: any) => {
          created.menuCategories.push(data);
          return Promise.resolve({ id: created.menuCategories.length, ...data });
        }),
        updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
      },
      category: { createMany: jest.fn(() => Promise.resolve({ count: 0 })) },
      hospitalityService: {
        create: jest.fn(({ data }: any) => {
          created.services.push(data);
          return Promise.resolve({ id: data.serviceType, ...data });
        }),
      },
      guestIdType: {
        createMany: jest.fn(({ data }: any) => {
          created.guestIdTypes.push(...data);
          return Promise.resolve({ count: data.length });
        }),
      },
      membership: { create: jest.fn(() => Promise.resolve({ id: 1 })) },
      location: { create: jest.fn(() => Promise.resolve({ id: 1 })) },
    };

    const prisma: any = {
      organization: { findUnique: jest.fn(() => Promise.resolve(null)) },
      membership: { count: jest.fn(() => Promise.resolve(0)) },
      user: { findUnique: jest.fn(() => Promise.resolve(null)) },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    const notifications: any = { notifyAdmins: jest.fn(() => Promise.resolve()) };
    const profiles: any = {};
    const service = new TenantsService(prisma, notifications, profiles);
    return { service, tx };
  }

  beforeEach(() => {
    created.stations = [];
    created.menuCategories = [];
    created.services = [];
    created.guestIdTypes = [];
    created.orgCreate = null;
  });

  it('persists the selected services and seeds a row per service line', async () => {
    const { service } = makeService();

    await service.createOrganization(7, {
      name: 'Lakeside Resort',
      businessType: BusinessType.HOSPITALITY,
      hospitalityServices: [
        HospitalityServiceType.FOOD_AND_BEVERAGE,
        HospitalityServiceType.SPA_AND_WELLNESS,
      ],
    });

    expect(created.orgCreate.enabledHospitalityServices).toEqual([
      HospitalityServiceType.FOOD_AND_BEVERAGE,
      HospitalityServiceType.SPA_AND_WELLNESS,
    ]);

    const enabled = created.services
      .filter((s) => s.isEnabled)
      .map((s) => s.serviceType)
      .sort();
    expect(enabled).toEqual([
      HospitalityServiceType.FOOD_AND_BEVERAGE,
      HospitalityServiceType.SPA_AND_WELLNESS,
    ]);
    expect(
      created.services.find(
        (s) => s.serviceType === HospitalityServiceType.ACCOMMODATION,
      )?.isEnabled,
    ).toBe(false);
    expect(created.services).toHaveLength(
      Object.values(HospitalityServiceType).length - 1,
    );
  });

  it('seeds stations and menu categories only when F&B is offered', async () => {
    const { service } = makeService();
    await service.createOrganization(7, {
      name: 'Lakeside Resort',
      businessType: BusinessType.HOSPITALITY,
      hospitalityServices: [
        HospitalityServiceType.FOOD_AND_BEVERAGE,
        HospitalityServiceType.ACCOMMODATION,
      ],
    });
    expect(created.stations).toHaveLength(3);
    expect(created.menuCategories.length).toBeGreaterThan(0);
  });

  it('does not seed F&B stations for a rooms-only pension', async () => {
    const { service } = makeService();
    await service.createOrganization(7, {
      name: 'Green Pension',
      businessType: BusinessType.HOSPITALITY,
      hospitalityServices: [HospitalityServiceType.ACCOMMODATION],
    });
    expect(created.stations).toHaveLength(0);
    expect(created.menuCategories).toHaveLength(0);
    expect(created.orgCreate.enabledHospitalityServices).toEqual([
      HospitalityServiceType.ACCOMMODATION,
    ]);
  });

  it('bypasses hospitality services entirely for non-hospitality businesses', async () => {
    const { service } = makeService();
    await service.createOrganization(7, {
      name: 'Main Shop',
      businessType: BusinessType.RETAIL,
      hospitalityServices: [HospitalityServiceType.FOOD_AND_BEVERAGE],
    });
    expect(created.orgCreate.enabledHospitalityServices).toEqual([]);
    expect(created.services).toHaveLength(0);
    expect(created.stations).toHaveLength(0);
    // Guest ID types are a front-desk concept — retail gets none.
    expect(created.guestIdTypes).toHaveLength(0);
  });

  it('seeds the default guest ID types for every hospitality business', async () => {
    const { service } = makeService();
    await service.createOrganization(7, {
      name: 'Green Pension',
      businessType: BusinessType.HOSPITALITY,
      hospitalityServices: [HospitalityServiceType.ACCOMMODATION],
    });

    // A rooms-only pension still registers guest IDs at check-in.
    expect(created.guestIdTypes.map((t) => t.code)).toEqual([
      'NATIONAL_ID',
      'PASSPORT',
      'DRIVERS_LICENSE',
      'OTHER',
    ]);
    expect(created.guestIdTypes.every((t) => t.tenantId === 42)).toBe(true);
    // Only the document types that carry an expiry require one.
    expect(
      created.guestIdTypes.filter((t) => t.requiresExpiry).map((t) => t.code),
    ).toEqual(['PASSPORT', 'DRIVERS_LICENSE']);
    expect(
      created.guestIdTypes.find((t) => t.code === 'NATIONAL_ID')?.nameI18n,
    ).toEqual({ en: 'National ID', am: 'ብሔራዊ መታወቂያ' });
  });

  it('falls back to the default set when a hospitality business omits the selection', async () => {
    const { service } = makeService();
    await service.createOrganization(7, {
      name: 'Default Hotel',
      businessType: BusinessType.HOSPITALITY,
    });
    expect(created.orgCreate.enabledHospitalityServices).toEqual([
      HospitalityServiceType.FOOD_AND_BEVERAGE,
      HospitalityServiceType.ACCOMMODATION,
    ]);
    expect(created.stations).toHaveLength(3);
  });

  it('resolveHospitalityServices filters CUSTOM and de-duplicates', () => {
    const { service } = makeService();
    const resolve = (service as any).resolveHospitalityServices.bind(service);

    expect(
      resolve(BusinessType.RETAIL, [HospitalityServiceType.GYM_AND_FITNESS]),
    ).toEqual([]);
    expect(
      resolve(BusinessType.HOSPITALITY, [
        HospitalityServiceType.GYM_AND_FITNESS,
        HospitalityServiceType.GYM_AND_FITNESS,
        HospitalityServiceType.CUSTOM,
      ]),
    ).toEqual([HospitalityServiceType.GYM_AND_FITNESS]);
    expect(resolve(BusinessType.HOSPITALITY, undefined)).toEqual([
      HospitalityServiceType.FOOD_AND_BEVERAGE,
      HospitalityServiceType.ACCOMMODATION,
    ]);
  });
});
