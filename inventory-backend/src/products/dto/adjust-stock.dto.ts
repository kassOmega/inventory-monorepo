import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class AdjustStockDto {
  @IsInt()
  locationId!: number;

  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
