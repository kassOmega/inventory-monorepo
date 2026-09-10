// src/manufacturing/manufacturing.service.ts
// MANUFACTURING vertical: bills of materials, production work orders and
// material scrap.
// Work-order state machine: DRAFT -> SCHEDULED -> IN_PROGRESS -> COMPLETED,
// and (DRAFT | SCHEDULED | IN_PROGRESS) -> CANCELLED. Scheduling verifies raw-
// material availability at the production location. Completing a work order
// atomically backflushes scrap-adjusted component stock, credits the finished-
// good inventory, creates a valued ProductBatch and records the COGM roll-up
// plus the audit trail.
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MfgBillStatus,
  MfgCreditNoteStatus,
  MfgIssueStatus,
  MfgOrderStage,
  MfgPoStatus,
  MfgRejectDisposition,
  Prisma,
  ScrapKind,
  WorkOrderStatus,
} from '@prisma/client';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { inventoryFind, inventoryUpsert } from '../common/inventory.util';
import { getCurrentTenantId } from '../common/tenant/tenant.context';
import { FinanceService } from '../finance/finance.service';
import { tr } from '../i18n/i18n.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AssignShiftWorkersDto,
  CreateBomDto,
  CreateConsumableIssueDto,
  CreateGoodsReceiptDto,
  CreateMachineDto,
  CreateManufacturingOrderDto,
  CreateMaterialIssueDto,
  CreateMfgFlowDto,
  CreateMfgServiceDto,
  CreateMfgTeamDto,
  CreatePurchaseOrderDto,
  CreateDirectReceiptDto,
  CreateVendorCreditNoteDto,
  GenerateVendorBillDto,
  PayVendorBillDto,
  CreateShiftFromTemplateDto,
  IssueMachineDto,
  ReturnMachineItemDto,
  ReturnMachineIssuanceDto,
  AssignOrderFlowDto,
  AdvanceOrderDto,
  CompleteOrderDeliveryDto,
  CreateShiftSessionDto,
  CreateShiftTemplateDto,
  CreateVendorDto,
  CreateWorkerDto,
  CreateWorkOrderDto,
  CreateDesignCategoryDto,
  UpdateDesignCategoryDto,
  CreateDesignCatalogItemDto,
  UpdateDesignCatalogItemDto,
  LogScrapDto,
  MachineComponentDto,
  MfgFlowStepInputDto,
  RecordConsumableUsageDto,
  RecordMfgServiceIncomeDto,
  ReturnMaterialDto,
  ReorderMfgTeamsDto,
  UpdateBomDto,
  UpdateMachineComponentStatusDto,
  UpdateMachineStatusDto,
  UpdateMachineDto,
  UpdateManufacturingOrderStageDto,
  UpdateMfgFlowDto,
  UpdateMfgServiceDto,
  UpdateMfgTeamDto,
  UpdateManufacturingOrderDto,
  UpdatePurchaseOrderDto,
  UpdateVendorDto,
  UpdateWorkerStatusDto,
  UpdateWorkOrderStatusDto,
} from './dto/manufacturing.dto';

const round2 = (n: number) => Math.round(n * 100) / 100;

// Scrap-adjusted quantity consumed for one BOM component line when producing
// targetQuantity units (scrapPercentage is a percent, e.g. 5 = 5%).
export function requiredWithScrap(
  quantityRequired: number,
  targetQuantity: number,
  scrapPercentage: number,
): number {
  return round2(
    quantityRequired * targetQuantity * (1 + scrapPercentage / 100),
  );
}

const ALLOWED_TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  [WorkOrderStatus.DRAFT]: [
    WorkOrderStatus.SCHEDULED,
    WorkOrderStatus.CANCELLED,
  ],
  [WorkOrderStatus.SCHEDULED]: [
    WorkOrderStatus.IN_PROGRESS,
    WorkOrderStatus.CANCELLED,
  ],
  [WorkOrderStatus.IN_PROGRESS]: [
    WorkOrderStatus.COMPLETED,
    WorkOrderStatus.CANCELLED,
  ],
  [WorkOrderStatus.COMPLETED]: [],
  [WorkOrderStatus.CANCELLED]: [],
};

const BOM_DETAIL_INCLUDE = {
  finishedProduct: true,
  items: { include: { rawMaterial: true } },
};

const WORK_ORDER_DETAIL_INCLUDE = {
  bom: { include: BOM_DETAIL_INCLUDE },
  finishedProduct: true,
  location: true,
  designCatalog: {
    select: {
      id: true,
      sku: true,
      name: true,
      description: true,
      mediaUrls: true,
      specifications: true,
      defaultBomId: true,
    },
  },
  scrapLogs: {
    include: { product: true },
    orderBy: { createdAt: 'desc' as const },
  },
};

