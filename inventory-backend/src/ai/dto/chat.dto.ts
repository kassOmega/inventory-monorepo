// src/ai/dto/chat.dto.ts
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class ChatDto {
  @IsString()
  @Length(1, 4000)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sessionId?: string;
}
