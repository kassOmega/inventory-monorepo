import { BadRequestException, Injectable } from '@nestjs/common';
import { getCurrentTenantId } from '../common/tenant/tenant.context';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PaymentMethodsService {
  constructor(private prisma: PrismaService) {}

  private tenant(): number {
    const id = getCurrentTenantId();
    if (id == null) throw new BadRequestException('No active organization');
    return id;
  }

  findAll() {
    const tenantId = this.tenant();
    return this.prisma.paymentMethod.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
  }

  create(name: string, isDigital: boolean, account?: string) {
    const tenantId = this.tenant();
    return this.prisma.paymentMethod
      .findFirst({
        where: {
          tenantId,
          name: { equals: name, mode: 'insensitive' },
        },
        select: { id: true },
      })
      .then((existing) => {
        if (existing) {
          throw new BadRequestException(
            `A payment method named "${name}" already exists`,
          );
        }
        return this.prisma.paymentMethod.create({
          data: { tenantId, name, isDigital, account: account ?? null },
        });
      });
  }

  async update(id: number, name?: string, isDigital?: boolean, account?: string) {
    const tenantId = this.tenant();
    const data: { name?: string; isDigital?: boolean; account?: string | null } = {};
    if (name !== undefined) {
      // Case-insensitive duplicate guard (excludes this method itself).
      const dup = await this.prisma.paymentMethod.findFirst({
        where: {
          tenantId,
          NOT: { id },
          name: { equals: name, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (dup) {
        throw new BadRequestException(
          `A payment method named "${name}" already exists`,
        );
      }
      data.name = name;
    }
    if (isDigital !== undefined) data.isDigital = isDigital;
    if (account !== undefined) data.account = account;
    await this.prisma.paymentMethod.updateMany({ where: { id, tenantId }, data });
    return this.prisma.paymentMethod.findFirst({ where: { id, tenantId } });
  }

  async remove(id: number) {
    const tenantId = this.tenant();
    const [orderPayments, sales, expenses, creditPayments] = await Promise.all([
      this.prisma.orderPayment.count({ where: { paymentMethodId: id } }),
      this.prisma.sale.count({ where: { paymentMethodId: id } }),
      this.prisma.expense.count({ where: { paymentMethodId: id } }),
      this.prisma.creditPayment.count({ where: { paymentMethodId: id } }),
    ]);
    if (orderPayments + sales + expenses + creditPayments > 0) {
      throw new BadRequestException('Payment method is in use and cannot be deleted');
    }
    await this.prisma.paymentMethod.deleteMany({ where: { id, tenantId } });
    return { id };
  }
}