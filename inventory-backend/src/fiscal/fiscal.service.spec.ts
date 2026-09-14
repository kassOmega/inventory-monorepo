import { ConflictException, NotFoundException } from '@nestjs/common';
import { FiscalService } from './fiscal.service';

jest.mock('../common/tenant/tenant.context', () => ({
  getCurrentTenantId: jest.fn(() => 1),
  requireTenantId: jest.fn(() => 1),
}));

describe('FiscalService', () => {
  let svc: FiscalService;
  let prisma: Record<string, any>;
  let orderUpdate: jest.Mock;
  let saleUpdate: jest.Mock;
  let upsert: jest.Mock;

  const paidOrder = {
    id: 10,
    orderNumber: 'ORD-10',
    status: 'PAID',
    discount: 0,
    serviceCharge: 10,
    tax: 15,
    taxInclusive: true,
    paidAmount: 110,
    updatedAt: new Date('2026-08-31'),
    customerName: 'Guest A',
    taxRateId: 5,
    items: [{ name: 'Pasta', quantity: 1, unitPrice: 100 }],
  };

  const retailSale = {
    id: 20,
    invoiceNumber: 'INV-20',
    totalAmount: 115,
    taxAmount: 15,
    paidAmount: 115,
    saleDate: new Date('2026-08-31'),
    taxRateId: 5,
    items: [
      {
        unitSellPrice: 100,
        quantity: 1,
        product: { brand: 'Acme', baseName: 'Cable' },
        variant: null,
      },
    ],
    customer: { name: 'Biz Co' },
    shop: { id: 1, name: 'Main' },
  };

  const paidOrders = [paidOrder, { ...paidOrder, id: 11, orderNumber: 'ORD-11' }];
  const retailSales = [retailSale];

  beforeEach(() => {
    orderUpdate = jest.fn(async (a: any) => ({ id: a.where.id }));
    saleUpdate = jest.fn(async (a: any) => ({ id: a.where.id }));
    upsert = jest.fn(async (a: any) => ({ id: 1, ...a.create }));
    prisma = {
      order: {
        findFirst: jest.fn(async (a: any) =>
          a.where.id === 10 ? paidOrder : null,
        ),
        findMany: jest.fn(async (a: any) => {
          const ids = a.where?.id?.in ?? [];
          return paidOrders.filter((o) => ids.includes(o.id));
        }),
        update: orderUpdate,
      },
      sale: {
        findFirst: jest.fn(async (a: any) =>
          a.where.id === 20 ? retailSale : null,
        ),
        findMany: jest.fn(async (a: any) => {
          const ids = a.where?.id?.in ?? [];
          return retailSales.filter((s) => ids.includes(s.id));
        }),
        update: saleUpdate,
      },
      organization: {
        findUnique: jest.fn(async () => ({
          name: 'Acme Ltd',
          taxId: 'TIN-123',
        })),
      },
      taxRate: {
        findUnique: jest.fn(async () => ({ code: 'VAT15', name: 'VAT 15%' })),
      },
      fiscalReceipt: { upsert },
      tenantFiscalConfig: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async (a: any) => ({ id: 1, ...a.data })),
        update: jest.fn(async (a: any) => ({ id: 1, ...a.data })),
      },
      fiscalBatch: {
        create: jest.fn(async (a: any) => ({ id: 7, ...a.data })),
      },
    };
    svc = new FiscalService(prisma as any);
  });

  it('builds a hospitality order summary with service charge + VAT', async () => {
    const s = await svc.getSummary({ orderId: 10 });
    expect(s.type).toBe('ORDER');
    expect(s.reference).toBe('ORD-10');
    expect(s.header).toMatchObject({
      companyName: 'Acme Ltd',
      tin: 'TIN-123',
      customerName: 'Guest A',
    });
    expect(s.lineItems[0]).toMatchObject({
      description: 'Pasta',
      qty: 1,
      unitPrice: 100,
      taxGroup: 'VAT15',
    });
    // Invariant: subtotal + serviceCharge + vat = grandTotal
    const f = s.financials;
    expect(f.serviceChargeAmount).toBe(10);
    expect(f.vatAmount).toBe(15);
    expect(f.subtotal + f.serviceChargeAmount + f.vatAmount).toBe(f.grandTotal);
    expect(f.grandTotal).toBe(110);
  });

  it('builds a retail sale summary with zero service charge', async () => {
    const s = await svc.getSummary({ saleId: 20 });
    expect(s.type).toBe('SALE');
    expect(s.financials.serviceChargeAmount).toBe(0);
    expect(s.financials.discount).toBe(0);
    expect(s.financials.subtotal).toBe(100);
    expect(s.financials.vatAmount).toBe(15);
    expect(s.financials.grandTotal).toBe(115);
    expect(s.lineItems[0].description).toBe('Acme Cable');
  });

  it('throws 409 when printing a non-paid order', async () => {
    prisma.order.findFirst.mockResolvedValueOnce({ status: 'OPEN' });
    await expect(svc.markPrintPending({ orderId: 10 })).rejects.toThrow(
      ConflictException,
    );
  });

  it('marks a paid order PRINT_PENDING', async () => {
    const r = await svc.markPrintPending({ orderId: 10 });
    expect(r.fiscalStatus).toBe('PRINT_PENDING');
    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 10 },
        data: expect.objectContaining({ fiscalStatus: 'PRINT_PENDING' }),
      }),
    );
  });

  it('acks an order: upserts the receipt snapshot + sets PRINTED', async () => {
    await svc.ack({ orderId: 10 }, {
      fsNumber: 'FS-2026-001',
      ejNumber: 'EJ-99',
      machineSerial: 'SER-1',
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderId: 10 },
        create: expect.objectContaining({
          orderId: 10,
          fsNumber: 'FS-2026-001',
          ejNumber: 'EJ-99',
          subtotal: 85,
          serviceCharge: 10,
          vatAmount: 15,
          grandTotal: 110,
        }),
      }),
    );
    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fiscalStatus: 'PRINTED' }),
      }),
    );
  });

  it('acks a sale: service charge snapshot is 0', async () => {
    await svc.ack({ saleId: 20 }, { fsNumber: 'FS-2', ejNumber: 'EJ-2' });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          saleId: 20,
          subtotal: 100,
          serviceCharge: 0,
          vatAmount: 15,
          grandTotal: 115,
        }),
      }),
    );
    expect(saleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fiscalStatus: 'PRINTED' }),
      }),
    );
  });

  it('marks a failed print with the error message', async () => {
    await svc.markFailed({ orderId: 10 }, { message: 'Agent offline' });
    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fiscalStatus: 'PRINT_FAILED',
          fiscalError: 'Agent offline',
        }),
      }),
    );
  });

  it('throws 404 for unknown targets', async () => {
    await expect(svc.getSummary({ orderId: 999 })).rejects.toThrow(
      NotFoundException,
    );
  });
  it('getConfig lazy-creates a config with org taxId defaults', async () => {
    const cfg = await svc.getConfig();
    expect(prisma.tenantFiscalConfig.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: 1, tin: 'TIN-123' }),
      }),
    );
    expect(cfg.tin).toBe('TIN-123');
  });

  it('updateConfig persists provided fields', async () => {
    prisma.tenantFiscalConfig.findUnique.mockResolvedValueOnce({ id: 1, tenantId: 1, tin: 'X' });
    const cfg = await svc.updateConfig({ tin: 'NEW-TIN', baudRate: 19200 });
    expect(prisma.tenantFiscalConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 1 },
        data: expect.objectContaining({ tin: 'NEW-TIN', baudRate: 19200 }),
      }),
    );
    expect(cfg.baudRate).toBe(19200);
  });

  it('updateConfig persists MoR E-Invoicing credentials', async () => {
    prisma.tenantFiscalConfig.findUnique.mockResolvedValueOnce({ id: 1, tenantId: 1, tin: 'X' });
    const cfg = await svc.updateConfig({
      morLiveUrl: 'https://eirs.mofed.gov.et/clearance',
      morClientId: 'client-42',
      morClientSecret: 's3cret',
      morCertificate: '/secure/meron.p12',
      terminalId: 'POS-0001',
      branchCode: 'ADDIS-01',
    });
    expect(prisma.tenantFiscalConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 1 },
        data: expect.objectContaining({
          morLiveUrl: 'https://eirs.mofed.gov.et/clearance',
          morClientId: 'client-42',
          morClientSecret: 's3cret',
          morCertificate: '/secure/meron.p12',
          terminalId: 'POS-0001',
          branchCode: 'ADDIS-01',
        }),
      }),
    );
    expect(cfg.morCertificate).toBe('/secure/meron.p12');
  });

  it('getBatchSummary aggregates two orders into one payload', async () => {
    const batch = await svc.getBatchSummary({ orderIds: [10, 11] });
    expect(batch.type).toBe('BATCH');
    expect(batch.documents).toHaveLength(2);
    // Similar line items across different order ids are merged (same
    // description + price → one "Pasta" line with combined quantity).
    expect(batch.lineItems).toHaveLength(1);
    expect(batch.lineItems[0]).toMatchObject({
      description: 'Pasta',
      qty: 2,
      unitPrice: 100,
    });
    // financials = sum of both orders' (each subtotal 85 + SC 10 + VAT 15 → total 110)
    expect(batch.financials.subtotal).toBe(170);
    expect(batch.financials.serviceChargeAmount).toBe(20);
    expect(batch.financials.vatAmount).toBe(30);
    expect(batch.financials.grandTotal).toBe(220);
  });

  it('ackBatch creates the batch header + receipts and marks docs PRINTED', async () => {
    const res = await svc.ackBatch(
      { orderIds: [10, 11] },
      { fsNumber: 'FB-1', ejNumber: 'EJ-B1' },
    );
    expect(prisma.fiscalBatch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fsNumber: 'FB-1', ejNumber: 'EJ-B1', grandTotal: 220 }),
      }),
    );
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(orderUpdate).toHaveBeenCalledTimes(2);
    expect(res.batch.id).toBe(7);
  });

  it('markBatchPrintPending rejects a non-paid order in the batch', async () => {
    prisma.order.findMany.mockResolvedValueOnce([
      paidOrder,
      { ...paidOrder, id: 11, status: 'OPEN' },
    ]);
    await expect(
      svc.markBatchPrintPending({ orderIds: [10, 11] }),
    ).rejects.toThrow(ConflictException);
  });
});
