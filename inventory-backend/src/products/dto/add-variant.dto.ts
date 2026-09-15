import {
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/** Add a new size/color variant to an existing product (restock inline flow). */
export class AddVariantDto {
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
  buyPrice?: number;

  @IsOptional()
  @IsNumber()
  sellPrice?: number;

  // Per-variant low-stock alert number (0 → inherit the product's) and the
  // suggested quantity to reorder once it is breached (null/absent → inherit).
  @IsOptional()
  @IsInt()
  @Min(0)
  reorderLevel?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  reorderQty?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number;

  // Optional location to deposit `quantity` immediately (restock target).
  @IsOptional()
  @IsInt()
  storeId?: number;
}
