// src/agent/dto/agent.dto.ts
import { AgentMode } from '@prisma/client';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class UpdateAgentConfigDto {
  @IsEnum(AgentMode)
  @IsOptional()
  mode?: AgentMode;

  /** Max cash the agent may auto-spend on restocks (0 = nothing auto). */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000000)
  @IsOptional()
  maxAutoSpend?: number;
}
