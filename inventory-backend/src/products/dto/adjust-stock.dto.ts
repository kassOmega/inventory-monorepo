import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class AdjustStockDto {
  @IsInt()
  locationId!: number;

  /**
   * Which variant is being counted. Required for a product with variants (the
   * stock lives on the variant rows); must be absent for a plain product.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  variantId?: number | null;

  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
