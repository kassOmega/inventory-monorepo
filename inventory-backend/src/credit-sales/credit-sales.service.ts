import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  asNumericId,
  formatBusinessNumber,
} from '../common/business-number.util';

@Injectable()
export class CreditSalesService {
  constructor(private prisma: PrismaService) {}

  /** Accept a numeric id or the UUID publicId, returning the numeric key. */
  async resolveCreditSaleId(ref: string): Promise<number> {
    const numeric = asNumericId(ref);
    if (numeric != null) return numeric;
    const row = await this.prisma.creditSale.findUnique({
      where: { publicId: ref },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Credit sale not found');
    return row.id;
  }

  async create(data: {
    customerId: number;
    totalAmount: number;
    shopId: number;
    items: { productId: number; quantity: number; unitPrice: number }[];
    saleId?: number;
  }) {
    return this.prisma.creditSale.create({
      data: {
        customerId: data.customerId,
        totalAmount: data.totalAmount,
        shopId: data.shopId,
        saleId: data.saleId,
        items: {
          create: data.items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
          })),
        },
      },
      include: { items: true },
    });
  }

  async findOne(id: number) {
    const row = await this.prisma.creditSale.findUnique({
      where: { id },
      include: { items: { include: { product: true } }, customer: true },
    });
    if (!row) return null;
    return {
      ...row,
      numberLabel: formatBusinessNumber('CR', row.number),
    };
  }

  async remove(id: number) {
    return this.prisma.creditSale.delete({ where: { id } });
  }
}