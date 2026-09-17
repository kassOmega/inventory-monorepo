import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/** One counted row of a stock-count sheet. */
export class BulkAdjustStockItemDto {
  @IsInt()
  @Min(1)
  productId!: number;

  /**
   * Which variant is being counted. Required for a product with variants (stock
   * lives on the variant rows); must be absent for a plain product.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  variantId?: number | null;

  @IsInt()
  @Min(1)
  locationId!: number;

  @IsNumber()
  @Min(0)
  quantity!: number;

  /**
   * Optional new SELLING price for this item, applied while counting (a count
   * never touches the buying price — there is deliberately no buy field here).
   * One value per variant/product, so every row of the same variant in the sheet
   * must send the same number.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  sellPrice?: number;
}

/**
 * A whole counting session: many products / variants across many locations in one
 * submission, so the user never has to reopen the form per item.
 *
 * All-or-nothing: every row is validated before anything is written, and one bad
 * row rejects the whole sheet with its index so the form can highlight it.
 */
export class BulkAdjustStockDto {
  /**
   * Client-generated token grouping every row of this session. It names the
   * journal references and the audit trail, and makes a double-submit harmless.
   */
  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BulkAdjustStockItemDto)
  items!: BulkAdjustStockItemDto[];
}
