// src/manufacturing/dto/manufacturing.dto.ts
// DTOs for the product-centric manufacturing module (bills of materials,
// production work orders and material scrap).
import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { ScrapKind, WorkOrderStatus, MfgOrderStage, MfgPricingModel, MachineStatus, MachineComponentStatus, MfgIssueStatus } from "@prisma/client";
import { MfgRejectDisposition } from "@prisma/client";

export class BomItemInputDto {
  @IsInt()
  rawMaterialProductId!: number;

  // Raw material quantity consumed per one unit of BOM output (pre-scrap).
  @IsPositive()
  quantityRequired!: number;

  // Optional unit-of-measure override; falls back to the product unit.
  @IsOptional()
  @IsInt()
  unitId?: number | null;
}

export class CreateBomDto {
  @IsInt()
  finishedProductId!: number;

  // Units of the finished product the BOM yields per completed run.
  @IsOptional()
  @IsPositive()
  quantityProduced?: number;

  // Expected material wastage in percent, applied to every component.
  @IsOptional()
  @Min(0)
  scrapPercentage?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BomItemInputDto)
  items!: BomItemInputDto[];
}

export class UpdateBomDto {
  @IsOptional()
  @IsInt()
  finishedProductId?: number;

  @IsOptional()
  @IsPositive()
  quantityProduced?: number;

  @IsOptional()
  @Min(0)
  scrapPercentage?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  // When present the whole component list is replaced atomically.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BomItemInputDto)
  items?: BomItemInputDto[];
}

export class CreateWorkOrderDto {
  @IsInt()
  bomId!: number;

  @IsPositive()
  targetQuantity!: number;

  @IsInt()
  locationId!: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  batchNumber?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsInt()
  finishedVariantId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateWorkOrderStatusDto {
  @IsEnum(WorkOrderStatus)
  status!: WorkOrderStatus;

  // Completion overrides (used when status = COMPLETED):
  // good units actually produced (defaults to target − finished scrap).
  @IsOptional()
  @Min(0.0001)
  completedQuantity?: number;

  // Finished units scrapped at the moment of completion (defaults to 0).
  @IsOptional()
  @Min(0)
  scrappedQuantity?: number;

  // Target inventory store the finished batch is deposited into.
  @IsOptional()
  @IsInt()
  finishedLocationId?: number;
}

export class LogScrapDto {
  // Raw material written off OR defective finished unit rejected.
  @IsInt()
  productId!: number;

  @IsPositive()
  quantity!: number;

  @IsOptional()
  @IsEnum(ScrapKind)
  kind?: ScrapKind;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CreateMfgServiceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsEnum(MfgPricingModel)
  pricingModel!: MfgPricingModel;

  @IsOptional()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  periodUnit?: string;
}

export class UpdateMfgServiceDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsEnum(MfgPricingModel)
  pricingModel?: MfgPricingModel;

