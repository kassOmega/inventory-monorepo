import { IsNumber, IsOptional } from 'class-validator';

export class UpdatePriceHistoryDto {
  @IsOptional()
  @IsNumber()
  oldBuyPrice?: number;

  @IsOptional()
  @IsNumber()
  newBuyPrice?: number;

  @IsOptional()
  @IsNumber()
  oldSellPrice?: number;

  @IsOptional()
  @IsNumber()
  newSellPrice?: number;
}
