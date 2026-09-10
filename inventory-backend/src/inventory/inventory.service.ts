// src/inventory/inventory.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { getCurrentTenantId } from '../common/tenant/tenant.context';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { FinanceService } from '../finance/finance.service';
import { PrismaService } from '../prisma/prisma.service';
import { RecordWastageDto } from './dto/record-wastage.dto';

const round2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService, private finance: FinanceService) {}

  private tenant(): number {
    const id = getCurrentTenantId();
    if (id == null) throw new BadRequestException('No active organization');
    return id;
  }

  /**
   * Record a spoilage/wastage write-off:
   *  - decrement physical stock on the target inventory balance,
   *  - log a WastageEntry (quantity, unit cost, total value, reason),
   *  - post a "Spoilage & Wastage" expense (Debit expense ↔ Credit Inventory
   *    Asset) so the loss shows on the P&L without skewing standard COGS.
   */
  async recordWastage(dto: RecordWastageDto, user: JwtPayload) {
    const tenantId = this.tenant();
    const { productId, quantity, reason, locationId } = dto;
    if (!(quantity > 0)) {
      throw new BadRequestException('Quantity must be greater than zero');
    }

    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      select: {
        id: true,
        brand: true,
        baseName: true,
        currentBuyPrice: true,
        unit: { select: { name: true } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');

    // Resolve the target inventory row: explicit location, otherwise the
    // location holding the most stock of this product.
    let targetLocationId = dto.locationId ?? null;
    if (targetLocationId == null) {
      const anyRow = await this.prisma.inventory.findFirst({
        where: { tenantId, productId, variantId: null, quantity: { gt: 0 } },
        orderBy: { quantity: 'desc' },
        select: { locationId: true },
      });
      targetLocationId = anyRow?.locationId ?? null;
    }
    if (targetLocationId == null) {
      throw new BadRequestException(
        'No inventory record found for this product — stock it first.',
      );
    }

    const inv = await this.prisma.inventory.findFirst({
      where: {
        tenantId,
        productId,
        variantId: null,
        locationId: targetLocationId,
      },
    });
    const available = inv?.quantity ?? 0;
    if (available < dto.quantity) {
      throw new BadRequestException(
        `Insufficient stock: ${available} unit(s) available at this location.`,
      );
    }

    // Value the write-off at the inventory row's weighted-average cost
    // (fallback: the product's current buy price).
    const unitCost = inv?.avgCost ?? product.currentBuyPrice ?? 0;
    const totalValue = round2(dto.quantity * unitCost);

    return this.prisma.$transaction(async (tx) => {
      await tx.inventory.update({
        where: { id: inv!.id },
        data: { quantity: { decrement: dto.quantity } },
      });

      const entry = await tx.wastageEntry.create({
        data: {
          tenantId,
          productId,
          locationId: targetLocationId,
          quantity: dto.quantity,
          unitCost,
          totalValue,
          reason: dto.reason ?? null,
          createdById: user.sub,
        },
      });

      await this.finance
        .postWastage({
          ref: `WST-${entry.id}`,
          description: `Spoilage: ${dto.quantity} × ${product.brand} ${product.baseName}${product.unit?.name ? ' ' + product.unit.name : ''}${dto.reason ? ` — ${dto.reason}` : ''}`,
          amount: totalValue,
          entryDate: new Date(),
          createdById: user.sub,
          tenantId,
          tx,
        })
        .catch(() => false);

      return entry;
    });
  }

  /** Wastage history, newest first, with an optional date window. */
  async listWastage(startDate?: string, endDate?: string) {
    const tenantId = this.tenant();
    const where: Record<string, unknown> = { tenantId };
    if (startDate || endDate) {
      const cond: Record<string, Date> = {};
      if (startDate) cond.gte = new Date(startDate);
      if (endDate) {
        const e = new Date(endDate);
        e.setHours(23, 59, 59, 999);
        cond.lte = e;
      }
      where.createdAt = cond;
    }
    return this.prisma.wastageEntry.findMany({
      where,
      include: { product: { include: { unit: true } }, location: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
