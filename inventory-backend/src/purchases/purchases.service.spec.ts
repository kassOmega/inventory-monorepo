import { Logger } from '@nestjs/common';
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
        updateMany: jest.fn(async () => ({ count: 1 })),
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
      postProcurement: jest.fn(async (args: any) => Boolean(args)),
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

  // --- Credit fork: the same record, a completely different settlement ------

  const creditPurchase = {
    id: 8,
    shopId: 3,
    productName: 'Cement',
    quantity: 20,
    unitPrice: 400,
    sellPrice: 0,
    totalCost: 8000,
    revenue: 0,
    profit: 0,
    status: 'PENDING',
    paymentType: 'CREDIT',
    paymentStatus: 'UNPAID',
    amountPaid: 0,
    vendorCustomerId: 5,
    paymentMethodId: null,
    createdById: 2,
    sale: null,
  };

  const makeCreditTx = () => {
    const tx: Record<string, any> = {
      auditLog: { create: jest.fn(async (args: any) => args.data) },
      sale: { create: jest.fn() },
      cashEntry: { create: jest.fn() },
      purchase: {
        update: jest.fn(async (args: any) => args.data),
        updateMany: jest.fn(async () => ({ count: 1 })),
        findUnique: jest.fn(async () => ({ id: 8, status: 'APPROVED' })),
      },
    };
    return tx;
  };

  it('books a payable (paid:false) on credit approval — no sale, no cash', async () => {
    const tx = makeCreditTx();
    const prisma: Record<string, any> = {
      purchase: { findUnique: jest.fn(async () => creditPurchase) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const finance = {
      postProcurement: jest.fn(async (args: any) => Boolean(args)),
      postSaleIncome: jest.fn(async () => 1),
    };
    const service = new PurchasesService(
      prisma as any,
      { notifyOwner: jest.fn() } as any,
      finance as any,
    );

    await service.approve(8, { sub: 1 } as any);

    expect(finance.postProcurement).toHaveBeenCalledTimes(1);
    expect(finance.postProcurement.mock.calls[0][0]).toMatchObject({
      ref: 'PUR-8',
      amount: 8000,
      paid: false, // credit Accounts Payable, not Cash
    });
    // Goods bought on credit are not sold and no cash moves at approval.
    expect(finance.postSaleIncome).not.toHaveBeenCalled();
    expect(tx.sale.create).not.toHaveBeenCalled();
    expect(tx.cashEntry.create).not.toHaveBeenCalled();
    // Approval is claimed with a conditional update (PENDING → APPROVED).
    expect(tx.purchase.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 8, status: 'PENDING' },
      data: { status: 'APPROVED' },
    });
  });

  it('clears the payable per vendor payment and derives the settlement status', async () => {
    const tx: Record<string, any> = {
      purchasePayment: {
        create: jest.fn(async (args: any) => ({
          id: 11,
          paidAt: new Date(),
          ...args.data,
        })),
        aggregate: jest.fn(async () => ({ _sum: { amount: 2000 } })),
        findUnique: jest.fn(async () => ({ id: 11, amount: 2000 })),
      },
      purchase: {
        update: jest.fn(async (args: any) => args.data),
        findUnique: jest.fn(async () => ({
          totalCost: 8000,
          paymentType: 'CREDIT',
        })),
      },
    };
    const prisma: Record<string, any> = {
      purchase: {
        findUnique: jest.fn(async () => ({
          ...creditPurchase,
          status: 'APPROVED',
        })),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const finance = { postVendorBillPayment: jest.fn(async (args: any) => Boolean(args)) };
    const service = new PurchasesService(
      prisma as any,
      { notifyOwner: jest.fn() } as any,
      finance as any,
    );

    await service.createPayment(8, { amount: 2000 }, { sub: 1 } as any);

    expect(finance.postVendorBillPayment).toHaveBeenCalledTimes(1);
    expect(finance.postVendorBillPayment.mock.calls[0][0]).toMatchObject({
      ref: 'VBP-11',
      amount: 2000,
      tenantId: 102,
    });
    // 2 000 of 8 000 paid back → PARTIALLY_PAID.
    expect(tx.purchase.update.mock.calls[0][0].data).toEqual({
      amountPaid: 2000,
      paymentStatus: 'PARTIALLY_PAID',
    });
  });

  it('refuses a vendor payment that overshoots the remaining balance', async () => {
    const prisma: Record<string, any> = {
      purchase: {
        findUnique: jest.fn(async () => ({ ...creditPurchase, status: 'APPROVED' })),
      },
      $transaction: jest.fn(),
    };
    const service = new PurchasesService(
      prisma as any,
      { notifyOwner: jest.fn() } as any,
      { postVendorBillPayment: jest.fn() } as any,
    );

    await expect(
      service.createPayment(8, { amount: 9000 }, { sub: 1 } as any),
    ).rejects.toThrow(/remaining/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('writes nothing when a concurrent approval already claimed the row', async () => {
    const tx = makeTx({
      purchase: {
        update: jest.fn(async (args: any) => args.data),
        // Another request flipped the row between our read and our write.
        updateMany: jest.fn(async () => ({ count: 0 })),
        findUnique: jest.fn(async () => ({ id: 7 })),
      },
    });
    const prisma = makePrisma(purchase, tx);
    const { service, finance } = makeService(prisma);

    await expect(service.approve(7, { sub: 1 } as any)).rejects.toThrow(
      /purchaseNotPending|not pending/i,
    );

    // No second flip sale, no second cash movement, no second journal entry.
    expect(tx.sale.create).not.toHaveBeenCalled();
    expect(tx.cashEntry.create).not.toHaveBeenCalled();
    expect(finance.postProcurement).not.toHaveBeenCalled();
  });

  it('warns instead of silently dropping an unposted procurement entry', async () => {
    const tx = makeTx();
    const prisma = makePrisma(purchase, tx);
    const { service, finance } = makeService(prisma);
    finance.postProcurement.mockResolvedValueOnce(false);
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await service.approve(7, { sub: 1 } as any);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('PUR-7'));
    warn.mockRestore();
  });
});

describe('PurchasesService — a posted row is no longer writable', () => {
  const approvedCredit = {
    id: 8,
    status: 'APPROVED',
    paymentType: 'CREDIT',
    quantity: 20,
    unitPrice: 400,
    sellPrice: 0,
    totalCost: 8000,
    sale: null,
    payments: [],
  };

  const makeHarness = (row: any, tx: Record<string, any> = {}) => {
    const prisma: Record<string, any> = {
      purchase: { findUnique: jest.fn(async () => row) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const finance = {
      postProcurement: jest.fn(async () => true),
      postSaleIncome: jest.fn(async () => 1),
      postVendorBillPayment: jest.fn(async () => true),
    };
    const service = new PurchasesService(
      prisma as any,
      { notifyOwner: jest.fn() } as any,
      finance as any,
    );
    return { service, prisma, finance, tx };
  };

  it('refuses to delete an approved purchase instead of stranding its PUR- entry', async () => {
    const tx = {
      purchase: { delete: jest.fn() },
      journalEntry: { deleteMany: jest.fn() },
    };
    const { service } = makeHarness(approvedCredit, tx);

    await expect(service.remove(8)).rejects.toThrow(
      /purchaseNotPending|not pending/i,
    );
    expect(tx.purchase.delete).not.toHaveBeenCalled();
    expect(tx.journalEntry.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes a pending row and clears any stray entry for its reference', async () => {
    const tx = {
      purchase: { delete: jest.fn(async () => ({ id: 9 })) },
      journalEntry: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    };
    const { service } = makeHarness(
      { ...approvedCredit, id: 9, status: 'PENDING', sale: null },
      tx,
    );

    await service.remove(9);

    expect(tx.purchase.delete).toHaveBeenCalledWith({ where: { id: 9 } });
    expect(tx.journalEntry.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 102, reference: 'PUR-9' },
    });
  });

  it('refuses a money edit on an approved purchase', async () => {
    const { service, prisma } = makeHarness(approvedCredit);

    await expect(service.update(8, { unitPrice: 500 })).rejects.toThrow(
      /purchaseApprovedLocked|approved/i,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('still accepts a note on an approved purchase', async () => {
    const tx = {
      purchase: {
        update: jest.fn(async (args: any) => args.data),
        findUnique: jest.fn(async () => ({
          totalCost: 8000,
          paymentType: 'CREDIT',
        })),
      },
      purchasePayment: {
        aggregate: jest.fn(async () => ({ _sum: { amount: 2000 } })),
      },
    };
    const { service } = makeHarness(approvedCredit, tx);

    await service.update(8, { notes: 'delivered late' });

    expect(tx.purchase.update).toHaveBeenCalledWith({
      where: { id: 8 },
      data: expect.objectContaining({ notes: 'delivered late' }),
    });
  });
});
