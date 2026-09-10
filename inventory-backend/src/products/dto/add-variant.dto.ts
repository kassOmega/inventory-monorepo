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

  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number;

  // Optional location to deposit `quantity` immediately (restock target).
  @IsOptional()
  @IsInt()
  storeId?: number;
}
