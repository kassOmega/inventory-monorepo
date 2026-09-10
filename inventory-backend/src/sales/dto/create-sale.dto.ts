import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class CreateSaleItemDto {
  @IsInt()
  productId!: number;

  @IsNumber()
  quantity!: number;

  @IsOptional()
  @IsNumber()
  customPrice?: number;

  // Variant sale: when set, stock is deducted from this size/color row.
  @IsOptional()
  @IsInt()
  variantId?: number;

  // Optional pre-selected batch (FIFO is used automatically otherwise).
  @IsOptional()
  @IsInt()
  batchId?: number;
}

export class CreateSaleDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSaleItemDto)
  items!: CreateSaleItemDto[];

  @IsOptional()
  @IsNumber()
  paidAmount?: number;

  @IsOptional()
  @IsNumber()
  remainingAmount?: number;

  @IsOptional()
  @IsString()
  @IsIn(['FULLY_PAID', 'PARTIALLY_PAID', 'CREDITED'])
  saleType?: string;

  @IsOptional()
  @IsInt()
  paymentMethodId?: number;

  @IsOptional()
  @IsInt()
  customerId?: number;

  @IsOptional()
  @IsInt()
  shopId?: number;

  @IsOptional()
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  clientRef?: string;
}
