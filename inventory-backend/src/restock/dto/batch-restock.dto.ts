import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * One line of a restock batch. Prices are per line, so a variant product is
 * costed variant by variant instead of inheriting the product's average.
 */
export class BatchRestockItemDto {
  @IsInt()
  @Min(1)
  productId!: number;

  /** Required for a product with variants; must be absent for a plain product. */
  @IsOptional()
  @IsInt()
  @Min(1)
  variantId?: number | null;

  /** Falls back to the batch-level `storeId`. */
  @IsOptional()
  @IsInt()
  @Min(1)
  locationId?: number;

  @IsInt()
  @IsPositive()
  quantity!: number;

  /** Owner-only: the cost of this line (per unit). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  buyPrice?: number;

  /** Owner-only: the new selling price for this line (per unit). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  sellPrice?: number;

  // Perishables must carry batch + expiry, exactly like the single-item restock.
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

/**
 * Restock many items — several products, their variants, across several
 * locations — in one submission.
 *
 * All-or-nothing: the sheet is validated up front (including location scope and
 * duplicate rows) and applied in one transaction; each location gets ONE request
 * carrying its items, so a delivery is one document per store rather than one per
 * line.
 */
export class BatchRestockDto {
  /** Default receiving location for items that do not name one. */
  @IsOptional()
  @IsInt()
  @Min(1)
  storeId?: number;

  @IsOptional()
  @IsString()
  vendor?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BatchRestockItemDto)
  items!: BatchRestockItemDto[];
}
