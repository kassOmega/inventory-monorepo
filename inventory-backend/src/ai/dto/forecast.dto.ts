// src/ai/dto/forecast.dto.ts
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export enum ForecastTargetPeriod {
  NEXT_7_DAYS = 'NEXT_7_DAYS',
  NEXT_30_DAYS = 'NEXT_30_DAYS',
  NEXT_QUARTER = 'NEXT_QUARTER',
}

export class ForecastDto {
  @IsEnum(ForecastTargetPeriod)
  targetPeriod!: ForecastTargetPeriod;

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
