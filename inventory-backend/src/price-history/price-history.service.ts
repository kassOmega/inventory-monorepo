import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Paging, pagedResult } from '../common/pagination.util';

@Injectable()
export class PriceHistoryService {
  constructor(private prisma: PrismaService) {}

  findAll(paging?: Paging) {
    const base = {
      include: { product: true },
      orderBy: { updatedAt: 'desc' as const },
    };
    if (paging?.enabled) {
      return this.prisma.$transaction(async (tx) => {
        const [rows, total] = await Promise.all([
          tx.priceHistory.findMany({
            ...base,
            skip: (paging.page - 1) * paging.pageSize,
            take: paging.pageSize,
          }),
          tx.priceHistory.count(),
        ]);
        return pagedResult(rows, total, paging.page, paging.pageSize);
      });
    }
    return this.prisma.priceHistory.findMany(base);
  }

  async findOne(id: number) {
    const record = await this.prisma.priceHistory.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Record not found');
    return record;
  }

  update(id: number, dto: any) {
    return this.prisma.priceHistory.update({ where: { id }, data: dto });
  }

  remove(id: number) {
    return this.prisma.priceHistory.delete({ where: { id } });
  }
}