  @IsOptional()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  periodUnit?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class RecordMfgServiceIncomeDto {
  @IsInt()
  serviceId!: number;

  @IsOptional()
  @Min(0.0001)
  quantity?: number;

  @IsOptional()
  @IsDateString()
  incomeDate?: string;

  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CreateManufacturingOrderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  // Optional production flow to route the order through from step 0. When
  // omitted the order waits in Intake until a flow is assigned.
  @IsOptional()
  @IsInt()
  flowId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerName?: string;

  @IsOptional()
  @IsInt()
  bomId?: number;

  // Optional Design Catalog item this job produces. When set without an
  // explicit bomId the design's default BOM is auto-applied.
  @IsOptional()
  @IsInt()
  designCatalogId?: number;

  @IsOptional()
  @Min(0.0001)
  targetQuantity?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

// Detail edits are only accepted while the order is still in the pre-production
// pipeline (DESIGN → QUEUED). PRODUCTION/COMPLETED/CANCELLED orders are locked;
// use the stage endpoints to cancel instead.
export class UpdateManufacturingOrderDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerName?: string | null;

  @IsOptional()
  @IsInt()
  bomId?: number | null;

  // Optional Design Catalog item this job produces (auto-fills the default BOM
  // when the design is set/updated without an explicit bomId).
  @IsOptional()
  @IsInt()
  designCatalogId?: number | null;

  @IsOptional()
  @Min(0.0001)
  targetQuantity?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class CreateMaterialIssueDto {
  @IsInt()
  productId!: number;

  @IsPositive()
  quantity!: number;

  @IsInt()
  locationId!: number;

  @IsOptional()
  @IsInt()
  workOrderId?: number;

  @IsOptional()
  @IsInt()
  jobId?: number;

  @IsOptional()
  @IsInt()
  issuedToId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class ReturnMaterialDto {
  @IsOptional()
  @IsInt()
  issueId?: number;

  @IsOptional()
  @IsInt()
  productId?: number;

  @IsPositive()
  quantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreateConsumableIssueDto {
  @IsInt()
  productId!: number;

  @IsPositive()
  quantity!: number;

  @IsOptional()
  @IsInt()
  shiftSessionId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  groupLabel?: string;
}

export class RecordConsumableUsageDto {
  @IsInt()
  productId!: number;

  @IsOptional()
  @IsInt()
  shiftSessionId?: number;

  @Min(0)
  usedQty!: number;

  @Min(0)
  leftQty!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreateMachineDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  type?: string;

  @IsOptional()
  @IsIn(["STATIONARY", "ISSUABLE"])
  kind?: string;

  @IsOptional()
  @IsNumber()
  hourlyRate?: number;

  @IsOptional()
  @IsInt()
  locationId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateMachineStatusDto {
  @IsEnum(MachineStatus)
  status!: MachineStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class MachineComponentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsInt()
  quantity?: number;

  @IsOptional()
  @IsInt()
  partProductId?: number;
}

export class UpdateMachineComponentStatusDto {
  @IsEnum(MachineComponentStatus)
  status!: MachineComponentStatus;

  @IsOptional()
  @IsInt()
  partProductId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreateShiftTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @IsString()
  @IsNotEmpty()
  startTime!: string;

  @IsString()
  @IsNotEmpty()
  endTime!: string;

  @IsOptional()
  @IsArray()
  repeatDays?: number[];

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateShiftSessionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @IsDateString()
  date!: string;

  @IsString()
  @IsNotEmpty()
  startTime!: string;

  @IsString()
  @IsNotEmpty()
  endTime!: string;

  @IsOptional()
  @IsArray()
  workers?: number[];
}

export class UpdateManufacturingOrderStageDto {
  @IsEnum(MfgOrderStage)
  stage!: MfgOrderStage;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AssignShiftWorkersDto {
  @IsArray()
  workerIds!: number[];
}

export class CreateWorkerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsInt()
  locationId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}

export class UpdateWorkerStatusDto {
  @IsIn(['ACTIVE', 'INACTIVE'])
  status!: string;
}

export class CreateShiftFromTemplateDto {
  @IsInt()
  templateId!: number;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  workers?: number[];
}

export class IssueMachineDto {
  @IsInt()
  machineId!: number;

  @IsInt()
  workerId!: number;

  @IsOptional()
  @IsInt()
  workOrderId?: number;

  @IsOptional()
  @IsInt()
  shiftId?: number;

  @IsOptional()
  @IsInt()
  locationId?: number;

  @IsOptional()
  @IsDateString()
  dueReturnAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class ReturnMachineItemDto {
  @IsInt()
  issuanceItemId!: number;

  @IsIn(["RETURNED", "DAMAGED", "MISSING"])
  status!: string;

  @IsOptional()
  @IsNumber()
  returnedQuantity?: number;

  @IsOptional()
  @IsNumber()
  replacementCost?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class ReturnMachineIssuanceDto {
  @IsArray()
  items!: ReturnMachineItemDto[];
}

export class UpdateMachineDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  type?: string | null;

  @IsOptional()
  @IsIn(["STATIONARY", "ISSUABLE"])
  kind?: string;

  @IsOptional()
  @IsNumber()
  hourlyRate?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class AssignOrderFlowDto {
  @IsInt()
  flowId!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AdvanceOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CompleteOrderDeliveryDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

// --- Manufacturing V2: owner-defined teams & flows ---------------------------

export class CreateMfgTeamDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateMfgTeamDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ReorderMfgTeamsDto {
  @IsArray()
  @IsInt({ each: true })
  ids!: number[];
}

export class MfgFlowStepInputDto {
  // Team that owns the step; omit for a manual/unassigned step.
  @IsOptional()
  @IsInt()
  teamId?: number;

  // Optional step label; defaults to the team name.
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  // True when this step performs the build — reaching it auto-links the
  // order's Work Order (materials backflush + COGM).
  @IsOptional()
  @IsBoolean()
  isProductionStep?: boolean;

  // Ordered operations performed inside this team step (e.g. Sectioning &
  // Cutting, Assembly, Painting). Empty = a single-hop step.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  operations?: string[];
}

export class CreateMfgFlowDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MfgFlowStepInputDto)
  steps?: MfgFlowStepInputDto[];
}

export class UpdateMfgFlowDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  // When present the whole step sequence is replaced atomically.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MfgFlowStepInputDto)
  steps?: MfgFlowStepInputDto[];
}

// --- Raw-material purchasing: vendors, purchase orders & goods receipts ------

export class CreateVendorDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  contactPerson?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  taxId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  paymentTermsDays?: number;
}

export class UpdateVendorDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  contactPerson?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  taxId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  paymentTermsDays?: number | null;
}

export class PurchaseOrderItemInputDto {
  @IsInt()
  productId!: number;

  @IsPositive()
  quantity!: number;

  @Min(0)
  unitCost!: number;
}

export class CreatePurchaseOrderDto {
  @IsInt()
  vendorId!: number;

  @IsOptional()
  @IsDateString()
  expectedDeliveryDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemInputDto)
  items!: PurchaseOrderItemInputDto[];
}

export class UpdatePurchaseOrderDto {
  @IsOptional()
  @IsInt()
  vendorId?: number;

  @IsOptional()
  @IsDateString()
  expectedDeliveryDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;

  // When present the whole item list is replaced atomically (DRAFT only).
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemInputDto)
  items?: PurchaseOrderItemInputDto[];
}

export class ReceiveGoodsItemDto {
  @IsInt()
  poItemId!: number;

