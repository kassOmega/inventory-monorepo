import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class AssistTurnDto {
  @IsIn(['user', 'model'])
  role!: 'user' | 'model';

  @IsString()
  @MaxLength(4000)
  text!: string;
}

/** POST /ai/assist — public onboarding assistant request (no auth). */
export class AssistDto {
  @IsString()
  @MinLength(8)
  @MaxLength(120)
  guestId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  lang?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AssistTurnDto)
  history?: AssistTurnDto[];
}