// src/ai/dto/cashflow.dto.ts
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export enum CashFlowTargetPeriod {
  NEXT_30_DAYS = 'NEXT_30_DAYS',
  NEXT_60_DAYS = 'NEXT_60_DAYS',
  NEXT_90_DAYS = 'NEXT_90_DAYS',
}

export class CashFlowDto {
  @IsEnum(CashFlowTargetPeriod)
  targetPeriod!: CashFlowTargetPeriod;

  /** Preferred output language for the AI report (e.g. English, Amharic, Afaan Oromoo). */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  language?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  locationId?: number;
}
