import { BadRequestException } from '@nestjs/common';

/**
 * Unit ladder for one product.
 *
 * `perBase` = how many of this unit are in ONE base unit (the product's current
 * unit). The base row is 1; every lower unit is > 1. The unit with the largest
 * perBase is the canonical stock unit — all Inventory quantities are stored in
 * that unit.
 */
export interface ProductUnitInput {
  unitId: number;
  perBase: number;
  isBase?: boolean;
  isDefaultSale?: boolean;
  buyPrice?: number | null;
  sellPrice?: number | null;
}

export interface ResolvedProductUnit extends ProductUnitInput {
  isBase: boolean;
  isDefaultSale: boolean;
  isHistorical: boolean;
  sortOrder: number;
}

export interface ResolvedProductUnitConfig {
  units: ResolvedProductUnit[];
  baseUnitId: number;
  stockUnitId: number;
  historicalUnitId: number;
  maxPerBase: number;
}

export interface StoredProductUnit {
  unitId: number;
  perBase: number;
  isBase?: boolean | null;
  isHistorical?: boolean | null;
  isDefaultSale?: boolean | null;
}

function assertInteger(value: number, message: string) {
  if (!Number.isInteger(value) || value < 1) {
    throw new BadRequestException(message);
  }
}

/**
 * Validate and resolve a product's unit ladder.
 *
 * Rules:
 *  - exactly one base row, perBase = 1;
 *  - every lower row has an integer perBase > 1;
 *  - no duplicate units;
 *  - exactly one default-sale row (falls back to the base);
 *  - the sorted perBase values form a whole-number chain
 *    (e.g. 24, 6, 1 — not 24, 6, 4, 1).
 */
export function resolveProductUnits(
  input: ProductUnitInput[] | undefined | null,
  options: {
    /** The product's base unit (existing product unit / dto.unitId). */
    baseUnitId: number;
    /** Existing products lock their historical unit to the original unit. */
    historicalUnitId?: number | null;
  },
): ResolvedProductUnitConfig | null {
  if (!input || input.length === 0) return null;

  const baseUnitId = Number(options.baseUnitId);
  if (!Number.isInteger(baseUnitId) || baseUnitId < 1) {
    throw new BadRequestException('Choose a base unit for the product.');
  }

  const seen = new Set<number>();
  for (const row of input) {
    const unitId = Number(row.unitId);
    if (!Number.isInteger(unitId) || unitId < 1) {
      throw new BadRequestException('Each unit must be a valid unit.');
    }
    if (seen.has(unitId)) {
      throw new BadRequestException('The same unit cannot be added twice.');
    }
    seen.add(unitId);
    assertInteger(
      Number(row.perBase),
      'Conversions must be whole numbers greater than zero.',
    );
  }

  const baseRows = input.filter((row) => Number(row.unitId) === baseUnitId);
  if (baseRows.length !== 1) {
    throw new BadRequestException(
      'The base unit must appear exactly once in the unit list.',
    );
  }
  if (Number(baseRows[0].perBase) !== 1) {
    throw new BadRequestException('The base unit conversion must be 1.');
  }

  const lowerRows = input.filter((row) => Number(row.unitId) !== baseUnitId);
  for (const row of lowerRows) {
    if (Number(row.perBase) <= 1) {
      throw new BadRequestException(
        'Only units lower than the base unit can be added. Conversion must be greater than 1.',
      );
    }
  }

  // Sort largest unit first (highest perBase), base last (perBase = 1).
  const sorted = [...input].sort(
    (a, b) => Number(b.perBase) - Number(a.perBase),
  );
  for (let i = 0; i < sorted.length - 1; i++) {
    const larger = Number(sorted[i].perBase);
    const smaller = Number(sorted[i + 1].perBase);
    if (larger % smaller !== 0) {
      throw new BadRequestException(
        'The unit conversions do not form a clean chain. Each larger conversion must be a whole multiple of the next smaller one.',
      );
    }
  }

  const maxPerBase = Math.max(...sorted.map((row) => Number(row.perBase)));
  const stockUnit = sorted.find((row) => Number(row.perBase) === maxPerBase)!;
  const stockUnitId = Number(stockUnit.unitId);

  // The historical unit is metadata, not a live ladder requirement. Completed
  // sale/return rows keep their own unit snapshots, so the old unit may be
  // removed when the product's units are edited. Keep the ID when the unit is
  // still present; otherwise no row carries the historical flag.
  const historicalUnitId = Number(options.historicalUnitId ?? baseUnitId);
  const historicalIsInLadder = seen.has(historicalUnitId);

  const defaultCandidates = input.filter((row) => row.isDefaultSale === true);
  if (defaultCandidates.length > 1) {
    throw new BadRequestException(
      'Only one unit can be the default selling unit.',
    );
  }
  const defaultUnitId =
    defaultCandidates.length === 1
      ? Number(defaultCandidates[0].unitId)
      : baseUnitId;

  return {
    units: sorted.map((row, index) => ({
      unitId: Number(row.unitId),
      perBase: Number(row.perBase),
      isBase: Number(row.unitId) === baseUnitId,
      isDefaultSale: Number(row.unitId) === defaultUnitId,
      isHistorical:
        historicalIsInLadder && Number(row.unitId) === historicalUnitId,
      buyPrice:
        row.buyPrice === undefined || row.buyPrice === null
          ? null
          : Number(row.buyPrice),
      sellPrice:
        row.sellPrice === undefined || row.sellPrice === null
          ? null
          : Number(row.sellPrice),
      sortOrder: index,
    })),
    baseUnitId,
    stockUnitId,
    historicalUnitId,
    maxPerBase,
  };
}

/**
 * Resolve the stored unit ladder for sale/stock movement. Returns null for
 * legacy products that have no ProductUnit rows (factor 1, product unit).
 */
export function resolveStoredUnits(
  units: StoredProductUnit[] | undefined | null,
  fallbackUnitId?: number | null,
): ResolvedProductUnitConfig | null {
  if (!units || units.length === 0) return null;
  return resolveProductUnits(
    units.map((u) => ({
      unitId: u.unitId,
      perBase: u.perBase,
      isBase: u.isBase ?? false,
      isDefaultSale: u.isDefaultSale ?? false,
      buyPrice: null,
      sellPrice: null,
    })),
    {
      baseUnitId:
        units.find((u) => u.isBase)?.unitId ??
        fallbackUnitId ??
        units[0].unitId,
      historicalUnitId:
        units.find((u) => u.isHistorical)?.unitId ?? fallbackUnitId ?? null,
    },
  );
}

