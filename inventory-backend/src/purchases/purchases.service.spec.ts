import { PurchasesService } from './purchases.service';

jest.mock('../common/tenant/tenant.context', () => ({
  getCurrentTenantId: jest.fn(() => 102),
  requireTenantId: jest.fn(() => 102),
}));

describe('PurchasesService.approve', () => {
  const makeTx = (overrides: Record<string, any> = {}) => {
    const tx: Record<string, any> = {
      organization: {
        findUnique: jest.fn(async () => ({
          id: 102,
          taxEnabled: true,
          taxInclusive: true,
        })),
      },
      taxRate: {
        findFirst: jest.fn(async () => ({ id: 3, rate: 15 })),
      },
      sale: {
        create: jest.fn(async (args: any) => ({
          id: 99,
          invoiceNumber: 'INV-99',
          ...args.data,
        })),
      },
      cashEntry: { create: jest.fn(async (args: any) => args.data) },
      auditLog: { create: jest.fn(async (args: any) => args.data) },
      purchase: {
        update: jest.fn(async (args: any) => args.data),
        findUnique: jest.fn(async () => ({ id: 7, status: 'APPROVED' })),
      },
      ...overrides,
    };
    return tx;
  };

  const makePrisma = (purchase: any, tx: any) => {
    const prisma: Record<string, any> = {
      purchase: { findUnique: jest.fn(async () => purchase) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    return prisma;
  };

  const makeService = (prisma: any) => {
    const finance = {
      postProcurement: jest.fn(async () => true),
      postSaleIncome: jest.fn(async () => 1),
    };
    const notifications = { notifyOwner: jest.fn(async () => undefined) };
    const service = new PurchasesService(prisma, notifications as any, finance as any);
    return { service, finance, prisma };
  };

  const purchase = {
    id: 7,
    shopId: 3,
    productName: 'Cable',
    quantity: 10,
    unitPrice: 50,
    sellPrice: 80,
    totalCost: 500,
    revenue: 800,
    profit: 300,
    status: 'PENDING',
    paymentMethodId: 1,
    createdById: 2,
    sale: null,
  };

  it('extracts output VAT from the flip sale when tax is enabled (inclusive)', async () => {
    const tx = makeTx();
    const prisma = makePrisma(purchase, tx);
    const { service, finance } = makeService(prisma);

    const result = await service.approve(7, { sub: 1 } as any);

    const saleData = tx.sale.create.mock.calls[0][0].data;
    expect(saleData.totalAmount).toBe(800); // gross unchanged in inclusive mode
    expect(saleData.taxAmount).toBeCloseTo(104.35, 2); // 800 - 800/1.15
    expect(saleData.taxRateId).toBe(3);
    expect(saleData.paidAmount).toBe(800);
    expect(saleData.profit).toBeCloseTo(195.65, 2); // net revenue - COGS
    // Cash inflow reflects the gross the customer actually pays.
    const inflow = tx.cashEntry.create.mock.calls.find(
      (c: any[]) => c[0].data.type === 'INFLOW',
    )[0].data;
    expect(inflow.amount).toBe(800);
    // Finance income posting still runs for the flip sale.
    expect(finance.postSaleIncome).toHaveBeenCalledTimes(1);
    expect(result).toBeTruthy();
  });

  it('adds VAT on top for exclusive pricing', async () => {
    const tx = makeTx({
      organization: {
        findUnique: jest.fn(async () => ({
          id: 102,
          taxEnabled: true,
          taxInclusive: false,
        })),
      },
    });
    const prisma = makePrisma(purchase, tx);
    const { service } = makeService(prisma);

    await service.approve(7, { sub: 1 } as any);

    const saleData = tx.sale.create.mock.calls[0][0].data;
    expect(saleData.totalAmount).toBe(920); // 800 + 15%
    expect(saleData.taxAmount).toBe(120);
    expect(saleData.paidAmount).toBe(920);
  });

  it('keeps revenue tax-free when the company tax flag is off', async () => {
    const tx = makeTx({
      organization: {
        findUnique: jest.fn(async () => ({
          id: 102,
          taxEnabled: false,
          taxInclusive: true,
        })),
      },
    });
    const prisma = makePrisma(purchase, tx);
    const { service } = makeService(prisma);

    await service.approve(7, { sub: 1 } as any);

    const saleData = tx.sale.create.mock.calls[0][0].data;
    expect(saleData.totalAmount).toBe(800);
    expect(saleData.taxAmount).toBe(0);
    expect(saleData.taxRateId).toBeNull();
  });
});
