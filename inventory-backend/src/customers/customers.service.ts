import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Paging, pagedResult } from '../common/pagination.util';
import { getCurrentTenantId } from '../common/tenant/tenant.context';
import {
  asNumericId,
  formatBusinessNumber,
} from '../common/business-number.util';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  /**
   * Accepts either a legacy numeric id or the UUID publicId and returns the
   * numeric primary key used internally.
   */
  async resolveCustomerId(ref: string): Promise<number> {
    const numeric = asNumericId(ref);
    if (numeric != null) return numeric;
    const row = await this.prisma.customer.findUnique({
      where: { publicId: ref },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Customer not found');
    return row.id;
  }

  async findAll(
    shopId?: number,
    opts?: { search?: string; onlyDebt?: boolean; paging?: Paging },
  ) {
    const q = (opts?.search ?? '').trim().toLowerCase();
    const customers = await this.prisma.customer
      .findMany({
        where: shopId ? { creditSales: { some: { shopId } } } : undefined,
        include: {
          creditSales: { include: { shop: true } },
          creditPayments: true,
        },
        orderBy: { createdAt: 'desc' },
      })
      .then((all) =>
        all
          .map((c) => {
            // All credits across all shops — consistent with payments (which have no shopId)
            const totalCredits = c.creditSales.reduce(
              (s, cs) => s + cs.totalAmount,
              0,
            );
            const totalPaid = c.creditPayments.reduce(
              (s, cp) => s + cp.amount,
              0,
            );
            return {
              id: c.id,
              publicId: c.publicId,
              number: c.number,
              numberLabel: formatBusinessNumber('CUST', c.number),
              name: c.name,
              phone: c.phone,
              totalCredits,
              totalPaid,
              remaining: totalCredits - totalPaid,
            };
          })
          .filter(
            (c) =>
              (c.totalCredits > 0 || !shopId) &&
              (!opts?.onlyDebt || c.remaining > 0) &&
              (!q ||
                c.name.toLowerCase().includes(q) ||
                (c.phone || '').includes(q) ||
                (c.numberLabel ?? '').toLowerCase().includes(q) ||
                String(c.number ?? '') === q),
          ),
      );

    if (!opts?.paging?.enabled) return customers;
    const start = (opts.paging.page - 1) * opts.paging.pageSize;
    return pagedResult(
      customers.slice(start, start + opts.paging.pageSize),
      customers.length,
      opts.paging.page,
      opts.paging.pageSize,
    );
  }

  async findOne(id: number, _shopId?: number) {
    const c = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        creditSales: {
          include: {
            items: { include: { product: true } },
            shop: true,
            sale: {
              select: {
                id: true,
                saleType: true,
                paidAmount: true,
                remainingAmount: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        creditPayments: {
          orderBy: { paidAt: 'desc' },
          include: { paymentMethod: true },
        },
      },
    });
    if (!c) return null;
    // All credits & payments across all shops — consistent since payments have no shopId
    const totalCredits = c.creditSales.reduce((s, cs) => s + cs.totalAmount, 0);
    const totalPaid = c.creditPayments.reduce((s, cp) => s + cp.amount, 0);
    return {
      ...c,
      numberLabel: formatBusinessNumber('CUST', c.number),
      totalCredits,
      totalPaid,
      remaining: totalCredits - totalPaid,
    };
  }

  async create(data: { name: string; phone?: string }) {
    const name = data.name.trim();
    const phone = data.phone?.trim() || undefined;

    // Duplicate-entry guard: reject when an existing customer matches the same
    // name (case-insensitive) or the exact same phone number.
    const existing = await this.prisma.customer.findFirst({
      where: {
        OR: [
          { name: { equals: name, mode: 'insensitive' } },
          ...(phone ? [{ phone: { equals: phone } }] : []),
        ],
      },
      select: { id: true, name: true, phone: true },
    });
    if (existing) {
      throw new ConflictException(
        `A customer matching "${existing.name}" already exists. Please select the existing customer instead of creating a duplicate.`,
      );
    }

    const organizationId = getCurrentTenantId();
    if (organizationId == null) {
      throw new BadRequestException('A business must be selected to create a customer.');
    }

    return this.prisma.customer.create({ data: { organizationId, ...data, name } });
  }

  update(id: number, data: { name?: string; phone?: string }) {
    return this.prisma.customer.update({ where: { id }, data });
  }

  async remove(id: number) {
    return this.prisma.customer.delete({ where: { id } });
  }
}
