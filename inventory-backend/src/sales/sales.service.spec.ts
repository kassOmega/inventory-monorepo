import { SalesService } from './sales.service';

jest.mock('../common/tenant/tenant.context', () => ({
  getCurrentTenantId: jest.fn(() => 1),
  requireTenantId: jest.fn(() => 1),
}));

const makePrisma = (overrides: Record<string, any> = {}) => {
  const prisma: Record<string, any> = {
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
    sale: {
      create: jest.fn(async (args: any) => ({
        id: 42,
        invoiceNumber: 'INV-42',
        saleDate: new Date('2026-08-30T00:34:39.000Z'),
        ...args.data,
      })),
    },
    inventory: {
      findFirst: jest.fn(async () => ({
        id: 9,
        quantity: 100,
        product: {
          currentBuyPrice: 10,
          currentSellPrice: 20,
          isPerishable: false,
        },
      })),
      update: jest.fn(async (args: any) => ({ id: args.where.id })),
    },
    productVariant: { findUnique: jest.fn(async () => null) },
    product: { findUnique: jest.fn(async () => null) },
    location: { findUnique: jest.fn(async () => ({ name: 'Shop' })) },
    organization: {
      findUnique: jest.fn(async () => ({
        taxEnabled: false,
        taxInclusive: true,
      })),
    },
    taxRate: { findFirst: jest.fn(async () => null) },
    productBatch: {
      findMany: jest.fn(async () => []),
      update: jest.fn(async (a: any) => a),
    },
    creditSale: { create: jest.fn(async (args: any) => args.data) },
    auditLog: { create: jest.fn(async (args: any) => args.data) },
    ...overrides,
  };
  return prisma;
};

const makeService = (prisma: any) => {
  const finance = { postSaleIncome: jest.fn(async () => 1) };
  const notifications = {
    checkAndNotifyLowStock: jest.fn(async () => undefined),
  };
  // CRM: only exercised for sales with a customer; a stub keeps these specs
  // focused on the checkout/stock behaviour they cover.
  const loyalty = {
    syncSaleLoyalty: jest.fn(async () => ({
      earned: 0,
      reversed: 0,
      balance: null,
    })),
  };
  const service = new SalesService(
    prisma,
    notifications as any,
    finance as any,
    loyalty as any,
  );
  return { service, finance, notifications, loyalty, prisma };
};

const createUser = {
  sub: 1,
  isSuperuser: true,
  locationId: null,
  permissions: [],
};
const updateUser = {
  sub: 1,
  isSuperuser: true,
  locationId: 3,
  permissions: [],
};

describe('SalesService.createSale', () => {
  it('calls postSaleIncome synchronously inside the checkout transaction', async () => {
    const prisma = makePrisma();
    const { service, finance } = makeService(prisma);

    await service.createSale(
      {
        shopId: 3,
        items: [{ productId: 5, quantity: 2 }],
        saleType: 'FULLY_PAID',
        paymentMethodId: 1,
      } as any,
      createUser as any,
    );

    // postSaleIncome fires within the same transaction that created the sale.
    expect(finance.postSaleIncome).toHaveBeenCalledTimes(1);
    // sale id 42 (from the create mock) + tenant 1 + the shared transaction.
    expect(finance.postSaleIncome).toHaveBeenCalledWith(
      42,
      1,
      expect.anything(),
    );
  });

  it('converts the selected unit to stock and prices it per unit', async () => {
    const units = [
      {
        unitId: 1,
        perBase: 1,
        isBase: true,
        isDefaultSale: true,
        sellPrice: null,
        buyPrice: null,
        unit: { name: 'Box' },
      },
      {
        unitId: 2,
        perBase: 24,
        isBase: false,
        isDefaultSale: false,
        sellPrice: null,
        buyPrice: null,
        unit: { name: 'Piece' },
      },
    ];
    const prisma = makePrisma({
      inventory: {
        findFirst: jest.fn(async () => ({
          id: 9,
          quantity: 100,
          product: {
            currentBuyPrice: 480,
            currentSellPrice: 1200,
            isPerishable: false,
            stockUnitId: 2,
            units,
          },
        })),
        update: jest.fn(async (args: any) => ({ id: args.where.id })),
      },
    });
    const { service } = makeService(prisma);

    await service.createSale(
      {
        shopId: 3,
        items: [{ productId: 5, quantity: 2, unitId: 1 }],
        saleType: 'FULLY_PAID',
        paymentMethodId: 1,
      } as any,
      createUser as any,
    );

    // 2 Boxes × 24 Pieces = 48 stock units deducted.
    expect(prisma.inventory.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { quantity: { decrement: 48 } } }),
    );
    const saleArg = (prisma.sale.create as jest.Mock).mock.calls[0][0];
    expect(saleArg.data.totalAmount).toBe(2400);
    expect(saleArg.data.items.create[0]).toMatchObject({
      unitId: 1,
      unitQuantity: 2,
      unitPrice: 1200,
      quantity: 48,
      stockQuantity: 48,
      stockFactor: 24,
    });
  });
});

