import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  /**
   * Email OR phone number. Preferred field. When omitted, `email` is used as a
   * fallback so existing clients keep working.
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  identifier?: string;

  /** Legacy login field (email). Optional now that `identifier` exists. */
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsString()
  @MaxLength(128)
  password!: string;
}
