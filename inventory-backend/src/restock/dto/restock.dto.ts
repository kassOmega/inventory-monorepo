import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
} from 'class-validator';

export class RestockDto {
  @IsInt()
  productId!: number;

  // Optional: standalone shops don't ask the owner for a location — the
  // backend resolves the org's single shop when this is omitted.
  @IsOptional()
  @IsInt()
  storeId?: number;

  @IsInt()
  @IsPositive()
  quantity!: number;

  // Prices are optional — the owner can restock without changing prices.
  @IsOptional()
  @IsNumber()
  @Min(0)
  newBuyPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  newSellPrice?: number;

  // Variant restock: when set, stock lands on this specific size/color row.
  @IsOptional()
  @IsInt()
  variantId?: number;

  // Perishable batch/expiry (required when the product is perishable).
  @IsOptional()
  @IsString()
  batchNumber?: string;

  @IsOptional()
  @IsDateString()
  manufactureDate?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;
}
