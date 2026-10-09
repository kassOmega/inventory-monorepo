// src/finance/carwash-gl.spec.ts
// The car-wash journal entry must be balanced: revenue is the owner share
// (gross − Σ washer %), the owner share sits in the 'Owner Share Receivable'
// asset until collected, and the per-washer split is informational (zero-sum).
import { FinanceService } from './finance.service';

/** A tx whose journal lines are captured so we can assert balance. */
function makeFinance() {
  const lines: any[] = [];
  const tx: any = {
    otherIncome: {
      findFirst: jest.fn(() => Promise.resolve(null)),
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 7, ...data })),
    },
    account: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(
          where.id === 55 ? { id: 55, name: 'Owner Share Receivable' } : null,
        ),
      ),
      findFirst: jest.fn(({ where }: any) => {
        if (where.name === 'Owner Share Receivable') {
          return Promise.resolve({ id: 55, name: 'Owner Share Receivable' });
        }
        return Promise.resolve(null);
      }),
      findMany: jest.fn(() => Promise.resolve([])),
    },
    journalEntry: {
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 99, ...data })),
      findFirst: jest.fn(() => Promise.resolve(null)),
    },
    journalLine: {
      createMany: jest.fn(({ data }: any) => {
        lines.push(...data);
        return Promise.resolve({ count: data.length });
      }),
    },
  };
  const finance = new FinanceService({} as any);
  return { finance, tx, lines };
}

describe('FinanceService.postCarWashIncome', () => {
  it('books revenue = owner share, receivable = owner share, and balances', async () => {
    const { finance, tx, lines } = makeFinance();
    await finance.postCarWashIncome({
      tx,
      tenantId: 1,
      washId: 5,
      revenueAccountId: 40,
      receivableAccountId: 55,
      // two washers: 50% and 30% of their halves of a 1000 wash.
      washerCommissions: [250, 150],
      description: 'Car wash #5',
      revenue: 1000,
      incomeDate: new Date('2026-07-01'),
    });

    const debit = lines.reduce((s, l) => s + (l.debit || 0), 0);
    const credit = lines.reduce((s, l) => s + (l.credit || 0), 0);
    expect(debit).toBeCloseTo(credit, 6); // balanced

    const ownerShare = 1000 - 400; // 600
    // Revenue credited / receivable debited by the owner share.
    const recvDebit = lines
      .filter((l) => l.accountId === 55)
      .reduce((s, l) => s + (l.debit || 0), 0);
    expect(recvDebit).toBeCloseTo(ownerShare, 6);

    const revenueNet =
      lines
        .filter((l) => l.accountId === 40)
        .reduce((s, l) => s + (l.credit || 0) - (l.debit || 0), 0);
    expect(revenueNet).toBeCloseTo(ownerShare, 6);

    // The income row records the owner share (the business's earning).
    expect(tx.otherIncome.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: ownerShare }) }),
    );
  });

  it('skips (with a warning) when the receivable account is missing', async () => {
    const { finance, tx } = makeFinance();
    tx.account.findUnique = jest.fn(() => Promise.resolve(null));
    tx.account.findFirst = jest.fn(() => Promise.resolve(null));
    const warn = jest.spyOn((finance as any).logger, 'warn').mockImplementation();
    await finance.postCarWashIncome({
      tx,
      tenantId: 1,
      washId: 6,
      revenueAccountId: 40,
      washerCommissions: [],
      description: 'Car wash #6',
      revenue: 500,
      incomeDate: new Date(),
    });
    expect(tx.journalLine.createMany).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });
});
