import { BusinessType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateOrganizationDto {
  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  slug?: string;

  @IsEnum(BusinessType)
  @IsOptional()
  businessType?: BusinessType;

  /** Standalone = a single-location shop run by the owner alone (no staff). */
  @IsBoolean()
  @IsOptional()
  standalone?: boolean;

  /** Tenant's primary UI language ("en" | "am"). Defaults to "en". */
  @IsIn(['en', 'am'])
  @IsOptional()
  defaultLanguage?: 'en' | 'am';
}

export class UpdateMyOrganizationDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsEnum(BusinessType)
  @IsOptional()
  businessType?: BusinessType;

  /** Flip standalone → false to upgrade to a multi-location business. */
  @IsBoolean()
  @IsOptional()
  standalone?: boolean;

  /** Required when upgrading: name for the current (hidden) location. */
  @IsString()
  @IsOptional()
  @MaxLength(100)
  locationName?: string;
}

export class UpdateSettingsDto {
  @IsObject()
  settings!: Record<string, unknown>;
}
