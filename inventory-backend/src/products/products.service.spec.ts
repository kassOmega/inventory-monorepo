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