describe('SalesService.updateSale', () => {
  it('rejects an increase above the restored stock with a delta-aware message', async () => {
    const oldSale = {
      id: 7,
      shopId: 3,
      items: [
        { id: 1, productId: 5, variantId: null, batchId: null, quantity: 3 },
      ],
    };
    // inventory.findFirst returns the post-restore row: 3 on hand means the
    // physical stock was 0 and the original 3 were restored before re-deduct.
    const prisma = makePrisma({
      sale: {
        findUnique: jest.fn(async () => oldSale),
        update: jest.fn(),
      },
      inventory: {
        // Restore step reads this row (existing inventory), then the delta
        // check sees the same post-restore quantity of 3 → 0 physical stock.
        findFirst: jest.fn(async () => ({ id: 9, quantity: 3 })),
        update: jest.fn(),
      },
      product: {
        findFirst: jest.fn(async () => ({
          id: 5,
          brand: 'ACME',
          baseName: 'Widget',
        })),
        findUnique: jest.fn(async () => null),
      },
    });
    const { service } = makeService(prisma);

    await expect(
      service.updateSale(
        7,
        { shopId: 3, items: [{ productId: 5, quantity: 8 }] } as any,
        updateUser as any,
      ),
    ).rejects.toThrow('Cannot sell 8x "ACME Widget". Only 3 available.');
    // The increase above the original allocation (8 - 3 = 5) was rejected.
    // The single inventory.update call was the stock restore of the original
    // 3 units — no re-deduction of the over-limit quantity happened.
    expect(prisma.inventory.update).toHaveBeenCalledTimes(1);
  });
});

describe('SalesService location scoping', () => {
  // A storekeeper: real location, type STORE, holds sales.view + sales.create.
  const storeUser = {
    sub: 9,
    isSuperuser: false,
    locationId: 26,
    locationType: 'STORE',
    permissions: ['sales.view'],
  };

  it('findAll shows a STORE user the sales booked at their own location', async () => {
    const prisma = makePrisma({
      sale: { findMany: jest.fn(async () => []) },
    });
    const { service } = makeService(prisma);

    await service.findAll(storeUser as any);

    expect(prisma.sale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ shopId: 26 }),
      }),
    );
  });

  it('findOne shows a STORE user their own sale instead of an empty result', async () => {
    const prisma = makePrisma({
      sale: {
        findFirst: jest.fn(async () => ({ id: 41, shopId: 26, items: [] })),
      },
    });
    const { service } = makeService(prisma);

    await service.findOne(41, storeUser as any);

    expect(prisma.sale.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 41, shopId: 26 }),
      }),
    );
    // The old behaviour forced shopId -1, making the sale unreachable by id.
    expect(prisma.sale.findFirst).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ shopId: -1 }),
      }),
    );
  });
});
