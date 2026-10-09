import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

const TERMS = ['MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY'] as const;
const BUSINESS_TYPES = [
  'RETAIL',
  'HOSPITALITY',
  'MANUFACTURING',
  'SERVICE',
  'CAR_WASH',
] as const;
const SUB_STATUSES = ['FREE', 'LIFETIME', 'ACTIVE', 'GRACE', 'EXPIRED'] as const;

/** Client receipt submission (multipart form fields, alongside `file`). */
export class SubmitSubscriptionPaymentDto {
  @IsString()
  @IsIn(TERMS as unknown as string[])
  term!: string;

  @IsOptional()
  @IsString()
  bankAccountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  payerName?: string;

  /** Bank transaction / FT reference number from the receipt (anti-replay). */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  transactionRef?: string;

  /** Amount the client claims; defaults to the configured price when omitted. */
  @IsOptional()
  @IsString()
  amount?: string;
}

/** Admin: platform-wide subscription settings (free-trial length). */
export class UpdateSubscriptionSettingsDto {
  @IsInt()
  @Min(0)
  trialDays!: number;
}

/** Admin: create/update a default price for (businessType?, term). */
export class UpsertPlanDto {
  @IsOptional()
  @IsIn(BUSINESS_TYPES as unknown as string[])
  businessType?: string | null;

  @IsString()
  @IsIn(TERMS as unknown as string[])
  term!: string;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/** Admin: set a tenant's subscription state. */
export class AdminUpdateSubscriptionDto {
  @IsOptional()
  @IsIn(SUB_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @IsIn(TERMS as unknown as string[])
  term?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  priceOverride?: number | null;

  @IsOptional()
  @IsString()
  expiresAt?: string | null;

  @IsOptional()
  @IsBoolean()
  autoRenew?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

/** Admin: bank account create/update. */
export class BankAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  bankName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  accountName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  accountNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  branch?: string | null;

  @IsOptional()
  @IsIn(BUSINESS_TYPES as unknown as string[])
  businessType?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

/** Admin: approve/reject a submitted receipt. */
export class ReviewPaymentDto {
  @IsString()
  @IsIn(['approve', 'reject'])
  action!: 'approve' | 'reject';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
