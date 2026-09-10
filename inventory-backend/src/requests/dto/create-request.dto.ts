import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  ValidateNested,
} from 'class-validator';

export class CreateRequestItemDto {
  @IsInt()
  productId!: number;

  @IsOptional()
  @IsNumber()
  quantityRequested?: number;

  // Variant request: when set, stock is requested/dispatched for this
  // specific size/color row.
  @IsOptional()
  @IsInt()
  variantId?: number;
}

export class CreateRequestDto {
  @IsOptional()
  @IsInt()
  storeId?: number;

  @IsOptional()
  @IsInt()
  fromStoreId?: number;

  @IsOptional()
  requestType?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRequestItemDto)
  items!: CreateRequestItemDto[];
}
