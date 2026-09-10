import { IsOptional, IsString } from 'class-validator';

export class StockReportQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  // Tolerated so the shared reports page query string (which includes the
  // date range) can be reused by the low-stock / dead-stock tabs.
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}
