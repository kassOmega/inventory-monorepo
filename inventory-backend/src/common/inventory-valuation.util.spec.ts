import {
  valueProductInventory,
  valueVariantQuantity,
  type ValuationProduct,
} from './inventory-valuation.util';

const units = [
  {
    unitId: 1,
    perBase: 1,
    isBase: true,
    isDefaultSale: true,
    buyPrice: null,
    sellPrice: null,
    unit: { name: 'Roll' },
  },
  {
    unitId: 2,
    perBase: 100,
    isBase: false,
    isDefaultSale: false,
    buyPrice: null,
    sellPrice: null,
    unit: { name: 'Meter' },
  },
];

const product: ValuationProduct = {
  currentBuyPrice: 1200,
  currentSellPrice: 1500,
  units,
  variants: [],
};

describe('inventory valuation helper', () => {
  it('values 29637 stock units as 296 Roll + 37 Meter', () => {
    const result = valueVariantQuantity(product, null, 29637);

    expect(result.quantityText).toBe('296 Roll 37 Meter');
    expect(result.unitLines.map((line) => [line.name, line.count])).toEqual([
      ['Roll', 296],
      ['Meter', 37],
    ]);
    expect(result.unitLines.map((line) => [line.buyPrice, line.sellPrice])).toEqual([
      [1200, 1500],
      [12, 15],
    ]);
    expect(result.buyTotal).toBe(355644); // 296×1200 + 37×12
    expect(result.sellTotal).toBe(444555); // 296×1500 + 37×15
    expect(result.profit).toBe(88911);
  });

  it('uses variant per-unit overrides before base ÷ perBase', () => {
    const variant = {
      id: 7,
      buyPrice: 1200,
      sellPrice: 1500,
      unitPrices: { '2': { sellPrice: 20, buyPrice: 13 } },
    };
    const result = valueVariantQuantity(product, variant, 29637);

    expect(result.unitLines.find((line) => line.unitId === 2)).toMatchObject({
      buyPrice: 13,
      sellPrice: 20,
    });
    expect(result.sellTotal).toBe(444740); // 296×1500 + 37×20
    expect(result.buyTotal).toBe(355681); // 296×1200 + 37×13
  });

  it('groups multiple locations into one variant row', () => {
    const variant = { id: 7, buyPrice: 1200, sellPrice: 1500 };
    const valued = valueProductInventory(
      { ...product, variants: [variant] },
      [
        { variantId: 7, quantity: 20000 },
        { variantId: 7, quantity: 9637 },
      ],
    );

    expect(valued.rows).toHaveLength(1);
    expect(valued.rows[0].quantityText).toBe('296 Roll 37 Meter');
    expect(valued.totals).toEqual({
      buyTotal: 355644,
      sellTotal: 444555,
      profit: 88911,
    });
  });

  it('handles a product without a unit ladder', () => {
    const result = valueVariantQuantity(
      { currentBuyPrice: 10, currentSellPrice: 15, unit: { name: 'Pcs' } },
      null,
      3,
    );

    expect(result.quantityText).toBe('3 Pcs');
    expect(result.buyTotal).toBe(30);
    expect(result.sellTotal).toBe(45);
    expect(result.profit).toBe(15);
  });

  it('handles negative stock with a signed breakdown and totals', () => {
    const result = valueVariantQuantity(product, null, -150);

    expect(result.quantityText).toBe('-1 Roll 50 Meter');
    expect(result.buyTotal).toBe(-1800); // -(1×1200 + 50×12)
    expect(result.sellTotal).toBe(-2250); // -(1×1500 + 50×15)
    expect(result.profit).toBe(-450);
  });

  it('keeps a fractional remainder in the smallest unit', () => {
    const result = valueVariantQuantity(product, null, 0.5);

    expect(result.quantityText).toBe('0.5 Meter');
    expect(result.buyTotal).toBe(6); // 0.5×12
    expect(result.sellTotal).toBe(7.5); // 0.5×15
    expect(result.profit).toBe(1.5);
  });

  it('rounds the unit price before multiplying so lines reconcile', () => {
    const thirds = {
      currentBuyPrice: 100,
      currentSellPrice: 1000,
      units: [
        {
          unitId: 1,
          perBase: 1,
          isBase: true,
          unit: { name: 'Box' },
        },
        {
          unitId: 2,
          perBase: 3,
          unit: { name: 'Piece' },
        },
      ],
    };
    const result = valueVariantQuantity(thirds, null, 2);

    expect(result.unitLines.find((line) => line.unitId === 2)).toMatchObject({
      buyPrice: 33.33,
      sellPrice: 333.33,
      buyTotal: 66.66,
      sellTotal: 666.66,
    });
    expect(result.buyTotal).toBe(66.66);
    expect(result.sellTotal).toBe(666.66);
  });
});
