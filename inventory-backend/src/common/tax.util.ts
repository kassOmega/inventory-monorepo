// src/common/tax.util.ts
// Shared tax resolution + split helpers used by the sales, restaurant, hotel and
// finance posting paths so the per-company configured tax rates stay consistent
// across every money movement. Amounts are rounded to 2dp like the finance engine.
import { TaxDirection } from '@prisma/client';

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface ResolvedTax {
  enabled: boolean;
  inclusive: boolean;
  rate: number; // percent (0-100), e.g. 15
  rateId: number | null;
}

/** Minimal structural typing so PrismaService and transaction clients both work. */
interface TaxDb {
  organization: { findUnique(args: any): Promise<any> };
  taxRate: { findFirst(args: any): Promise<any> };
}

/**
 * Resolve the company's tax settings plus the enabled default rate for the given
 * direction (falling back to the first enabled rate when none is marked default).
 * Returns `enabled: false` when tax is off or no rate exists, so callers keep
 * their current behaviour unchanged.
 */
export async function resolveTax(
  db: TaxDb,
  tenantId: number | null,
  direction: TaxDirection,
): Promise<ResolvedTax> {
  if (tenantId == null) {
    return { enabled: false, inclusive: true, rate: 0, rateId: null };
  }
  const org = await db.organization.findUnique({
    where: { id: tenantId },
    select: { taxEnabled: true, taxInclusive: true },
  });
  if (!org?.taxEnabled) {
    return { enabled: false, inclusive: true, rate: 0, rateId: null };
  }

  const rate =
    (await db.taxRate.findFirst({
      where: { organizationId: tenantId, direction, enabled: true, isDefault: true },
      select: { id: true, rate: true },
    })) ??
    (await db.taxRate.findFirst({
      where: { organizationId: tenantId, direction, enabled: true },
      orderBy: { id: 'asc' },
      select: { id: true, rate: true },
    }));

  if (!rate) {
    return { enabled: false, inclusive: org.taxInclusive, rate: 0, rateId: null };
  }
  return {
    enabled: true,
    inclusive: org.taxInclusive,
    rate: Number(rate.rate),
    rateId: rate.id,
  };
}

/**
 * Split an amount into net + tax for the given rate.
 *  - inclusive (prices include tax): `amount` is the gross the customer pays,
 *    e.g. 115 at 15% → { net: 100, tax: 15 }.
 *  - exclusive (prices before tax): `amount` is the net base, tax is on top,
 *    e.g. 100 at 15% → { net: 100, tax: 15 } (caller adds tax to the total).
 */
export function splitTax(
  amount: number,
  ratePct: number,
  inclusive: boolean,
): { net: number; tax: number } {
  const safe = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  const r = ratePct / 100;
  if (inclusive) {
    const tax = round2(safe - safe / (1 + r));
    return { net: round2(safe - tax), tax };
  }
  return { net: round2(safe), tax: round2(safe * r) };
}
