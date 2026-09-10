import { TaxDirection } from '@prisma/client';
import { resolveTax, splitTax } from './tax.util';

describe('tax.util', () => {
  describe('splitTax', () => {
    it('inclusive: 115 at 15% → net 100 + tax 15', () => {
      expect(splitTax(115, 15, true)).toEqual({ net: 100, tax: 15 });
    });

    it('inclusive: 100 at 15% → net 86.96 + tax 13.04', () => {
      const { net, tax } = splitTax(100, 15, true);
      expect(net).toBe(86.96);
      expect(tax).toBe(13.04);
    });

    it('exclusive: 100 at 15% → net 100 + tax 15 on top', () => {
      expect(splitTax(100, 15, false)).toEqual({ net: 100, tax: 15 });
    });

    it('clamps zero/negative amounts', () => {
      expect(splitTax(-5, 15, true)).toEqual({ net: 0, tax: 0 });
    });
  });

  describe('resolveTax', () => {
    const db: any = {
      organization: {
        findUnique: jest.fn(async () => ({
          taxEnabled: true,
          taxInclusive: true,
        })),
      },
      taxRate: {
        findFirst: jest.fn(async () => ({ id: 5, rate: 15 })),
      },
    };

    it('returns disabled when there is no tenant context', async () => {
      expect(await resolveTax(db, null, TaxDirection.OUTPUT)).toEqual({
        enabled: false,
        inclusive: true,
        rate: 0,
        rateId: null,
      });
    });

    it('returns disabled when tax is off for the company', async () => {
      db.organization.findUnique.mockResolvedValueOnce({
        taxEnabled: false,
        taxInclusive: true,
      });
      const r = await resolveTax(db, 1, TaxDirection.OUTPUT);
      expect(r.enabled).toBe(false);
    });

    it('resolves the enabled default rate when tax is on', async () => {
      const r = await resolveTax(db, 1, TaxDirection.OUTPUT);
      expect(r).toMatchObject({ enabled: true, inclusive: true, rate: 15, rateId: 5 });
    });

    it('returns disabled when no rate exists for the direction', async () => {
      db.taxRate.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      const r = await resolveTax(db, 1, TaxDirection.INPUT);
      expect(r.enabled).toBe(false);
    });
  });
});
