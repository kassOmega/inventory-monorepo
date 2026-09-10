// src/ai/dto/po-draft.dto.ts
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class PoDraftDto {
  /** Preferred output language for the draft notes. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  language?: string;

  /** Assumed supplier lead time in days (default 7). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  leadTimeDays?: number;

  /** When true, the generated draft is created automatically (default true). */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  autoCreate?: boolean;
}
