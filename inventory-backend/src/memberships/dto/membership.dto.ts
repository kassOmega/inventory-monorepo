// src/memberships/dto/membership.dto.ts
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { HospitalityServiceType } from '@prisma/client';

export class CreateMembershipTypeDto {
  // The hospitality service (Gym, Pool, or a custom facility like Spa) this
  // pass plan belongs to. Works for both default and custom services.
  @IsString() hospitalityServiceId!: string;
  @IsString() name!: string;
  @IsInt() @Type(() => Number) durationDays!: number;
  @IsNumber() @Type(() => Number) price!: number;
}

export class UpdateMembershipTypeDto {
  @IsString() @IsOptional() name?: string;
  @IsInt() @Type(() => Number) @IsOptional() durationDays?: number;
  @IsNumber() @Type(() => Number) @IsOptional() price?: number;
  @IsBoolean() @IsOptional() isActive?: boolean;
}

export class AssignMembershipDto {
  @IsString() membershipTypeId!: string;
  @IsString() customerName!: string;
  @IsString() @IsOptional() phone?: string;
  @IsString() @IsOptional() email?: string;
  @IsString() @IsOptional() startDate?: string;
}

export class UpdateCustomerMembershipDto {
  @IsString() @IsOptional() endDate?: string;
  @IsString() @IsOptional() status?: string;
}