@Injectable()
export class ManufacturingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: FinanceService,
    private readonly notifications: NotificationsService,
  ) {}

  private tenantId(): number {
    const id = getCurrentTenantId();
    if (id == null) {
      throw new BadRequestException(tr('errors.noActiveOrganization'));
    }
    return id;
  }

  private async audit(userId: number, action: string, details: string) {
    await this.prisma.auditLog.create({
      data: { userId, action, details },
    });
  }

  // -------------------------------------------------------------------------
  // Bills of materials
  // -------------------------------------------------------------------------

  async listBoms(
    filters: { finishedProductId?: number; search?: string } = {},
  ) {
    const tenantId = this.tenantId();
    const where: Prisma.BillOfMaterialsWhereInput = {
      organizationId: tenantId,
    };
    if (filters.finishedProductId)
      where.finishedProductId = filters.finishedProductId;
    if (filters.search) {
      where.finishedProduct = {
        OR: [
          { baseName: { contains: filters.search, mode: 'insensitive' } },
          { brand: { contains: filters.search, mode: 'insensitive' } },
        ],
      };
    }
    return this.prisma.billOfMaterials.findMany({
      where,
      include: {
        finishedProduct: true,
        items: { include: { rawMaterial: true } },
        _count: { select: { workOrders: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getBom(id: number) {
    const tenantId = this.tenantId();
    const bom = await this.prisma.billOfMaterials.findFirst({
      where: { id, organizationId: tenantId },
      include: {
        finishedProduct: { include: { unit: true } },
        items: { include: { rawMaterial: { include: { unit: true } } } },
      },
    });
    if (!bom)
      throw new NotFoundException(tr('errors.manufacturing.bomNotFound'));
    return bom;
  }

  async createBom(dto: CreateBomDto) {
    const tenantId = this.tenantId();
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException(tr('errors.manufacturing.itemsRequired'));
    }
    const finished = await this.prisma.product.findFirst({
      where: { id: dto.finishedProductId, tenantId },
      select: { id: true, brand: true, baseName: true },
    });
    if (!finished) {
      throw new NotFoundException(
        tr('errors.manufacturing.finishedProductNotFound'),
      );
    }

    const seen = new Set<number>();
    const itemData: Array<{
      rawMaterialProductId: number;
      quantityRequired: number;
      unitId: number | null;
    }> = [];
    for (const line of dto.items) {
      if (line.rawMaterialProductId === dto.finishedProductId) {
        throw new BadRequestException(
          tr('errors.manufacturing.componentSameAsFinished'),
        );
      }
      if (seen.has(line.rawMaterialProductId)) {
        throw new BadRequestException(
          tr('errors.manufacturing.duplicateComponent'),
        );
      }
      seen.add(line.rawMaterialProductId);
      const raw = await this.prisma.product.findFirst({
        where: { id: line.rawMaterialProductId, tenantId },
        select: { id: true, unitId: true },
      });
      if (!raw)
        throw new NotFoundException(
          tr('errors.manufacturing.componentNotFound'),
        );
      itemData.push({
        rawMaterialProductId: line.rawMaterialProductId,
        quantityRequired: line.quantityRequired,
        unitId: line.unitId ?? raw.unitId ?? null,
      });
    }

    return this.prisma.billOfMaterials.create({
      data: {
        organizationId: tenantId,
        finishedProductId: dto.finishedProductId,
        quantityProduced: dto.quantityProduced ?? 1,
        scrapPercentage: dto.scrapPercentage ?? 0,
        notes: dto.notes ?? null,
        items: { create: itemData },
      },
      include: BOM_DETAIL_INCLUDE,
    });
  }

  async updateBom(id: number, dto: UpdateBomDto) {
    const tenantId = this.tenantId();
    const existing = await this.prisma.billOfMaterials.findFirst({
      where: { id, organizationId: tenantId },
      select: { id: true, finishedProductId: true },
    });
    if (!existing)
      throw new NotFoundException(tr('errors.manufacturing.bomNotFound'));

    if (
      dto.finishedProductId != null &&
      dto.finishedProductId !== existing.finishedProductId
    ) {
      const p = await this.prisma.product.findFirst({
        where: { id: dto.finishedProductId, tenantId },
        select: { id: true },
      });
      if (!p)
        throw new NotFoundException(
          tr('errors.manufacturing.finishedProductNotFound'),
        );
    }

    let itemData: Array<{
      rawMaterialProductId: number;
      quantityRequired: number;
      unitId: number | null;
    }> | null = null;
    if (dto.items !== undefined) {
      if (dto.items.length === 0) {
        throw new BadRequestException(tr('errors.manufacturing.itemsRequired'));
      }
      const finishedId = dto.finishedProductId ?? existing.finishedProductId;
      const seen = new Set<number>();
      itemData = [];
      for (const line of dto.items) {
        if (line.rawMaterialProductId === finishedId) {
          throw new BadRequestException(
            tr('errors.manufacturing.componentSameAsFinished'),
          );
        }
        if (seen.has(line.rawMaterialProductId)) {
          throw new BadRequestException(
            tr('errors.manufacturing.duplicateComponent'),
          );
        }
        seen.add(line.rawMaterialProductId);
        const raw = await this.prisma.product.findFirst({
          where: { id: line.rawMaterialProductId, tenantId },
          select: { id: true, unitId: true },
        });
        if (!raw) {
          throw new NotFoundException(
            tr('errors.manufacturing.componentNotFound'),
          );
        }
        itemData.push({
          rawMaterialProductId: line.rawMaterialProductId,
          quantityRequired: line.quantityRequired,
          unitId: line.unitId ?? raw.unitId ?? null,
        });
      }
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const data: Prisma.BillOfMaterialsUpdateInput = {
        ...(dto.quantityProduced != null
          ? { quantityProduced: dto.quantityProduced }
          : {}),
        ...(dto.scrapPercentage != null
          ? { scrapPercentage: dto.scrapPercentage }
          : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.finishedProductId != null
          ? { finishedProduct: { connect: { id: dto.finishedProductId } } }
          : {}),
        ...(itemData != null
          ? { items: { deleteMany: {}, create: itemData } }
          : {}),
      };
      return tx.billOfMaterials.update({
        where: { id },
        data,
        include: BOM_DETAIL_INCLUDE,
      });
    });
  }

  async deleteBom(id: number) {
    const tenantId = this.tenantId();
    const existing = await this.prisma.billOfMaterials.findFirst({
      where: { id, organizationId: tenantId },
      include: { _count: { select: { workOrders: true } } },
    });
    if (!existing)
      throw new NotFoundException(tr('errors.manufacturing.bomNotFound'));
    if (existing._count.workOrders > 0) {
      throw new BadRequestException(
        tr('errors.manufacturing.bomHasWorkOrders'),
      );
    }
    await this.prisma.billOfMaterials.delete({ where: { id } });
    return { id };
  }

  // -------------------------------------------------------------------------
  // Work orders
  // -------------------------------------------------------------------------

  async listWorkOrders(
    filters: {
      status?: string;
      locationId?: number;
      finishedProductId?: number;
    } = {},
  ) {
    const tenantId = this.tenantId();
    const where: Prisma.WorkOrderWhereInput = { organizationId: tenantId };
    if (filters.status) where.status = filters.status as WorkOrderStatus;
    if (filters.locationId) where.locationId = filters.locationId;
    if (filters.finishedProductId)
      where.finishedProductId = filters.finishedProductId;
    return this.prisma.workOrder.findMany({
      where,
      include: {
        bom: {
          select: {
            id: true,
            finishedProductId: true,
            quantityProduced: true,
            scrapPercentage: true,
          },
        },
        finishedProduct: true,
        location: true,
        designCatalog: {
          select: {
            id: true,
            sku: true,
            name: true,
            mediaUrls: true,
            specifications: true,
          },
        },
        _count: { select: { scrapLogs: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getWorkOrder(id: number) {
    const tenantId = this.tenantId();
    const wo = await this.prisma.workOrder.findFirst({
      where: { id, organizationId: tenantId },
      include: WORK_ORDER_DETAIL_INCLUDE,
    });
    if (!wo)
      throw new NotFoundException(tr('errors.manufacturing.workOrderNotFound'));
    return wo;
  }

  async createWorkOrder(dto: CreateWorkOrderDto, user: JwtPayload) {
    const tenantId = this.tenantId();
    const bom = await this.prisma.billOfMaterials.findFirst({
      where: { id: dto.bomId, organizationId: tenantId },
      select: { id: true, finishedProductId: true },
    });
    if (!bom)
      throw new NotFoundException(tr('errors.manufacturing.bomNotFound'));
    const location = await this.prisma.location.findFirst({
      where: { id: dto.locationId, tenantId },
      select: { id: true },
    });
    if (!location) {
      throw new NotFoundException(tr('errors.manufacturing.locationNotFound'));
    }
    if (dto.finishedVariantId != null) {
      const variant = await this.prisma.productVariant.findFirst({
        where: { id: dto.finishedVariantId, productId: bom.finishedProductId },
        select: { id: true },
      });
      if (!variant) {
        throw new BadRequestException(
          tr('errors.manufacturing.variantNotFound'),
        );
      }
    }
    return this.prisma.workOrder.create({
      data: {
        organizationId: tenantId,
        bomId: bom.id,
        finishedProductId: bom.finishedProductId,
        finishedVariantId: dto.finishedVariantId ?? null,
        targetQuantity: dto.targetQuantity,
        locationId: dto.locationId,
        batchNumber: dto.batchNumber?.trim() || null,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        notes: dto.notes ?? null,
        createdById: user.sub,
      },
      include: WORK_ORDER_DETAIL_INCLUDE,
    });
  }

  /**
   * Advance a work order through the lifecycle. Scheduling runs a material
   * availability check; completing runs the atomic backflush transaction.
   */
  async updateStatus(
    id: number,
    dto: UpdateWorkOrderStatusDto,
    user: JwtPayload,
  ) {
    const tenantId = this.tenantId();
    const wo = await this.prisma.workOrder.findFirst({
      where: { id, organizationId: tenantId },
      include: { bom: { include: BOM_DETAIL_INCLUDE } },
    });
    if (!wo)
      throw new NotFoundException(tr('errors.manufacturing.workOrderNotFound'));

    const target = dto.status;
    if (target === wo.status) return this.getWorkOrder(id);
    const allowed = ALLOWED_TRANSITIONS[wo.status] ?? [];
    if (!allowed.includes(target)) {
      throw new BadRequestException(
        tr('errors.manufacturing.invalidStatusTransition', {
          from: wo.status,
          to: target,
        }),
      );
    }

    if (target === WorkOrderStatus.SCHEDULED) {
      await this.assertMaterialAvailability(
        tenantId,
        wo.locationId,
        wo.targetQuantity,
        wo.bom,
      );
    }

    if (target === WorkOrderStatus.IN_PROGRESS) {
      await this.prisma.workOrder.update({
        where: { id },
        data: { status: target, startedAt: new Date() },
      });
      await this.audit(
        user.sub,
        'WORK_ORDER_STARTED',
        `Work order #${id} started`,
      );
      return this.getWorkOrder(id);
    }

    if (target === WorkOrderStatus.CANCELLED) {
      await this.prisma.workOrder.update({
        where: { id },
        data: { status: target },
      });
      await this.audit(
        user.sub,
        'WORK_ORDER_CANCELLED',
        `Work order #${id} cancelled`,
      );
      return this.getWorkOrder(id);
    }

    if (target === WorkOrderStatus.COMPLETED) {
      await this.completeWorkOrderTx(tenantId, id, user, dto);
      return this.getWorkOrder(id);
    }

    // SCHEDULED
    await this.prisma.workOrder.update({
      where: { id },
      data: { status: target },
    });
    await this.audit(
      user.sub,
      'WORK_ORDER_SCHEDULED',
      `Work order #${id} scheduled`,
    );
    return this.getWorkOrder(id);
  }

  private async assertMaterialAvailability(
    tenantId: number,
    locationId: number,
    targetQuantity: number,
    bom: {
      scrapPercentage: number;
      items: Array<{
        quantityRequired: number;
        rawMaterialProductId: number;
        rawMaterial?: { baseName: string } | null;
      }>;
    } | null,
  ) {
    if (!bom)
      throw new NotFoundException(tr('errors.manufacturing.bomNotFound'));
    const problems: string[] = [];
    for (const line of bom.items) {
      const required = requiredWithScrap(
        line.quantityRequired,
        targetQuantity,
        bom.scrapPercentage,
      );
      const inv = await inventoryFind(this.prisma, {
        productId: line.rawMaterialProductId,
        locationId,
        variantId: null,
      });
      const available = inv?.quantity ?? 0;
      if (available < required) {
        const name =
          line.rawMaterial?.baseName ?? `#${line.rawMaterialProductId}`;
        problems.push(`${name} (need ${required}, have ${available})`);
      }
    }
    if (problems.length > 0) {
      throw new BadRequestException(
        tr('errors.manufacturing.insufficientStock', {
          problems: problems.join('; '),
        }),
      );
    }
  }

  /**
   * Complete an IN_PROGRESS work order inside a single database transaction:
   * backflush scrap-adjusted raw stock, credit finished goods at WAC, create
   * the finished ProductBatch (FEFO) and store the COGM roll-up.
   */
  private async completeWorkOrderTx(
    tenantId: number,
    id: number,
    user: JwtPayload,
    opts?: {
      completedQuantity?: number;
      scrappedQuantity?: number;
      finishedLocationId?: number;
    },
  ) {
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const wo = await tx.workOrder.findFirst({
        where: { id, organizationId: tenantId },
        include: { bom: { include: BOM_DETAIL_INCLUDE } },
      });
      if (!wo)
        throw new NotFoundException(
          tr('errors.manufacturing.workOrderNotFound'),
        );
      if (wo.status !== WorkOrderStatus.IN_PROGRESS) {
        throw new BadRequestException(
          tr('errors.manufacturing.invalidStatusTransition', {
            from: wo.status,
            to: WorkOrderStatus.COMPLETED,
          }),
        );
      }

      const bom = wo.bom;
      const target = wo.targetQuantity;
      const previousFinishedScrap =
        (
          await tx.productionScrapLog.aggregate({
            where: { workOrderId: id, kind: ScrapKind.FINISHED },
            _sum: { quantity: true },
          })
        )._sum.quantity ?? 0;
      const scrapedNow = Math.max(0, opts?.scrappedQuantity ?? 0);
      const producedQty = round2(
        opts?.completedQuantity != null
          ? opts.completedQuantity
          : target - previousFinishedScrap - scrapedNow,
      );
      if (!(producedQty > 0)) {
        throw new BadRequestException(
          tr('errors.manufacturing.producedQtyZero'),
        );
      }
      if (producedQty + previousFinishedScrap + scrapedNow > target + 1e-9) {
        throw new BadRequestException(
          tr('errors.manufacturing.completionExceedsTarget', { target }),
        );
      }
      const finishedLocationId = opts?.finishedLocationId ?? wo.locationId;

      // 1) Backflush raw materials (scrap-adjusted) valued at location WAC.
      const issued: string[] = [];
      let totalCogm = 0;
      for (const line of bom.items) {
        const required = requiredWithScrap(
          line.quantityRequired,
          target,
          bom.scrapPercentage,
        );
        const inv = await tx.inventory.findFirst({
          where: {
            tenantId,
            productId: line.rawMaterialProductId,
            variantId: null,
            locationId: wo.locationId,
          },
        });
        const available = inv?.quantity ?? 0;
        if (available < required) {
          const name =
            line.rawMaterial?.baseName ?? `#${line.rawMaterialProductId}`;
          throw new BadRequestException(
            tr('errors.manufacturing.insufficientStock', {
              problems: `${name} (need ${required}, have ${available})`,
            }),
          );
        }
        const unitCost = inv?.avgCost ?? line.rawMaterial?.currentBuyPrice ?? 0;
        totalCogm += required * unitCost;
        if (inv) {
          await tx.inventory.update({
            where: { id: inv.id },
            data: { quantity: { decrement: required } },
          });
        }
        if (line.rawMaterial?.isPerishable) {
          await this.deductFefoBatches(tx, {
            tenantId,
            productId: line.rawMaterialProductId,
            locationId: wo.locationId,
            quantity: required,
          });
        }
        issued.push(
          `${line.rawMaterial?.baseName ?? `#${line.rawMaterialProductId}`} ${required}`,
        );
      }

      const cogmUnitCost = round2(totalCogm / producedQty);

      // 1.5) Finished units scrapped at completion (raises per-unit COGM).
      if (scrapedNow > 0) {
        await tx.productionScrapLog.create({
          data: {
            organizationId: tenantId,
            workOrderId: id,
            productId: wo.finishedProductId,
            kind: ScrapKind.FINISHED,
            quantity: scrapedNow,
            unitCost: cogmUnitCost,
            totalValue: round2(scrapedNow * cogmUnitCost),
            reason: 'Scrapped at completion',
            createdById: user.sub,
          },
        });
      }

      // 2) Credit the finished good into the target store (WAC merge).
      await inventoryUpsert(tx, {
        productId: wo.finishedProductId,
        variantId: wo.finishedVariantId ?? null,
        locationId: finishedLocationId,
        increment: producedQty,
        unitCost: cogmUnitCost,
        tenantId,
      });

      // 3) FEFO batch for the finished good (batchNumber + COGM unit cost).
      const batchNumber =
        wo.batchNumber?.trim() ||
        `BAT-${Date.now().toString(36).toUpperCase()}`;
      await this.upsertFinishedBatch(tx, {
        tenantId,
        productId: wo.finishedProductId,
        variantId: wo.finishedVariantId ?? null,
        locationId: finishedLocationId,
        batchNumber,
        expiryDate: wo.expiryDate ?? null,
        quantity: producedQty,
        unitCost: cogmUnitCost,
      });

      // 4) Mark the order complete and snapshot the COGM roll-up.
      await tx.workOrder.update({
        where: { id },
        data: {
          status: WorkOrderStatus.COMPLETED,
          producedQuantity: producedQty,
          completedAt: new Date(),
          batchNumber,
          expiryDate: wo.expiryDate ?? null,
          finishedLocationId,
          totalCogmCost: round2(totalCogm),
          cogmUnitCost,
        },
      });

      // If this work order belongs to a job that reached PRODUCTION, complete it.
      await this.autoCompleteLinkedJob(tx, tenantId, id);

      await tx.auditLog.create({
        data: {
          userId: user.sub,
          action: 'PRODUCTION_ISSUE',
          details: `Work order #${id} material issue: ${issued.join(', ')}`,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: user.sub,
          action: 'WORK_ORDER_COMPLETED',
          details: `Work order #${id} produced ${producedQty} ${bom.finishedProduct?.baseName ?? `#${wo.finishedProductId}`} — COGM ${round2(totalCogm)} (${cogmUnitCost}/unit, batch ${batchNumber})`,
        },
      });
    });
  }

  /**
   * FEFO: decrement `quantity` from the earliest-expiring batches of a raw
   * material at a location. Legacy product-level batches (locationId null)
   * remain available at every location.
   */
  private async deductFefoBatches(
    tx: Prisma.TransactionClient,
    args: {
      tenantId: number;
      productId: number;
      locationId: number;
      quantity: number;
    },
  ) {
    const { tenantId, productId, locationId, quantity } = args;
    let remaining = quantity;
    const batches = await tx.productBatch.findMany({
      where: { tenantId, productId, quantity: { gt: 0 } },
      orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
    });
    for (const batch of batches) {
      if (remaining <= 0) break;
      if (batch.locationId != null && batch.locationId !== locationId) continue;
      const take = Math.min(batch.quantity, remaining);
      await tx.productBatch.update({
        where: { id: batch.id },
        data: { quantity: { decrement: take } },
      });
      remaining -= take;
    }
    if (remaining > 0) {
      throw new BadRequestException(
        tr('errors.manufacturing.insufficientStock', {
          problems: `batch stock ${remaining} short`,
        }),
      );
    }
  }

  /**
   * Create the finished-good ProductBatch for a completion or merge it into an
   * existing batch (same product + batch number + location) with a quantity-
   * weighted unit-cost update. A batch number already used at another location
   * is rejected so FEFO allocation never mixes locations.
   */
  private async upsertFinishedBatch(
    tx: Prisma.TransactionClient,
    args: {
      tenantId: number;
      productId: number;
      variantId: number | null;
      locationId: number;
      batchNumber: string;
      expiryDate: Date | null;
      quantity: number;
      unitCost: number;
    },
  ) {
    const existing = await tx.productBatch.findFirst({
      where: {
        tenantId: args.tenantId,
        productId: args.productId,
        batchNumber: args.batchNumber,
      },
    });
    if (existing) {
      if (
        existing.locationId != null &&
        existing.locationId !== args.locationId
      ) {
        throw new BadRequestException(
          tr('errors.manufacturing.batchNumberInUse', {
            batchNumber: args.batchNumber,
          }),
        );
      }
      const mergedQty = (existing.quantity ?? 0) + args.quantity;
      const oldValue = (existing.quantity ?? 0) * (existing.unitCost ?? 0);
      const mergedCost =
        mergedQty > 0
          ? round2((oldValue + args.quantity * args.unitCost) / mergedQty)
          : args.unitCost;
      return tx.productBatch.update({
        where: { id: existing.id },
        data: {
          quantity: mergedQty,
          unitCost: mergedCost,
          locationId: existing.locationId ?? args.locationId,
          ...(args.expiryDate ? { expiryDate: args.expiryDate } : {}),
          manufactureDate: new Date(),
        },
      });
    }
    return tx.productBatch.create({
      data: {
        tenantId: args.tenantId,
        productId: args.productId,
        variantId: args.variantId,
        locationId: args.locationId,
        batchNumber: args.batchNumber,
        expiryDate: args.expiryDate,
        manufactureDate: new Date(),
        quantity: args.quantity,
        unitCost: args.unitCost,
      },
    });
  }

  /**
   * Log a defect/wastage entry against an in-progress work order. FINISHED
   * scrap reduces the quantity credited on completion; RAW scrap records the
   * material write-off at its location WAC.
   */
  async logScrap(id: number, dto: LogScrapDto, user: JwtPayload) {
    const tenantId = this.tenantId();
    const wo = await this.prisma.workOrder.findFirst({
      where: { id, organizationId: tenantId },
      select: {
        id: true,
        status: true,
        targetQuantity: true,
        finishedProductId: true,
        locationId: true,
        cogmUnitCost: true,
        bom: {
          select: { items: { select: { rawMaterialProductId: true } } },
        },
      },
    });
    if (!wo)
      throw new NotFoundException(tr('errors.manufacturing.workOrderNotFound'));
    if (wo.status !== WorkOrderStatus.IN_PROGRESS) {
      throw new BadRequestException(
        tr('errors.manufacturing.workOrderNotInProgress'),
      );
    }

    const kind = dto.kind ?? ScrapKind.RAW;
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, tenantId },
      select: { id: true, baseName: true, currentBuyPrice: true },
    });
    if (!product)
      throw new NotFoundException(tr('errors.manufacturing.productNotFound'));

    const isComponent = wo.bom?.items.some(
      (it) => it.rawMaterialProductId === product.id,
    );
    if (kind === ScrapKind.FINISHED && product.id !== wo.finishedProductId) {
      throw new BadRequestException(
        tr('errors.manufacturing.scrapProductNotInBom'),
      );
    }
    if (kind === ScrapKind.RAW && !isComponent) {
      throw new BadRequestException(
        tr('errors.manufacturing.scrapProductNotInBom'),
      );
    }

    let unitCost = 0;
    if (kind === ScrapKind.RAW) {
      const inv = await inventoryFind(this.prisma, {
        productId: product.id,
        locationId: wo.locationId,
        variantId: null,
      });
      unitCost = inv?.avgCost ?? product.currentBuyPrice ?? 0;
    } else {
      unitCost = wo.cogmUnitCost || product.currentBuyPrice || 0;
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (kind === ScrapKind.FINISHED) {
        const agg = await tx.productionScrapLog.aggregate({
          where: { workOrderId: id, kind: ScrapKind.FINISHED },
          _sum: { quantity: true },
        });
        if ((agg._sum.quantity ?? 0) + dto.quantity > wo.targetQuantity) {
          throw new BadRequestException(
            tr('errors.manufacturing.scrapExceedsTarget', {
              target: wo.targetQuantity,
            }),
          );
        }
      }
      const entry = await tx.productionScrapLog.create({
        data: {
          organizationId: tenantId,
          workOrderId: id,
          productId: product.id,
          kind,
          quantity: dto.quantity,
          unitCost,
          totalValue: round2(dto.quantity * unitCost),
          reason: dto.reason ?? null,
          createdById: user.sub,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: user.sub,
          action: 'PRODUCTION_SCRAP',
          details: `Work order #${id} scrap: ${dto.quantity} ${product.baseName} (${kind}) — ${round2(dto.quantity * unitCost)}`,
        },
      });
      return entry;
    });
  }

  // ---------------------------------------------------------------------------
  // Additional services & recorded service income
  // ---------------------------------------------------------------------------

  async listMfgServices(activeOnly = false) {
    const tenantId = this.tenantId();
    return this.prisma.mfgService.findMany({
      where: {
        organizationId: tenantId,
        ...(activeOnly ? { active: true } : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  async createMfgService(dto: CreateMfgServiceDto) {
    const tenantId = this.tenantId();
    try {
      return await this.prisma.mfgService.create({
        data: {
          organizationId: tenantId,
          name: dto.name,
          description: dto.description ?? null,
          pricingModel: dto.pricingModel,
          price: dto.price ?? 0,
          periodUnit: dto.periodUnit ?? null,
        },
      });
    } catch (err) {
      if (this.isDuplicate(err)) {
        throw new BadRequestException(
          tr('errors.manufacturing.duplicateService'),
        );
      }
      throw err;
    }
  }

  async updateMfgService(id: number, dto: UpdateMfgServiceDto) {
    const tenantId = this.tenantId();
    const existing = await this.prisma.mfgService.findFirst({
      where: { id, organizationId: tenantId },
    });
    if (!existing)
      throw new NotFoundException(tr('errors.manufacturing.serviceNotFound'));
    try {
      return await this.prisma.mfgService.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description }
            : {}),
          ...(dto.pricingModel !== undefined
            ? { pricingModel: dto.pricingModel }
            : {}),
          ...(dto.price !== undefined ? { price: dto.price } : {}),
          ...(dto.periodUnit !== undefined
            ? { periodUnit: dto.periodUnit }
            : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
      });
    } catch (err) {
      if (this.isDuplicate(err)) {
        throw new BadRequestException(
          tr('errors.manufacturing.duplicateService'),
        );
      }
      throw err;
    }
  }

  async deleteMfgService(id: number) {
    const tenantId = this.tenantId();
    const existing = await this.prisma.mfgService.findFirst({
      where: { id, organizationId: tenantId },
      include: { _count: { select: { incomes: true } } },
    });
    if (!existing)
      throw new NotFoundException(tr('errors.manufacturing.serviceNotFound'));
    if (existing._count.incomes > 0) {
      throw new BadRequestException(
        tr('errors.manufacturing.serviceHasIncomes'),
      );
    }
    await this.prisma.mfgService.delete({ where: { id } });
    return { id };
  }

  async listMfgServiceIncomes(
    filters: { serviceId?: number; startDate?: string; endDate?: string } = {},
  ) {
    const tenantId = this.tenantId();
    const where: Prisma.MfgServiceIncomeWhereInput = {
      organizationId: tenantId,
    };
    if (filters.serviceId) where.serviceId = filters.serviceId;
    if (filters.startDate || filters.endDate) {
      const cond: Prisma.DateTimeFilter = {};
      if (filters.startDate)
        cond.gte = new Date(`${filters.startDate}T00:00:00`);
      if (filters.endDate) cond.lte = new Date(`${filters.endDate}T23:59:59`);
      where.incomeDate = cond;
    }
    return this.prisma.mfgServiceIncome.findMany({
      where,
      include: { service: true },
      orderBy: { incomeDate: 'desc' },
    });
  }

  async recordMfgServiceIncome(
    dto: RecordMfgServiceIncomeDto,
    user: JwtPayload,
  ) {
    const tenantId = this.tenantId();
    const service = await this.prisma.mfgService.findFirst({
      where: { id: dto.serviceId, organizationId: tenantId, active: true },
    });
    if (!service)
      throw new NotFoundException(tr('errors.manufacturing.serviceNotFound'));
    const quantity = dto.quantity ?? 1;
    const amount = Math.round(service.price * quantity * 100) / 100;
    const incomeAccount = await this.prisma.account.findFirst({
      where: {
        tenantId,
        type: 'INCOME' as any,
        name: { in: ['Production Revenue', 'Other Income'] },
      },
      select: { id: true },
    });
    if (!incomeAccount) {
      throw new BadRequestException(
        tr('errors.manufacturing.incomeAccountMissing'),
      );
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const income = await tx.mfgServiceIncome.create({
        data: {
          organizationId: tenantId,
          serviceId: service.id,
          quantity,
          periodStart: dto.periodStart ? new Date(dto.periodStart) : null,
          periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : null,
          amount,
          incomeDate: dto.incomeDate ? new Date(dto.incomeDate) : new Date(),
          notes: dto.notes ?? null,
          recordedById: user.sub,
        },
      });
      await this.finance
        .postManufacturingServiceIncome({
          tx,
          tenantId,
          sourceId: income.id,
          accountId: incomeAccount.id,
          description: `Service income: ${service.name}${dto.notes ? ` — ${dto.notes}` : ''}`,
          amount,
          incomeDate: income.incomeDate,
          createdById: user.sub,
        })
        .catch(() => null);
      return tx.mfgServiceIncome.findUnique({
        where: { id: income.id },
        include: { service: true },
      });
    });
  }

  private isDuplicate(err: unknown): boolean {
    const e = err as { code?: string };
    return e?.code === 'P2002';
  }

  // ---------------------------------------------------------------------------
  // Manufacturing job orders (customer-facing pipeline)
  // ---------------------------------------------------------------------------

  async listJobs(filters: { stage?: string; search?: string } = {}) {
    const tenantId = this.tenantId();
    const where: Prisma.ManufacturingOrderWhereInput = {
      organizationId: tenantId,
    };
    if (filters.stage) where.stage = filters.stage as MfgOrderStage;
    if (filters.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { customerName: { contains: filters.search, mode: 'insensitive' } },
        { jobNumber: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.manufacturingOrder.findMany({
      where,
      include: {
        bom: {
          select: {
            id: true,
            finishedProductId: true,
            finishedProduct: { select: { baseName: true } },
          },
        },
        workOrder: {
          select: {
            id: true,
            status: true,
            producedQuantity: true,
            totalCogmCost: true,
            cogmUnitCost: true,
          },
        },
        designCatalog: {
          select: {
            id: true,
            sku: true,
            name: true,
            mediaUrls: true,
            specifications: true,
            category: { select: { id: true, name: true } },
          },
        },
        _count: { select: { history: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getJob(id: number) {
    const tenantId = this.tenantId();
    const job = await this.prisma.manufacturingOrder.findFirst({
      where: { id, organizationId: tenantId },
      include: {
        bom: { include: { finishedProduct: true } },
        workOrder: true,
        designCatalog: {
          select: {
            id: true,
            sku: true,
            name: true,
            description: true,
            mediaUrls: true,
            specifications: true,
            defaultBomId: true,
            category: { select: { id: true, name: true } },
          },
        },
        history: { orderBy: { createdAt: 'asc' as const } },
        flow: {
          include: {
            steps: {
              orderBy: { sortOrder: 'asc' as const },
              include: { team: { select: { id: true, name: true } }, operations: { orderBy: { sortOrder: "asc" } } },
            },
          },
        },
        handovers: { orderBy: { createdAt: 'asc' as const } },
      },
    });
    if (!job)
      throw new NotFoundException(tr('errors.manufacturing.jobNotFound'));
    // Resolve actor names so the history/handover timeline reads clearly.
    const actorIds = [
      ...(job.history ?? []).map((h) => h.changedById),
      ...(job.handovers ?? []).map((h) => h.changedById),
    ].filter((id): id is number => id != null);
    const actorNameById = new Map<number, string>();
    if (actorIds.length) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: [...new Set(actorIds)] } },
        select: { id: true, name: true },
      });
      users.forEach((u) => actorNameById.set(u.id, u.name));
    }
    return {
      ...job,
      history: (job.history ?? []).map((h) => ({
        ...h,
        actorName: h.changedById ? actorNameById.get(h.changedById) ?? null : null,
      })),
      handovers: (job.handovers ?? []).map((h) => ({
        ...h,
        actorName: h.changedById ? actorNameById.get(h.changedById) ?? null : null,
      })),
    };
  }

  async createJob(dto: CreateManufacturingOrderDto, user: JwtPayload) {
    const tenantId = this.tenantId();
    if (dto.bomId != null) {
      const bom = await this.prisma.billOfMaterials.findFirst({
        where: { id: dto.bomId, organizationId: tenantId },
        select: { id: true },
      });
      if (!bom)
        throw new NotFoundException(tr('errors.manufacturing.bomNotFound'));
    }
    // Design Catalog: validate the linked item and auto-apply its default BOM
    // when the caller didn't choose one explicitly.
    let designDefaultBomId: number | null | undefined;
    if (dto.designCatalogId != null) {
      const design = await this.prisma.designCatalog.findFirst({
        where: { id: dto.designCatalogId, organizationId: tenantId },
        select: { id: true, defaultBomId: true },
      });
      if (!design)
        throw new NotFoundException('Design catalog item not found');
      if (dto.bomId == null && design.defaultBomId != null) {
        designDefaultBomId = design.defaultBomId;
      }
    }
    // Optional production flow: the new order starts on step 0 of that flow.
    let firstStep: {
      teamId: number | null;
      isProductionStep: boolean;
      operations?: Array<{ id: number }>;
    } | null = null;
    if (dto.flowId != null) {
      const flow = await this.prisma.mfgFlow.findFirst({
        where: { id: dto.flowId, organizationId: tenantId, active: true },
        include: { steps: { orderBy: { sortOrder: 'asc' as const }, include: { operations: { orderBy: { sortOrder: 'asc' as const } } } } },
      });
      if (!flow)
        throw new NotFoundException(tr('errors.manufacturing.flowNotFound'));
      const s = flow.steps[0];
      firstStep = s
        ? {
            teamId: s.teamId ?? null,
            isProductionStep: s.isProductionStep,
            operations: s.operations ?? [],
          }
        : null;
    }
    const jobNumber = `JB-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const job = await tx.manufacturingOrder.create({
        data: {
          organizationId: tenantId,
          jobNumber,
          title: dto.title,
          customerName: dto.customerName ?? null,
          bomId: dto.bomId ?? designDefaultBomId ?? null,
          designCatalogId: dto.designCatalogId ?? null,
          targetQuantity: dto.targetQuantity ?? null,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          notes: dto.notes ?? null,
          createdById: user.sub,
        },
      });
      await tx.manufacturingOrderHistory.create({
        data: {
          organizationId: tenantId,
          orderId: job.id,
          toStage: MfgOrderStage.DESIGN,
          changedById: user.sub,
        },
      });
      if (dto.flowId != null && firstStep) {
        await this.enterFlowStep(
          tx as any,
          tenantId,
          {
            id: job.id,
            jobNumber,
            title: job.title,
            bomId: job.bomId,
            targetQuantity: job.targetQuantity,
            workOrderId: null,
          },
          dto.flowId,
          0,
          firstStep,
          user,
        );
        await tx.mfgOrderHandover.create({
          data: {
            organizationId: tenantId,
            orderId: job.id,
            fromTeamId: null,
            toTeamId: firstStep.teamId,
            stepIndex: 0,
            changedById: user.sub,
          },
        });
      }
      return tx.manufacturingOrder.findFirst({
        where: { id: job.id, organizationId: tenantId },
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Order CRUD: detail edits + deletion (kept to the pre-production pipeline so
  // cost/production history stays intact)
  // ---------------------------------------------------------------------------

  async updateJob(id: number, dto: UpdateManufacturingOrderDto, user: JwtPayload) {
    const tenantId = this.tenantId();
    const job = await this.prisma.manufacturingOrder.findFirst({
      where: { id, organizationId: tenantId },
      select: { id: true, stage: true, jobNumber: true },
    });
    if (!job)
      throw new NotFoundException(tr('errors.manufacturing.jobNotFound'));

    const lockedStages = [
      MfgOrderStage.PRODUCTION,
      MfgOrderStage.COMPLETED,
      MfgOrderStage.CANCELLED,
    ] as MfgOrderStage[];
    if (lockedStages.includes(job.stage))
      throw new BadRequestException(tr('errors.manufacturing.jobLocked'));

    if (dto.title !== undefined && !dto.title.trim()) {
      throw new BadRequestException(
        tr('errors.manufacturing.jobTitleRequired'),
      );
    }
    if (dto.bomId != null) {
      const bom = await this.prisma.billOfMaterials.findFirst({
        where: { id: dto.bomId, organizationId: tenantId },
        select: { id: true },
      });
      if (!bom)
        throw new NotFoundException(tr('errors.manufacturing.bomNotFound'));
    }

    // Design Catalog: validate the linked item and auto-fill the default BOM
    // when the design changes without an explicit BOM choice.
    let autoBomId: number | null | undefined;
    if (dto.designCatalogId !== undefined && dto.designCatalogId != null) {
      const design = await this.prisma.designCatalog.findFirst({
        where: { id: dto.designCatalogId, organizationId: tenantId },
        select: { id: true, defaultBomId: true },
      });
      if (!design)
        throw new NotFoundException('Design catalog item not found');
      if (dto.bomId === undefined && design.defaultBomId != null) {
        autoBomId = design.defaultBomId;
      }
    }

    const updated = await this.prisma.manufacturingOrder.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.customerName !== undefined
          ? { customerName: (dto.customerName ?? '').trim() || null }
          : {}),
        ...(dto.bomId !== undefined
          ? { bomId: dto.bomId ?? null }
          : autoBomId !== undefined
            ? { bomId: autoBomId }
            : {}),
        ...(dto.designCatalogId !== undefined
          ? { designCatalogId: dto.designCatalogId ?? null }
          : {}),
        ...(dto.targetQuantity !== undefined
          ? { targetQuantity: dto.targetQuantity }
          : {}),
        ...(dto.dueDate !== undefined
          ? { dueDate: dto.dueDate ? new Date(dto.dueDate) : null }
          : {}),
        ...(dto.notes !== undefined
          ? { notes: dto.notes?.trim() || null }
          : {}),
      },
    });
    await this.audit(
      user.sub,
      'JOB_UPDATED',
      `Order ${job.jobNumber} details updated`,
    );
    return updated;
  }

  async deleteJob(id: number, user: JwtPayload) {
    const tenantId = this.tenantId();
    const job = await this.prisma.manufacturingOrder.findFirst({
      where: { id, organizationId: tenantId },
      select: {
        id: true,
        stage: true,
        jobNumber: true,
        completedAt: true,
        workOrder: { select: { status: true } },
      },
    });
    if (!job)
      throw new NotFoundException(tr('errors.manufacturing.jobNotFound'));

    const wo = job.workOrder as { status?: string } | null;
    const deletableStages = [
      MfgOrderStage.DESIGN,
      MfgOrderStage.PURCHASING_MATERIALS,
      MfgOrderStage.MATERIAL_READY,
      MfgOrderStage.QUEUED,
      MfgOrderStage.CANCELLED,
    ] as MfgOrderStage[];
    const productionStarted =
      wo?.status === 'IN_PROGRESS' || wo?.status === 'COMPLETED';
    if (
      !deletableStages.includes(job.stage) ||
      job.completedAt != null ||
      productionStarted
    ) {
      throw new BadRequestException(
        tr('errors.manufacturing.jobCannotDelete'),
      );
    }
    // History rows and handovers cascade; a leftover draft/scheduled work order
    // is detached by the FK (onDelete: SetNull).
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.manufacturingOrder.delete({ where: { id } });
    });
    await this.audit(user.sub, 'JOB_DELETED', `Order ${job.jobNumber} deleted`);
    return { id };
  }

  async updateJobStage(
    id: number,
    dto: UpdateManufacturingOrderStageDto,
    user: JwtPayload,
  ) {
    const tenantId = this.tenantId();
    const job = await this.prisma.manufacturingOrder.findFirst({
      where: { id, organizationId: tenantId },
      include: { bom: { select: { finishedProductId: true } } },
    });
    if (!job)
      throw new NotFoundException(tr('errors.manufacturing.jobNotFound'));
    const target = dto.stage;
    if (target === job.stage) return this.getJob(id);

    const allowed: Record<MfgOrderStage, MfgOrderStage[]> = {
      [MfgOrderStage.DESIGN]: [
        MfgOrderStage.PURCHASING_MATERIALS,
        MfgOrderStage.CANCELLED,
      ],
      [MfgOrderStage.PURCHASING_MATERIALS]: [
        MfgOrderStage.MATERIAL_READY,
        MfgOrderStage.CANCELLED,
      ],
      [MfgOrderStage.MATERIAL_READY]: [
        MfgOrderStage.QUEUED,
        MfgOrderStage.CANCELLED,
      ],
      [MfgOrderStage.QUEUED]: [MfgOrderStage.PRODUCTION],
      [MfgOrderStage.PRODUCTION]: [MfgOrderStage.COMPLETED],
      [MfgOrderStage.COMPLETED]: [],
      [MfgOrderStage.CANCELLED]: [],
    };
    if (!(allowed[job.stage] ?? []).includes(target)) {
      throw new BadRequestException(
        tr('errors.manufacturing.invalidJobStage', {
          from: job.stage,
          to: target,
        }),
      );
    }

    let workOrderId = job.workOrderId;
    if (target === MfgOrderStage.PRODUCTION && !job.workOrderId) {
      if (!job.bomId || !job.targetQuantity || !job.bom) {
        throw new BadRequestException(tr('errors.manufacturing.jobNeedsBom'));
      }
      const location = await this.prisma.location.findFirst({
        where: { tenantId },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      if (!location)
        throw new NotFoundException(
          tr('errors.manufacturing.locationNotFound'),
        );
      const wo = await this.prisma.workOrder.create({
        data: {
          organizationId: tenantId,
          bomId: job.bomId,
          finishedProductId: job.bom.finishedProductId,
          targetQuantity: job.targetQuantity,
          locationId: location.id,
          notes: `Job ${job.jobNumber}: ${job.title}`,
          designCatalogId: job.designCatalogId ?? null,
          createdById: user.sub,
        },
      });
      workOrderId = wo.id;
    }

    // When a job moves to COMPLETED, snapshot what the linked work order
    // actually produced (quantity + COGM) so job lists/detail, material
    // variance and reports all reflect real production instead of the target.
    let producedSnapshot: {
      producedQuantity?: number | null;
      totalCogmCost?: number;
      cogmUnitCost?: number;
    } = {};
    if (target === MfgOrderStage.COMPLETED && workOrderId) {
      const wo = await this.prisma.workOrder.findFirst({
        where: { id: workOrderId, organizationId: tenantId },
        select: {
          producedQuantity: true,
          totalCogmCost: true,
          cogmUnitCost: true,
        },
      });
      if (wo && (wo.producedQuantity ?? 0) > 0) {
        producedSnapshot = {
          producedQuantity: wo.producedQuantity,
          totalCogmCost: wo.totalCogmCost ?? 0,
          cogmUnitCost: wo.cogmUnitCost ?? 0,
        };
      }
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.manufacturingOrder.update({
        where: { id },
        data: {
          stage: target,
          workOrderId,
          ...(target === MfgOrderStage.COMPLETED
            ? { ...producedSnapshot, completedAt: new Date() }
            : {}),
        },
      });
      await tx.manufacturingOrderHistory.create({
        data: {
          organizationId: tenantId,
          orderId: id,
          fromStage: job.stage,
          toStage: target,
          note: dto.note ?? null,
          changedById: user.sub,
        },
      });
      return tx.manufacturingOrder.findFirst({
        where: { id, organizationId: tenantId },
        include: {
          bom: { include: { finishedProduct: true } },
          workOrder: true,
          designCatalog: {
            select: {
              id: true,
              sku: true,
              name: true,
              mediaUrls: true,
              specifications: true,
              category: { select: { id: true, name: true } },
            },
          },
          history: { orderBy: { createdAt: 'asc' as const } },
        },
      });
    });
  }

  /** Called after a WorkOrder completes so the linked job auto-advances. */
  async autoCompleteLinkedJob(
    tx: Prisma.TransactionClient,
    tenantId: number,
    workOrderId: number,
  ) {
    const job = await tx.manufacturingOrder.findFirst({
      where: {
        organizationId: tenantId,
        workOrderId,
        stage: MfgOrderStage.PRODUCTION,
      },
      include: {
        flow: {
          include: { steps: { orderBy: { sortOrder: 'asc' as const }, include: { operations: { orderBy: { sortOrder: 'asc' as const } } } } },
        },
      },
    });
    if (!job) return;
    // Snapshot the real output + COGM from the completed work order.
    const wo = await tx.workOrder.findFirst({
      where: { id: workOrderId, organizationId: tenantId },
      select: {
        producedQuantity: true,
        totalCogmCost: true,
        cogmUnitCost: true,
        completedAt: true,
      },
    });
    const producedQuantity = wo?.producedQuantity ?? null;
    const totalCogmCost = wo?.totalCogmCost ?? 0;
    const cogmUnitCost = wo?.cogmUnitCost ?? 0;
    const snapshot = { producedQuantity, totalCogmCost, cogmUnitCost };
    const completedNote =
      totalCogmCost > 0
        ? `Work order completed — produced ${producedQuantity}, COGM ${totalCogmCost} (${cogmUnitCost}/unit)`
        : 'Linked work order completed';

    // Flow order: if the build finished before the final step, auto-advance the
    // order to the next team instead of closing it. Only the final step (or a
    // job that is not on a flow) completes the order.
    const flowSteps = job.flow?.steps ?? [];
    const currentStep =
      job.currentStepIndex != null && job.currentStepIndex >= 0
        ? flowSteps[job.currentStepIndex]
        : undefined;
    const currentOps = currentStep?.operations ?? [];
    const curOpIndex =
      job.currentOperationId != null
        ? currentOps.findIndex((o: any) => o.id === job.currentOperationId)
        : -1;
    // The production step has more operations left → advance to the next one.
    if (currentOps.length > 0 && curOpIndex >= 0 && curOpIndex + 1 < currentOps.length) {
      const nextOp = currentOps[curOpIndex + 1];
      await tx.manufacturingOrder.update({
        where: { id: job.id },
        data: { ...snapshot, currentOperationId: nextOp.id, stage: MfgOrderStage.PRODUCTION },
      });
      await tx.manufacturingOrderHistory.create({
        data: {
          organizationId: tenantId,
          orderId: job.id,
          fromStage: MfgOrderStage.PRODUCTION,
          toStage: MfgOrderStage.PRODUCTION,
          note: `${completedNote} — next operation: ${nextOp.name}`,
        },
      });
      return;
    }
    const nextIndex = (job.currentStepIndex ?? -1) + 1;
    const nextStep = job.currentStepIndex != null && job.currentStepIndex >= 0 ? flowSteps[nextIndex] : null;
    if (job.flowId != null && nextStep) {
      await tx.manufacturingOrder.update({
        where: { id: job.id },
        data: {
          ...snapshot,
          currentStepIndex: nextIndex,
          currentTeamId: nextStep.teamId ?? null,
          currentOperationId: nextStep.operations?.[0]?.id ?? null,
          stage: MfgOrderStage.PRODUCTION, // still inside the build pipeline
        },
      });
      await tx.mfgOrderHandover.create({
        data: {
          organizationId: tenantId,
          orderId: job.id,
          fromTeamId: job.currentTeamId,
          toTeamId: nextStep.teamId ?? null,
          stepIndex: nextIndex,
          note: completedNote,
        },
      });
      await tx.manufacturingOrderHistory.create({
        data: {
          organizationId: tenantId,
          orderId: job.id,
          fromStage: MfgOrderStage.PRODUCTION,
          toStage: MfgOrderStage.PRODUCTION,
          note: completedNote,
        },
      });
      return;
    }

    await tx.manufacturingOrder.update({
      where: { id: job.id },
      data: {
        ...snapshot,
        currentOperationId: null,
        stage: MfgOrderStage.COMPLETED,
        completedAt: wo?.completedAt ?? new Date(),
      },
    });
    await tx.manufacturingOrderHistory.create({
      data: {
        organizationId: tenantId,
        orderId: job.id,
        fromStage: MfgOrderStage.PRODUCTION,
        toStage: MfgOrderStage.COMPLETED,
        note: completedNote,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Materials: issue to worker & return (job/work-order linked, variance-ready)
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Design Catalog (product/design registry + order/work-order linking)
  // ---------------------------------------------------------------------------

  async listDesignCategories() {
    const tenantId = this.tenantId();
    const cats = await this.prisma.designCategory.findMany({
      where: { organizationId: tenantId },
      include: { _count: { select: { items: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const nodes = cats.map((c) => ({ ...c, children: [] as any[] }));
    const byId = new Map<number, any>(nodes.map((n) => [n.id, n]));
    const tree: any[] = [];
    for (const n of nodes) {
      const parent = n.parentId != null ? byId.get(n.parentId) : undefined;
      if (parent) parent.children.push(n);
      else tree.push(n);
    }
    return { categories: cats, tree };
  }

  async createDesignCategory(dto: CreateDesignCategoryDto, user: JwtPayload) {
    const tenantId = this.tenantId();
    if (dto.parentId != null) {
      const parent = await this.prisma.designCategory.findFirst({
        where: { id: dto.parentId, organizationId: tenantId },
        select: { id: true },
      });
      if (!parent) throw new NotFoundException('Parent category not found');
    }
    try {
      return await this.prisma.designCategory.create({
        data: {
          organizationId: tenantId,
          name: dto.name.trim(),
          parentId: dto.parentId ?? null,
          description: dto.description?.trim() || null,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002')
        throw new BadRequestException(
          'A category with this name already exists at this level',
        );
      throw e;
    }
  }

  async updateDesignCategory(
    id: number,
    dto: UpdateDesignCategoryDto,
    user: JwtPayload,
  ) {
    const tenantId = this.tenantId();
    const existing = await this.prisma.designCategory.findFirst({
      where: { id, organizationId: tenantId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Design category not found');
    if (dto.parentId === id)
      throw new BadRequestException('A category cannot be its own parent');
    if (dto.parentId != null) {
      // Guard against cycles by walking up from the requested parent.
      let cursor: number | null = dto.parentId;
      let hops = 0;
      while (cursor && hops < 50) {
        if (cursor === id)
          throw new BadRequestException(
            'Cannot move a category under one of its own descendants',
          );
        const row = await this.prisma.designCategory.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
        cursor = row?.parentId ?? null;
        hops += 1;
      }
      const parent = await this.prisma.designCategory.findFirst({
        where: { id: dto.parentId, organizationId: tenantId },
        select: { id: true },
      });
      if (!parent) throw new NotFoundException('Parent category not found');
    }
    try {
      return await this.prisma.designCategory.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.parentId !== undefined
            ? { parentId: dto.parentId ?? null }
            : {}),
          ...(dto.description !== undefined
            ? { description: dto.description?.trim() || null }
            : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002')
        throw new BadRequestException(
          'A category with this name already exists at this level',
        );
      throw e;
    }
  }

  async deleteDesignCategory(id: number, user: JwtPayload) {
    const tenantId = this.tenantId();
    const existing = await this.prisma.designCategory.findFirst({
      where: { id, organizationId: tenantId },
      select: { id: true, _count: { select: { children: true, items: true } } },
    });
    if (!existing) throw new NotFoundException('Design category not found');
    if ((existing._count?.children ?? 0) > 0 || (existing._count?.items ?? 0) > 0)
      throw new BadRequestException(
        'Cannot delete a category that still contains sub-categories or catalog items',
      );
    await this.prisma.designCategory.delete({ where: { id } });
    return { ok: true };
  }


  async listDesignCatalogItems(
    filters: { categoryId?: number; search?: string } = {},
  ) {
    const tenantId = this.tenantId();
    const where: any = { organizationId: tenantId };
    if (filters.categoryId) where.categoryId = filters.categoryId;
    if (filters.search?.trim()) {
      const q = filters.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { sku: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.designCatalog.findMany({
      where,
      include: {
        category: { select: { id: true, name: true, parentId: true } },
      },
      orderBy: [{ categoryId: 'asc' }, { name: 'asc' }],
    });
    const bomIds = [
      ...new Set(
        rows
          .map((r) => r.defaultBomId)
          .filter((x): x is number => x != null),
      ),
    ];
    const productIds = [
      ...new Set(
        rows.map((r) => r.productId).filter((x): x is number => x != null),
      ),
    ];
    const [boms, products] = await Promise.all([
      bomIds.length
        ? this.prisma.billOfMaterials.findMany({
            where: { organizationId: tenantId, id: { in: bomIds } },
            select: {
              id: true,
              quantityProduced: true,
              finishedProduct: { select: { baseName: true } },
            },
          })
        : Promise.resolve(
            [] as {
              id: number;
              quantityProduced: number;
              finishedProduct: { baseName: string };
            }[],
          ),
      productIds.length
        ? this.prisma.product.findMany({
            where: { tenantId, id: { in: productIds } },
            select: { id: true, brand: true, baseName: true, sku: true },
          })
        : Promise.resolve(
            [] as { id: number; brand: string; baseName: string; sku: string }[],
          ),
    ]);
    const bomById = new Map(boms.map((b) => [b.id, b]));
    const productById = new Map(products.map((p) => [p.id, p]));
    return rows.map((r) => ({
      ...r,
      defaultBom: r.defaultBomId ? bomById.get(r.defaultBomId) ?? null : null,
      product: r.productId ? productById.get(r.productId) ?? null : null,
    }));
  }

  async createDesignCatalogItem(
    dto: CreateDesignCatalogItemDto,
    user: JwtPayload,
  ) {
    const tenantId = this.tenantId();
    await this.assertDesignCatalogRefs(
      dto.categoryId,
      dto.defaultBomId,
      dto.productId,
    );
    if (dto.sku?.trim()) {
      const clash = await this.prisma.designCatalog.findFirst({
        where: { organizationId: tenantId, sku: dto.sku.trim() },
      });
      if (clash) throw new BadRequestException('This SKU is already in use');
    }
    return this.prisma.designCatalog.create({
      data: {
        organizationId: tenantId,
        categoryId: dto.categoryId ?? null,
        sku: dto.sku?.trim() || null,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        specifications: (dto.specifications as any) ?? undefined,
        mediaUrls: dto.mediaUrls ?? [],
        defaultBomId: dto.defaultBomId ?? null,
        productId: dto.productId ?? null,
        createdById: user.sub,
      },
      include: {
        category: { select: { id: true, name: true, parentId: true } },
      },
    });
  }


  async updateDesignCatalogItem(
    id: number,
    dto: UpdateDesignCatalogItemDto,
    user: JwtPayload,
  ) {
    const tenantId = this.tenantId();
    const existing = await this.prisma.designCatalog.findFirst({
      where: { id, organizationId: tenantId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Design catalog item not found');
    await this.assertDesignCatalogRefs(
      dto.categoryId,
      dto.defaultBomId,
      dto.productId,
    );
    if (dto.sku?.trim()) {
      const clash = await this.prisma.designCatalog.findFirst({
        where: { organizationId: tenantId, sku: dto.sku.trim(), NOT: { id } },
      });
      if (clash) throw new BadRequestException('This SKU is already in use');
    }
    return this.prisma.designCatalog.update({
      where: { id },
      data: {
        ...(dto.categoryId !== undefined
          ? { categoryId: dto.categoryId ?? null }
          : {}),
        ...(dto.sku !== undefined ? { sku: dto.sku?.trim() || null } : {}),
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description?.trim() || null }
          : {}),
        ...(dto.specifications !== undefined
          ? { specifications: (dto.specifications as any) ?? null }
          : {}),
        ...(dto.mediaUrls !== undefined ? { mediaUrls: dto.mediaUrls } : {}),
        ...(dto.defaultBomId !== undefined
          ? { defaultBomId: dto.defaultBomId ?? null }
          : {}),
        ...(dto.productId !== undefined
          ? { productId: dto.productId ?? null }
          : {}),
      },
      include: {
        category: { select: { id: true, name: true, parentId: true } },
      },
    });
  }

  async deleteDesignCatalogItem(id: number, user: JwtPayload) {
    const tenantId = this.tenantId();
    const existing = await this.prisma.designCatalog.findFirst({
      where: { id, organizationId: tenantId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Design catalog item not found');
    const [orders, workOrders] = await Promise.all([
      this.prisma.manufacturingOrder.count({
        where: { organizationId: tenantId, designCatalogId: id },
      }),
      this.prisma.workOrder.count({
        where: { organizationId: tenantId, designCatalogId: id },
      }),
    ]);
    if (orders > 0 || workOrders > 0)
      throw new BadRequestException(
        'This design is linked to job orders or work orders and cannot be deleted',
      );
    await this.prisma.designCatalog.delete({ where: { id } });
    return { ok: true };
  }

  private async assertDesignCatalogRefs(
    categoryId?: number | null,
    defaultBomId?: number | null,
    productId?: number | null,
  ) {
    const tenantId = this.tenantId();
    if (categoryId != null) {
      const category = await this.prisma.designCategory.findFirst({
        where: { id: categoryId, organizationId: tenantId },
        select: { id: true },
      });
      if (!category) throw new NotFoundException('Category not found');
    }
    if (defaultBomId != null) {
      const bom = await this.prisma.billOfMaterials.findFirst({
        where: { id: defaultBomId, organizationId: tenantId },
        select: { id: true },
      });
      if (!bom)
        throw new NotFoundException(
          'Bill of materials not found for this organization',
        );
    }
    if (productId != null) {
      const product = await this.prisma.product.findFirst({
        where: { id: productId, tenantId },
        select: { id: true },
      });
      if (!product) throw new NotFoundException('Product not found');
    }
  }

  async issueMaterial(dto: CreateMaterialIssueDto, user: JwtPayload) {
    const tenantId = this.tenantId();
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, tenantId },
      select: { id: true },
    });
    if (!product)
      throw new NotFoundException(tr('errors.manufacturing.productNotFound'));

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const inv = await tx.inventory.findFirst({
        where: {
          tenantId,
          productId: dto.productId,
          variantId: null,
          locationId: dto.locationId,
        },
      });
      const available = inv?.quantity ?? 0;
      if (available < dto.quantity) {
        throw new BadRequestException(
          tr('errors.manufacturing.insufficientStock', {
            problems: `available ${available}`,
          }),
        );
      }
      const unitCost = inv?.avgCost ?? 0;
      if (inv) {
        await tx.inventory.update({
          where: { id: inv.id },
          data: { quantity: { decrement: dto.quantity } },
        });
      }
      return tx.materialIssue.create({
        data: {
          organizationId: tenantId,
          workOrderId: dto.workOrderId ?? null,
          jobId: dto.jobId ?? null,
          productId: dto.productId,
          locationId: dto.locationId,
          issuedToId: dto.issuedToId ?? null,
          issuedById: user.sub,
          quantity: dto.quantity,
          unitCost,
          notes: dto.notes ?? null,
        },
        include: { returns: true },
      });
    });
  }

  async returnMaterial(dto: ReturnMaterialDto, user: JwtPayload) {
    const tenantId = this.tenantId();
    const issue = dto.issueId
      ? await this.prisma.materialIssue.findFirst({
          where: { id: dto.issueId, organizationId: tenantId },
        })
      : null;
    const productId = dto.productId ?? issue?.productId;
    if (!productId)
      throw new BadRequestException(tr('errors.manufacturing.productNotFound'));

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (!issue)
        throw new BadRequestException(tr('errors.manufacturing.issueNotFound'));
      await inventoryUpsert(tx, {
        productId,
        locationId: issue.locationId,
        increment: dto.quantity,
        unitCost: issue.unitCost ?? null,
        tenantId,
      });
      const ret = await tx.materialReturn.create({
        data: {
          organizationId: tenantId,
          issueId: issue.id,
          productId,
          quantity: dto.quantity,
          returnedById: user.sub,
          note: dto.note ?? null,
        },
      });
      if (issue) {
        const total = await tx.materialReturn.aggregate({
          where: { organizationId: tenantId, issueId: issue.id },
          _sum: { quantity: true },
        });
        const returnedQty = total._sum.quantity ?? 0;
        const status: MfgIssueStatus =
          returnedQty >= issue.quantity
            ? MfgIssueStatus.RETURNED
            : returnedQty > 0
              ? MfgIssueStatus.PARTIAL
              : MfgIssueStatus.OPEN;
        await tx.materialIssue.update({
          where: { id: issue.id },
          data: { status },
        });
      }
      return ret;
    });
  }

  async listMaterialIssues(
    filters: {
      workOrderId?: number;
      jobId?: number;
      issuedToId?: number;
      status?: string;
    } = {},
  ) {
    const tenantId = this.tenantId();
    const where: Prisma.MaterialIssueWhereInput = { organizationId: tenantId };
    if (filters.workOrderId) where.workOrderId = filters.workOrderId;
    if (filters.jobId) where.jobId = filters.jobId;
    if (filters.issuedToId) where.issuedToId = filters.issuedToId;
    if (filters.status) where.status = filters.status as MfgIssueStatus;
    const issues = await this.prisma.materialIssue.findMany({
      where,
      include: { returns: true },
      orderBy: { issuedAt: 'desc' },
    });
    const productIds = [...new Set(issues.map((i) => i.productId))];
    const products = productIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, brand: true, baseName: true },
        })
      : [];
    const byId = new Map(products.map((p) => [p.id, p]));
    return issues.map((i) => {
      const returnedQty = (i.returns ?? []).reduce((s, r) => s + r.quantity, 0);
      return {
        ...i,
        product: byId.get(i.productId) ?? null,
        issuedQty: i.quantity,
        returnedQty,
        usedQty: Math.max(0, i.quantity - returnedQty),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Machines & components
  // ---------------------------------------------------------------------------

  async listMachines() {
    const tenantId = this.tenantId();
    return this.prisma.machine.findMany({
      where: { organizationId: tenantId },
      include: {
        components: true,
        statusLogs: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async createMachine(dto: CreateMachineDto) {
    const tenantId = this.tenantId();
    try {
      return await this.prisma.machine.create({
        data: {
          organizationId: tenantId,
          code: dto.code,
          name: dto.name,
          type: dto.type ?? null,
          kind: (dto.kind as any) ?? 'STATIONARY',
          locationId: dto.locationId ?? null,
          notes: dto.notes ?? null,
          hourlyRate: dto.hourlyRate ?? null,
        },
      });
    } catch (err) {
      if (this.isDuplicate(err))
        throw new BadRequestException(
          tr('errors.manufacturing.duplicateService'),
        );
      throw err;
    }
  }

  async updateMachineStatus(
    id: number,
    dto: UpdateMachineStatusDto,
    user: JwtPayload,
  ) {
    const tenantId = this.tenantId();
    const machine = await this.prisma.machine.findFirst({
      where: { id, organizationId: tenantId },
    });
    if (!machine)
      throw new NotFoundException(tr('errors.manufacturing.machineNotFound'));
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.machine.update({ where: { id }, data: { status: dto.status } });
      return tx.machineStatusLog.create({
        data: {
          organizationId: tenantId,
          machineId: id,
          fromStatus: machine.status,
          toStatus: dto.status,
          note: dto.note ?? null,
          changedById: user.sub,
        },
      });
    });
  }

  async updateMachine(id: number, dto: UpdateMachineDto) {
    const tenantId = this.tenantId();
    const existing = await this.prisma.machine.findFirst({ where: { id, organizationId: tenantId } });
    if (!existing) throw new NotFoundException(tr("errors.manufacturing.machineNotFound"));
    try {
      return await this.prisma.machine.update({
        where: { id },
        data: {
          ...(dto.code !== undefined ? { code: dto.code } : {}),
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.type !== undefined ? { type: dto.type } : {}),
          ...(dto.kind !== undefined ? { kind: dto.kind as any } : {}),
          ...(dto.hourlyRate !== undefined ? { hourlyRate: dto.hourlyRate } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        },
      });
    } catch (err) {
      if (this.isDuplicate(err)) throw new BadRequestException(tr("errors.manufacturing.duplicateService"));
      throw err;
    }
  }

  async deleteMachine(id: number) {
    const tenantId = this.tenantId();
    const machine = await this.prisma.machine.findFirst({ where: { id, organizationId: tenantId } });
    if (!machine) throw new NotFoundException(tr("errors.manufacturing.machineNotFound"));
    const open = await this.prisma.machineIssuance.findFirst({ where: { organizationId: tenantId, machineId: id, status: { in: ["OUT", "PARTIAL"] } } });
    if (open) throw new BadRequestException(tr("errors.manufacturing.machineHasOpenIssuance"));
    await this.prisma.machine.delete({ where: { id } });
    return { deleted: true };
  }

  async addMachineComponent(machineId: number, dto: MachineComponentDto) {
    const tenantId = this.tenantId();
    const machine = await this.prisma.machine.findFirst({
      where: { id: machineId, organizationId: tenantId },
    });
    if (!machine)
      throw new NotFoundException(tr('errors.manufacturing.machineNotFound'));
    return this.prisma.machineComponent.create({
      data: {
        organizationId: tenantId,
        machineId,
        name: dto.name,
        quantity: dto.quantity ?? 1,
        partProductId: dto.partProductId ?? null,
      },
    });
  }

  async updateComponentStatus(
    componentId: number,
    dto: UpdateMachineComponentStatusDto,
    user: JwtPayload,
  ) {
    const tenantId = this.tenantId();
    const component = await this.prisma.machineComponent.findFirst({
      where: { id: componentId, organizationId: tenantId },
      include: { machine: true },
    });
    if (!component)
      throw new NotFoundException(
        tr('errors.manufacturing.machineComponentNotFound'),
      );
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.machineComponent.update({
        where: { id: componentId },
        data: {
          status: dto.status,
          partProductId: dto.partProductId ?? component.partProductId,
          ...(dto.status === 'REPLACED' ? { lastReplacedAt: new Date() } : {}),
        },
      });
      // Replacement draws from the linked part product stock at the machine location.
      const partProductId = dto.partProductId ?? component.partProductId;
      if (
        dto.status === 'REPLACED' &&
        partProductId &&
        component.machine?.locationId
      ) {
        const inv = await tx.inventory.findFirst({
          where: {
            tenantId,
            productId: partProductId,
            variantId: null,
            locationId: component.machine.locationId,
          },
        });
        if (inv) {
          await tx.inventory.update({
            where: { id: inv.id },
            data: { quantity: { decrement: component.quantity || 1 } },
          });
        }
      }
      return tx.componentStatusLog.create({
        data: {
          organizationId: tenantId,
          componentId,
          fromStatus: component.status,
          toStatus: dto.status,
          note: dto.note ?? null,
          changedById: user.sub,
        },
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Consumables (grouped issue + used/left)
  // ---------------------------------------------------------------------------

  async createConsumableIssue(dto: CreateConsumableIssueDto) {
    const tenantId = this.tenantId();
    return this.prisma.consumableIssue.create({
      data: {
        organizationId: tenantId,
        productId: dto.productId,
        quantity: dto.quantity,
        shiftSessionId: dto.shiftSessionId ?? null,
        groupLabel: dto.groupLabel ?? null,
      },
    });
  }

  async recordConsumableUsage(dto: RecordConsumableUsageDto) {
    const tenantId = this.tenantId();
    return this.prisma.consumableUsageLog.create({
      data: {
        organizationId: tenantId,
        productId: dto.productId,
        usedQty: dto.usedQty,
        leftQty: dto.leftQty,
        shiftSessionId: dto.shiftSessionId ?? null,
        note: dto.note ?? null,
      },
    });
  }

  async listConsumableActivity() {
    const tenantId = this.tenantId();
    return this.prisma.consumableUsageLog.findMany({
      where: { organizationId: tenantId },
      orderBy: { recordedAt: 'desc' },
      take: 100,
    });
  }

  // ---------------------------------------------------------------------------
  // Work shifts: templates, sessions, handover checks
  // ---------------------------------------------------------------------------

  async listShiftTemplates() {
    const tenantId = this.tenantId();
    return this.prisma.shiftTemplate.findMany({
      where: { organizationId: tenantId },
      orderBy: { name: 'asc' },
    });
  }

  // --- Manufacturing V2: team flow routing ---------------------------------
  /**
   * Lifecycle stage for a flow order: once a linked Work Order exists the order
   * is "in the build pipeline" (PRODUCTION); otherwise it is still DESIGN.
   * Flow membership (steps/teams) is tracked by flowId + currentStepIndex +
   * currentTeamId and never by the stage enum.
   */
  private flowStageFor(hasLinkedWorkOrder: boolean): MfgOrderStage {
    return hasLinkedWorkOrder
      ? MfgOrderStage.PRODUCTION
      : MfgOrderStage.DESIGN;
  }

  /**
   * Place an order onto a specific flow step: persists the position (flowId,
   * step index, owning team) and, when the step is the production step and the
   * order carries a BOM + target quantity, auto-creates + links the shop-floor
   * Work Order (materials backflush / machine / COGM then run from that order).
   * `client` is a transaction client (or the main prisma service).
   */
  private async enterFlowStep(
    client: any,
    tenantId: number,
    order: {
      id: number;
      jobNumber: string;
      title: string;
      bomId: number | null;
      targetQuantity: number | null;
      workOrderId: number | null;
    },
    flowId: number | null,
    stepIndex: number,
    step: {
      teamId: number | null;
      isProductionStep: boolean;
      operations?: Array<{ id: number }>;
    },
    user: JwtPayload,
  ) {
    let workOrderId = order.workOrderId;
    let createdWorkOrder = false;
    if (
      workOrderId == null &&
      step.isProductionStep &&
      order.bomId != null &&
      order.targetQuantity != null &&
      order.targetQuantity > 0
    ) {
      const bom = await client.billOfMaterials.findFirst({
        where: { id: order.bomId, organizationId: tenantId },
        select: { finishedProductId: true },
      });
      const location = await client.location.findFirst({
        where: { tenantId },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      if (bom && location) {
        const wo = await client.workOrder.create({
          data: {
            organizationId: tenantId,
            bomId: order.bomId,
            finishedProductId: bom.finishedProductId,
            targetQuantity: order.targetQuantity,
            locationId: location.id,
            notes: `Order ${order.jobNumber}: ${order.title}`,
            createdById: user.sub,
          },
        });
        workOrderId = wo.id;
        createdWorkOrder = true;
      }
    }
    const stage = this.flowStageFor(workOrderId != null);
    const updated = await client.manufacturingOrder.update({
      where: { id: order.id },
      data: {
        flowId,
        currentStepIndex: stepIndex,
        currentTeamId: step.teamId ?? null,
        // Entering a step starts at its first operation when it has any.
        currentOperationId:
          step.operations && step.operations.length
            ? step.operations[0].id
            : null,
        workOrderId,
        stage,
      },
    });
    if (createdWorkOrder) {
      await client.auditLog.create({
        data: {
          userId: user.sub,
          action: 'WORK_ORDER_LINKED',
          details: `Order ${order.jobNumber} reached the production step — work order #${workOrderId} auto-created`,
        },
      });
    }
    return { updated, workOrderId, stage, createdWorkOrder };
  }

  async getOrderFlow() {
    const tenantId = this.tenantId();
    const flow = await this.prisma.mfgFlow.findFirst({
      where: { organizationId: tenantId, isDefault: true },
      include: { steps: { orderBy: { sortOrder: "asc" }, include: { team: { select: { id: true, name: true } }, operations: { orderBy: { sortOrder: "asc" } } } } },
    });
    const teams = await this.prisma.mfgTeam.findMany({ where: { organizationId: tenantId }, orderBy: { sortOrder: "asc" } });
    return { flow: flow ?? null, teams };
  }

  async getOrderQueue(teamId?: number) {
    const tenantId = this.tenantId();
    const where: Prisma.ManufacturingOrderWhereInput = { organizationId: tenantId, currentTeamId: teamId ?? undefined, completedAt: null };
    if (!teamId) delete where.currentTeamId;
    return this.prisma.manufacturingOrder.findMany({
      where,
      orderBy: { createdAt: "asc" },
      include: {
        flow: { include: { steps: { orderBy: { sortOrder: "asc" }, include: { operations: { orderBy: { sortOrder: "asc" } } } } } },
        workOrder: {
          select: {
            id: true,
            status: true,
            producedQuantity: true,
            totalCogmCost: true,
            cogmUnitCost: true,
          },
        },
        handovers: { orderBy: { createdAt: "desc" } },
      },
    });
  }

  async assignOrderFlow(orderId: number, dto: AssignOrderFlowDto, user: JwtPayload) {
    const tenantId = this.tenantId();
    const order = await this.prisma.manufacturingOrder.findFirst({
      where: { id: orderId, organizationId: tenantId },
      select: {
        id: true,
        jobNumber: true,
        title: true,
        bomId: true,
        targetQuantity: true,
        workOrderId: true,
        currentTeamId: true,
      },
    });
    if (!order) throw new NotFoundException(tr('errors.manufacturing.jobNotFound'));
    const flow = await this.prisma.mfgFlow.findFirst({
      where: { id: dto.flowId, organizationId: tenantId, active: true },
      include: { steps: { orderBy: { sortOrder: "asc" }, include: { operations: { orderBy: { sortOrder: "asc" } } } } },
    });
    if (!flow) throw new NotFoundException(tr('errors.manufacturing.flowNotFound'));
    const first = flow.steps[0] ?? null;
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.mfgOrderHandover.create({
        data: {
          organizationId: tenantId,
          orderId,
          fromTeamId: order.currentTeamId ?? null,
          toTeamId: first?.teamId ?? null,
          stepIndex: 0,
          note: dto.note ?? null,
          changedById: user.sub,
        },
      });
      await this.enterFlowStep(
        tx as any,
        tenantId,
        order,
        flow.id,
        0,
        {
          teamId: first?.teamId ?? null,
          isProductionStep: first?.isProductionStep ?? false,
          operations: first?.operations ?? [],
        },
        user,
      );
      return tx.manufacturingOrder.findFirst({ where: { id: orderId } });
    });
  }

  /**
   * Move the order strictly to the next step of ITS OWN flow. Teams that are not
   * part of the selected flow are skipped by definition — e.g. an order on a
   * flow without a Purchasing step is never handed to the purchasing team.
   */
  async advanceOrder(orderId: number, dto: AdvanceOrderDto, user: JwtPayload) {
    const tenantId = this.tenantId();
    const order = await this.prisma.manufacturingOrder.findFirst({
      where: { id: orderId, organizationId: tenantId },
      include: { flow: { include: { steps: { orderBy: { sortOrder: "asc" }, include: { operations: { orderBy: { sortOrder: "asc" } } } } } } },
    });
    if (!order) throw new NotFoundException(tr('errors.manufacturing.jobNotFound'));
    if (!order.flow || order.currentStepIndex < 0)
      throw new BadRequestException(tr('errors.manufacturing.orderNotOnFlow'));
    const steps = order.flow.steps;
    const current = steps[order.currentStepIndex];
    if (!current)
      throw new BadRequestException(tr('errors.manufacturing.orderNotOnFlow'));
    const ops = current.operations ?? [];
    const opIndex =
      order.currentOperationId != null
        ? ops.findIndex((o: any) => o.id === order.currentOperationId)
        : -1;
    const pos = opIndex >= 0 ? opIndex : -1;
    const lastOpName = pos >= 0 ? (ops[pos].name as string) : null;

    // Step has operations: each press completes the current one and either
    // starts the next operation (same team/step) or hands off to the next team.
    if (ops.length > 0 && pos === -1) {
      // Legacy row without an active operation — start the first one.
      return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.manufacturingOrder.update({
          where: { id: orderId },
          data: { currentOperationId: ops[0].id },
        });
        await tx.manufacturingOrderHistory.create({
          data: {
            organizationId: tenantId,
            orderId,
            toStage: order.stage,
            note: `Started operation: ${ops[0].name}`,
            changedById: user.sub,
          },
        });
        return tx.manufacturingOrder.findFirst({ where: { id: orderId } });
      });
    }
    if (ops.length > 0 && pos + 1 < ops.length) {
      const nextOp = ops[pos + 1];
      return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.manufacturingOrder.update({
          where: { id: orderId },
          data: { currentOperationId: nextOp.id },
        });
        await tx.manufacturingOrderHistory.create({
          data: {
            organizationId: tenantId,
            orderId,
            toStage: order.stage,
            note: `Completed operation: ${ops[pos].name}`,
            changedById: user.sub,
          },
        });
        return tx.manufacturingOrder.findFirst({ where: { id: orderId } });
      });
    }

    // No more operations (or none): hand the order to the next team step.
    const nextIndex = order.currentStepIndex + 1;
    if (nextIndex >= steps.length)
      throw new BadRequestException(tr('errors.manufacturing.orderOnFinalStep'));
    const next = steps[nextIndex];
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const handoverNote = lastOpName
        ? `Completed ${lastOpName}${dto.note ? ` — ${dto.note}` : ""}`
        : (dto.note ?? null);
      await tx.mfgOrderHandover.create({
        data: {
          organizationId: tenantId,
          orderId,
          fromTeamId: order.currentTeamId,
          toTeamId: next.teamId ?? null,
          stepIndex: nextIndex,
          note: handoverNote,
          changedById: user.sub,
        },
      });
      if (lastOpName) {
        await tx.manufacturingOrderHistory.create({
          data: {
            organizationId: tenantId,
            orderId,
            toStage: order.stage,
            note: `Completed operation: ${lastOpName}`,
            changedById: user.sub,
          },
        });
      }
      await this.enterFlowStep(
        tx as any,
        tenantId,
        order,
        order.flowId,
        nextIndex,
        {
          teamId: next.teamId ?? null,
          isProductionStep: next.isProductionStep,
          operations: next.operations ?? [],
        },
        user,
      );
      return tx.manufacturingOrder.findFirst({ where: { id: orderId } });
    });
  }

  async completeOrderDelivery(orderId: number, dto: CompleteOrderDeliveryDto, user: JwtPayload) {
    const tenantId = this.tenantId();
    const order = await this.prisma.manufacturingOrder.findFirst({
      where: { id: orderId, organizationId: tenantId },
      include: {
        flow: { include: { steps: { orderBy: { sortOrder: "asc" }, include: { operations: { orderBy: { sortOrder: "asc" } } } } } },
        workOrder: {
          select: {
            producedQuantity: true,
            totalCogmCost: true,
            cogmUnitCost: true,
            completedAt: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException("Order not found");
    if (!order.flow || order.currentStepIndex < 0) throw new BadRequestException("Order is not on a flow yet");
    const steps = order.flow.steps;
    if (order.currentStepIndex < steps.length - 1) throw new BadRequestException("Only the final team can complete this order.");
    await this.prisma.mfgOrderHandover.create({ data: { organizationId: tenantId, orderId, fromTeamId: order.currentTeamId, toTeamId: null, stepIndex: order.currentStepIndex, note: dto.note ?? null, changedById: user.sub } });
    const wo = order.workOrder as
      | { producedQuantity?: number | null; totalCogmCost?: number; cogmUnitCost?: number }
      | null
      | undefined;
    const producedQuantity =
      wo && (wo.producedQuantity ?? 0) > 0 ? wo.producedQuantity : null;
    return this.prisma.manufacturingOrder.update({
      where: { id: orderId },
      data: {
        currentStepIndex: -1,
        currentTeamId: null,
        currentOperationId: null,
        completedAt: new Date(),
        stage: "COMPLETED" as any,
        producedQuantity,
        totalCogmCost: producedQuantity ? wo?.totalCogmCost ?? 0 : 0,
        cogmUnitCost: producedQuantity ? wo?.cogmUnitCost ?? 0 : 0,
      },
    });
  }

  // --- Manufacturing V2: team & flow administration --------------------------
  async listTeams() {
    const tenantId = this.tenantId();
    return this.prisma.mfgTeam.findMany({
      where: { organizationId: tenantId },
      include: { _count: { select: { steps: true } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  async createTeam(dto: CreateMfgTeamDto) {
    const tenantId = this.tenantId();
    const sortOrder =
      dto.sortOrder ??
      (await this.prisma.mfgTeam.count({
        where: { organizationId: tenantId },
      }));
    try {
      return await this.prisma.mfgTeam.create({
        data: {
          organizationId: tenantId,
          name: dto.name.trim(),
          description: dto.description ?? null,
          sortOrder,
        },
      });
    } catch (err) {
      if (this.isDuplicate(err))
        throw new BadRequestException(
          tr("errors.manufacturing.duplicateTeam"),
        );
      throw err;
    }
  }

  async updateTeam(id: number, dto: UpdateMfgTeamDto) {
    const tenantId = this.tenantId();
    const existing = await this.prisma.mfgTeam.findFirst({
      where: { id, organizationId: tenantId },
    });
    if (!existing)
      throw new NotFoundException(tr("errors.manufacturing.teamNotFound"));
    try {
      return await this.prisma.mfgTeam.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description }
            : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
      });
    } catch (err) {
      if (this.isDuplicate(err))
        throw new BadRequestException(
          tr("errors.manufacturing.duplicateTeam"),
        );
      throw err;
    }
  }

  async reorderTeams(dto: ReorderMfgTeamsDto) {
    const tenantId = this.tenantId();
    const teams = await this.prisma.mfgTeam.findMany({
      where: { organizationId: tenantId, id: { in: dto.ids } },
      select: { id: true },
    });
    const found = new Set(teams.map((t) => t.id));
    const missing = dto.ids.filter((i) => !found.has(i));
    if (missing.length > 0)
      throw new NotFoundException(tr("errors.manufacturing.teamNotFound"));
    await this.prisma.$transaction(
      dto.ids.map((id, index) =>
        this.prisma.mfgTeam.update({
          where: { id },
          data: { sortOrder: index },
        }),
      ),
    );
    return { ids: dto.ids };
  }

  async deleteTeam(id: number) {
    const tenantId = this.tenantId();
    const existing = await this.prisma.mfgTeam.findFirst({
      where: { id, organizationId: tenantId },
    });
    if (!existing)
      throw new NotFoundException(tr("errors.manufacturing.teamNotFound"));
    const [stepUses, queueUses] = await Promise.all([
      this.prisma.mfgFlowStep.count({
        where: { organizationId: tenantId, teamId: id },
      }),
      this.prisma.manufacturingOrder.count({
        where: { organizationId: tenantId, currentTeamId: id },
      }),
    ]);
    if (stepUses > 0 || queueUses > 0) {
      throw new BadRequestException(tr("errors.manufacturing.teamInUse"));
    }
    await this.prisma.mfgTeam.delete({ where: { id } });
    return { id };
  }

  /**
   * Mirror of the restaurant-station RBAC pattern: every production flow gets
   * two dynamic permissions (production-flow.<id>.view / .update) and an
   * organization role named "<name> Production Flow" granted both. Idempotent —
   * safe to call on create/update/list.
   */
  private async ensureFlowAccess(flow: {
    id: number;
    name: string;
    roleId?: number | null;
  }): Promise<{
    roleId: number | null;
    roleName: string;
    permissionView: string;
    permissionUpdate: string;
  }> {
    const tenantId = this.tenantId();
    const viewKey = `production-flow.${flow.id}.view`;
    const updateKey = `production-flow.${flow.id}.update`;
    const roleName = `${flow.name} Production Flow`;

    const permView = await this.prisma.permission.upsert({
      where: { key: viewKey },
      update: { label: `View ${flow.name} Process` },
      create: {
        key: viewKey,
        label: `View ${flow.name} Process`,
        group: 'Production Flows',
      },
    });
    const permUpdate = await this.prisma.permission.upsert({
      where: { key: updateKey },
      update: { label: `Update ${flow.name} Process` },
      create: {
        key: updateKey,
        label: `Update ${flow.name} Process`,
        group: 'Production Flows',
      },
    });

    let role = await this.prisma.role.findFirst({
      where: { name: roleName, organizationId: tenantId },
    });
    if (!role && flow.roleId) {
      role = await this.prisma.role.findFirst({
        where: { id: flow.roleId, organizationId: tenantId },
      });
    }
    if (!role) {
      role = await this.prisma.role.create({
        data: {
          name: roleName,
          organizationId: tenantId,
          description: `Members view and update the ${flow.name} production process`,
        },
      });
    }
    await this.prisma.rolePermission.createMany({
      data: [
        { roleId: role.id, permissionId: permView.id },
        { roleId: role.id, permissionId: permUpdate.id },
      ],
      skipDuplicates: true,
    });
    await this.prisma.mfgFlow.update({
      where: { id: flow.id },
      data: { roleId: role.id },
    });
    return { roleId: role.id, roleName, permissionView: viewKey, permissionUpdate: updateKey };
  }

  async listFlows() {
    const tenantId = this.tenantId();
    const flows = await this.prisma.mfgFlow.findMany({
      where: { organizationId: tenantId },
      include: {
        steps: {
          orderBy: { sortOrder: "asc" },
          include: {
            team: { select: { id: true, name: true, active: true } },
            operations: { orderBy: { sortOrder: "asc" } },
          },
        },
        _count: { select: { orders: true } },
      },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });
    const result: any[] = [];
    for (const flow of flows) {
      let roleId = flow.roleId ?? null;
      if (!roleId) {
        const access = await this.ensureFlowAccess({
          id: flow.id,
          name: flow.name,
          roleId: flow.roleId,
        });
        roleId = access.roleId;
      }
      result.push({
        ...flow,
        roleId,
        permissionView: `production-flow.${flow.id}.view`,
        permissionUpdate: `production-flow.${flow.id}.update`,
      });
    }
    return result;
  }

  /** Validate + normalise flow step rows. Step labels come from the team name. */
  private async prepareFlowSteps(
    tenantId: number,
    steps: MfgFlowStepInputDto[],
  ) {
    const teamIds = [
      ...new Set(
        steps
          .map((s) => s.teamId)
          .filter((id): id is number => id != null),
      ),
    ];
    const teams = teamIds.length
      ? await this.prisma.mfgTeam.findMany({
          where: { organizationId: tenantId, id: { in: teamIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(teams.map((t) => [t.id, t.name]));
    return steps.map((s, index) => {
      const teamName = s.teamId != null ? nameById.get(s.teamId) : undefined;
      if (s.teamId != null && !teamName)
        throw new NotFoundException(tr("errors.manufacturing.teamNotFound"));
      return {
        organizationId: tenantId,
        teamId: s.teamId ?? null,
        isProductionStep: s.isProductionStep ?? false,
        name: (teamName || s.name?.trim() || `Step ${index + 1}`).slice(0, 150),
        sortOrder: index,
        operations: (s.operations ?? [])
          .map((o) => o.trim())
          .filter(Boolean)
          .slice(0, 20),
      };
    });
  }

  /** Expand normalised step rows into nested create inputs (ops included). */
  private flowStepCreateInputs(tenantId: number, stepData: any[]) {
    return stepData.map((st: any) => {
      const { operations, ...rest } = st;
      return {
        ...rest,
        ...(operations && operations.length
          ? {
              operations: {
                create: operations.map((name: string, index: number) => ({
                  organizationId: tenantId,
                  name: name.slice(0, 150),
                  sortOrder: index,
                })),
              },
            }
          : {}),
      };
    });
  }

  async createFlow(dto: CreateMfgFlowDto) {
    const tenantId = this.tenantId();
    const stepData = await this.prepareFlowSteps(tenantId, dto.steps ?? []);
    try {
      const created = await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          if (dto.isDefault) {
            await tx.mfgFlow.updateMany({
              where: { organizationId: tenantId },
              data: { isDefault: false },
            });
          }
          return tx.mfgFlow.create({
            data: {
              organizationId: tenantId,
              name: dto.name.trim(),
              description: dto.description ?? null,
              isDefault: dto.isDefault ?? false,
              active: dto.active ?? true,
              steps: { create: this.flowStepCreateInputs(tenantId, stepData) },
            },
            include: {
              steps: {
                orderBy: { sortOrder: "asc" },
                include: { team: { select: { id: true, name: true } }, operations: { orderBy: { sortOrder: "asc" } } },
              },
            },
          });
        },
      );
      // New flows are instantly routable + RBAC-registered.
      const access = await this.ensureFlowAccess(created);
      return {
        ...created,
        roleId: access.roleId,
        permissionView: access.permissionView,
        permissionUpdate: access.permissionUpdate,
      };
    } catch (err) {
      if (this.isDuplicate(err))
        throw new BadRequestException(
          tr("errors.manufacturing.duplicateFlow"),
        );
      throw err;
    }
  }

  async updateFlow(id: number, dto: UpdateMfgFlowDto) {
    const tenantId = this.tenantId();
    const existing = await this.prisma.mfgFlow.findFirst({
      where: { id, organizationId: tenantId },
    });
    if (!existing)
      throw new NotFoundException(tr("errors.manufacturing.flowNotFound"));
    const stepData =
      dto.steps !== undefined
        ? await this.prepareFlowSteps(tenantId, dto.steps)
        : null;
    try {
      const updated = await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          if (dto.isDefault === true) {
            await tx.mfgFlow.updateMany({
              where: { organizationId: tenantId, id: { not: id } },
              data: { isDefault: false },
            });
          }
          if (stepData) {
            await tx.mfgFlowStep.deleteMany({
              where: { organizationId: tenantId, flowId: id },
            });
          }
          return tx.mfgFlow.update({
            where: { id },
            data: {
              ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
              ...(dto.description !== undefined
                ? { description: dto.description }
                : {}),
              ...(dto.isDefault !== undefined
                ? { isDefault: dto.isDefault }
                : {}),
              ...(dto.active !== undefined ? { active: dto.active } : {}),
              ...(stepData
                ? { steps: { create: this.flowStepCreateInputs(tenantId, stepData) } }
                : {}),
            },
            include: {
              steps: {
                orderBy: { sortOrder: "asc" },
                include: { team: { select: { id: true, name: true } }, operations: { orderBy: { sortOrder: "asc" } } },
              },
            },
          });
        },
      );
      // Keep the RBAC role + permission labels in sync with the flow.
      const access = await this.ensureFlowAccess(updated);
      return {
        ...updated,
        roleId: access.roleId,
        permissionView: access.permissionView,
        permissionUpdate: access.permissionUpdate,
      };
    } catch (err) {
      if (this.isDuplicate(err))
        throw new BadRequestException(
          tr("errors.manufacturing.duplicateFlow"),
        );
      throw err;
    }
  }

  async setDefaultFlow(id: number) {
    const tenantId = this.tenantId();
    const existing = await this.prisma.mfgFlow.findFirst({
      where: { id, organizationId: tenantId },
    });
    if (!existing)
      throw new NotFoundException(tr("errors.manufacturing.flowNotFound"));
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.mfgFlow.updateMany({
        where: { organizationId: tenantId, id: { not: id } },
        data: { isDefault: false },
      });
      await tx.mfgFlow.update({ where: { id }, data: { isDefault: true } });
    });
    return { id };
  }

  async deleteFlow(id: number) {
    const tenantId = this.tenantId();
    const existing = await this.prisma.mfgFlow.findFirst({
      where: { id, organizationId: tenantId },
      include: { _count: { select: { orders: true } } },
    });
    if (!existing)
      throw new NotFoundException(tr("errors.manufacturing.flowNotFound"));
    if (existing._count.orders > 0) {
      throw new BadRequestException(tr("errors.manufacturing.flowHasOrders"));
    }
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.mfgFlowStep.deleteMany({
        where: { organizationId: tenantId, flowId: id },
      });
      await tx.mfgFlow.delete({ where: { id } });
      // Keep exactly one default when the deleted flow was the default.
      if (existing.isDefault) {
        const fallback = await tx.mfgFlow.findFirst({
          where: { organizationId: tenantId, active: true },
        });
        if (fallback) {
          await tx.mfgFlow.update({
            where: { id: fallback.id },
            data: { isDefault: true },
          });
        }
      }
    });
    return { id };
  }

  // --- Issuable machine issuance (check-out set, per-part return) -----------
  async listMachineIssuances(filters: { status?: string } = {}) {
    const tenantId = this.tenantId();
    const where: Prisma.MachineIssuanceWhereInput = {
      organizationId: tenantId,
    };
    if (filters.status) where.status = filters.status as any;
    return this.prisma.machineIssuance.findMany({
      where,
      include: {
        machine: {
          select: {
            id: true,
            code: true,
            name: true,
            kind: true,
            status: true,
          },
        },
        items: { orderBy: { id: 'asc' } },
      },
      orderBy: { issuedAt: 'desc' },
    });
  }

  async issueMachine(dto: IssueMachineDto, user: JwtPayload) {
    const tenantId = this.tenantId();
    const machine = await this.prisma.machine.findFirst({
      where: { id: dto.machineId, organizationId: tenantId },
    });
    if (!machine)
      throw new NotFoundException(tr('errors.manufacturing.machineNotFound'));
    if (machine.kind !== 'ISSUABLE')
      throw new BadRequestException(
        tr('errors.manufacturing.machineNotIssuable'),
      );
    if (machine.status !== 'AVAILABLE')
      throw new BadRequestException(
        tr('errors.manufacturing.machineNotAvailable'),
      );
    if (!dto.workerId)
      throw new BadRequestException(
        tr('errors.manufacturing.issueWorkerRequired'),
      );

    const components = await this.prisma.machineComponent.findMany({
      where: { machineId: machine.id, organizationId: tenantId },
    });
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.machineStatusLog.create({
        data: {
          organizationId: tenantId,
          machineId: machine.id,
          fromStatus: machine.status,
          toStatus: 'ISSUED' as any,
          note: `Issued to worker #${dto.workerId}`,
          changedById: user.sub,
        },
      });
      const issuance = await tx.machineIssuance.create({
        data: {
          organizationId: tenantId,
          machineId: machine.id,
          workerId: dto.workerId,
          workOrderId: dto.workOrderId ?? null,
          shiftId: dto.shiftId ?? null,
          issuedById: user.sub,
          locationId: dto.locationId ?? null,
          dueReturnAt: dto.dueReturnAt ? new Date(dto.dueReturnAt) : null,
          notes: dto.notes ?? null,
          items: {
            create: components.map((c) => ({
              organizationId: tenantId,
              componentName: c.name,
              expectedQuantity: c.quantity,
              returnedQuantity: 0,
              status: 'OUT',
            })),
          },
        },
      });
      await tx.machine.update({
        where: { id: machine.id },
        data: { status: 'ISSUED' as any },
      });
      return tx.machineIssuance.findUniqueOrThrow({
        where: { id: issuance.id },
        include: { items: true },
      });
    });
  }
  async returnMachineIssuance(
    id: number,
    dto: ReturnMachineIssuanceDto,
    user: JwtPayload,
  ) {
    const tenantId = this.tenantId();
    const issuance = await this.prisma.machineIssuance.findFirst({
      where: { id, organizationId: tenantId },
      include: { machine: true, items: true },
    });
    if (!issuance)
      throw new NotFoundException(tr('errors.manufacturing.issuanceNotFound'));
    if (issuance.status === 'RETURNED')
      throw new BadRequestException(tr('errors.manufacturing.issuanceClosed'));

    const updates = dto.items.map((it) => {
      const row = issuance.items.find((x) => x.id === it.issuanceItemId);
      if (!row)
        throw new BadRequestException(
          tr('errors.manufacturing.issuanceItemNotFound'),
        );
      return {
        id: row.id,
        status: it.status,
        returnedQuantity: it.returnedQuantity ?? row.expectedQuantity,
        replacementCost: it.replacementCost ?? null,
        notes: it.notes ?? null,
      };
    });

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const u of updates)
        await tx.machineIssuanceItem.update({ where: { id: u.id }, data: u });
      const items = issuance.items.map(
        (row) => updates.find((x) => x.id === row.id) ?? row,
      );
      const damaged = items.filter(
        (i) => i.status === 'DAMAGED' || i.status === 'MISSING',
      );
      const outstanding = items.filter((i) => i.status === 'OUT');
      const nextMachine: any =
        damaged.length > 0
          ? 'UNDER_MAINTENANCE'
          : outstanding.length > 0
            ? 'ISSUED'
            : 'AVAILABLE';
      const nextIssuance =
        outstanding.length === 0
          ? 'RETURNED'
          : damaged.length > 0
            ? 'PARTIAL'
            : issuance.status;

      await tx.machine.update({
        where: { id: issuance.machineId },
        data: { status: nextMachine },
      });
      if (issuance.machine.status !== nextMachine) {
        await tx.machineStatusLog.create({
          data: {
            organizationId: tenantId,
            machineId: issuance.machineId,
            fromStatus: issuance.machine.status,
            toStatus: nextMachine,
            note:
              outstanding.length === 0
                ? 'Returned by worker'
                : 'Return check-in (issues found)',
            changedById: user.sub,
          },
        });
      }
      for (const u of updates) {
        const row = items.find((x) => x.id === u.id) as any;
        if (
          (row.status === 'DAMAGED' || row.status === 'MISSING') &&
          (u.replacementCost ?? 0) > 0
        ) {
          await tx.machineLossCharge.create({
            data: {
              organizationId: tenantId,
              issuanceItemId: u.id,
              category: row.status === 'MISSING' ? 'LOSS' : 'DAMAGE',
              amount: u.replacementCost ?? 0,
              workOrderId: issuance.workOrderId,
              shiftId: issuance.shiftId,
              workerId: issuance.workerId,
              notes: u.notes ?? null,
              recordedById: user.sub,
            },
          });
        }
      }
      const updated = await tx.machineIssuance.update({
        where: { id },
        data: {
          status: nextIssuance,
          returnedAt: nextIssuance === 'RETURNED' ? new Date() : null,
        },
        include: { items: true },
      });
      return { ...updated, nextMachine };
    });
  }

  // --- Workers (employees roster) ------------------------------------------
  async getWorkers() {
    const tenantId = this.tenantId();
    return this.prisma.worker.findMany({
      where: { organizationId: tenantId },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  async createWorker(dto: CreateWorkerDto) {
    const tenantId = this.tenantId();
    return this.prisma.worker.create({
      data: {
        organizationId: tenantId,
        name: dto.name,
        title: dto.title ?? null,
        phone: dto.phone ?? null,
        locationId: dto.locationId ?? null,
        notes: dto.notes ?? null,
      },
    });
  }

  async updateWorkerStatus(id: number, dto: UpdateWorkerStatusDto) {
    const tenantId = this.tenantId();
    const worker = await this.prisma.worker.findFirst({
      where: { id, organizationId: tenantId },
    });
    if (!worker)
      throw new NotFoundException(tr('errors.manufacturing.workerNotFound'));
    return this.prisma.worker.update({
      where: { id },
      data: { status: dto.status },
    });
  }

  async createShiftTemplate(dto: CreateShiftTemplateDto) {
    const tenantId = this.tenantId();
    if (dto.repeatDays?.length && dto.date) {
      throw new BadRequestException(
        tr('errors.manufacturing.patternCantHaveDate'),
      );
    }
    if ((!dto.repeatDays || dto.repeatDays.length === 0) && !dto.date) {
      throw new BadRequestException(
        tr('errors.manufacturing.patternNeedsDate'),
      );
    }
    try {
      return await this.prisma.shiftTemplate.create({
        data: {
          organizationId: tenantId,
          name: dto.name,
          startTime: dto.startTime,
          endTime: dto.endTime,
          repeatDays: dto.repeatDays ?? [],
          date: dto.date ? new Date(dto.date) : null,
          active: dto.active ?? true,
        },
      });
    } catch (err) {
      if (this.isDuplicate(err))
        throw new BadRequestException(
          tr('errors.manufacturing.duplicateService'),
        );
      throw err;
    }
  }

  async updateShiftTemplate(id: number, dto: Partial<CreateShiftTemplateDto>) {
    const tenantId = this.tenantId();
    const existing = await this.prisma.shiftTemplate.findFirst({
      where: { id, organizationId: tenantId },
    });
    if (!existing)
      throw new NotFoundException(
        tr('errors.manufacturing.shiftTemplateNotFound'),
      );
    return this.prisma.shiftTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.startTime !== undefined ? { startTime: dto.startTime } : {}),
        ...(dto.endTime !== undefined ? { endTime: dto.endTime } : {}),
        ...(dto.repeatDays !== undefined ? { repeatDays: dto.repeatDays } : {}),
        ...(dto.date !== undefined
          ? { date: dto.date ? new Date(dto.date) : null }
          : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
  }

  async createShiftSession(dto: CreateShiftSessionDto) {
    const tenantId = this.tenantId();
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const session = await tx.shiftSession.create({
        data: {
          organizationId: tenantId,
          name: dto.name,
          date: new Date(dto.date),
          startTime: dto.startTime,
          endTime: dto.endTime,
        },
      });
      if (dto.workers?.length) {
        await tx.shiftAssignment.createMany({
          data: dto.workers.map((workerId) => ({
            organizationId: tenantId,
            sessionId: session.id,
            workerId,
          })),
        });
      }
      return session;
    });
  }

  async createShiftFromTemplate(dto: CreateShiftFromTemplateDto) {
    const tenantId = this.tenantId();
    const template = await this.prisma.shiftTemplate.findFirst({
      where: { id: dto.templateId, organizationId: tenantId },
    });
    if (!template)
      throw new NotFoundException(
        tr('errors.manufacturing.shiftTemplateNotFound'),
      );

    let date: Date;
    if (template.repeatDays.length > 0) {
      // Recurring pattern: an instance day is required and must match a repeat weekday.
      if (!dto.date)
        throw new BadRequestException(
          tr('errors.manufacturing.patternNeedsInstanceDate'),
        );
      const picked = new Date(dto.date);
      if (!template.repeatDays.includes(picked.getDay())) {
        throw new BadRequestException(
          tr('errors.manufacturing.patternWeekdayMismatch'),
        );
      }
      date = picked;
    } else {
      // One-time pattern: the instance day is fixed by the pattern.
      if (!template.date)
        throw new BadRequestException(
          tr('errors.manufacturing.patternNeedsDate'),
        );
      date = template.date;
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const session = await tx.shiftSession.create({
        data: {
          organizationId: tenantId,
          shiftTemplateId: template.id,
          name: template.name,
          date,
          startTime: template.startTime,
          endTime: template.endTime,
        },
      });
      const workerIds = (dto.workers ?? []).filter((w) => Number.isInteger(w));
      if (workerIds.length) {
        await tx.shiftAssignment.createMany({
          data: workerIds.map((workerId) => ({
            organizationId: tenantId,
            sessionId: session.id,
            workerId,
          })),
        });
      }
      return session;
    });
  }

  async listShiftSessions(filters: { status?: string; date?: string } = {}) {
    const tenantId = this.tenantId();
    const where: Prisma.ShiftSessionWhereInput = { organizationId: tenantId };
    if (filters.status) where.status = filters.status as any;
    if (filters.date) {
      const d = new Date(filters.date);
      const end = new Date(d);
      end.setDate(end.getDate() + 1);
      where.date = { gte: d, lt: end };
    }
    return this.prisma.shiftSession.findMany({
      where,
      include: { assignments: true, ShiftTemplate: { select: { name: true } } },
      orderBy: { date: 'desc' },
    });
  }

  async assignShiftWorkers(sessionId: number, dto: AssignShiftWorkersDto) {
    const tenantId = this.tenantId();
    const session = await this.prisma.shiftSession.findFirst({
      where: { id: sessionId, organizationId: tenantId },
    });
    if (!session)
      throw new NotFoundException(
        tr('errors.manufacturing.shiftSessionNotFound'),
      );
    return this.prisma.shiftAssignment.createMany({
      data: dto.workerIds.map((workerId) => ({
        organizationId: tenantId,
        sessionId,
        workerId,
      })),
    });
  }

  async startShiftSession(id: number) {
    const tenantId = this.tenantId();
    const session = await this.prisma.shiftSession.findFirst({
      where: { id, organizationId: tenantId },
    });
    if (!session)
      throw new NotFoundException(
        tr('errors.manufacturing.shiftSessionNotFound'),
      );
    return this.prisma.shiftSession.update({
      where: { id },
      data: { status: 'ACTIVE', startedAt: new Date(), triggeredBy: 'MANUAL' },
    });
  }

  async endShiftSession(id: number) {
    const tenantId = this.tenantId();
    const session = await this.prisma.shiftSession.findFirst({
      where: { id, organizationId: tenantId },
      include: { assignments: true },
    });
    if (!session)
      throw new NotFoundException(
        tr('errors.manufacturing.shiftSessionNotFound'),
      );

    const workerIds = (session.assignments ?? [])
      .map((a) => a.workerId)
      .filter((w): w is number => w != null);
    const openIssues = workerIds.length
      ? await this.prisma.materialIssue.findMany({
          where: {
            organizationId: tenantId,
            issuedToId: { in: workerIds },
            status: { in: ['OPEN', 'PARTIAL'] as any },
          },
          include: { returns: true },
        })
      : [];
    const missing = openIssues
      .map((issue) => {
        const returned = (issue.returns ?? []).reduce(
          (s, r) => s + r.quantity,
          0,
        );
        return {
          workerId: issue.issuedToId,
          issueId: issue.id,
          shortQty: issue.quantity - returned,
        };
      })
      .filter((m) => m.shortQty > 0);
    const handoverClean = missing.length === 0;

    await this.prisma.shiftSession.update({
      where: { id },
      data: { status: 'ENDED', endedAt: new Date(), handoverClean },
    });
    if (!handoverClean) {
      const ids = [
        ...new Set(
          missing.map((m) => m.workerId).filter((w): w is number => w != null),
        ),
      ];
      const workers = ids.length
        ? await this.prisma.user.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true },
          })
        : [];
      const names = workers.map((w) => w.name).join(', ');
      await this.notifications
        .notifyOwner(
          'Shift handover: unreturned materials',
          `Shift "${session.name}" ended with ${missing.length} outstanding material issue(s) from: ${names || 'unknown workers'}`,
        )
        .catch(() => undefined);
    }
    const openTools = workerIds.length
      ? await this.prisma.machineIssuance.findMany({
          where: {
            organizationId: tenantId,
            status: { in: ["OUT", "PARTIAL"] },
            OR: [{ shiftId: id }, { workerId: { in: workerIds } }],
          },
          include: {
            machine: { select: { id: true, name: true, code: true } },
            items: { where: { status: "OUT" } },
          },
        })
      : [];
    return { id, handoverClean, missing, unreturnedIssuances: openTools };
  }

  // ---------------------------------------------------------------------------
  // Variance: issued − returned vs the BOM standard for a work order/job
  // ---------------------------------------------------------------------------

  async materialVariance(filters: { workOrderId?: number; jobId?: number }) {
    const tenantId = this.tenantId();
    let producedQty: number | null = null;
    let bom: any = null;
    if (filters.workOrderId) {
      const wo = await this.prisma.workOrder.findFirst({
        where: { id: filters.workOrderId, organizationId: tenantId },
        include: { bom: { include: { items: true } } },
      });
      if (!wo)
        throw new NotFoundException(
          tr('errors.manufacturing.workOrderNotFound'),
        );
      producedQty = wo.producedQuantity || wo.targetQuantity;
      bom = wo.bom;
    } else if (filters.jobId) {
      const job = await this.prisma.manufacturingOrder.findFirst({
        where: { id: filters.jobId, organizationId: tenantId },
        include: { bom: { include: { items: true } } },
      });
      if (!job)
        throw new NotFoundException(tr('errors.manufacturing.jobNotFound'));
      // Completed jobs carry the real output snapshot (auto-copied from the
      // linked work order); unfinished ones fall back to the target.
      producedQty = job.producedQuantity ?? job.targetQuantity;
      bom = job.bom;
    }

    const issues = await this.prisma.materialIssue.findMany({
      where: {
        organizationId: tenantId,
        ...(filters.workOrderId ? { workOrderId: filters.workOrderId } : {}),
        ...(filters.jobId ? { jobId: filters.jobId } : {}),
      },
      include: { returns: true },
    });
    const totals = new Map<number, { issued: number; returned: number }>();
    for (const issue of issues) {
      const entry = totals.get(issue.productId) ?? { issued: 0, returned: 0 };
      entry.issued += issue.quantity;
      entry.returned += (issue.returns ?? []).reduce(
        (s, r) => s + r.quantity,
        0,
      );
      totals.set(issue.productId, entry);
    }
    const productIds = [
      ...new Set([
        ...totals.keys(),
        ...(bom?.items ?? []).map((i: any) => i.rawMaterialProductId),
      ]),
    ];
    const products = productIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, brand: true, baseName: true },
        })
      : [];
    const nameById = new Map(
      products.map((p) => [p.id, `${p.brand} ${p.baseName}`.trim()]),
    );

    const standard = new Map<number, number>();
    for (const item of bom?.items ?? []) {
      standard.set(
        item.rawMaterialProductId,
        (item.quantityRequired ?? 0) * (producedQty ?? 0),
      );
    }

    const mergedIds = new Set([...totals.keys(), ...standard.keys()]);
    return {
      producedQty,
      rows: [...mergedIds].map((productId) => {
        const t = totals.get(productId) ?? { issued: 0, returned: 0 };
        const std = standard.get(productId) ?? null;
        return {
          productId,
          productName: nameById.get(productId) ?? `#${productId}`,
          issued: t.issued,
          returned: t.returned,
          used: Math.max(0, t.issued - t.returned),
          standard: std,
          variance:
            std != null
              ? Math.round((t.issued - t.returned - std) * 100) / 100
              : null,
        };
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // Raw-material purchasing: vendors, purchase orders, goods receipts (GRN)
  // ---------------------------------------------------------------------------

  private nextDocNumber(prefix: string): string {
    const y = new Date().getFullYear();
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `${prefix}-${y}-${rand}`;
  }

  private async vendorNameById(vendorId: number, tenantId: number) {
    const v = await this.prisma.mfgVendor.findFirst({
      where: { id: vendorId, organizationId: tenantId },
      select: { id: true, name: true },
    });
    if (!v) throw new NotFoundException(tr('errors.manufacturing.vendorNotFound'));
    return v;
  }

  async listVendors(search?: string) {
    const tenantId = this.tenantId();
    return this.prisma.mfgVendor.findMany({
      where: {
        organizationId: tenantId,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' as const } },
                { contactPerson: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      include: { _count: { select: { purchaseOrders: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async createVendor(dto: CreateVendorDto) {
    const tenantId = this.tenantId();
    try {
      return await this.prisma.mfgVendor.create({
        data: {
          organizationId: tenantId,
          name: dto.name.trim(),
          contactPerson: dto.contactPerson ?? null,
          email: dto.email ?? null,
          phone: dto.phone ?? null,
          address: dto.address ?? null,
          taxId: dto.taxId ?? null,
          paymentTermsDays: dto.paymentTermsDays ?? null,
        },
      });
    } catch (err) {
      if (this.isDuplicate(err))
        throw new BadRequestException(tr('errors.manufacturing.duplicateVendor'));
      throw err;
    }
  }

  async updateVendor(id: number, dto: UpdateVendorDto) {
    const tenantId = this.tenantId();
    const existing = await this.prisma.mfgVendor.findFirst({
      where: { id, organizationId: tenantId },
    });
    if (!existing)
      throw new NotFoundException(tr('errors.manufacturing.vendorNotFound'));
    try {
      return await this.prisma.mfgVendor.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.contactPerson !== undefined
            ? { contactPerson: dto.contactPerson?.trim() || null }
            : {}),
          ...(dto.email !== undefined
            ? { email: dto.email?.trim() || null }
            : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone?.trim() || null } : {}),
          ...(dto.address !== undefined
            ? { address: dto.address?.trim() || null }
            : {}),
          ...(dto.taxId !== undefined ? { taxId: dto.taxId?.trim() || null } : {}),
          ...(dto.paymentTermsDays !== undefined
            ? { paymentTermsDays: dto.paymentTermsDays ?? null }
            : {}),
        },
      });
    } catch (err) {
      if (this.isDuplicate(err))
        throw new BadRequestException(tr('errors.manufacturing.duplicateVendor'));
      throw err;
    }
  }

  async deleteVendor(id: number) {
    const tenantId = this.tenantId();
    const existing = await this.prisma.mfgVendor.findFirst({
      where: { id, organizationId: tenantId },
      include: { _count: { select: { purchaseOrders: true } } },
    });
    if (!existing)
      throw new NotFoundException(tr('errors.manufacturing.vendorNotFound'));
    if (existing._count.purchaseOrders > 0) {
      throw new BadRequestException(tr('errors.manufacturing.vendorInUse'));
    }
    await this.prisma.mfgVendor.delete({ where: { id } });
    return { id };
  }

  async listMaterialProducts() {
    // Raw-material products = any product referenced by the tenant's BOMs.
    const tenantId = this.tenantId();
    const boms = await this.prisma.billOfMaterials.findMany({
      where: { organizationId: tenantId },
      select: { items: { select: { rawMaterialProductId: true } } },
    });
    const ids = [
      ...new Set(boms.flatMap((b) => b.items.map((i) => i.rawMaterialProductId))),
    ];
    if (!ids.length) return [];
    return this.prisma.product.findMany({
      where: { id: { in: ids }, tenantId },
      select: {
        id: true,
        brand: true,
        baseName: true,
        currentBuyPrice: true,
        unit: { select: { name: true } },
      },
      orderBy: { baseName: 'asc' },
    });
  }

  async listPurchaseOrders(
    filters: { status?: string; search?: string; vendorId?: number } = {},
  ) {
    const tenantId = this.tenantId();
    const where: any = { organizationId: tenantId };
    if (filters.status) where.status = filters.status as MfgPoStatus;
    if (filters.vendorId) where.vendorId = filters.vendorId;
    if (filters.search) {
      where.OR = [
        { poNumber: { contains: filters.search, mode: 'insensitive' } },
        { vendor: { name: { contains: filters.search, mode: 'insensitive' } } },
      ];
    }
    return this.prisma.mfgPurchaseOrder.findMany({
      where,
      include: {
        vendor: true,
        items: true,
        receipts: { select: { id: true, grnNumber: true, receivedAt: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPurchaseOrder(id: number) {
    const tenantId = this.tenantId();
    const po = await this.prisma.mfgPurchaseOrder.findFirst({
      where: { id, organizationId: tenantId },
      include: {
        vendor: true,
        items: true,
        receipts: { include: { items: true }, orderBy: { receivedAt: 'desc' } },
      },
    });
    if (!po) throw new NotFoundException(tr('errors.manufacturing.poNotFound'));
    return po;
  }

  async createPurchaseOrder(dto: CreatePurchaseOrderDto, user: JwtPayload) {
    const tenantId = this.tenantId();
    await this.vendorNameById(dto.vendorId, tenantId);
    if (!dto.items.length)
      throw new BadRequestException(tr('errors.manufacturing.poItemsRequired'));
    for (const line of dto.items) {
      const p = await this.prisma.product.findFirst({
        where: { id: line.productId, tenantId },
        select: { id: true },
      });
      if (!p)
        throw new NotFoundException(tr('errors.manufacturing.productNotFound'));
    }
    const totalAmount = round2(
      dto.items.reduce((s, i) => s + i.quantity * i.unitCost, 0),
    );
    const poNumber = this.nextDocNumber('PO');
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      return tx.mfgPurchaseOrder.create({
        data: {
          organizationId: tenantId,
          poNumber,
          vendorId: dto.vendorId,
          expectedDeliveryDate: dto.expectedDeliveryDate
            ? new Date(dto.expectedDeliveryDate)
            : null,
          notes: dto.notes ?? null,
          totalAmount,
          createdById: user.sub,
          items: {
            create: dto.items.map((i) => ({
              organizationId: tenantId,
              productId: i.productId,
              quantity: i.quantity,
              unitCost: i.unitCost,
            })),
          },
        },
        include: { vendor: true, items: true },
      });
    });
  }

  async updatePurchaseOrder(id: number, dto: UpdatePurchaseOrderDto) {
    const tenantId = this.tenantId();
    const existing = await this.prisma.mfgPurchaseOrder.findFirst({
      where: { id, organizationId: tenantId },
      include: { items: true },
    });
    if (!existing)
      throw new NotFoundException(tr('errors.manufacturing.poNotFound'));
    if (existing.status !== MfgPoStatus.DRAFT)
      throw new BadRequestException(tr('errors.manufacturing.poNotEditable'));

    if (dto.vendorId != null) await this.vendorNameById(dto.vendorId, tenantId);
    let totalAmount = existing.totalAmount;
    let itemData: Array<{
      productId: number;
      quantity: number;
      unitCost: number;
      organizationId: number;
    }> | null = null;
    if (dto.items !== undefined) {
      if (!dto.items.length)
        throw new BadRequestException(tr('errors.manufacturing.poItemsRequired'));
      for (const line of dto.items) {
        const p = await this.prisma.product.findFirst({
          where: { id: line.productId, tenantId },
          select: { id: true },
        });
        if (!p)
          throw new NotFoundException(tr('errors.manufacturing.productNotFound'));
      }
      itemData = dto.items.map((i) => ({
        organizationId: tenantId,
        productId: i.productId,
        quantity: i.quantity,
        unitCost: i.unitCost,
      }));
      totalAmount = round2(
        dto.items.reduce((s, i) => s + i.quantity * i.unitCost, 0),
      );
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (itemData) {
        await tx.mfgPurchaseOrderItem.deleteMany({
          where: { poId: id, organizationId: tenantId },
        });
      }
      return tx.mfgPurchaseOrder.update({
        where: { id },
        data: {
          ...(dto.vendorId !== undefined ? { vendorId: dto.vendorId } : {}),
          ...(dto.expectedDeliveryDate !== undefined
            ? {
                expectedDeliveryDate: dto.expectedDeliveryDate
                  ? new Date(dto.expectedDeliveryDate)
                  : null,
              }
            : {}),
          ...(dto.notes !== undefined
            ? { notes: dto.notes?.trim() || null }
            : {}),
          totalAmount,
          ...(itemData ? { items: { create: itemData } } : {}),
        },
        include: { vendor: true, items: true },
      });
    });
  }

  async sendPurchaseOrder(id: number, user: JwtPayload) {
    const tenantId = this.tenantId();
    const po = await this.prisma.mfgPurchaseOrder.findFirst({
      where: { id, organizationId: tenantId },
    });
    if (!po) throw new NotFoundException(tr('errors.manufacturing.poNotFound'));
    if (po.status !== MfgPoStatus.DRAFT)
      throw new BadRequestException(tr('errors.manufacturing.poNotEditable'));
    const updated = await this.prisma.mfgPurchaseOrder.update({
      where: { id },
      data: { status: MfgPoStatus.SENT },
    });
    await this.audit(
      user.sub,
      'PO_SENT',
      `Purchase order ${po.poNumber} sent to vendor`,
    );
    return updated;
  }

  async cancelPurchaseOrder(id: number, user: JwtPayload) {
    const tenantId = this.tenantId();
    const po = await this.prisma.mfgPurchaseOrder.findFirst({
      where: { id, organizationId: tenantId },
      include: { items: true },
    });
    if (!po) throw new NotFoundException(tr('errors.manufacturing.poNotFound'));
    if (
      !([MfgPoStatus.DRAFT, MfgPoStatus.SENT] as MfgPoStatus[]).includes(
        po.status,
      )
    )
      throw new BadRequestException(tr('errors.manufacturing.poCannotCancel'));
    const received = po.items.reduce(
      (s, i) => s + (i.quantityReceived ?? 0),
      0,
    );
    if (received > 0)
      throw new BadRequestException(tr('errors.manufacturing.poCannotCancel'));
    const updated = await this.prisma.mfgPurchaseOrder.update({
      where: { id },
      data: { status: MfgPoStatus.CANCELLED },
    });
    await this.audit(
      user.sub,
      'PO_CANCELLED',
      `Purchase order ${po.poNumber} cancelled`,
    );
    return updated;
  }

  async deletePurchaseOrder(id: number) {
    const tenantId = this.tenantId();
    const po = await this.prisma.mfgPurchaseOrder.findFirst({
      where: { id, organizationId: tenantId },
      include: { _count: { select: { receipts: true } } },
    });
    if (!po) throw new NotFoundException(tr('errors.manufacturing.poNotFound'));
    if (po._count.receipts > 0)
      throw new BadRequestException(tr('errors.manufacturing.poHasReceipts'));
    if (
      !([MfgPoStatus.DRAFT, MfgPoStatus.CANCELLED] as MfgPoStatus[]).includes(
        po.status,
      )
    )
      throw new BadRequestException(tr('errors.manufacturing.poNotEditable'));
    await this.prisma.mfgPurchaseOrder.delete({ where: { id } });
    return { id };
  }

  /**
   * Netting shortage: raw materials needed by all OPEN orders (with BOM +
   * target qty) minus what is already on hand and already on order.
   */
  async purchaseOrderNetting() {
    const tenantId = this.tenantId();
    const openOrders = await this.prisma.manufacturingOrder.findMany({
      where: {
        organizationId: tenantId,
        completedAt: null,
        stage: { not: MfgOrderStage.CANCELLED },
        bomId: { not: null },
        targetQuantity: { not: null },
      },
      include: {
        bom: {
          include: {
            items: {
              include: {
                rawMaterial: {
                  select: { id: true, brand: true, baseName: true },
                },
              },
            },
          },
        },
      },
    });
    const required = new Map<number, number>();
    const names = new Map<number, string>();
    for (const order of openOrders) {
      const bom = order.bom;
      if (!bom) continue;
      const qty = order.targetQuantity ?? 1;
      for (const item of bom.items) {
        const need =
          item.quantityRequired *
          qty *
          (1 + (bom.scrapPercentage ?? 0) / 100);
        required.set(
          item.rawMaterialProductId,
          (required.get(item.rawMaterialProductId) ?? 0) + need,
        );
        names.set(
          item.rawMaterialProductId,
          `${item.rawMaterial.brand ?? ''} ${item.rawMaterial.baseName ?? ''}`.trim() ||
            `#${item.rawMaterialProductId}`,
        );
      }
    }
    if (required.size === 0) return { lines: [], orderCount: 0 };

    const productIds = [...required.keys()];
    const onHandAgg = await this.prisma.inventory.groupBy({
      by: ['productId'],
      where: { tenantId, productId: { in: productIds } },
      _sum: { quantity: true },
    });
    const onHand = new Map(
      onHandAgg.map((r) => [r.productId, r._sum.quantity ?? 0]),
    );

    // Already-ordered, not-yet-arrived quantities shouldn't be re-bought.
    const onOrderRows = await this.prisma.mfgPurchaseOrderItem.findMany({
      where: { organizationId: tenantId, productId: { in: productIds } },
      select: {
        productId: true,
        quantity: true,
        quantityReceived: true,
        quantityRejected: true,
      },
    });
    const onOrder = new Map<number, number>();
    for (const r of onOrderRows) {
      const openQty = Math.max(
        0,
        r.quantity - r.quantityReceived - r.quantityRejected,
      );
      onOrder.set(
        r.productId,
        (onOrder.get(r.productId) ?? 0) + openQty,
      );
    }

    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, tenantId },
      select: { id: true, brand: true, baseName: true, currentBuyPrice: true },
    });
    const costHint = new Map(
      products.map((p) => [p.id, p.currentBuyPrice ?? 0]),
    );

    const lines = productIds
      .map((productId) => {
        const req = round2(required.get(productId) ?? 0);
        const hand = round2(onHand.get(productId) ?? 0);
        const ordered = round2(onOrder.get(productId) ?? 0);
        const shortage = round2(Math.max(0, req - hand - ordered));
        return {
          productId,
          productName: names.get(productId) ?? `#${productId}`,
          required: req,
          onHand: hand,
          onOrder: ordered,
          suggestedQty: shortage,
          unitCostHint: costHint.get(productId) ?? 0,
        };
      })
      .filter((l) => l.suggestedQty > 0)
      .sort((a, b) => b.suggestedQty - a.suggestedQty);
    return { lines, orderCount: openOrders.length };
  }

  async listGoodsReceipts(
    filters: { search?: string; purchaseOrderId?: number } = {},
  ) {
    const tenantId = this.tenantId();
    const where: any = { organizationId: tenantId };
    if (filters.purchaseOrderId) where.poId = filters.purchaseOrderId;
    if (filters.search) {
      where.OR = [
        { grnNumber: { contains: filters.search, mode: 'insensitive' } },
        { po: { poNumber: { contains: filters.search, mode: 'insensitive' } } },
      ];
    }
    return this.prisma.mfgGoodsReceipt.findMany({
      where,
      include: {
        po: { include: { vendor: true } },
        items: true,
      },
      orderBy: { receivedAt: 'desc' },
    });
  }

  async getGoodsReceipt(id: number) {
    const tenantId = this.tenantId();
    const grn = await this.prisma.mfgGoodsReceipt.findFirst({
      where: { id, organizationId: tenantId },
      include: {
        po: { include: { vendor: true, items: true } },
        items: true,
      },
    });
    if (!grn)
      throw new NotFoundException(tr('errors.manufacturing.grnNotFound'));
    return grn;
  }

  /**
   * Receive raw material against a SENT PO: creates the GRN, increments the
   * live store balance at PO unit cost, and advances the PO to
   * PARTIALLY_RECEIVED / RECEIVED.
   */
  async receiveGoods(dto: CreateGoodsReceiptDto, user: JwtPayload) {
    const tenantId = this.tenantId();
    const po = await this.prisma.mfgPurchaseOrder.findFirst({
      where: { id: dto.purchaseOrderId, organizationId: tenantId },
      include: { items: true, vendor: true },
    });
    if (!po) throw new NotFoundException(tr('errors.manufacturing.poNotFound'));
    if (
      !([MfgPoStatus.SENT, MfgPoStatus.PARTIALLY_RECEIVED] as MfgPoStatus[]).includes(
        po.status,
      )
    )
      throw new BadRequestException(tr('errors.manufacturing.poNotReceivable'));

    const location = await this.prisma.location.findFirst({
      where: { id: dto.locationId, tenantId },
      select: { id: true, name: true },
    });
    if (!location)
      throw new NotFoundException(tr('errors.manufacturing.locationNotFound'));

    // Validate lines against the PO items & remaining quantities.
    const lines: Array<{
      poItemId: number;
      productId: number;
      orderedQty: number;
      previouslyReceived: number;
      receivedQty: number;
      rejectedQty: number;
      unitCost: number;
      batchNumber?: string | null;
      expiryDate?: Date | null;
      manufactureDate?: Date | null;
      rejectReason?: string | null;
    }> = [];
    let incoming = 0;
    for (const entry of dto.items) {
      const item = po.items.find((i) => i.id === entry.poItemId);
      if (!item)
        throw new BadRequestException(
          tr('errors.manufacturing.grnLineNotOnPo'),
        );
      const already =
        (item.quantityReceived ?? 0) + (item.quantityRejected ?? 0);
      const remaining = Math.max(0, item.quantity - already);
      const receivedQty = Math.max(0, entry.receivedQty ?? 0);
      const rejectedQty = Math.max(0, entry.rejectedQty ?? 0);
      if (receivedQty + rejectedQty > remaining + 1e-9) {
        throw new BadRequestException(
          tr('errors.manufacturing.grnOverReceipt', {
            productId: item.productId,
            remaining,
          }),
        );
      }
      lines.push({
        poItemId: item.id,
        productId: item.productId,
        orderedQty: item.quantity,
        previouslyReceived: item.quantityReceived ?? 0,
        receivedQty,
        rejectedQty,
        unitCost: item.unitCost ?? 0,
        batchNumber: entry.batchNumber?.trim() || null,
        expiryDate: entry.expiryDate ? new Date(entry.expiryDate) : null,
        manufactureDate: entry.manufactureDate ? new Date(entry.manufactureDate) : null,
        rejectReason: entry.rejectReason?.trim() || null,
      });
      incoming += receivedQty + rejectedQty;
    }
    if (incoming <= 0)
      throw new BadRequestException(
        tr('errors.manufacturing.grnNothingReceived'),
      );

    const grnNumber = this.nextDocNumber('GRN');
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const receipt = await tx.mfgGoodsReceipt.create({
        data: {
          organizationId: tenantId,
          grnNumber,
          poId: po.id,
          locationId: dto.locationId,
          receivedById: user.sub,
          receivedAt: dto.receivedAt ? new Date(dto.receivedAt) : new Date(),
          notes: dto.notes ?? null,
          items: {
            create: lines.map((l) => ({
              organizationId: tenantId,
              poItemId: l.poItemId,
              productId: l.productId,
              orderedQty: l.orderedQty,
              previouslyReceived: l.previouslyReceived,
              receivedQty: l.receivedQty,
              rejectedQty: l.rejectedQty,
              unitCost: l.unitCost,
              quantityBilled: 0,
              batchNumber: l.batchNumber ?? null,
              expiryDate: l.expiryDate ?? null,
              manufactureDate: l.manufactureDate ?? null,
              rejectReason: l.rejectReason ?? null,
            })),
          },
        },
      });

      for (const line of lines) {
        const stocked = round2(line.receivedQty - line.rejectedQty);
        if (stocked > 0) {
          await inventoryUpsert(tx, {
            productId: line.productId,
            locationId: dto.locationId,
            variantId: null,
            increment: stocked,
            unitCost: line.unitCost,
            tenantId,
          });
        }
        await tx.mfgPurchaseOrderItem.update({
          where: { id: line.poItemId },
          data: {
            quantityReceived: { increment: line.receivedQty },
            quantityRejected: { increment: line.rejectedQty },
          },
        });
      }

      const grnItems = await tx.mfgGoodsReceiptItem.findMany({
        where: { receiptId: receipt.id },
      });
      let accrualTotal = 0;
      for (const line of lines) {
        const grnItem = grnItems.find((g: any) => g.poItemId === line.poItemId);
        if (!grnItem) continue;
        if (line.rejectedQty > 0) {
          await tx.mfgRejectedStock.create({
            data: {
              organizationId: tenantId,
              grnItemId: grnItem.id,
              grnId: receipt.id,
              poId: po.id,
              vendorId: po.vendorId,
              productId: line.productId,
              quantity: line.rejectedQty,
              unitCost: line.unitCost,
              reason: line.rejectReason ?? 'OTHER',
              disposition: 'QUARANTINE',
              locationId: dto.locationId,
              createdById: user.sub,
            },
          });
        }
        const stocked = round2(line.receivedQty - line.rejectedQty);
        if (stocked > 0 && line.batchNumber) {
          const existingBatch = await tx.productBatch.findFirst({
            where: { tenantId, productId: line.productId, batchNumber: line.batchNumber },
          });
          if (existingBatch) {
            await tx.productBatch.update({
              where: { id: existingBatch.id },
              data: { quantity: { increment: stocked } },
            });
          } else {
            await tx.productBatch.create({
              data: {
                tenantId,
                productId: line.productId,
                batchNumber: line.batchNumber,
                expiryDate: line.expiryDate ?? null,
                manufactureDate: line.manufactureDate ?? null,
                locationId: dto.locationId,
                quantity: stocked,
                unitCost: line.unitCost,
                vendorId: po.vendorId,
                grnId: receipt.id,
                grnItemId: grnItem.id,
              },
            });
          }
        }
        accrualTotal += round2(line.receivedQty * line.unitCost);
      }
      if (accrualTotal > 0) {
        await this.finance.postProcurement({
          ref: `GRN-${receipt.id}`,
          description: `GRN ${grnNumber} - ${po.poNumber}`,
          amount: accrualTotal,
          entryDate: dto.receivedAt ? new Date(dto.receivedAt) : undefined,
          createdById: user.sub,
          paid: false,
          tenantId,
          tx,
        });
      }
      const allClosed = po.items.every((i) => {
        const extra =
          (lines.find((l) => l.poItemId === i.id)?.receivedQty ?? 0) +
          (lines.find((l) => l.poItemId === i.id)?.rejectedQty ?? 0);
        return i.quantityReceived + i.quantityRejected + extra >= i.quantity;
      });
      const status = allClosed
        ? MfgPoStatus.RECEIVED
        : MfgPoStatus.PARTIALLY_RECEIVED;
      await tx.mfgPurchaseOrder.update({
        where: { id: po.id },
        data: { status },
      });
      await tx.auditLog.create({
        data: {
          userId: user.sub,
          action: 'GOODS_RECEIVED',
          details: `GRN ${grnNumber} — PO ${po.poNumber} from ${po.vendor?.name ?? `#${po.vendorId}`} (${lines.length} line(s))`,
        },
      });
      return tx.mfgGoodsReceipt.findFirst({
        where: { id: receipt.id },
        include: { items: true, po: { include: { vendor: true } } },
      });
    });
  }

  /** Open purchase-order lines (backorders) grouped by PO and vendor. */
  async listOpenPurchaseOrderLines() {
    const tenantId = this.tenantId();
    const pos = await this.prisma.mfgPurchaseOrder.findMany({
      where: { organizationId: tenantId, status: { in: ['SENT', 'PARTIALLY_RECEIVED'] } },
      include: { vendor: true, items: true },
      orderBy: { createdAt: 'desc' },
    });
    const result: any[] = [];
    for (const po of pos) {
      const lines = (po.items ?? [])
        .map((it: any) => ({
          poItemId: it.id,
          productId: it.productId,
          orderedQty: it.quantity ?? 0,
          receivedQty: it.quantityReceived ?? 0,
          rejectedQty: it.quantityRejected ?? 0,
          unitCost: it.unitCost ?? 0,
          expectedDeliveryDate: it.expectedDeliveryDate ?? po.expectedDeliveryDate ?? null,
          backorderQty: Math.max(0, round2((it.quantity ?? 0) - (it.quantityReceived ?? 0) - (it.quantityRejected ?? 0))),
        }))
        .filter((l: any) => l.backorderQty > 0);
      if (lines.length > 0) {
        result.push({
          poId: po.id,
          poNumber: po.poNumber,
          vendorId: po.vendorId,
          vendor: po.vendor?.name ?? null,
          status: po.status,
          expectedDeliveryDate: po.expectedDeliveryDate,
          lines,
          totalValue: round2(lines.reduce((s: number, l: any) => s + l.backorderQty * l.unitCost, 0)),
        });
      }
    }
    return result;
  }

  /** Rejected / quarantined stock audit list. */
  async listRejectedStock(filters: { disposition?: string } = {}) {
    const tenantId = this.tenantId();
    return this.prisma.mfgRejectedStock.findMany({
      where: {
        organizationId: tenantId,
        ...(filters.disposition ? { disposition: filters.disposition as any } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Creates a DRAFT vendor bill from a GRN (3-way PO<->GRN<->Bill match). */
  async createVendorBillFromGrn(dto: GenerateVendorBillDto, user: JwtPayload) {
    const tenantId = this.tenantId();
    const grn = await this.prisma.mfgGoodsReceipt.findFirst({
      where: { id: dto.grnId, organizationId: tenantId },
      include: { items: true, po: { include: { vendor: true } } },
    });
    if (!grn) throw new NotFoundException('Goods receipt not found');
    const dup = await this.prisma.mfgVendorBill.findFirst({
      where: { organizationId: tenantId, grnId: grn.id },
    });
    if (dup) throw new BadRequestException('A vendor bill already exists for this GRN');
    const billable = (grn.items ?? []).filter((i: any) => (i.receivedQty ?? 0) > 0);
    if (!billable.length) throw new BadRequestException('GRN has no received lines to bill');
    const totalAmount = round2(
      billable.reduce((s: number, i: any) => s + (i.receivedQty ?? 0) * (i.unitCost ?? 0), 0),
    );
    const vendorId = grn.vendorId ?? grn.po?.vendorId ?? null;
    const billNumber = this.nextDocNumber('BILL');
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const bill = await tx.mfgVendorBill.create({
        data: {
          organizationId: tenantId,
          billNumber,
          vendorId,
          poId: grn.poId ?? null,
          grnId: grn.id,
          totalAmount,
          taxAmount: 0,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          notes: dto.notes ?? null,
          createdById: user.sub,
          items: {
            create: billable.map((i: any) => ({
              organizationId: tenantId,
              poItemId: i.poItemId,
              grnItemId: i.id,
              productId: i.productId,
              quantity: i.receivedQty ?? 0,
              unitCost: i.unitCost ?? 0,
              amount: round2((i.receivedQty ?? 0) * (i.unitCost ?? 0)),
            })),
          },
        },
        include: { items: true },
      });
      for (const i of billable) {
        await tx.mfgGoodsReceiptItem.update({
          where: { id: i.id },
          data: { quantityBilled: { increment: i.receivedQty ?? 0 } },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: user.sub,
          action: 'VENDOR_BILL',
          details: `Bill ${billNumber} created from GRN ${grn.grnNumber}`,
        },
      });
      return bill;
    });
  }

  /** Vendor bills with items (3-way PO<->GRN<->Bill view). */
  async listVendorBills() {
    const tenantId = this.tenantId();
    return this.prisma.mfgVendorBill.findMany({
      where: { organizationId: tenantId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getVendorBill(id: number) {
    const tenantId = this.tenantId();
    const bill = await this.prisma.mfgVendorBill.findFirst({
      where: { id, organizationId: tenantId },
      include: { items: true },
    });
    if (!bill) throw new NotFoundException('Vendor bill not found');
    const creditNotes = await this.prisma.mfgVendorCreditNote.findMany({
      where: { organizationId: tenantId, billId: id },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
    return { ...bill, creditNotes };
  }

  /** Approve (OPEN) a DRAFT bill - the AP liability was already accrued at GRN. */
  async approveVendorBill(id: number, user: JwtPayload) {
    const tenantId = this.tenantId();
    const bill = await this.prisma.mfgVendorBill.findFirst({
      where: { id, organizationId: tenantId },
    });
    if (!bill) throw new NotFoundException('Vendor bill not found');
    if (bill.status !== MfgBillStatus.DRAFT)
      throw new BadRequestException('Only DRAFT bills can be approved');
    const updated = await this.prisma.mfgVendorBill.update({
      where: { id },
      data: { status: MfgBillStatus.OPEN },
    });
    await this.prisma.auditLog.create({
      data: { userId: user.sub, action: 'VENDOR_BILL_OPEN', details: `Bill ${bill.billNumber} approved` },
    });
    return updated;
  }

  /** Delete a DRAFT bill. */
  async deleteVendorBill(id: number) {
    const tenantId = this.tenantId();
    const bill = await this.prisma.mfgVendorBill.findFirst({
      where: { id, organizationId: tenantId },
    });
    if (!bill) throw new NotFoundException('Vendor bill not found');
    if (bill.status !== MfgBillStatus.DRAFT)
      throw new BadRequestException('Only DRAFT bills can be deleted');
    await this.prisma.mfgVendorBill.delete({ where: { id } });
    return { message: 'Vendor bill deleted' };
  }

  /** Record a payment against an OPEN/PARTIALLY_PAID bill (Dr AP ↔ Cr Cash). */
  async payVendorBill(id: number, dto: PayVendorBillDto, user: JwtPayload) {
    const tenantId = this.tenantId();
    const bill = await this.prisma.mfgVendorBill.findFirst({
      where: { id, organizationId: tenantId },
    });
    if (!bill) throw new NotFoundException('Vendor bill not found');
    if (![MfgBillStatus.OPEN, MfgBillStatus.PARTIALLY_PAID].includes(bill.status as any))
      throw new BadRequestException('Only OPEN or PARTIALLY_PAID bills accept payments');
    const creditAgg = await this.prisma.mfgVendorCreditNote.aggregate({
      where: {
        organizationId: tenantId,
        billId: id,
        status: { in: [MfgCreditNoteStatus.ISSUED, MfgCreditNoteStatus.APPLIED] },
      },
      _sum: { totalAmount: true },
    });
    const netDue = round2((bill.totalAmount ?? 0) - ((creditAgg._sum.totalAmount as number) ?? 0));
    if (dto.amount > netDue + 0.01)
      throw new BadRequestException(`Payment ${dto.amount} exceeds outstanding ${netDue}`);
    await this.finance.postVendorBillPayment({
      ref: `VBP-${bill.id}-${Date.now()}`,
      amount: dto.amount,
      tenantId,
      createdById: user.sub,
      entryDate: dto.paidAt ? new Date(dto.paidAt) : undefined,
    });
    const newStatus =
      Math.abs(dto.amount - netDue) < 0.01
        ? MfgBillStatus.PAID
        : MfgBillStatus.PARTIALLY_PAID;
    const updated = await this.prisma.mfgVendorBill.update({
      where: { id },
      data: { status: newStatus },
    });
    await this.prisma.auditLog.create({
      data: {
        userId: user.sub,
        action: 'VENDOR_BILL_PAY',
        details: `Paid ${dto.amount} on bill ${bill.billNumber}`,
      },
    });
    return updated;
  }

  /** Create a DRAFT vendor credit note from quarantined rejections. */
  async createVendorCreditNote(dto: CreateVendorCreditNoteDto, user: JwtPayload) {
    const tenantId = this.tenantId();
    if (!dto.items.length) throw new BadRequestException('Add at least one rejection line');
    const rejections = await this.prisma.mfgRejectedStock.findMany({
      where: {
        organizationId: tenantId,
        id: { in: dto.items.map((i) => i.rejectionId) },
        disposition: MfgRejectDisposition.QUARANTINE,
      },
    });
    const lines: any[] = [];
    let total = 0;
    for (const item of dto.items) {
      const rej = rejections.find((r) => r.id === item.rejectionId);
      if (!rej) continue;
      const qty = Math.min(item.quantity ?? rej.quantity, rej.quantity);
      if (qty <= 0) continue;
      const amount = round2(qty * rej.unitCost);
      total += amount;
      lines.push({
        organizationId: tenantId,
        rejectionId: rej.id,
        grnItemId: rej.grnItemId,
        productId: rej.productId,
        quantity: qty,
        unitCost: rej.unitCost,
        amount,
      });
    }
    if (!lines.length) throw new BadRequestException('No usable rejection lines');
    const vendorId = dto.vendorId ?? rejections[0]?.vendorId ?? null;
    const grnId = dto.grnId ?? rejections[0]?.grnId ?? null;
    const creditNoteNumber = this.nextDocNumber('CN');
    const note = await this.prisma.mfgVendorCreditNote.create({
      data: {
        organizationId: tenantId,
        creditNoteNumber,
        vendorId,
        grnId,
        billId: dto.billId ?? null,
        totalAmount: round2(total),
        reason: dto.notes ?? null,
        createdById: user.sub,
        items: { create: lines },
      },
      include: { items: true },
    });
    return note;
  }

  async listVendorCreditNotes() {
    const tenantId = this.tenantId();
    return this.prisma.mfgVendorCreditNote.findMany({
      where: { organizationId: tenantId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Issue (ISSUED) a DRAFT credit note to the vendor. */
  async issueVendorCreditNote(id: number, user: JwtPayload) {
    const tenantId = this.tenantId();
    const note = await this.prisma.mfgVendorCreditNote.findFirst({
      where: { id, organizationId: tenantId },
    });
    if (!note) throw new NotFoundException('Credit note not found');
    if (note.status !== MfgCreditNoteStatus.DRAFT)
      throw new BadRequestException('Only DRAFT credit notes can be issued');
    const updated = await this.prisma.mfgVendorCreditNote.update({
      where: { id },
      data: { status: MfgCreditNoteStatus.ISSUED },
    });
    await this.prisma.auditLog.create({
      data: {
        userId: user.sub,
        action: 'CREDIT_NOTE_ISSUED',
        details: `Credit note ${note.creditNoteNumber} issued`,
      },
    });
    return updated;
  }

  /** Delete a DRAFT credit note. */
  async deleteVendorCreditNote(id: number) {
    const tenantId = this.tenantId();
    const note = await this.prisma.mfgVendorCreditNote.findFirst({
      where: { id, organizationId: tenantId },
    });
    if (!note) throw new NotFoundException('Credit note not found');
    if (note.status !== MfgCreditNoteStatus.DRAFT)
      throw new BadRequestException('Only DRAFT credit notes can be deleted');
    await this.prisma.mfgVendorCreditNote.delete({ where: { id } });
    return { message: 'Credit note deleted' };
  }

  /** Apply (APPLIED) an ISSUED credit note: post Dr AP ↔ Cr Inventory. */
  async applyVendorCreditNote(id: number, user: JwtPayload) {
    const tenantId = this.tenantId();
    const note = await this.prisma.mfgVendorCreditNote.findFirst({
      where: { id, organizationId: tenantId },
      include: { items: true },
    });
    if (!note) throw new NotFoundException('Credit note not found');
    if (note.status !== MfgCreditNoteStatus.ISSUED)
      throw new BadRequestException('Only ISSUED credit notes can be applied');
    await this.finance.postVendorCreditNote({
      ref: `VCN-${id}`,
      amount: note.totalAmount,
      tenantId,
      createdById: user.sub,
    });
    const updated = await this.prisma.mfgVendorCreditNote.update({
      where: { id },
      data: { status: MfgCreditNoteStatus.APPLIED },
    });
    const rejectionIds = (note.items ?? [])
      .map((i: any) => i.rejectionId)
      .filter(Boolean);
    if (rejectionIds.length) {
      await this.prisma.mfgRejectedStock.updateMany({
        where: { organizationId: tenantId, id: { in: rejectionIds } },
        data: { disposition: MfgRejectDisposition.CREDIT_NOTE_ISSUED },
      });
    }
    await this.prisma.auditLog.create({
      data: {
        userId: user.sub,
        action: 'CREDIT_NOTE_APPLIED',
        details: `Credit note ${note.creditNoteNumber} applied`,
      },
    });
    return updated;
  }

  /** Scrap a quarantined rejection (Dr Spoilage & Wastage ↔ Cr Inventory). */
  async scrapRejectedStock(id: number, user: JwtPayload) {
    const tenantId = this.tenantId();
    const rej = await this.prisma.mfgRejectedStock.findFirst({
      where: { id, organizationId: tenantId },
    });
    if (!rej) throw new NotFoundException('Rejected stock not found');
    if (rej.disposition !== MfgRejectDisposition.QUARANTINE)
      throw new BadRequestException('Only quarantined rejections can be scrapped');
    await this.finance.postScrapDisposition({
      ref: `SCP-${id}`,
      amount: round2(rej.quantity * rej.unitCost),
      tenantId,
      createdById: user.sub,
    });
    const updated = await this.prisma.mfgRejectedStock.update({
      where: { id },
      data: { disposition: MfgRejectDisposition.SCRAPPED },
    });
    await this.prisma.auditLog.create({
      data: {
        userId: user.sub,
        action: 'REJECTION_SCRAPPED',
        details: `Scrapped ${rej.quantity} of product #${rej.productId}`,
      },
    });
    return updated;
  }

  /** Direct/quick buy: immediate cash purchase that stocks materials in one step. */
  async receiveDirectGoods(dto: CreateDirectReceiptDto, user: JwtPayload) {
    const tenantId = this.tenantId();
    if (!dto.items.length) throw new BadRequestException('Add at least one line');
    for (const line of dto.items) {
      if (!(line.quantity > 0) || line.unitCost < 0)
        throw new BadRequestException('Invalid quantity or unit cost');
      const p = await this.prisma.product.findFirst({
        where: { id: line.productId, tenantId },
        select: { id: true },
      });
      if (!p) throw new NotFoundException('Product not found');
    }
    if (dto.vendorId != null) await this.vendorNameById(dto.vendorId, tenantId);
    const location = await this.prisma.location.findFirst({
      where: { id: dto.locationId, tenantId },
      select: { id: true, name: true },
    });
    if (!location) throw new NotFoundException('Location not found');
    const totalAmount = round2(dto.items.reduce((s, l) => s + l.quantity * l.unitCost, 0));
    const grnNumber = this.nextDocNumber('GRN');
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const receipt = await tx.mfgGoodsReceipt.create({
        data: {
          organizationId: tenantId,
          grnNumber,
          vendorId: dto.vendorId ?? null,
          isDirect: true,
          totalAmount,
          locationId: dto.locationId,
          receivedById: user.sub,
          receivedAt: dto.receivedAt ? new Date(dto.receivedAt) : new Date(),
          notes: dto.notes ?? null,
          items: {
            create: dto.items.map((l) => ({
              organizationId: tenantId,
              poItemId: null,
              productId: l.productId,
              orderedQty: l.quantity,
              receivedQty: l.quantity,
              rejectedQty: 0,
              unitCost: l.unitCost,
              quantityBilled: 0,
              batchNumber: l.batchNumber?.trim() || null,
              expiryDate: l.expiryDate ? new Date(l.expiryDate) : null,
              manufactureDate: l.manufactureDate ? new Date(l.manufactureDate) : null,
            })),
          },
        },
      });
      for (const l of dto.items) {
        await inventoryUpsert(tx, {
          productId: l.productId,
          locationId: dto.locationId,
          variantId: null,
          increment: l.quantity,
          unitCost: l.unitCost,
          tenantId,
        });
        if (l.batchNumber?.trim()) {
          const existingBatch = await tx.productBatch.findFirst({
            where: { tenantId, productId: l.productId, batchNumber: l.batchNumber.trim() },
          });
          if (existingBatch) {
            await tx.productBatch.update({
              where: { id: existingBatch.id },
              data: { quantity: { increment: l.quantity } },
            });
          } else {
            await tx.productBatch.create({
              data: {
                tenantId,
                productId: l.productId,
                batchNumber: l.batchNumber.trim(),
                expiryDate: l.expiryDate ? new Date(l.expiryDate) : null,
                manufactureDate: l.manufactureDate ? new Date(l.manufactureDate) : null,
                locationId: dto.locationId,
                quantity: l.quantity,
                unitCost: l.unitCost,
                vendorId: dto.vendorId ?? null,
                grnId: receipt.id,
              },
            });
          }
        }
      }
      await this.finance.postProcurement({
        ref: `GRN-${receipt.id}`,
        description: `Direct buy GRN ${grnNumber}`,
        amount: totalAmount,
        entryDate: dto.receivedAt ? new Date(dto.receivedAt) : new Date(),
        createdById: user.sub,
        paid: true,
        tenantId,
        tx,
      });
      await tx.auditLog.create({
        data: {
          userId: user.sub,
          action: 'DIRECT_GRN',
          details: `Direct buy GRN ${grnNumber} (${dto.items.length} line(s))`,
        },
      });
      return tx.mfgGoodsReceipt.findFirst({
        where: { id: receipt.id },
        include: { items: true },
      });
    });
  }

}