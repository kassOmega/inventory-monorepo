import { NotFoundException } from '@nestjs/common';
import { CreditPaymentsService } from '../credit-payments/credit-payments.service';
import { CreditSalesService } from '../credit-sales/credit-sales.service';
import { CustomersService } from '../customers/customers.service';
import { RequestsService } from '../requests/requests.service';
import { UsersService } from '../users/users.service';

// Keep error paths free of i18n bootstrapping.
jest.mock('../i18n/i18n.service', () => ({ tr: (key: string) => key }));

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const UNKNOWN = '3f2504e0-4f89-41d3-9a0c-0305e82c3399';

type RowIds = {
  customer?: number | null;
  creditSale?: number | null;
  creditPayment?: number | null;
  stockRequest?: number | null;
  user?: number | null;
};

const makePrisma = (rows: RowIds) => {
  const find = (id?: number | null) =>
    jest.fn(async () => (id == null ? null : { id }));
  return {
    customer: { findUnique: find(rows.customer) },
    creditSale: { findUnique: find(rows.creditSale) },
    creditPayment: { findUnique: find(rows.creditPayment) },
    stockRequest: { findUnique: find(rows.stockRequest) },
    user: { findUnique: find(rows.user) },
  };
};

describe('numeric id / publicId resolution', () => {
  it('passes legacy numeric refs straight through', async () => {
    const prisma = makePrisma({});
    await expect(
      new CustomersService(prisma as any).resolveCustomerId('42'),
    ).resolves.toBe(42);
    await expect(
      new CreditSalesService(prisma as any).resolveCreditSaleId('7'),
    ).resolves.toBe(7);
    await expect(
      new CreditPaymentsService(prisma as any).resolveCreditPaymentId('8'),
    ).resolves.toBe(8);
    await expect(
      new UsersService(prisma as any).resolveUserId('3'),
    ).resolves.toBe(3);
    const requests = new RequestsService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
    );
    await expect(requests.resolveRequestId('9')).resolves.toBe(9);
  });

  it('resolves uuids through the publicId column', async () => {
    const prisma = makePrisma({
      customer: 11,
      creditSale: 12,
      creditPayment: 15,
      stockRequest: 13,
      user: 14,
    });
    await expect(
      new CustomersService(prisma as any).resolveCustomerId(UUID),
    ).resolves.toBe(11);
    await expect(
      new CreditSalesService(prisma as any).resolveCreditSaleId(UUID),
    ).resolves.toBe(12);
    await expect(
      new CreditPaymentsService(prisma as any).resolveCreditPaymentId(UUID),
    ).resolves.toBe(15);
    await expect(
      new UsersService(prisma as any).resolveUserId(UUID),
    ).resolves.toBe(14);
    const requests = new RequestsService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
    );
    await expect(requests.resolveRequestId(UUID)).resolves.toBe(13);

    expect(prisma.customer.findUnique).toHaveBeenCalledWith({
      where: { publicId: UUID },
      select: { id: true },
    });
    expect(prisma.stockRequest.findUnique).toHaveBeenCalledWith({
      where: { publicId: UUID },
      select: { id: true },
    });
  });

  it('throws NotFound for unknown uuids', async () => {
    const prisma = makePrisma({});
    await expect(
      new CustomersService(prisma as any).resolveCustomerId(UNKNOWN),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      new CreditSalesService(prisma as any).resolveCreditSaleId(UNKNOWN),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      new CreditPaymentsService(prisma as any).resolveCreditPaymentId(UNKNOWN),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      new UsersService(prisma as any).resolveUserId(UNKNOWN),
    ).rejects.toBeInstanceOf(NotFoundException);
    const requests = new RequestsService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
    );
    await expect(requests.resolveRequestId(UNKNOWN)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
