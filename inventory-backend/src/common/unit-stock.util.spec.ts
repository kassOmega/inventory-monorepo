import {
  baseToStockQuantity,
  convertStockQuantityBetweenLadders,
  fromStockQuantity,
  splitStockQuantity,
  toStockFromUnitCounts,
  toStockQuantity,
} from './unit-stock.util';

const ladder = [
  { unitId: 1, perBase: 1 },
  { unitId: 2, perBase: 12 },
  { unitId: 3, perBase: 48 },
];

describe('unit-stock converter', () => {
  it('converts a selected unit to the smallest stock unit', () => {
    expect(toStockQuantity(2, 12, ladder)).toBe(8); // 2 packets × 4 pieces
    expect(toStockQuantity(2, 1, ladder)).toBe(96); // 2 boxes × 48 pieces
  });

  it('converts per-unit counts to stock units', () => {
    expect(toStockFromUnitCounts({ 1: 1, 2: 3 }, ladder)).toBe(60);
  });

  it('converts stock units back to the selected unit', () => {
    expect(fromStockQuantity(60, 12, ladder)).toBe(15);
  });

  it('converts between ladders through a common unit', () => {
    const next = [
      { unitId: 1, perBase: 1 },
      { unitId: 2, perBase: 12 },
    ];
    expect(convertStockQuantityBetweenLadders(48, ladder, next, 3)).toBe(12);
  });

  it('splits stock units into whole unit lines', () => {
    expect(
      splitStockQuantity(60, ladder).map((line) => [
        line.unit.unitId,
        line.quantity,
      ]),
    ).toEqual([
      [1, 1],
      [2, 3],
    ]);
  });

  it('keeps legacy base conversion in one place', () => {
    expect(baseToStockQuantity(2, ladder)).toBe(96);
  });
});
