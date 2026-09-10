// src/restaurant/menu-recipe.service.ts
// Recipe (MenuItemIngredient) wiring: dynamic menu-item costing from live
// ingredient buy prices, plus the idempotent settlement-time deduction of raw
// ingredient stock when a food order is PAID.
//
// Fallback rule: a menu item WITH a recipe gets its cost auto-computed as
//   Σ (quantityPerUnit × product.currentBuyPrice)
// A menu item WITHOUT a recipe keeps the manually-entered `cost` field — nothing
// about the existing manual flow breaks.
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MenuItemTrackingMode, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const round2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class MenuRecipeService {
  constructor(private prisma: PrismaService) {}

  /**
   * Live recipe cost for a menu item, or null when no recipe is defined
   * (caller falls back to the manual `cost` field).
   */
  async liveMenuItemCost(
    menuItemId: number,
    tenantId: number | null,
    tx?: Prisma.TransactionClient,
  ): Promise<number | null> {
    const db = tx ?? this.prisma;
    const rows = await db.menuItemIngredient.findMany({
      where: { tenantId, menuItemId },
      select: {
        quantityPerUnit: true,
        product: { select: { currentBuyPrice: true } },
      },
    });
    if (rows.length === 0) return null;
    return round2(
      rows.reduce(
        (s, r) => s + r.quantityPerUnit * (r.product?.currentBuyPrice ?? 0),
        0,
      ),
    );
  }

  /** Recalculate + persist MenuItem.cost from the recipe. PERPETUAL-only. */
  async recalcMenuItemCost(
    menuItemId: number,
    tenantId: number | null,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const db = tx ?? this.prisma;
    // Recipes (and their live auto-cost) are PERPETUAL-only; SIMPLE/BENCHMARK
    // items keep their own cost semantics (0 / estimatedCogs).
    const mi = await db.menuItem.findFirst({
      where: { id: menuItemId, tenantId },
      select: { trackingMode: true },
    });
    if (!mi || mi.trackingMode !== MenuItemTrackingMode.PERPETUAL) return false;
    const cost = await this.liveMenuItemCost(menuItemId, tenantId, db);
    if (cost == null) return false;
    await db.menuItem.updateMany({
      where: { id: menuItemId, tenantId },
      data: { cost },
    });
    return true;
  }

  /** Recalculate every menu item whose recipe references an ingredient product. */
  async recalcMenuItemsForIngredient(
    productId: number,
    tenantId: number | null,
  ): Promise<number> {
    const rows = await this.prisma.menuItemIngredient.findMany({
      where: { tenantId, productId },
      select: { menuItemId: true },
    });
    for (const r of rows) {
      await this.recalcMenuItemCost(r.menuItemId, tenantId);
    }
    return rows.length;
  }

  /** Recipe detail for a menu item, with live buy prices + line costs. */
  async getRecipe(menuItemId: number, tenantId: number) {
    const mi = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, tenantId },
      select: { id: true, name: true, cost: true },
    });
    if (!mi) throw new NotFoundException('Menu item not found');

    const rows = await this.prisma.menuItemIngredient.findMany({
      where: { tenantId, menuItemId },
      include: { product: { include: { unit: true } } },
      orderBy: { id: 'asc' },
    });

    const computedCost = round2(
      rows.reduce(
        (s, r) => s + r.quantityPerUnit * (r.product?.currentBuyPrice ?? 0),
        0,
      ),
    );

    return {
      menuItemId,
      name: mi.name,
      hasRecipe: rows.length > 0,
      manualCost: mi.cost,
      computedCost,
      effectiveCost: rows.length > 0 ? computedCost : mi.cost,
      ingredients: rows.map((r) => ({
        productId: r.productId,
        name: `${r.product?.brand ?? ''} ${r.product?.baseName ?? ''}`.trim() || `Product #${r.productId}`,
        unit: r.product?.unit?.name ?? null,
        quantityPerUnit: r.quantityPerUnit,
        currentBuyPrice: r.product?.currentBuyPrice ?? 0,
        lineCost: round2(
          r.quantityPerUnit * (r.product?.currentBuyPrice ?? 0),
        ),
      })),
    };
  }

  /**
   * Bulk-replace a menu item's recipe and recalculate its cost. Passing an
   * empty array clears the recipe → the manual `cost` field takes over.
   */
  async setRecipe(
    menuItemId: number,
    tenantId: number,
    ingredients: { productId: number; quantityPerUnit: number }[],
  ) {
    const mi = await this.prisma.menuItem.findFirst({
      where: { id: menuItemId, tenantId },
      select: { id: true, trackingMode: true },
    });
    if (!mi) throw new NotFoundException('Menu item not found');
    if (mi.trackingMode !== MenuItemTrackingMode.PERPETUAL) {
      throw new BadRequestException(
        'Recipes are only used for Perpetual tracking mode. Switch this item to Perpetual tracking to define a recipe.',
      );
    }

    // Validate the referenced products exist (deleting an ingredient that is
    // in a recipe is blocked by the FK anyway).
    const productIds = [...new Set(ingredients.map((i) => i.productId))];
    if (productIds.length > 0) {
      const found = await this.prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true },
      });
      if (found.length !== productIds.length) {
        throw new BadRequestException(
          'One or more ingredient products were not found',
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.menuItemIngredient.deleteMany({ where: { menuItemId } });
      if (ingredients.length > 0) {
        await tx.menuItemIngredient.createMany({
          data: ingredients.map((i) => ({
            tenantId,
            menuItemId,
            productId: i.productId,
            quantityPerUnit: i.quantityPerUnit,
          })),
        });
      }
      await this.recalcMenuItemCost(menuItemId, tenantId, tx);
    });

    return this.getRecipe(menuItemId, tenantId);
  }
}
