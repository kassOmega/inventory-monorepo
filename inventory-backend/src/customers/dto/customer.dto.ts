// src/customers/dto/customer.dto.ts
// Request shapes for the customer CRM. `main.ts` runs a strict ValidationPipe
// (whitelist + forbidNonWhitelisted), so every field a caller may send must be
// declared here — that is also what keeps unexpected payload keys out of the
// database.
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Enum values mirrored from prisma/schema.prisma (kept in one place here). */
export const CUSTOMER_SOURCES = [
  'WALK_IN',
  'REFERRAL',
  'ONLINE',
  'EVENT',
  'OTHER',
] as const;

export const CUSTOMER_NOTE_KINDS = [
  'NOTE',
  'CALL',
  'VISIT',
  'COMPLAINT',
  'FOLLOW_UP',
] as const;

export const CUSTOMER_LANGUAGES = ['en', 'am'] as const;

/** Max number of labels on one customer — a guard against accidental blobs. */
const MAX_TAGS = 20;

/**
 * Full customer payload used by the single reusable customer form on every
 * surface (credits, sales, requests, CRM directory). Only `name` is required:
 * every other field is optional so a quick "name + phone" save still works.
 */
export class CreateCustomerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  email?: string;

  /**
   * Legacy shop hint. The customer row itself is organization-scoped; the shop
   * only ever filtered credit lists, so it is accepted and stored for
   * backwards compatibility with older clients.
   */
  @IsOptional()
  @IsInt()
  shopId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  /** ISO date (a bare `YYYY-MM-DD` is accepted — day/month are what matter). */
  @IsOptional()
  @IsDateString()
  birthday?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TAGS)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[];

  /** CRM summary note (the interaction timeline is CustomerNote). */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsIn(CUSTOMER_LANGUAGES)
  preferredLanguage?: string;

  @IsOptional()
  @IsIn(CUSTOMER_SOURCES)
  source?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000_000)
  creditLimit?: number;

  /** The credit gate: false = this customer may not take goods on credit. */
  @IsOptional()
  @IsBoolean()
  canTakeCredit?: boolean;

  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}

/** Every field optional — a PATCH-style full-form save. */
export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  email?: string;

  @IsOptional()
  @IsInt()
  shopId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @IsOptional()
  @IsDateString()
  birthday?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TAGS)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsIn(CUSTOMER_LANGUAGES)
  preferredLanguage?: string;

  @IsOptional()
  @IsIn(CUSTOMER_SOURCES)
  source?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000_000)
  creditLimit?: number;

  @IsOptional()
  @IsBoolean()
  canTakeCredit?: boolean;

  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;
}

/** One timeline entry (note / call / visit / complaint / follow-up). */
export class CreateCustomerNoteDto {
  @IsOptional()
  @IsIn(CUSTOMER_NOTE_KINDS)
  kind?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;

  /** Optional reminder date; drives the "follow-ups due" badge. */
  @IsOptional()
  @IsDateString()
  followUpAt?: string;
}

/** Manual loyalty adjustment (bonus points, corrections, redemptions). */
export class AdjustLoyaltyDto {
  /** Signed points: positive grants, negative removes. */
  @Type(() => Number)
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  points!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

/** Per-organization loyalty programme settings. */
export class UpdateLoyaltyProgramDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** Points earned per 1.00 of the sale total (0.01 = 1 point per 100 ETB). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  pointsPerCurrency?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10_000)
  valuePerPoint?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  minRedeemPoints?: number;
}
