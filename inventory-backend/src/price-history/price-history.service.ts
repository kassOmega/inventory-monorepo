import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Paging, pagedResult } from '../common/pagination.util';

/** Filters the history list accepts (all optional). */
export interface PriceHistoryQuery {
  productId?: number;
  variantId?: number;
  source?: string;
  /** Pull the per-variant rows of each action in as `variants` detail. */
  withDetails?: boolean;
}

/** One per-variant row of a price action, as the page's accordion shows it. */
interface VariantPriceChange {
  variantId: number | null;
  sku: string | null;
  attributes: Record<string, unknown>;
  oldBuyPrice: number;
  newBuyPrice: number;
  oldSellPrice: number;
  newSellPrice: number;
}

@Injectable()
export class PriceHistoryService {
  constructor(private prisma: PrismaService) {}

  /**
   * The history list. By default it returns the product-level ("main") row of each
   * price action — the row that carries the average the form submitted — and, when
   * `withDetails` is set, attaches the per-variant rows of those same actions so
   * the page can expand a row instead of issuing a request per row. Asking for a
   * specific `variantId` returns that variant's own history instead.
   */
  async findAll(paging?: Paging, opts: PriceHistoryQuery = {}) {
    const where: Record<string, unknown> = {
      variantId: opts.variantId ?? null,
    };
    if (opts.productId) where.productId = opts.productId;
    if (opts.source) where.source = opts.source;

    const base = {
      where,
      include: { product: true as const },
      orderBy: { updatedAt: 'desc' as const },
    };

    let rows: any[];
    let total: number;
    if (paging?.enabled) {
      const [pageRows, count] = await this.prisma.$transaction(async (tx) =>
        Promise.all([
          tx.priceHistory.findMany({
            ...base,
            skip: (paging.page - 1) * paging.pageSize,
            take: paging.pageSize,
          }),
          tx.priceHistory.count({ where }),
        ]),
      );
      rows = pageRows;
      total = count;
    } else {
      rows = await this.prisma.priceHistory.findMany(base);
      total = rows.length;
    }

    const withVariants = opts.withDetails
      ? await this.attachVariantDetails(rows)
      : rows;

    return paging?.enabled
      ? pagedResult(withVariants, total, paging.page, paging.pageSize)
      : withVariants;
  }

  /**
   * Attach each action's per-variant rows in ONE extra query (grouped by the batch
   * reference every row of that action shares).
   */
  private async attachVariantDetails(rows: any[]): Promise<any[]> {
    const refs = [
      ...new Set(rows.map((r) => r.batchRef).filter((r): r is string => !!r)),
    ];
    if (refs.length === 0) return rows.map((r) => ({ ...r, variants: [] }));

    const details = await this.prisma.priceHistory.findMany({
      where: { batchRef: { in: refs }, variantId: { not: null } },
      include: {
        variant: { select: { id: true, sku: true, attributes: true } },
      },
      orderBy: { id: 'asc' },
    });

    const byRef = new Map<string, VariantPriceChange[]>();
    for (const detail of details) {
      const key = detail.batchRef as string;
      const list = byRef.get(key) ?? [];
      list.push({
        variantId: detail.variantId,
        sku: detail.variant?.sku ?? null,
        attributes: (detail.variant?.attributes as Record<string, unknown>) ?? {},
        oldBuyPrice: detail.oldBuyPrice,
        newBuyPrice: detail.newBuyPrice,
        oldSellPrice: detail.oldSellPrice,
        newSellPrice: detail.newSellPrice,
      });
      byRef.set(key, list);
    }

    return rows.map((row) => ({
      ...row,
      variants: (row.batchRef && byRef.get(row.batchRef)) || [],
    }));
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
