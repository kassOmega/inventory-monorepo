import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
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

  // Client-generated idempotency key: lets an offline/queued request replay
  // safely (the backend returns the request that already exists).
  @IsOptional()
  @IsString()
  @MaxLength(100)
  clientRef?: string;
}
