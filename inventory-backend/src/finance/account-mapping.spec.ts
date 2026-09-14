// src/finance/account-mapping.spec.ts
import { FinanceService } from './finance.service';
import { seedAccountMappings } from './account-mapping.constants';

jest.mock('../common/tenant/tenant.context', () => ({
  getCurrentTenantId: jest.fn(() => 1),
  requireTenantId: jest.fn(() => 1),
}));

describe('Account mapping engine', () => {
  it('seeds default two-leg mappings from the chart and is idempotent', async () => {
    const db = {
      account: {
        findMany: jest.fn(async () => [
          { id: 10, name: 'Inventory Asset' },
          { id: 11, name: 'Accounts Payable' },
          { id: 12, name: 'Cash' },
          { id: 13, name: 'Spoilage & Wastage' },
          { id: 14, name: 'Inventory Adjustment' },
        ]),
      },
      accountMapping: { createMany: jest.fn(async () => ({})) },
    };
    await seedAccountMappings(db as any, 1);
    expect(db.accountMapping.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ transactionType: 'PURCHASE', debitAccountId: 10, creditAccountId: 11 }),
        expect.objectContaining({ transactionType: 'PURCHASE_PAID', debitAccountId: 10, creditAccountId: 12 }),
        expect.objectContaining({ transactionType: 'CREDIT_NOTE', debitAccountId: 11, creditAccountId: 10 }),
        expect.objectContaining({ transactionType: 'WASTAGE', debitAccountId: 13, creditAccountId: 10 }),
        expect.objectContaining({ transactionType: 'ADJUSTMENT', debitAccountId: 10, creditAccountId: 14 }),
      ]),
      skipDuplicates: true,
    });
    const data = (db.accountMapping.createMany as jest.Mock).mock.calls[0][0].data;
    expect(data.find((d: any) => d.transactionType === 'SALE')).toBeUndefined();
    expect(data.find((d: any) => d.transactionType === 'EXPENSE')).toEqual(
      expect.objectContaining({ transactionType: 'EXPENSE', debitAccountId: null, creditAccountId: 12 }),
    );
  });

  it('createExpense routes the credit side through the tenant mapping', async () => {
    const bankId = 99;
    const prisma = {
      account: {
        findFirst: jest.fn(async (args: any) =>
          args?.where?.name === 'Input VAT Receivable'
            ? null
            : { id: 1, name: 'Cash', type: 'ASSET', isSystem: true },
        ),
        findUnique: jest.fn(async () => ({ id: 90, name: 'Rent', type: 'EXPENSE' })),
      },
      accountMapping: {
        findUnique: jest.fn(async () => ({ debitAccountId: null, creditAccountId: bankId })),
      },
      expense: { create: jest.fn(async (x: any) => x.data) },
      journalEntry: { create: jest.fn(async (x: any) => ({ id: 1, ...x.data })) },
      journalLine: { createMany: jest.fn(async () => ({})) },
      $transaction: (fn: any) => fn(prisma),
    };
    const service = new FinanceService(prisma as any);
    await service.createExpense({ accountId: 90, amount: 100 } as any, 7);
    expect(prisma.accountMapping.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId_transactionType: { tenantId: 1, transactionType: 'EXPENSE' } } }),
    );
    const lines = (prisma.journalLine.createMany as jest.Mock).mock.calls[0][0].data;
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountId: 90, debit: 100, credit: 0 }),
        expect.objectContaining({ accountId: bankId, debit: 0, credit: 100 }),
      ]),
    );
  });

  it('allows a SALE payment-account override but guards engine-managed sides', async () => {
    const empty = new FinanceService({} as any);
    // Credit side (revenue/COGS/VAT) is structural — writes are rejected.
    await expect(empty.setAccountMapping('SALE', 1, 2)).rejects.toThrow(
      /only the payment account/,
    );
    await expect(empty.setAccountMapping('NOPE', 1, 2)).rejects.toThrow(
      /Unknown posting action/,
    );
    // Debit (payment account) side is tenant-mappable.
    const prisma = {
      account: { count: jest.fn(async () => 1) },
      accountMapping: {
        upsert: jest.fn(async (x: any) => ({ id: 1, ...x.create })),
      },
    };
    const service = new FinanceService(prisma as any);
    const row = await service.setAccountMapping('SALE', 12, null);
    expect(row).toEqual(
      expect.objectContaining({
        transactionType: 'SALE',
        debitAccountId: 12,
        creditAccountId: null,
      }),
    );
  });

  it('getOperationalSummary nets journal lines per account and returns totals', async () => {
    const prisma = {
      journalLine: {
        groupBy: jest.fn(async () => [
          { accountId: 40, _sum: { debit: 0, credit: 500 } },
          { accountId: 41, _sum: { debit: 300, credit: 0 } },
        ]),
      },
      account: {
        findMany: jest.fn(async () => [
          { id: 40, name: 'Sales Revenue', type: 'INCOME', isSystem: true },
          { id: 41, name: 'Rent', type: 'EXPENSE', isSystem: false },
        ]),
      },
    };
    const service = new FinanceService(prisma as any);
    const res = await service.getOperationalSummary('2026-08-01', '2026-08-31');
    expect(res.totals).toEqual({ revenue: 500, expense: 300 });
    const sale = res.rows.find((r: any) => r.accountId === 40);
    const rent = res.rows.find((r: any) => r.accountId === 41);
    expect(sale.amount).toBe(500);
    expect(rent.amount).toBe(300);
  });
});