  @IsNumber()
  @Min(0)
  receivedQty!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  rejectedQty?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  batchNumber?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsDateString()
  manufactureDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  rejectReason?: string;
}


export class CreateGoodsReceiptDto {
  @IsInt()
  purchaseOrderId!: number;

  @IsInt()
  locationId!: number;

  @IsOptional()
  @IsDateString()
  receivedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveGoodsItemDto)
  items!: ReceiveGoodsItemDto[];
}

// --- Procurement enhancements: direct receipts, vendor bills, credit notes ---

export class DirectReceiptItemDto {
  @IsInt()
  productId!: number;

  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsNumber()
  @Min(0)
  unitCost!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  batchNumber?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsDateString()
  manufactureDate?: string;
}

export class CreateDirectReceiptDto {
  @IsOptional()
  @IsInt()
  vendorId?: number;

  @IsInt()
  locationId!: number;

  @IsOptional()
  @IsDateString()
  receivedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DirectReceiptItemDto)
  items!: DirectReceiptItemDto[];
}

export class GenerateVendorBillDto {
  @IsInt()
  grnId!: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class PayVendorBillDto {
  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsDateString()
  paidAt?: string;
}

export class CreditNoteItemInputDto {
  @IsInt()
  rejectionId!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;
}

export class CreateVendorCreditNoteDto {
  @IsOptional()
  @IsInt()
  vendorId?: number;

  @IsOptional()
  @IsInt()
  grnId?: number;

  @IsOptional()
  @IsInt()
  billId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreditNoteItemInputDto)
  items!: CreditNoteItemInputDto[];
}

export class UpdateRejectionDto {
  @IsOptional()
  @IsEnum(MfgRejectDisposition)
  disposition?: MfgRejectDisposition;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

// ---------------------------------------------------------------------------
// Design Catalog (customer-facing product/design registry)
// ---------------------------------------------------------------------------

export class CreateDesignCategoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsInt()
  parentId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateDesignCategoryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsInt()
  parentId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class CreateDesignCatalogItemDto {
  @IsOptional()
  @IsInt()
  categoryId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  // Flexible design data (dimensions, materials, finish options, ...).
  // Accepted as any JSON object.
  @IsOptional()
  specifications?: Record<string, unknown>;

  // Blueprint / render / photo URLs.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaUrls?: string[];

  // Auto-applied BOM when a job order picks this design without an explicit BOM.
  @IsOptional()
  @IsInt()
  defaultBomId?: number | null;

  // Optional finished inventory Product this design produces.
  @IsOptional()
  @IsInt()
  productId?: number | null;
}

export class UpdateDesignCatalogItemDto {
  @IsOptional()
  @IsInt()
  categoryId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @IsOptional()
  specifications?: Record<string, unknown> | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaUrls?: string[];

  @IsOptional()
  @IsInt()
  defaultBomId?: number | null;

  @IsOptional()
  @IsInt()
  productId?: number | null;
}

