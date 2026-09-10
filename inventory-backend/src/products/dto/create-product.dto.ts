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

export class CreateProductDto {
  @IsString()
  brand: string;

  @IsString()
  baseName: string;

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

  @IsOptional()
  @IsInt()
  unitId?: number;

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

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateProductBatchDto)
  batch?: CreateProductBatchDto;
}
