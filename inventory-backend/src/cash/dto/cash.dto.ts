// src/cash/dto/cash.dto.ts
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

export class RecordFloatDto {
  @IsInt() recipientId!: number;
  @IsNumber() @Type(() => Number) amount!: number;
  @IsString() @IsOptional() notes?: string;
}

export class RecordCollectionDto {
  @IsInt() fromUserId!: number;
  @IsNumber() @Type(() => Number) amount!: number;
  @IsInt() @IsOptional() paymentMethodId?: number;
  @IsString() @IsOptional() notes?: string;
}

export class UpdateCashSettingsDto {
  @IsBoolean() @IsOptional() requireCashierConfirmation?: boolean;
  @IsBoolean() @IsOptional() enableFloatManagement?: boolean;
}
