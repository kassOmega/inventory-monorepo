import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';

export class ReturnSaleItemDto {
  @IsInt()
  productId!: number;

  @IsInt()
  @IsPositive()
  quantity!: number;
}

export class ReturnSaleDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReturnSaleItemDto)
  items!: ReturnSaleItemDto[];

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsInt()
  refundMethodId?: number;
}
