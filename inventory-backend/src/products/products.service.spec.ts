import { ProductsService } from './products.service';

jest.mock('../common/tenant/tenant.context', () => ({
  getCurrentTenantId: jest.fn(() => 1),
}));

const makePrisma = (overrides: Record<string, any> = {}) => {
  const createdProduct = {
    id: 1,
    sku: 'ABC-XYZ-1A2B',
    brand: 'Acme',
    baseName: 'Widget',
    currentBuyPrice: 0,
    currentSellPrice: 0,
    hasVariants: false,
  };
  const prisma: Record<string, any> = {
    product: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async (args: any) => ({ ...createdProduct, ...args.data })),
      update: jest.fn(async (args: any) => args.data),
      findUnique: jest.fn(async () => createdProduct),
    },
    productVariant: {
      createManyAndReturn: jest.fn(async (args: any) =>
        (args.data ?? []).map((d: any, i: number) => ({
          id: i + 1,
          ...d,
        })),
      ),
      update: jest.fn(async (args: any) => args.data),
      findFirst: jest.fn(async () => null),
    },
    organization: {
      findUnique: jest.fn(async () => ({ standalone: false })),
    },
    location: {
      findFirst: jest.fn(async () => null),
      findUnique: jest.fn(async () => ({ type: 'STORE' })),
    },
    ...overrides,
  };
  return prisma;
};

const makeService = (prisma: any) => {
  const notifications = { notifyLocation: jest.fn(async () => undefined) };
  const finance = { postProcurement: jest.fn(async () => 1) };
  const service = new ProductsService(
    prisma,
    notifications as any,
    finance as any,
  );
  return { service, notifications, finance, prisma };
};

const owner = { sub: 1, isSuperuser: true, locationId: null, permissions: [] };
const base = (over: any = {}) => ({
  brand: 'Acme',
  baseName: 'Widget',
  categoryId: 1,
  hasVariants: false,
  ...over,
});

describe('ProductsService price + store validation', () => {
  it('rejects a plain product without positive buy/sell prices before any insert', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);

    await expect(
      service.create(
        base({ currentBuyPrice: 0, currentSellPrice: 0 }) as any,
        owner as any,
      ),
    ).rejects.toThrow('Buy Price and Sell Price are required for this product.');
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('requires a store when a plain product carries initial quantity', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);

    await expect(
      service.create(
        base({
          currentBuyPrice: 10,
          currentSellPrice: 20,
          quantity: 5,
          storeId: undefined,
        }) as any,
        owner as any,
      ),
    ).rejects.toThrow(
      'Please select a target Store/Location to assign initial stock.',
    );
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('stores the rounded variant average on the parent for variant products', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);

    await service.create(
      base({
        hasVariants: true,
        variants: [
          { attributes: { size: 'S' }, buyPrice: 10, sellPrice: 30 },
          { attributes: { size: 'L' }, buyPrice: 20, sellPrice: 40 },
        ],
      }) as any,
      owner as any,
    );

    // Parent row = simple average of the per-variant prices (rounded).
    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          currentBuyPrice: 15,
          currentSellPrice: 35,
          hasVariants: true,
        }),
      }),
    );
  });

  it('rejects a variant row that is missing a price', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);

    await expect(
      service.create(
        base({
          hasVariants: true,
          variants: [
            { attributes: { size: 'S' }, buyPrice: 10, sellPrice: 30 },
            { attributes: { size: 'L' }, buyPrice: 20, sellPrice: undefined },
          ],
        }) as any,
        owner as any,
      ),
    ).rejects.toThrow('Variant 2: buy and sell prices are required');
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('requires a store before variant rows with initial quantity are deposited', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);

    await expect(
      service.create(
        base({
          hasVariants: true,
          variants: [
            { attributes: { size: 'S' }, buyPrice: 10, sellPrice: 20, quantity: 4 },
          ],
          storeId: undefined,
        }) as any,
        owner as any,
      ),
    ).rejects.toThrow(
      'Please select a target Store/Location to assign initial stock.',
    );
    expect(prisma.product.create).not.toHaveBeenCalled();
  });
});

describe('ProductsService.findByCode (POS scan to cart)', () => {
  const productRow = {
    id: 7,
    sku: 'SAMBUSA-1',
    barcode: '4006381333931',
    brand: 'Nejat',
    baseName: 'Sambusa',
    hasVariants: false,
    inventory: [{ locationId: 3, quantity: 12 }],
  };

  it('matches a product barcode exactly, trimming and ignoring case', async () => {
    const prisma = makePrisma();
    prisma.product.findFirst = jest.fn(async () => productRow);
    const { service } = makeService(prisma);

    const res = await service.findByCode(' 4006381333931 ', 3);

    expect(res.matchType).toBe('PRODUCT');
    expect(res.product).toBe(productRow);
    expect(res.variant).toBeNull();
    expect(prisma.product.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { barcode: { equals: '4006381333931', mode: 'insensitive' } },
          { sku: { equals: '4006381333931', mode: 'insensitive' } },
        ],
      },
      include: expect.objectContaining({
        variants: { orderBy: { id: 'asc' } },
        inventory: { where: { locationId: 3 }, include: { location: true } },
      }),
    });
    expect(prisma.productVariant.findFirst).not.toHaveBeenCalled();
  });

  it('falls back to a variant code and returns the parent product', async () => {
    const prisma = makePrisma();
    prisma.product.findFirst = jest.fn(async () => null);
    prisma.productVariant.findFirst = jest.fn(async () => ({
      id: 41,
      sku: 'SAMBUSA-1-L',
      barcode: '4006381333948',
      product: productRow,
    }));
    const { service } = makeService(prisma);

    const res = await service.findByCode('4006381333948');

    expect(res.matchType).toBe('VARIANT');
    expect(res.product).toBe(productRow);
    expect(res.variant).toEqual({
      id: 41,
      sku: 'SAMBUSA-1-L',
      barcode: '4006381333948',
    });
    // The nested parent is stripped so the client can merge both objects.
    expect((res.variant as any).product).toBeUndefined();
  });

  it('returns NONE without querying for a blank code', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);

    const res = await service.findByCode('   ');

    expect(res).toEqual({ product: null, variant: null, matchType: 'NONE' });
    expect(prisma.product.findFirst).not.toHaveBeenCalled();
    expect(prisma.productVariant.findFirst).not.toHaveBeenCalled();
  });

  it('returns NONE when nothing matches', async () => {
    const prisma = makePrisma();
    const { service } = makeService(prisma);

    const res = await service.findByCode('DOES-NOT-EXIST');

    expect(res).toEqual({ product: null, variant: null, matchType: 'NONE' });
  });

  it('leaves the inventory include unscoped when no location is given', async () => {
    const prisma = makePrisma();
    prisma.product.findFirst = jest.fn(async () => productRow);
    const { service } = makeService(prisma);

    await service.findByCode('SAMBUSA-1');

    expect(prisma.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          inventory: { include: { location: true } },
        }),
      }),
    );
  });
});
