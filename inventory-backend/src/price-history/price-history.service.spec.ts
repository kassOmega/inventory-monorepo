import { PriceHistoryService } from './price-history.service';

const parentRow = (over: Record<string, unknown> = {}) => ({
  id: 10,
  productId: 5,
  variantId: null,
  batchRef: 'PH1',
  source: 'PRODUCT_EDIT',
  oldBuyPrice: 10,
  newBuyPrice: 12,
  oldSellPrice: 20,
  newSellPrice: 24,
  updatedAt: new Date('2026-09-17T10:00:00Z'),
  product: { id: 5, brand: 'Kabel', baseName: 'Wire' },
  ...over,
});

const detailRow = (over: Record<string, unknown> = {}) => ({
  id: 11,
  productId: 5,
  variantId: 847,
  batchRef: 'PH1',
  source: 'PRODUCT_EDIT',
  oldBuyPrice: 8,
  newBuyPrice: 9,
  oldSellPrice: 18,
  newSellPrice: 19,
  variant: {
    id: 847,
    sku: 'KAB-25-RED',
    attributes: { slot1: '2.5mm', slot2: 'Red' },
  },
  ...over,
});

/**
 * The page query asks for parent rows (variantId: null); the detail query asks for
 * `variantId: { not: null }` — which is how the mock tells them apart.
 */
const make = (
  opts: { rows?: any[]; details?: any[]; count?: number } = {},
) => {
  const rows = opts.rows ?? [parentRow()];
  const details = opts.details ?? [detailRow()];
  const prisma: any = {
    priceHistory: {
      findMany: jest.fn(async (args: any) =>
        args?.where?.variantId && typeof args.where.variantId === 'object'
          ? details
          : rows,
      ),
      count: jest.fn(async () => opts.count ?? rows.length),
    },
  };
  prisma.$transaction = jest.fn(async (arg: any) =>
    typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
  );
  return { prisma, service: new PriceHistoryService(prisma as any) };
};

describe('PriceHistoryService.findAll', () => {
  it('lists the product-level rows of each action by default', async () => {
    const { prisma, service } = make();

    const rows = await service.findAll();

    expect(rows).toHaveLength(1);
    expect(prisma.priceHistory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { variantId: null },
        orderBy: { updatedAt: 'desc' },
      }),
    );
    // No detail requested → no second query.
    expect(prisma.priceHistory.findMany).toHaveBeenCalledTimes(1);
  });

  it('attaches the per-variant rows of those actions in one extra query', async () => {
    const { prisma, service } = make();

    const rows = await service.findAll(undefined, { withDetails: true });

    expect(prisma.priceHistory.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.priceHistory.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { batchRef: { in: ['PH1'] }, variantId: { not: null } },
      }),
    );
    expect((rows as any[])[0].variants).toEqual([
      {
        variantId: 847,
        sku: 'KAB-25-RED',
        attributes: { slot1: '2.5mm', slot2: 'Red' },
        oldBuyPrice: 8,
        newBuyPrice: 9,
        oldSellPrice: 18,
        newSellPrice: 19,
      },
    ]);
  });

  it('gives every action its own detail list', async () => {
    const { service } = make({
      rows: [parentRow({ id: 10, batchRef: 'PH1' }), parentRow({ id: 12, batchRef: 'PH2' })],
      details: [
        detailRow({ batchRef: 'PH1' }),
        detailRow({ id: 13, batchRef: 'PH2', variantId: 848 }),
      ],
    });

    const rows = (await service.findAll(undefined, { withDetails: true })) as any[];

    expect(rows[0].variants.map((v: any) => v.variantId)).toEqual([847]);
    expect(rows[1].variants.map((v: any) => v.variantId)).toEqual([848]);
  });

  it('reports no detail when an action has no batch reference', async () => {
    const { prisma, service } = make({ rows: [parentRow({ batchRef: null })] });

    const rows = (await service.findAll(undefined, { withDetails: true })) as any[];

    expect(rows[0].variants).toEqual([]);
    expect(prisma.priceHistory.findMany).toHaveBeenCalledTimes(1);
  });

  it('filters by product and source, and lists a variant when asked for one', async () => {
    const { prisma, service } = make();

    await service.findAll(undefined, { productId: 5, source: 'RESTOCK' });
    expect(prisma.priceHistory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { variantId: null, productId: 5, source: 'RESTOCK' },
      }),
    );

    await service.findAll(undefined, { variantId: 847 });
    expect(prisma.priceHistory.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { variantId: 847 } }),
    );
  });

  it('keeps the paged envelope and counts the filtered rows', async () => {
    const { prisma, service } = make({ count: 42 });

    const page = await service.findAll(
      { page: 2, pageSize: 20, enabled: true },
      { withDetails: true },
    );

    expect(page).toMatchObject({ total: 42, page: 2, pageSize: 20 });
    expect((page as any).data).toHaveLength(1);
    expect((page as any).data[0].variants).toHaveLength(1);
    expect(prisma.priceHistory.count).toHaveBeenCalledWith({
      where: { variantId: null },
    });
    expect(prisma.priceHistory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20 }),
    );
  });
});
