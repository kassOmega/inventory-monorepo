// src/admin/dto/admin.dto.ts
import { BusinessType, HospitalityServiceType, OrgStatus, UserStatus } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateOwnerDto {
  @IsString() name!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;

  /** AI free-trial end date (ISO). Defaults to today + 15 days. */
  @IsDateString() @IsOptional() aiTrialEndsAt?: string;

  /** Per-user daily AI query cap (null/empty = global default). */
  @IsInt() @Min(0) @IsOptional() dailyAiQuota?: number;
}

export class CreateOrgForOwnerDto {
  @IsInt() ownerUserId!: number;
  @IsString() name!: string;
  @IsEnum(BusinessType) @IsOptional() businessType?: BusinessType;

  /** Hospitality only: the service lines the business offers (multi-select). */
  @IsArray()
  @IsEnum(HospitalityServiceType, { each: true })
  @IsOptional()
  hospitalityServices?: HospitalityServiceType[];

  /** AI entitlement overrides for the new business (admin-only path). */
  @IsBoolean() @IsOptional() aiEnabled?: boolean;
  @IsDateString() @IsOptional() aiTrialEndsAt?: string | null;

  /** Standalone = a single shop that manages its own inventory (no store). */
  @IsBoolean() @IsOptional() standalone?: boolean;
}

export class UpdateUserStatusDto {
  @IsEnum(UserStatus) status!: UserStatus;
}

export class UpdateOrgStatusDto {
  @IsEnum(OrgStatus) status!: OrgStatus;
}

export class UpdateUserDto {
  @IsString() @IsOptional() name?: string;
  @IsEmail() @IsOptional() email?: string;
  @IsString() @MinLength(8) @IsOptional() password?: string;
  /** Set an ISO date to grant/extend the AI trial; pass null to clear it. */
  @IsDateString() @IsOptional() aiTrialEndsAt?: string | null;
  /** Per-user daily AI query cap; pass null to fall back to the global default. */
  @IsInt() @Min(0) @IsOptional() dailyAiQuota?: number | null;
}

export class UpdateOrganizationDto {
  @IsString() @IsOptional() name?: string;
  @IsEnum(BusinessType) @IsOptional() businessType?: BusinessType;
  @IsBoolean() @IsOptional() aiEnabled?: boolean;
  /** ISO date for the AI window; null = unlimited (paid). */
  @IsDateString() @IsOptional() aiTrialEndsAt?: string | null;
}

export class AssignOwnerDto {
  @IsInt() ownerUserId!: number;
}
