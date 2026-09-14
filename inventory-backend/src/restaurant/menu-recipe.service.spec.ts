// src/restaurant/menu-recipe.service.spec.ts
import { MenuRecipeService } from './menu-recipe.service';

jest.mock('../common/tenant/tenant.context', () => ({
  getCurrentTenantId: jest.fn(() => 1),
  requireTenantId: jest.fn(() => 1),
}));

describe('MenuRecipeService — dynamic recipe costing', () => {
  const makePrisma = (overrides: Record<string, any> = {}) => {
    const prisma: Record<string, any> = {
      menuItemIngredient: {
        findMany: jest.fn(async () => []),
        deleteMany: jest.fn(async () => ({ count: 0 })),
        createMany: jest.fn(async () => ({ count: 0 })),
      },
      menuItem: {
        findFirst: jest.fn(async () => ({
          id: 1,
          name: 'Shiro',
          cost: 30,
          trackingMode: 'PERPETUAL',
        })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      product: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
      ...overrides,
    };
    return prisma;
  };

  it('liveMenuItemCost returns null when no recipe exists (manual fallback)', async () => {
    const prisma = makePrisma();
    const service = new MenuRecipeService(prisma as any);
    expect(await service.liveMenuItemCost(1, 1)).toBeNull();
  });

  it('liveMenuItemCost computes Σ quantityPerUnit × currentBuyPrice', async () => {
    const prisma = makePrisma({
      menuItemIngredient: {
        findMany: jest.fn(async () => [
          { menuItemId: 1, productId: 10, quantityPerUnit: 0.1, product: { currentBuyPrice: 30 } },
          { menuItemId: 1, productId: 11, quantityPerUnit: 0.05, product: { currentBuyPrice: 160 } },
        ]),
      },
    });
    const service = new MenuRecipeService(prisma as any);
    // 0.1 × 30 (onion) + 0.05 × 160 (oil) = 3 + 8 = 11
    expect(await service.liveMenuItemCost(1, 1)).toBe(11);
  });

  it('recalcMenuItemCost persists the recipe cost and leaves manual cost alone without a recipe', async () => {
    const prisma = makePrisma();
    const service = new MenuRecipeService(prisma as any);

    expect(await service.recalcMenuItemCost(1, 1)).toBe(false);
    expect(prisma.menuItem.updateMany).not.toHaveBeenCalled();

    prisma.menuItemIngredient.findMany.mockResolvedValueOnce([
      { menuItemId: 1, productId: 10, quantityPerUnit: 0.1, product: { currentBuyPrice: 30 } },
    ]);
    expect(await service.recalcMenuItemCost(1, 1)).toBe(true);
    expect(prisma.menuItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { cost: 3 } }),
    );
  });

  it('setRecipe validates products, bulk-replaces and recalculates', async () => {
    const prisma = makePrisma({
      product: {
        findMany: jest.fn(async () => [{ id: 10 }, { id: 11 }]),
      },
      menuItemIngredient: {
        findMany: jest.fn(async () => [
          { id: 1, menuItemId: 1, productId: 10, quantityPerUnit: 0.1, product: { currentBuyPrice: 30, unit: null }, createdAt: new Date() },
        ]),
        deleteMany: jest.fn(async () => ({ count: 0 })),
        createMany: jest.fn(async () => ({ count: 2 })),
      },
      menuItem: {
        findFirst: jest.fn(async () => ({
          id: 1,
          name: 'Shiro',
          cost: 30,
          trackingMode: 'PERPETUAL',
        })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    });
    const service = new MenuRecipeService(prisma as any);

    const result = await service.setRecipe(1, 1, [
      { productId: 10, quantityPerUnit: 0.1 },
      { productId: 11, quantityPerUnit: 0.05 },
    ]);

    expect(prisma.menuItemIngredient.deleteMany).toHaveBeenCalledWith({
      where: { menuItemId: 1 },
    });
    expect(prisma.menuItemIngredient.createMany).toHaveBeenCalledTimes(1);
    // getRecipe returns the live computed cost (0.1×30 = 3).
    expect(result.computedCost).toBe(3);
    expect(result.effectiveCost).toBe(3);
    expect(result.ingredients).toHaveLength(1);
  });

  it('rejects recipes and recalculations for SIMPLE / BENCHMARK items', async () => {
    const prisma = makePrisma({
      menuItem: {
        findFirst: jest.fn(async () => ({
          id: 1,
          name: 'Tea',
          cost: 15,
          trackingMode: 'BENCHMARK',
        })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    });
    const service = new MenuRecipeService(prisma as any);

    // recalcMenuItemCost no-ops for non-PERPETUAL items (never writes cost).
    expect(await service.recalcMenuItemCost(1, 1)).toBe(false);
    expect(prisma.menuItem.updateMany).not.toHaveBeenCalled();

    // setRecipe rejects non-PERPETUAL items outright.
    await expect(
      service.setRecipe(1, 1, [{ productId: 10, quantityPerUnit: 0.1 }]),
    ).rejects.toThrow('Perpetual tracking');
  });
});
