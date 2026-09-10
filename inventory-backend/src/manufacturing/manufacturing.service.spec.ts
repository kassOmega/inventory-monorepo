import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  ManufacturingService,
  requiredWithScrap,
} from './manufacturing.service';

jest.mock('../common/tenant/tenant.context', () => ({
  getCurrentTenantId: jest.fn(() => 1),
}));

// Shared fixture: IN_PROGRESS work order producing 10 units of a chair from
// 2kg wood + 0.5kg nails per unit at 5% scrap.
const makeWo = (overrides: Record<string, any> = {}) => ({
  id: 5,
  organizationId: 1,
  bomId: 10,
  finishedProductId: 7,
  finishedVariantId: null,
  targetQuantity: 10,
  producedQuantity: 0,
  locationId: 3,
  status: 'IN_PROGRESS',
  batchNumber: 'B-1',
  expiryDate: null,
  bom: {
    finishedProduct: { id: 7, baseName: 'Classic Chair', currentBuyPrice: 0 },
    scrapPercentage: 5,
    items: [
      {
        rawMaterialProductId: 11,
        quantityRequired: 2,
        rawMaterial: {
          id: 11,
          baseName: 'Oak Wood',
          currentBuyPrice: 120,
          isPerishable: false,
        },
      },
      {
        rawMaterialProductId: 12,
        quantityRequired: 0.5,
        rawMaterial: {
          id: 12,
          baseName: 'Steel Nails',
          currentBuyPrice: 90,
          isPerishable: false,
        },
      },
    ],
  },
  ...overrides,
});

// Transaction mock: wood/nails inventory rows and a nullable finished-goods row.
const makeTx = (overrides: Record<string, any> = {}) => {
  const invRows = {
    11: { id: 21, productId: 11, locationId: 3, quantity: 200, avgCost: 120 },
    12: { id: 22, productId: 12, locationId: 3, quantity: 50, avgCost: 90 },
  };
  const tx = {
    workOrder: {
      findFirst: jest.fn(async () => makeWo()),
      update: jest.fn(async (args: any) => ({
        id: args.where.id,
        ...args.data,
      })),
    },
    productionScrapLog: {
      aggregate: jest.fn(async () => ({ _sum: { quantity: null } })),
      create: jest.fn(async (args: any) => ({ id: 1, ...args.data })),
    },
    inventory: {
      findFirst: jest.fn(async (args: any) => {
        if (args?.where?.productId === 7) return null;
        return invRows[args?.where?.productId] ?? null;
      }),
      update: jest.fn(async (args: any) => ({
        id: args.where.id,
        ...args.data,
      })),
      create: jest.fn(async (args: any) => ({ id: 99, ...args.data })),
    },
    productBatch: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async (args: any) => ({ id: 50, ...args.data })),
      update: jest.fn(async (args: any) => ({
        id: args.where.id,
        ...args.data,
      })),
    },
    auditLog: {
      create: jest.fn(async (args: any) => ({ id: 1, ...args.data })),
    },
    manufacturingOrder: {
      findFirst: jest.fn(async () => null),
      update: jest.fn(async (args: any) => ({
        id: args.where.id,
        ...args.data,
      })),
    },
    manufacturingOrderHistory: {
      create: jest.fn(async (args: any) => ({ id: 1, ...args.data })),
    },
    ...overrides,
  };
  return { tx, invRows };
};

