import { IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsObject, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ProductKind } from '@prisma/client';

export class CreateProductVariantDto {
  @IsOptional()
  @IsInt()
  /** Existing variant id — present on update (PUT) so we upsert, not clone. */
  id?: number;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, any>;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string | null;

  /** Per-unit price overrides keyed by unitId. */
  @IsOptional()
  @IsObject()
  unitPrices?: Record<string, { buyPrice?: number; sellPrice?: number }>;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  buyPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  sellPrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  reorderLevel?: number;

  /** Suggested reorder qty for this variant (null on update → clear/inherit). */
  @IsOptional()
  @IsInt()
  @Min(0)
  reorderQty?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number;
}

export class CreateProductBatchDto {
  @IsOptional()
  @IsString()
  batchNumber?: string;

  @IsOptional()
  @IsDateString()
  manufactureDate?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsInt()
  quantity?: number;
}

export class CreateProductUnitDto {
  @IsInt()
  unitId!: number;

  /// How many of this unit are in ONE base unit. Base row = 1; lower units > 1.
  @IsInt()
  @Min(1)
  perBase!: number;

  @IsOptional()
  @IsBoolean()
  isBase?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefaultSale?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  buyPrice?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  sellPrice?: number | null;
}

export class CreateProductDto {
  @IsString()
  brand: string;

  @IsString()
  baseName: string;

  @IsOptional()
  @IsString()
  imageUrl?: string | null;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, any>;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  currentBuyPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  currentSellPrice?: number;

  @IsNumber()
  categoryId: number;

  @IsInt()
  @Min(1)
  unitId!: number;

  @IsOptional()
  @IsEnum(ProductKind)
  kind?: ProductKind;

  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsOptional()
  @IsInt()
  storeId?: number;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsOptional()
  @IsBoolean()
  hasVariants?: boolean;

  @IsOptional()
  @IsBoolean()
  isPerishable?: boolean;

  @IsOptional()
  @Min(0)
  reorderLevel?: number;

  @IsOptional()
  @Min(0)
  reorderQty?: number;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProductVariantDto)
  variants?: CreateProductVariantDto[];

  /** Product-specific unit ladder (base + lower units). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProductUnitDto)
  units?: CreateProductUnitDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateProductBatchDto)
  batch?: CreateProductBatchDto;
}
