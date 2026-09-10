// src/ai/dto/churn.dto.ts
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ChurnDto {
  /** Preferred output language for the AI report. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  language?: string;
}
