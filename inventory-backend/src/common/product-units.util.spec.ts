import { resolveProductUnits } from './product-units.util';

describe('resolveProductUnits', () => {
  const ladder = [
    { unitId: 1, perBase: 1, isBase: true },
    { unitId: 2, perBase: 24 },
  ];

  it('allows the historical unit to be removed from the live ladder', () => {
    const config = resolveProductUnits(ladder, {
      baseUnitId: 1,
      historicalUnitId: 99,
    });

    expect(config).not.toBeNull();
    expect(config!.units.every((unit) => !unit.isHistorical)).toBe(true);
    expect(config!.historicalUnitId).toBe(99);
  });

  it('still requires exactly one base unit', () => {
    expect(() =>
      resolveProductUnits(
        [{ unitId: 2, perBase: 24 }],
        { baseUnitId: 1 },
      ),
    ).toThrow(/base unit/i);
  });

  it('keeps the historical flag when that unit remains in the ladder', () => {
    const config = resolveProductUnits(ladder, {
      baseUnitId: 1,
      historicalUnitId: 2,
    });

    expect(config!.units.find((unit) => unit.unitId === 2)?.isHistorical).toBe(
      true,
    );
  });
});
