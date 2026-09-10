import { TaxDirection } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { TaxesService } from './taxes.service';

jest.mock('../common/tenant/tenant.context', () => ({
  getCurrentTenantId: jest.fn(() => 1),
}));

describe('TaxesService', () => {
  let svc: TaxesService;
  let prisma: Record<string, any>;
  let taxRates: any[];
  let accounts: any[];
  let orgState: any;

  const makePrisma = () => {
    prisma = {
      organization: {
        findUnique: jest.fn(async () => orgState),
        update: jest.fn(async (args: any) => {
          orgState = { ...orgState, ...args.data };
          return orgState;
        }),
      },
      taxRate: {
        findMany: jest.fn(async (args: any) => {
          let rows = taxRates.filter((r: any) => r.organizationId === 1);
          if (args?.where?.direction) {
            rows = rows.filter((r: any) => r.direction === args.where.direction);
          }
          if (args?.where?.isDefault === true) {
            rows = rows.filter((r: any) => r.isDefault === true);
          }
          if (args?.where?.NOT?.id != null) {
            rows = rows.filter((r: any) => r.id !== args.where.NOT.id);
          }
          return [...rows];
        }),
        findFirst: jest.fn(async (args: any) => {
          return (
            taxRates.find(
              (r: any) => r.id === args.where.id && r.organizationId === 1,
            ) ?? null
          );
        }),
        create: jest.fn(async (args: any) => {
          const row = {
            id: taxRates.length + 1,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...args.data,
          };
          taxRates.push(row);
          return row;
        }),
        updateMany: jest.fn(async (args: any) => {
          for (const r of taxRates) {
            if (args.where.id != null && r.id !== args.where.id) continue;
            if (
              args.where.organizationId != null &&
              r.organizationId !== args.where.organizationId
            ) continue;
            if (args.where.direction != null && r.direction !== args.where.direction) continue;
            if (args.where.isDefault != null && r.isDefault !== args.where.isDefault) continue;
            if (args.where.NOT?.id != null && r.id === args.where.NOT.id) continue;
            Object.assign(r, args.data);
          }
          return { count: 1 };
        }),
        deleteMany: jest.fn(async (args: any) => {
          taxRates = taxRates.filter(
            (r: any) => !(r.id === args.where.id && r.organizationId === 1),
          );
          return { count: 1 };
        }),
      },
      account: {
        findMany: jest.fn(async () => accounts),
        createMany: jest.fn(async (args: any) => {
          accounts.push(...args.data);
          return { count: args.data.length };
        }),
      },
    };
    return prisma;
  };

  beforeEach(() => {
    orgState = { id: 1, taxEnabled: false, taxInclusive: true, taxId: null };
    taxRates = [];
    accounts = [];
    svc = new TaxesService(makePrisma() as any);
  });

  it('findAll returns settings + rates', async () => {
    taxRates.push({
      id: 1,
      organizationId: 1,
      name: 'VAT 15%',
      code: 'VAT15',
      rate: 15,
      direction: TaxDirection.OUTPUT,
      isDefault: true,
      enabled: true,
    });
    const result = await svc.findAll();
    expect(result.settings).toEqual({
      taxEnabled: false,
      taxInclusive: true,
      taxId: null,
    });
    expect(result.rates).toHaveLength(1);
    expect(result.rates[0].name).toBe('VAT 15%');
  });

  it('create clamps rate to 0-100', async () => {
    await svc.create({ name: 'Bad', rate: 150 } as any);
    expect(taxRates[0].rate).toBe(100);
    await svc.create({ name: 'Neg', rate: -5 } as any);
    expect(taxRates[1].rate).toBe(0);
  });

  it('create as default demotes the previous default', async () => {
    taxRates.push({
      id: 1,
      organizationId: 1,
      name: 'Old',
      rate: 10,
      direction: TaxDirection.OUTPUT,
      isDefault: true,
      enabled: true,
    });
    await svc.create({ name: 'New', rate: 15, isDefault: true } as any);
    expect(taxRates.find((r) => r.id === 1).isDefault).toBe(false);
    expect(taxRates.find((r) => r.name === 'New').isDefault).toBe(true);
  });

  it('update promotes a rate to default and demotes the old one', async () => {
    taxRates.push({
      id: 1,
      organizationId: 1,
      name: 'Old',
      rate: 10,
      direction: TaxDirection.OUTPUT,
      isDefault: true,
      enabled: true,
    });
    taxRates.push({
      id: 2,
      organizationId: 1,
      name: 'New',
      rate: 15,
      direction: TaxDirection.OUTPUT,
      isDefault: false,
      enabled: true,
    });
    await svc.update(2, { isDefault: true } as any);
    expect(taxRates.find((r) => r.id === 1).isDefault).toBe(false);
    expect(taxRates.find((r) => r.id === 2).isDefault).toBe(true);
  });

  it('remove blocks deleting the default rate', async () => {
    taxRates.push({
      id: 1,
      organizationId: 1,
      name: 'VAT 15%',
      rate: 15,
      direction: TaxDirection.OUTPUT,
      isDefault: true,
      enabled: true,
    });
    await expect(svc.remove(1)).rejects.toThrow(BadRequestException);
    expect(taxRates).toHaveLength(1);
  });

  it('remove deletes a non-default rate', async () => {
    taxRates.push({
      id: 1,
      organizationId: 1,
      name: 'VAT 15%',
      rate: 15,
      direction: TaxDirection.OUTPUT,
      isDefault: true,
      enabled: true,
    });
    taxRates.push({
      id: 2,
      organizationId: 1,
      name: 'Zero-rated',
      rate: 0,
      direction: TaxDirection.OUTPUT,
      isDefault: false,
      enabled: true,
    });
    await svc.remove(2);
    expect(taxRates).toHaveLength(1);
  });

  it('enabling tax auto-creates the VAT accounts', async () => {
    await svc.updateSettings({ taxEnabled: true });
    expect(accounts.map((a: any) => a.name)).toEqual(
      expect.arrayContaining(['Output VAT Payable', 'Input VAT Receivable']),
    );
    expect(accounts[0].tenantId).toBe(1);
    expect(accounts[0].isSystem).toBe(true);
  });

  it('disabling tax does not create VAT accounts', async () => {
    await svc.updateSettings({ taxEnabled: false });
    expect(accounts).toHaveLength(0);
  });

  it('updateSettings persists taxId and trims it', async () => {
    const res = await svc.updateSettings({ taxId: '  ABC123  ' });
    expect(res.settings.taxId).toBe('ABC123');
  });
});

