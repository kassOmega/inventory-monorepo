// src/inventory/inventory.service.spec.ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InventoryService } from './inventory.service';

jest.mock('../common/tenant/tenant.context', () => ({
  getCurrentTenantId: jest.fn(() => 1),
  requireTenantId: jest.fn(() => 1),
}));

describe('InventoryService — spoilage & wastage', () => {
  const user = { sub: 7 } as any;
  const product = {
    id: 10,
    brand: 'Raw',
    baseName: 'Onion',
    currentBuyPrice: 30,
    unit: { name: 'kg' },
  };

  const makePrisma = (overrides: Record<string, any> = {}) => {
    const prisma: Record<string, any> = {
      product: {
        findFirst: jest.fn(async () => product),
      },
      inventory: {
        findFirst: jest.fn(async () => ({ id: 5, quantity: 100, locationId: 2 })),
        update: jest.fn(async (args: any) => ({ id: args.where.id })),
      },
      wastageEntry: {
        create: jest.fn(async (args: any) => ({ id: 12, ...args.data })),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
      ...overrides,
    };
    return prisma;
  };

  const finance = {
    postWastage: jest.fn(async () => true),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('decrements stock, logs a wastage entry and posts the ledger', async () => {
    const prisma = makePrisma();
    const service = new InventoryService(prisma as any, finance as any);

    const result = await service.recordWastage(
      { productId: 10, quantity: 5, reason: 'spoiled' },
      user,
    );

    expect(prisma.inventory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: { quantity: { decrement: 5 } },
      }),
    );
    expect(prisma.wastageEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: 10,
          quantity: 5,
          unitCost: 30,
          totalValue: 150,
          reason: 'spoiled',
        }),
      }),
    );
    expect(finance.postWastage).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: 'WST-12',
        amount: 150,
        tenantId: 1,
      }),
    );
    expect(result.id).toBe(12);
  });

  it('rejects wastage that exceeds available stock', async () => {
    const prisma = makePrisma();
    const service = new InventoryService(prisma as any, finance as any);

    await expect(
      service.recordWastage({ productId: 10, quantity: 200 }, user),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.inventory.update).not.toHaveBeenCalled();
    expect(finance.postWastage).not.toHaveBeenCalled();
  });

  it('throws NotFound for an unknown product', async () => {
    const prisma = makePrisma({
      product: { findFirst: jest.fn(async () => null) },
    });
    const service = new InventoryService(prisma as any, finance as any);

    await expect(
      service.recordWastage({ productId: 999, quantity: 1 }, user),
    ).rejects.toThrow(NotFoundException);
  });
});
