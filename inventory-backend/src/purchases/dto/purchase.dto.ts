// src/purchases/dto/purchase.dto.ts
// Payloads for the unified purchases API. `paymentType` is the only axis that
// differs between a quick (paid) purchase and a credit purchase, so both share
// these DTOs. main.ts runs ValidationPipe with forbidNonWhitelisted, so every
// field the forms send must be declared here.
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/** PAID = settled from the till up front, CREDIT = owed to the vendor. */
export const PURCHASE_PAYMENT_TYPES: string[] = ['PAID', 'CREDIT'];

/** One bought line, shared by the single and the bulk endpoints. */
export class PurchaseLineDto {
  @IsString()
  productName!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  /** Only meaningful for PAID rows (the flip sale's expected price). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sellPrice?: number;
}

/** Fields that apply to a whole submission (single-line or bulk). */
export class PurchaseMetaDto {
  @IsOptional()
  @IsIn(PURCHASE_PAYMENT_TYPES)
  paymentType?: string;

  /** Required when paymentType is CREDIT. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  vendorCustomerId?: number;

  /** Owners are not bound to a location, so they pick the shop. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  shopId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  paymentMethodId?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Client-generated idempotency key (double-submit protection). */
  @IsOptional()
  @IsString()
  clientRef?: string;
}

/** POST /purchases — a single line plus its batch metadata. */
export class CreatePurchaseDto extends PurchaseMetaDto {
  @IsString()
  productName!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sellPrice?: number;
}

/** POST /purchases/bulk — the cart the shared form builds. */
export class CreatePurchaseBulkDto extends PurchaseMetaDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  items!: PurchaseLineDto[];
}

/** PATCH /purchases/:id — correct a line before/after approval. */
export class UpdatePurchaseDto {
  @IsOptional()
  @IsString()
  productName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sellPrice?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  vendorCustomerId?: number;
}

/** POST /purchases/:id/payments — vendor payback against a credit purchase. */
export class CreateVendorPaymentDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  /** Only used to cross-check the vendor already on the purchase. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  customerId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  paymentMethodId?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  paidAt?: string;

  @IsOptional()
  @IsString()
  clientRef?: string;
}

/** PATCH /purchases/payments/:id */
export class UpdateVendorPaymentDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  paymentMethodId?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  paidAt?: string;
}
