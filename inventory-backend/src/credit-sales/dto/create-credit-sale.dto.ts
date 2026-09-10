import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  ValidateNested,
} from 'class-validator';

export class CreditSaleItemDto {
  @IsInt()
  productId!: number;

  @IsInt()
  quantity!: number;

  @IsNumber()
  unitPrice!: number;
}

export class CreateCreditSaleDto {
  @IsInt()
  customerId!: number;

  @IsNumber()
  totalAmount!: number;

  @IsInt()
  shopId!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreditSaleItemDto)
  items!: CreditSaleItemDto[];

  @IsOptional()
  @IsInt()
  saleId?: number;
}
