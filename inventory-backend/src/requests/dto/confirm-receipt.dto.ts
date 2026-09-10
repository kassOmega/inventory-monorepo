import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsPositive,
  ValidateNested,
} from 'class-validator';

export class ConfirmReceiptItemDto {
  @IsInt()
  id!: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  quantityReceived?: number;
}

export class ConfirmReceiptDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfirmReceiptItemDto)
  items!: ConfirmReceiptItemDto[];
}
