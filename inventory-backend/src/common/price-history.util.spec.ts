import { newPriceBatchRef, recordPriceChanges } from './price-history.util';

const makeDb = () => ({
  priceHistory: { create: jest.fn(async (args: any) => args.data) },
});

const change = (over: Record<string, unknown> = {}) => ({
  productId: 5,
  oldBuyPrice: 10,
  newBuyPrice: 12,
  oldSellPrice: 20,
  newSellPrice: 24,
  ...over,
});

describe('recordPriceChanges', () => {
  it('writes one row per change, all sharing a batch reference', async () => {
    const db = makeDb();

    const batchRef = await recordPriceChanges(db as any, {
      tenantId: 3,
      userId: 7,
      source: 'PRODUCT_EDIT',
      changes: [
        change(),
        change({ variantId: 847, oldBuyPrice: 8, newBuyPrice: 9 }),
      ],
    });

    expect(db.priceHistory.create).toHaveBeenCalledTimes(2);
    expect(batchRef).toMatch(/^PH/);
    const [parent, variant] = db.priceHistory.create.mock.calls.map(
      (c: any) => c[0].data,
    );
    // The product's own row is the "main" row the detail groups under.
    expect(parent).toMatchObject({
      productId: 5,
      variantId: null,
      batchRef,
      source: 'PRODUCT_EDIT',
      updatedById: 7,
      tenantId: 3,
    });
    expect(variant).toMatchObject({
      productId: 5,
      variantId: 847,
      batchRef,
      source: 'PRODUCT_EDIT',
      oldBuyPrice: 8,
      newBuyPrice: 9,
    });
  });

  it('skips rows whose prices did not move', async () => {
    const db = makeDb();

    await recordPriceChanges(db as any, {
      userId: 1,
      source: 'PURCHASE',
      changes: [
        change(),
        change({ variantId: 847, newBuyPrice: 10, newSellPrice: 20 }),
      ],
    });

    expect(db.priceHistory.create).toHaveBeenCalledTimes(1);
  });

  it('keeps an unchanged row when asked, so an action always has a main row', async () => {
    const db = makeDb();

    await recordPriceChanges(db as any, {
      userId: 1,
      source: 'PURCHASE',
      keepUnchanged: true,
      changes: [
        change({ variantId: 847, oldBuyPrice: 8, newBuyPrice: 9 }),
        change({ newBuyPrice: 10, newSellPrice: 20 }),
      ],
    });

    expect(db.priceHistory.create).toHaveBeenCalledTimes(2);
    const rows = db.priceHistory.create.mock.calls.map((c: any) => c[0].data);
    expect(rows.some((r: any) => r.variantId === null)).toBe(true);
  });

  it('reuses a batch reference supplied by the caller', async () => {
    const db = makeDb();

    const batchRef = await recordPriceChanges(db as any, {
      userId: 1,
      source: 'REQUEST',
      batchRef: 'PHgiven',
      changes: [change()],
    });

    expect(batchRef).toBe('PHgiven');
    expect(db.priceHistory.create.mock.calls[0][0].data.batchRef).toBe('PHgiven');
  });

  it('mints a distinct reference per action', () => {
    expect(newPriceBatchRef()).not.toBe(newPriceBatchRef());
  });
});
