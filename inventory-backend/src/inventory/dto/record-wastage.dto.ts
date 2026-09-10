// src/inventory/dto/record-wastage.dto.ts
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class RecordWastageDto {
  @IsInt()
  productId!: number;

  @IsNumber()
  @Type(() => Number)
  @IsPositive()
  quantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;

  @IsOptional()
  @IsInt()
  locationId?: number;
}
