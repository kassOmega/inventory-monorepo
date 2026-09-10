import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { SaleType } from '@prisma/client';

export class ConfirmSaleItemDto {
  @IsInt()
  id!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  quantityReceived?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitSellPrice?: number;
}

export class ConfirmSaleDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfirmSaleItemDto)
  items!: ConfirmSaleItemDto[];

  @IsOptional()
  @IsEnum(SaleType)
  saleType?: SaleType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  paidAmount?: number;

  @IsOptional()
  @IsInt()
  paymentMethodId?: number;

  @IsOptional()
  @IsInt()
  customerId?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