const makePrisma = (wo: any, tx: any) => {
  const prisma: Record<string, any> = {
    workOrder: { findFirst: jest.fn(async () => wo) },
    billOfMaterials: { findFirst: jest.fn(async () => null) },
    inventory: { findFirst: jest.fn(async () => null) },
    auditLog: { create: jest.fn(async (args: any) => args.data) },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  return prisma;
};

const makeService = (prisma: any) =>
  new ManufacturingService(
    prisma as any,
    {
      postManufacturingServiceIncome: jest.fn(async () => ({ id: 1 })),
    } as any,
    { notifyOwner: jest.fn(async () => undefined) } as any,
  );

describe('ManufacturingService', () => {
  describe('requiredWithScrap', () => {
    it('applies the scrap percentage to the required quantity', () => {
      expect(requiredWithScrap(2, 10, 5)).toBe(21);
      expect(requiredWithScrap(0.5, 10, 5)).toBeCloseTo(5.25, 2);
    });
  });

  describe('updateStatus -> COMPLETED', () => {
    it('decrements raw stock, credits finished stock, values the batch with COGM and logs audits', async () => {
      const wo = makeWo();
      const { tx } = makeTx();
      const prisma = makePrisma(wo, tx);
      const service = makeService(prisma);

      const result = await service.updateStatus(5, { status: 'COMPLETED' }, {
        sub: 2,
      } as any);

      // Scrap-adjusted raw backflush: wood 21 kg, nails 5.25 kg.
      const woodUpd = tx.inventory.update.mock.calls.find(
        (c: any[]) => c[0].where.id === 21,
      )!;
      const nailsUpd = tx.inventory.update.mock.calls.find(
        (c: any[]) => c[0].where.id === 22,
      )!;
      expect(woodUpd[0].data.quantity.decrement).toBe(21);
      expect(nailsUpd[0].data.quantity.decrement).toBeCloseTo(5.25, 2);

      // Finished-goods row created at the location (no row existed yet).
      const finishedRow = tx.inventory.create.mock.calls[0][0].data;
      expect(finishedRow.productId).toBe(7);
      expect(finishedRow.locationId).toBe(3);
      expect(finishedRow.quantity).toBe(10);

      // COGM roll-up: (21 * 120 + 5.25 * 90) / 10 = 299.25 per unit.
      const batch = tx.productBatch.create.mock.calls[0][0].data;
      expect(batch.productId).toBe(7);
      expect(batch.batchNumber).toBe('B-1');
      expect(batch.quantity).toBe(10);
      expect(batch.unitCost).toBe(299.25);

      const woUpdate = tx.workOrder.update.mock.calls[0][0];
      expect(woUpdate.data.status).toBe('COMPLETED');
      expect(woUpdate.data.producedQuantity).toBe(10);
      expect(woUpdate.data.totalCogmCost).toBe(2992.5);
      expect(woUpdate.data.cogmUnitCost).toBe(299.25);

      const actions = tx.auditLog.create.mock.calls.map(
        (c: any[]) => c[0].data.action,
      );
      expect(actions).toContain('PRODUCTION_ISSUE');
      expect(actions).toContain('WORK_ORDER_COMPLETED');
    });
  });

  describe('updateStatus -> COMPLETED (insufficient stock)', () => {
    it('rejects the completion when a raw material runs short mid-transaction', async () => {
      const wo = makeWo();
      const { tx } = makeTx({
        inventory: {
          findFirst: jest.fn(async (args: any) =>
            args?.where?.productId === 11
              ? {
                  id: 21,
                  productId: 11,
                  locationId: 3,
                  quantity: 10,
                  avgCost: 120,
                }
              : null,
          ),
          update: jest.fn(async (args: any) => ({
            id: args.where.id,
            ...args.data,
          })),
          create: jest.fn(async (args: any) => ({ id: 99, ...args.data })),
        },
      });
      const prisma = makePrisma(wo, tx);
      const service = makeService(prisma);

      await expect(
        service.updateStatus(5, { status: 'COMPLETED' }, { sub: 2 } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.inventory.update).not.toHaveBeenCalled();
      expect(tx.productBatch.create).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus -> COMPLETED (finished scrap)', () => {
    it('credits only the net produced quantity when finished units were scrapped', async () => {
      const wo = makeWo();
      const { tx } = makeTx({
        productionScrapLog: {
          aggregate: jest.fn(async () => ({ _sum: { quantity: 2 } })),
          create: jest.fn(async (args: any) => ({ id: 1, ...args.data })),
        },
      });
      const prisma = makePrisma(wo, tx);
      const service = makeService(prisma);

      await service.updateStatus(5, { status: 'COMPLETED' }, { sub: 2 } as any);

      const woUpdate = tx.workOrder.update.mock.calls[0][0];
      expect(woUpdate.data.producedQuantity).toBe(8);
      expect(tx.productBatch.create.mock.calls[0][0].data.quantity).toBe(8);
    });
  });

  describe('updateStatus transitions', () => {
    it('rejects skipping straight from DRAFT to COMPLETED', async () => {
      const wo = makeWo({ status: 'DRAFT' });
      const { tx } = makeTx();
      const prisma = makePrisma(wo, tx);
      const service = makeService(prisma);

      await expect(
        service.updateStatus(5, { status: 'COMPLETED' }, { sub: 2 } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects cancelling a completed work order', async () => {
      const wo = makeWo({ status: 'COMPLETED' });
      const { tx } = makeTx();
      const prisma = makePrisma(wo, tx);
      const service = makeService(prisma);

      await expect(
        service.updateStatus(5, { status: 'CANCELLED' }, { sub: 2 } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('updateJobStage -> PRODUCTION', () => {
    it('creates the linked work order when a queued job enters production', async () => {
      const job = {
        id: 3,
        organizationId: 1,
        stage: 'QUEUED',
        bomId: 10,
        targetQuantity: 10,
        workOrderId: null,
        bom: { finishedProductId: 7 },
      };
      const tx: Record<string, any> = {
        manufacturingOrder: {
          update: jest.fn(async (args: any) => ({
            id: args.where.id,
            ...args.data,
          })),
          findFirst: jest.fn(async () => ({ ...job })),
        },
        manufacturingOrderHistory: {
          create: jest.fn(async (args: any) => ({ id: 1, ...args.data })),
        },
      };
      const prisma: Record<string, any> = {
        manufacturingOrder: { findFirst: jest.fn(async () => job) },
        location: { findFirst: jest.fn(async () => ({ id: 3 })) },
        workOrder: {
          create: jest.fn(async (args: any) => ({ id: 9, ...args.data })),
        },
        $transaction: jest.fn(async (cb: any) => cb(tx)),
      };
      const service = makeService(prisma);

      await service.updateJobStage(3, { stage: 'PRODUCTION' }, {
        sub: 2,
      } as any);

      const woCreate = prisma.workOrder.create.mock.calls[0][0];
      expect(woCreate.data.bomId).toBe(10);
      expect(woCreate.data.finishedProductId).toBe(7);
      expect(woCreate.data.targetQuantity).toBe(10);
      const orderUpd = tx.manufacturingOrder.update.mock.calls[0][0];
      expect(orderUpd.data.stage).toBe('PRODUCTION');
      expect(orderUpd.data.workOrderId).toBe(9);
      const history = tx.manufacturingOrderHistory.create.mock.calls[0][0].data;
      expect(history.toStage).toBe('PRODUCTION');
      expect(history.orderId).toBe(3);
    });
  });

  describe('updateJobStage -> COMPLETED (COGM snapshot)', () => {
    it('copies produced quantity + COGM from the linked work order onto the job', async () => {
      const job = {
        id: 3,
        organizationId: 1,
        stage: 'PRODUCTION',
        bomId: 10,
        targetQuantity: 10,
        workOrderId: 5,
        bom: { finishedProductId: 7 },
      };
      const tx: Record<string, any> = {
        manufacturingOrder: {
          update: jest.fn(async (args: any) => ({
            id: args.where.id,
            ...args.data,
          })),
          findFirst: jest.fn(async () => ({ ...job })),
        },
        manufacturingOrderHistory: {
          create: jest.fn(async (args: any) => ({ id: 1, ...args.data })),
        },
      };
      const prisma: Record<string, any> = {
        manufacturingOrder: { findFirst: jest.fn(async () => job) },
        workOrder: {
          findFirst: jest.fn(async () => ({
            id: 5,
            producedQuantity: 8,
            totalCogmCost: 2394,
            cogmUnitCost: 299.25,
          })),
        },
        $transaction: jest.fn(async (cb: any) => cb(tx)),
      };
      const service = makeService(prisma);

      await service.updateJobStage(3, { stage: 'COMPLETED' }, {
        sub: 2,
      } as any);

      const data = tx.manufacturingOrder.update.mock.calls[0][0].data;
      expect(data.stage).toBe('COMPLETED');
      expect(data.producedQuantity).toBe(8);
      expect(data.totalCogmCost).toBe(2394);
      expect(data.cogmUnitCost).toBe(299.25);
      expect(data.completedAt).toBeInstanceOf(Date);
    });
  });

  describe('autoCompleteLinkedJob (COGM carry-through)', () => {
    it('auto-completes the job and snapshots output + COGM + completedAt', async () => {
      const tx: Record<string, any> = {
        manufacturingOrder: {
          findFirst: jest.fn(async () => ({ id: 3, workOrderId: 5 })),
          update: jest.fn(async (args: any) => ({
            id: args.where.id,
            ...args.data,
          })),
        },
        workOrder: {
          findFirst: jest.fn(async () => ({
            producedQuantity: 8,
            totalCogmCost: 2394,
            cogmUnitCost: 299.25,
            completedAt: new Date('2026-09-08T10:00:00Z'),
          })),
        },
        manufacturingOrderHistory: {
          create: jest.fn(async (args: any) => ({ id: 1, ...args.data })),
        },
      };
      const prisma = makePrisma(null, tx);
      const service = makeService(prisma);

      await service.autoCompleteLinkedJob(tx as any, 1, 5);

      const data = tx.manufacturingOrder.update.mock.calls[0][0].data;
      expect(data.stage).toBe('COMPLETED');
      expect(data.producedQuantity).toBe(8);
      expect(data.totalCogmCost).toBe(2394);
      expect(data.cogmUnitCost).toBe(299.25);
      expect(data.completedAt).toBeInstanceOf(Date);
      const note =
        tx.manufacturingOrderHistory.create.mock.calls[0][0].data.note;
      expect(note).toContain('COGM 2394');
    });

    it('leaves unrelated orders alone when no linked job is on PRODUCTION', async () => {
      const tx: Record<string, any> = {
        manufacturingOrder: { findFirst: jest.fn(async () => null) },
        manufacturingOrderHistory: { create: jest.fn(async () => ({ id: 1 })) },
      };
      const prisma = makePrisma(null, tx);
      const service = makeService(prisma);

      await service.autoCompleteLinkedJob(tx as any, 1, 5);
      expect(tx.manufacturingOrderHistory.create).not.toHaveBeenCalled();
    });
  });

  describe('completeOrderDelivery (final flow step)', () => {
    const steps = [0, 1, 2, 3, 4].map((i) => ({
      id: i + 1,
      name: `Step ${i + 1}`,
      sortOrder: i,
      teamId: i + 1,
    }));

    it('refuses to complete an order that is not on its final step', async () => {
      const prisma: Record<string, any> = {
        manufacturingOrder: {
          findFirst: jest.fn(async () => ({
            id: 12,
            organizationId: 1,
            currentStepIndex: 1,
            flow: { steps },
          })),
        },
      };
      const service = makeService(prisma);
      await expect(
        service.completeOrderDelivery(12, {}, { sub: 2 } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('snapshots produced qty + COGM from the linked work order on delivery', async () => {
      const tx: Record<string, any> = {
        mfgOrderHandover: {
          create: jest.fn(async (args: any) => ({ id: 1, ...args.data })),
        },
        manufacturingOrder: {
          update: jest.fn(async (args: any) => ({
            id: args.where.id,
            ...args.data,
          })),
        },
      };
      const prisma: Record<string, any> = {
        manufacturingOrder: {
          findFirst: jest.fn(async () => ({
            id: 12,
            organizationId: 1,
            currentStepIndex: 4,
            currentTeamId: 5,
            flow: { steps },
            workOrder: {
              producedQuantity: 8,
              totalCogmCost: 2394,
              cogmUnitCost: 299.25,
            },
          })),
          update: tx.manufacturingOrder.update,
        },
        mfgOrderHandover: tx.mfgOrderHandover,
      };
      const service = makeService(prisma);

      await service.completeOrderDelivery(12, { note: 'Delivered' }, {
        sub: 2,
      } as any);

      const data = tx.manufacturingOrder.update.mock.calls[0][0].data;
      expect(data.stage).toBe('COMPLETED');
      expect(data.producedQuantity).toBe(8);
      expect(data.totalCogmCost).toBe(2394);
      expect(data.cogmUnitCost).toBe(299.25);
      expect(data.completedAt).toBeInstanceOf(Date);
      expect(tx.mfgOrderHandover.create).toHaveBeenCalled();
    });
  });

  describe('materialVariance for a job', () => {
    it('bases the standard on the job produced quantity snapshot (not the target)', async () => {
      const prisma: Record<string, any> = {
        manufacturingOrder: {
          findFirst: jest.fn(async () => ({
            id: 3,
            producedQuantity: 8,
            targetQuantity: 10,
            bom: { items: [{ rawMaterialProductId: 11, quantityRequired: 2 }] },
          })),
        },
        materialIssue: {
          findMany: jest.fn(async () => [
            { id: 1, productId: 11, quantity: 20, returns: [{ quantity: 4 }] },
          ]),
        },
        product: {
          findMany: jest.fn(async () => [
            { id: 11, brand: 'Oak', baseName: 'Wood' },
          ]),
        },
      };
      const service = makeService(prisma);

      const result = await service.materialVariance({ jobId: 3 });
      expect(result.producedQty).toBe(8);
      const row = result.rows.find((r: any) => r.productId === 11)!;
      expect(row).toBeDefined();
      expect(row.issued).toBe(20);
      expect(row.returned).toBe(4);
      expect(row.standard).toBe(16);
      expect(row.variance).toBe(0);
    });
  });

  describe('flow-first order routing (enterFlowStep)', () => {
    const flow = {
      id: 4,
      active: true,
      steps: [
        { id: 101, teamId: 1, isProductionStep: false, sortOrder: 0 },
        { id: 102, teamId: 2, isProductionStep: false, sortOrder: 1 },
      ],
    };

    it('creates an order on step 0 of the chosen production flow', async () => {
      const tx: Record<string, any> = {
        manufacturingOrder: {
          create: jest.fn(async (args: any) => ({
            id: 3,
            jobNumber: 'JB-2026-1234',
            ...args.data,
          })),
          update: jest.fn(async (args: any) => ({
            id: args.where.id,
            ...args.data,
          })),
          findFirst: jest.fn(async () => ({ id: 3 })),
        },
        manufacturingOrderHistory: { create: jest.fn(async () => ({ id: 1 })) },
        mfgOrderHandover: {
          create: jest.fn(async (args: any) => ({ id: 1, ...args.data })),
        },
        location: { findFirst: jest.fn(async () => ({ id: 3 })) },
      };
      const prisma: Record<string, any> = {
        billOfMaterials: { findFirst: jest.fn(async () => null) },
        mfgFlow: { findFirst: jest.fn(async () => ({ ...flow })) },
        $transaction: jest.fn(async (cb: any) => cb(tx)),
      };
      const service = makeService(prisma);

      await service.createJob({ title: 'Custom wardrobe', flowId: 4 }, {
        sub: 2,
      } as any);

      const update = tx.manufacturingOrder.update.mock.calls[0][0];
      expect(update.data.flowId).toBe(4);
      expect(update.data.currentStepIndex).toBe(0);
      expect(update.data.currentTeamId).toBe(1);
      expect(update.data.stage).toBe('DESIGN');
      const handover = tx.mfgOrderHandover.create.mock.calls[0][0].data;
      expect(handover.stepIndex).toBe(0);
      expect(handover.toTeamId).toBe(1);
    });

    it('auto-links a Work Order when the order enters a production step with a BOM', async () => {
      const productionFlow = {
        id: 4,
        steps: [{ id: 101, teamId: 5, isProductionStep: true, sortOrder: 0 }],
      };
      const tx: Record<string, any> = {
        manufacturingOrder: {
          create: jest.fn(async (args: any) => ({
            id: 3,
            jobNumber: 'JB-2026-4321',
            bomId: args.data.bomId,
            targetQuantity: args.data.targetQuantity,
            ...args.data,
          })),
          update: jest.fn(async (args: any) => ({
            id: args.where.id,
            ...args.data,
          })),
          findFirst: jest.fn(async () => ({ id: 3 })),
        },
        manufacturingOrderHistory: { create: jest.fn(async () => ({ id: 1 })) },
        mfgOrderHandover: { create: jest.fn(async () => ({ id: 1 })) },
        billOfMaterials: {
          findFirst: jest.fn(async () => ({ finishedProductId: 7 })),
        },
        location: { findFirst: jest.fn(async () => ({ id: 3 })) },
        workOrder: {
          create: jest.fn(async (args: any) => ({ id: 9, ...args.data })),
        },
        auditLog: { create: jest.fn(async () => ({ id: 1 })) },
      };
      const prisma: Record<string, any> = {
        billOfMaterials: {
          findFirst: jest.fn(async () => ({ id: 10 })),
        },
        mfgFlow: { findFirst: jest.fn(async () => productionFlow) },
        $transaction: jest.fn(async (cb: any) => cb(tx)),
      };
      const service = makeService(prisma);

      await service.createJob(
        { title: 'Run of 5 doors', flowId: 4, bomId: 10, targetQuantity: 5 },
        { sub: 2 } as any,
      );

      const woCreate = tx.workOrder.create.mock.calls[0][0];
      expect(woCreate.data.bomId).toBe(10);
      expect(woCreate.data.finishedProductId).toBe(7);
      expect(woCreate.data.targetQuantity).toBe(5);
      const update = tx.manufacturingOrder.update.mock.calls[0][0];
      expect(update.data.workOrderId).toBe(9);
      expect(update.data.stage).toBe('PRODUCTION');
      expect(tx.auditLog.create.mock.calls[0][0].data.action).toBe(
        'WORK_ORDER_LINKED',
      );
    });
  });

  describe('autoCompleteLinkedJob on a flow', () => {
    const makeTx = () => {
      const tx: Record<string, any> = {
        manufacturingOrder: {
          findFirst: jest.fn(async () => null),
          update: jest.fn(async (args: any) => ({
            id: args.where.id,
            ...args.data,
          })),
        },
        workOrder: {
          findFirst: jest.fn(async () => ({
            producedQuantity: 8,
            totalCogmCost: 2394,
            cogmUnitCost: 299.25,
            completedAt: new Date('2026-09-08T10:00:00Z'),
          })),
        },
        mfgOrderHandover: {
          create: jest.fn(async (args: any) => ({ id: 1, ...args.data })),
        },
        manufacturingOrderHistory: {
          create: jest.fn(async (args: any) => ({ id: 1, ...args.data })),
        },
      };
      return tx;
    };

    it('auto-advances the order to the next flow step when production finishes mid-flow', async () => {
      const tx = makeTx();
      tx.manufacturingOrder.findFirst.mockResolvedValueOnce({
        id: 3,
        flowId: 4,
        currentStepIndex: 1,
        currentTeamId: 2,
        stage: 'PRODUCTION',
        flow: {
          steps: [
            { id: 101, teamId: 1, sortOrder: 0 },
            { id: 102, teamId: 2, sortOrder: 1 },
            { id: 103, teamId: 3, sortOrder: 2 },
            { id: 104, teamId: 4, sortOrder: 3 },
          ],
        },
      });
      const prisma = makePrisma(null, tx);
      const service = makeService(prisma);

      await service.autoCompleteLinkedJob(tx as any, 1, 9);

      const data = tx.manufacturingOrder.update.mock.calls[0][0].data;
      expect(data.stage).toBe('PRODUCTION');
      expect(data.currentStepIndex).toBe(2);
      expect(data.currentTeamId).toBe(3);
      expect(data.producedQuantity).toBe(8);
      expect(data.totalCogmCost).toBe(2394);
      expect(data.completedAt).toBeUndefined();
      const handover = tx.mfgOrderHandover.create.mock.calls[0][0].data;
      expect(handover.toTeamId).toBe(3);
      expect(handover.stepIndex).toBe(2);
    });

    it('completes the order when the production step is the final hop', async () => {
      const tx = makeTx();
      tx.manufacturingOrder.findFirst.mockResolvedValueOnce({
        id: 3,
        flowId: 4,
        currentStepIndex: 2,
        currentTeamId: 3,
        stage: 'PRODUCTION',
        flow: {
          steps: [
            { id: 101, teamId: 1, sortOrder: 0 },
            { id: 102, teamId: 2, sortOrder: 1 },
            { id: 103, teamId: 3, sortOrder: 2 },
          ],
        },
      });
      const prisma = makePrisma(null, tx);
      const service = makeService(prisma);

      await service.autoCompleteLinkedJob(tx as any, 1, 9);

      const data = tx.manufacturingOrder.update.mock.calls[0][0].data;
      expect(data.stage).toBe('COMPLETED');
      expect(data.completedAt).toBeInstanceOf(Date);
      expect(data.producedQuantity).toBe(8);
      expect(data.totalCogmCost).toBe(2394);
      const history = tx.manufacturingOrderHistory.create.mock.calls[0][0].data;
      expect(history.toStage).toBe('COMPLETED');
    });
  });

  describe('order CRUD (updateJob / deleteJob)', () => {
    it("updates an editable order's details and audits the change", async () => {
      const prisma: Record<string, any> = {
        manufacturingOrder: {
          findFirst: jest.fn(async () => ({
            id: 3,
            stage: 'DESIGN',
            jobNumber: 'JB-2026-1234',
          })),
          update: jest.fn(async (args: any) => ({
            id: args.where.id,
            ...args.data,
          })),
        },
        auditLog: {
          create: jest.fn(async (args: any) => ({ id: 1, ...args.data })),
        },
      };
      const service = makeService(prisma);

      const result = await service.updateJob(
        3,
        {
          title: '  Double Door Unit  ',
          customerName: '',
          dueDate: null,
          notes: null,
        },
        { sub: 2 } as any,
      );

      expect(result.title).toBe('Double Door Unit');
      expect(result.customerName).toBeNull();
      expect(result.dueDate).toBeNull();
      expect(result.notes).toBeNull();
      const audit = prisma.auditLog.create.mock.calls[0][0].data;
      expect(audit.action).toBe('JOB_UPDATED');
      expect(audit.details).toContain('JB-2026-1234');
    });

    it('validates a replaced BOM belongs to the organization', async () => {
      const prisma: Record<string, any> = {
        manufacturingOrder: {
          findFirst: jest.fn(async () => ({
            id: 3,
            stage: 'QUEUED',
            jobNumber: 'JB-2026-1',
          })),
        },
        billOfMaterials: { findFirst: jest.fn(async () => null) },
      };
      const service = makeService(prisma);
      await expect(
        service.updateJob(3, { bomId: 999 }, { sub: 2 } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects detail edits once the order has started production', async () => {
      const prisma: Record<string, any> = {
        manufacturingOrder: {
          findFirst: jest.fn(async () => ({
            id: 3,
            stage: 'PRODUCTION',
            jobNumber: 'JB-2026-1',
          })),
        },
      };
      const service = makeService(prisma);
      await expect(
        service.updateJob(3, { title: 'Changed' }, { sub: 2 } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('deletes a pre-production order inside a transaction', async () => {
      const tx: Record<string, any> = {
        manufacturingOrder: {
          delete: jest.fn(async (args: any) => ({ id: args.where.id })),
        },
      };
      const prisma: Record<string, any> = {
        manufacturingOrder: {
          findFirst: jest.fn(async () => ({
            id: 3,
            stage: 'DESIGN',
            jobNumber: 'JB-2026-1234',
            completedAt: null,
            workOrder: null,
          })),
        },
        auditLog: {
          create: jest.fn(async (args: any) => ({ id: 1, ...args.data })),
        },
        $transaction: jest.fn(async (cb: any) => cb(tx)),
      };
      const service = makeService(prisma);

      const result = await service.deleteJob(3, { sub: 2 } as any);
      expect(result.id).toBe(3);
      expect(tx.manufacturingOrder.delete).toHaveBeenCalledWith({
        where: { id: 3 },
      });
      const audit = prisma.auditLog.create.mock.calls[0][0].data;
      expect(audit.action).toBe('JOB_DELETED');
    });

    it('rejects deleting an order that has reached production', async () => {
      const prisma: Record<string, any> = {
        manufacturingOrder: {
          findFirst: jest.fn(async () => ({
            id: 3,
            stage: 'PRODUCTION',
            jobNumber: 'JB-2026-1',
            completedAt: null,
            workOrder: { status: 'IN_PROGRESS' },
          })),
        },
      };
      const service = makeService(prisma);
      await expect(
        service.deleteJob(3, { sub: 2 } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

describe('ManufacturingService team & flow administration', () => {
  const makeCrudPrisma = (overrides: Record<string, any> = {}) => {
    const prisma: Record<string, any> = {
      mfgTeam: {
        findMany: jest.fn(async () => []),
        count: jest.fn(async () => 0),
        create: jest.fn(async (args: any) => ({ id: 1, ...args.data })),
        update: jest.fn(async (args: any) => ({
          id: args.where.id,
          ...args.data,
        })),
        delete: jest.fn(async (args: any) => ({ id: args.where.id })),
        findFirst: jest.fn(async () => null),
      },
      mfgFlow: {
        findMany: jest.fn(async () => []),
        create: jest.fn(async (args: any) => ({ id: 1, ...args.data })),
        update: jest.fn(async (args: any) => ({
          id: args.where.id,
          ...args.data,
        })),
        delete: jest.fn(async (args: any) => ({ id: args.where.id })),
        updateMany: jest.fn(async () => ({ count: 1 })),
        findFirst: jest.fn(async () => null),
      },
      mfgFlowStep: {
        count: jest.fn(async () => 0),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
      manufacturingOrder: { count: jest.fn(async () => 0) },
      // RBAC delegates used by ensureFlowAccess when a flow is created/listed.
      permission: {
        upsert: jest.fn(async (args: any) => ({ id: 1, ...args.create })),
      },
      role: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async (args: any) => ({ id: 7, ...args.data })),
      },
      rolePermission: {
        createMany: jest.fn(async () => ({ count: 2 })),
      },
      $transaction: jest.fn(async (cb: any) => cb({})),
      ...overrides,
    };
    return prisma;
  };

  const service = (prisma: any) =>
    new (require('./manufacturing.service').ManufacturingService)(
      prisma,
      {
        postManufacturingServiceIncome: jest.fn(async () => ({ id: 1 })),
      } as any,
      { notifyOwner: jest.fn(async () => undefined) } as any,
    );

  describe('teams', () => {
    it('creates a team with the next sort order', async () => {
      const prisma = makeCrudPrisma({
        mfgTeam: {
          findMany: jest.fn(async () => []),
          count: jest.fn(async () => 2),
          create: jest.fn(async (args: any) => ({ id: 5, ...args.data })),
        },
      });
      const created = await service(prisma).createTeam({ name: 'Packaging' });
      expect(created.id).toBe(5);
      expect(created.name).toBe('Packaging');
      expect(created.sortOrder).toBe(2);
    });

    it('rejects a duplicate team name', async () => {
      const prisma = makeCrudPrisma({
        mfgTeam: {
          count: jest.fn(async () => 0),
          create: jest.fn(async () => {
            throw { code: 'P2002' };
          }),
        },
      });
      await expect(
        service(prisma).createTeam({ name: 'Intake' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('blocks deleting a team that is used by a flow step', async () => {
      const prisma = makeCrudPrisma({
        mfgTeam: {
          findFirst: jest.fn(async () => ({ id: 2, name: 'Intake' })),
        },
        mfgFlowStep: { count: jest.fn(async () => 1) },
        manufacturingOrder: { count: jest.fn(async () => 0) },
      });
      await expect(service(prisma).deleteTeam(2)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('blocks deleting a team that owns orders in the pipeline', async () => {
      const prisma = makeCrudPrisma({
        mfgTeam: {
          findFirst: jest.fn(async () => ({ id: 2, name: 'Production' })),
        },
        mfgFlowStep: { count: jest.fn(async () => 0) },
        manufacturingOrder: { count: jest.fn(async () => 3) },
      });
      await expect(service(prisma).deleteTeam(2)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('flows', () => {
    it('creates a flow with ordered steps and clears other defaults', async () => {
      const tx: Record<string, any> = {
        mfgFlow: {
          updateMany: jest.fn(async () => ({ count: 1 })),
          create: jest.fn(async (args: any) => ({ id: 9, ...args.data })),
        },
      };
      const prisma = makeCrudPrisma({
        mfgTeam: {
          findMany: jest.fn(async () => [
            { id: 1, name: 'Intake' },
            { id: 2, name: 'Production' },
          ]),
        },
        $transaction: jest.fn(async (cb: any) => cb(tx)),
      });
      const created = await service(prisma).createFlow({
        name: 'Make-to-order',
        isDefault: true,
        steps: [{ teamId: 1 }, { teamId: 2, isProductionStep: true }],
      });
      expect(created.id).toBe(9);
      expect(tx.mfgFlow.updateMany).toHaveBeenCalled();
      const createCall = tx.mfgFlow.create.mock.calls[0][0];
      expect(createCall.data.isDefault).toBe(true);
      expect(createCall.data.steps.create).toHaveLength(2);
      expect(createCall.data.steps.create[0].name).toBe('Intake');
      expect(createCall.data.steps.create[0].isProductionStep).toBe(false);
      // Labels come from the team (no per-step label editing) + production flag
      // is persisted so reaching this step auto-links a Work Order.
      expect(createCall.data.steps.create[1].name).toBe('Production');
      expect(createCall.data.steps.create[1].isProductionStep).toBe(true);
      expect(createCall.data.steps.create[1].sortOrder).toBe(1);
      // RBAC registered automatically (mirrors restaurant stations).
      expect(created.roleId).toBe(7);
      expect(created.permissionView).toBe('production-flow.9.view');
      expect(prisma.rolePermission.createMany).toHaveBeenCalled();
    });

    it('rejects a flow that references an unknown team', async () => {
      const prisma = makeCrudPrisma({
        mfgTeam: { findMany: jest.fn(async () => [{ id: 1, name: 'Intake' }]) },
      });
      await expect(
        service(prisma).createFlow({ name: 'Bad', steps: [{ teamId: 99 }] }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('blocks deleting a flow that orders are routed through', async () => {
      const prisma = makeCrudPrisma({
        mfgFlow: {
          findFirst: jest.fn(async () => ({
            id: 4,
            isDefault: true,
            _count: { orders: 2 },
          })),
        },
      });
      await expect(service(prisma).deleteFlow(4)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('setDefaultFlow demotes every other flow first', async () => {
      const tx: Record<string, any> = {
        mfgFlow: {
          updateMany: jest.fn(async () => ({ count: 3 })),
          update: jest.fn(async (args: any) => ({
            id: args.where.id,
            ...args.data,
          })),
        },
      };
      const prisma = makeCrudPrisma({
        mfgFlow: {
          findFirst: jest.fn(async () => ({ id: 4, isDefault: false })),
        },
        $transaction: jest.fn(async (cb: any) => cb(tx)),
      });
      const res = await service(prisma).setDefaultFlow(4);
      expect(res.id).toBe(4);
      const demote = tx.mfgFlow.updateMany.mock.calls[0][0];
      expect(demote.where.id.not).toBe(4);
      expect(tx.mfgFlow.update.mock.calls[0][0].data.isDefault).toBe(true);
    });
  });
});

describe('Manufacturing purchasing & goods receiving', () => {
  const makeService = (prisma: any) =>
    new (require('./manufacturing.service').ManufacturingService)(
      prisma,
      {
        postManufacturingServiceIncome: jest.fn(async () => ({ id: 1 })),
      } as any,
      { notifyOwner: jest.fn(async () => undefined) } as any,
    );

  it('sends a DRAFT purchase order', async () => {
    const prisma: Record<string, any> = {
      mfgPurchaseOrder: {
        findFirst: jest.fn(async () => ({
          id: 1,
          poNumber: 'PO-2026-A',
          status: 'DRAFT',
        })),
        update: jest.fn(async (args: any) => ({ id: 1, ...args.data })),
      },
      auditLog: { create: jest.fn(async () => ({ id: 1 })) },
    };
    const result = await makeService(prisma).sendPurchaseOrder(1, {
      sub: 2,
    } as any);
    expect(result.status).toBe('SENT');
  });

  it('refuses to send a non-draft purchase order', async () => {
    const prisma: Record<string, any> = {
      mfgPurchaseOrder: {
        findFirst: jest.fn(async () => ({
          id: 1,
          poNumber: 'PO-1',
          status: 'RECEIVED',
        })),
      },
    };
    await expect(
      makeService(prisma).sendPurchaseOrder(1, { sub: 2 } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('netting shortage = required − on hand − on order (positive only)', async () => {
    const prisma: Record<string, any> = {
      manufacturingOrder: {
        findMany: jest.fn(async () => [
          {
            targetQuantity: 10,
            bom: {
              scrapPercentage: 5,
              items: [
                {
                  quantityRequired: 2,
                  rawMaterialProductId: 11,
                  rawMaterial: { brand: 'Oak', baseName: 'Wood' },
                },
              ],
            },
          },
        ]),
      },
      inventory: { groupBy: jest.fn(async () => []) },
      mfgPurchaseOrderItem: { findMany: jest.fn(async () => []) },
      product: { findMany: jest.fn(async () => []) },
    };
    const result = await makeService(prisma).purchaseOrderNetting();
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].productId).toBe(11);
    expect(result.lines[0].required).toBe(21); // 2 × 10 × 1.05
    expect(result.lines[0].suggestedQty).toBe(21);
  });

  it('receives goods, stocks the store and closes the PO', async () => {
    const tx: Record<string, any> = {
      mfgGoodsReceipt: {
        create: jest.fn(async (args: any) => ({ id: 9, ...args.data })),
        findFirst: jest.fn(async () => ({ id: 9 })),
      },
      mfgGoodsReceiptItem: {
        findMany: jest.fn(async () => []),
      },
      inventory: {
        findFirst: jest.fn(async () => ({ id: 40, quantity: 0, avgCost: 0 })),
        update: jest.fn(async (args: any) => ({
          id: args.where.id,
          ...args.data,
        })),
        create: jest.fn(async (args: any) => ({ id: 41, ...args.data })),
      },
      mfgPurchaseOrderItem: {
        update: jest.fn(async (args: any) => ({
          id: args.where.id,
          ...args.data,
        })),
      },
      mfgPurchaseOrder: {
        update: jest.fn(async (args: any) => ({
          id: args.where.id,
          ...args.data,
        })),
      },
      auditLog: { create: jest.fn(async () => ({ id: 1 })) },
    };
    const prisma: Record<string, any> = {
      mfgPurchaseOrder: {
        findFirst: jest.fn(async () => ({
          id: 1,
          poNumber: 'PO-2026-A',
          status: 'SENT',
          vendor: { name: 'Acme Supplies' },
          items: [
            {
              id: 11,
              productId: 22,
              quantity: 10,
              unitCost: 50,
              quantityReceived: 0,
              quantityRejected: 0,
            },
          ],
        })),
      },
      location: {
        findFirst: jest.fn(async () => ({ id: 5, name: 'Raw Store' })),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const result = await makeService(prisma).receiveGoods(
      {
        purchaseOrderId: 1,
        locationId: 5,
        items: [{ poItemId: 11, receivedQty: 10, rejectedQty: 0 }],
      },
      { sub: 2 } as any,
    );
    expect(tx.mfgGoodsReceipt.create).toHaveBeenCalled();
    const invUpdate = tx.inventory.update.mock.calls[0][0];
    expect(invUpdate.data.quantity.increment).toBe(10);
    expect(tx.mfgPurchaseOrder.update.mock.calls[0][0].data.status).toBe(
      'RECEIVED',
    );
    expect(result).toBeDefined();
  });

  it('rejects receiving more than the outstanding quantity', async () => {
    const prisma: Record<string, any> = {
      mfgPurchaseOrder: {
        findFirst: jest.fn(async () => ({
          id: 1,
          poNumber: 'PO-2026-A',
          status: 'SENT',
          vendor: { name: 'Acme' },
          items: [
            {
              id: 11,
              productId: 22,
              quantity: 10,
              unitCost: 50,
              quantityReceived: 0,
              quantityRejected: 0,
            },
          ],
        })),
      },
      location: { findFirst: jest.fn(async () => ({ id: 5 })) },
    };
    await expect(
      makeService(prisma).receiveGoods(
        {
          purchaseOrderId: 1,
          locationId: 5,
          items: [{ poItemId: 11, receivedQty: 12, rejectedQty: 0 }],
        },
        { sub: 2 } as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Manufacturing per-step operations', () => {
  const makeService = (prisma: any) =>
    new (require('./manufacturing.service').ManufacturingService)(
      prisma,
      {
        postManufacturingServiceIncome: jest.fn(async () => ({ id: 1 })),
      } as any,
      { notifyOwner: jest.fn(async () => undefined) } as any,
    );

  it('advance moves to the next operation when the step has more', async () => {
    const tx: Record<string, any> = {
      manufacturingOrder: {
        update: jest.fn(async (args: any) => ({
          id: args.where.id,
          ...args.data,
        })),
        findFirst: jest.fn(async () => ({ id: 3 })),
      },
      manufacturingOrderHistory: { create: jest.fn(async () => ({ id: 1 })) },
    };
    const prisma: Record<string, any> = {
      manufacturingOrder: {
        findFirst: jest.fn(async () => ({
          id: 3,
          flowId: 4,
          currentStepIndex: 1,
          currentTeamId: 2,
          currentOperationId: 500,
          stage: 'PRODUCTION',
          flow: {
            steps: [
              { id: 101, teamId: 1 },
              {
                id: 102,
                teamId: 2,
                operations: [
                  { id: 500, name: 'Sectioning & Cutting' },
                  { id: 501, name: 'Assembly' },
                  { id: 502, name: 'Painting' },
                ],
              },
              { id: 103, teamId: 3 },
            ],
          },
        })),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    await makeService(prisma).advanceOrder(3, {}, { sub: 2 } as any);
    const data = tx.manufacturingOrder.update.mock.calls[0][0].data;
    expect(data.currentOperationId).toBe(501);
    const note = tx.manufacturingOrderHistory.create.mock.calls[0][0].data.note;
    expect(note).toContain('Sectioning & Cutting');
    // Still on the same step/team — no handover was created.
    expect(tx.mfgOrderHandover?.create).toBeUndefined();
  });

  it('advance hands off to the next team after the last operation', async () => {
    const tx: Record<string, any> = {
      mfgOrderHandover: {
        create: jest.fn(async (args: any) => ({ id: 1, ...args.data })),
      },
      manufacturingOrder: {
        update: jest.fn(async (args: any) => ({
          id: args.where.id,
          ...args.data,
        })),
        findFirst: jest.fn(async () => ({ id: 3 })),
      },
      manufacturingOrderHistory: { create: jest.fn(async () => ({ id: 1 })) },
    };
    const prisma: Record<string, any> = {
      manufacturingOrder: {
        findFirst: jest.fn(async () => ({
          id: 3,
          flowId: 4,
          currentStepIndex: 1,
          currentTeamId: 2,
          currentOperationId: 502,
          stage: 'PRODUCTION',
          flow: {
            steps: [
              { id: 101, teamId: 1 },
              {
                id: 102,
                teamId: 2,
                operations: [
                  { id: 500, name: 'Sectioning & Cutting' },
                  { id: 501, name: 'Assembly' },
                  { id: 502, name: 'Painting' },
                ],
              },
              { id: 103, teamId: 3 },
            ],
          },
        })),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    await makeService(prisma).advanceOrder(3, {}, { sub: 2 } as any);
    const data = tx.manufacturingOrder.update.mock.calls[0][0].data;
    expect(data.currentStepIndex).toBe(2);
    expect(data.currentTeamId).toBe(3);
    expect(data.currentOperationId).toBeNull();
    expect(tx.mfgOrderHandover.create).toHaveBeenCalled();
  });
});


describe('Manufacturing procurement enhancements', () => {
  const makeService = (prisma: any, finance?: any) =>
    new (require('./manufacturing.service').ManufacturingService)(
      prisma,
      (finance ?? {
        postManufacturingServiceIncome: jest.fn(async () => ({ id: 1 })),
        postVendorBillPayment: jest.fn(async () => true),
        postVendorCreditNote: jest.fn(async () => true),
        postScrapDisposition: jest.fn(async () => true),
        postProcurement: jest.fn(async () => true),
      }) as any,
      { notifyOwner: jest.fn(async () => undefined) } as any,
    );

  it('listOpenPurchaseOrderLines reports line-level backorders', async () => {
    const prisma: Record<string, any> = {
      mfgPurchaseOrder: {
        findMany: jest.fn(async () => [
          {
            id: 1,
            poNumber: 'PO-1',
            vendorId: 5,
            status: 'PARTIALLY_RECEIVED',
            vendor: { name: 'Acme' },
            expectedDeliveryDate: null,
            items: [
              { id: 11, productId: 22, quantity: 10, quantityReceived: 10, quantityRejected: 0, unitCost: 50 },
              { id: 12, productId: 23, quantity: 10, quantityReceived: 8, quantityRejected: 0, unitCost: 30 },
            ],
          },
        ]),
      },
    };
    const result = await makeService(prisma).listOpenPurchaseOrderLines();
    expect(result).toHaveLength(1);
    expect(result[0].lines).toHaveLength(1);
    expect(result[0].lines[0].backorderQty).toBe(2);
    expect(result[0].totalValue).toBe(60);
  });

  it('createVendorBillFromGrn refuses duplicates for the same GRN', async () => {
    const prisma: Record<string, any> = {
      mfgGoodsReceipt: {
        findFirst: jest.fn(async () => ({ id: 9, grnNumber: 'GRN-9' })),
      },
      mfgVendorBill: {
        findFirst: jest.fn(async () => ({ id: 3 })),
      },
    };
    await expect(
      makeService(prisma).createVendorBillFromGrn({ grnId: 9 } as any, { sub: 1 } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('payVendorBill posts Dr AP/Cr Cash and marks a fully-paid bill PAID', async () => {
    const finance: any = {
      postManufacturingServiceIncome: jest.fn(async () => ({ id: 1 })),
      postVendorBillPayment: jest.fn(async () => true),
      postVendorCreditNote: jest.fn(async () => true),
      postScrapDisposition: jest.fn(async () => true),
      postProcurement: jest.fn(async () => true),
    };
    const prisma: Record<string, any> = {
      mfgVendorBill: {
        findFirst: jest.fn(async () => ({ id: 2, billNumber: 'BILL-2', totalAmount: 100, status: 'OPEN' })),
        update: jest.fn(async (args: any) => ({ id: 2, ...args.data })),
      },
      mfgVendorCreditNote: {
        aggregate: jest.fn(async () => ({ _sum: { totalAmount: null } })),
      },
      auditLog: { create: jest.fn(async () => ({ id: 1 })) },
    };
    const service = makeService(prisma, finance);
    const updated = await service.payVendorBill(2, { amount: 100 } as any, { sub: 1 } as any);
    expect(updated.status).toBe('PAID');
    expect(finance.postVendorBillPayment).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 100, ref: expect.stringContaining('VBP-') }),
    );
  });
});
