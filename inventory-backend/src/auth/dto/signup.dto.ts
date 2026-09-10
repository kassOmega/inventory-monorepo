import { BusinessType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PASSWORD_MESSAGE, PASSWORD_RULE } from '../../common/validators/password';

/** Optional inline business created together with the account. */
export class SignupBusinessDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsEnum(BusinessType)
  @IsOptional()
  businessType?: BusinessType;

  /** Standalone = a single-location shop run by the owner alone (no staff). */
  @IsBoolean()
  @IsOptional()
  standalone?: boolean;
}

/** Public self-registration for user (owner) accounts — no role/business yet. */
export class SignupDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @Length(8, 72)
  @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  password!: string;

  @IsString()
  @MaxLength(100)
  name!: string;

  @IsString()
  @MaxLength(30)
  @IsOptional()
  phone?: string;

  /** Optional first business created inline (max 2 businesses per owner). */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SignupBusinessDto)
  business?: SignupBusinessDto;
}
