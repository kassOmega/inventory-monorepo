import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

const KINDS = ['LOAN', 'PENALTY'] as const;
const SOURCES = ['SALARY', 'COMMISSION'] as const;

export class CreateDeductionDto {
  @IsOptional()
  @IsInt()
  userId?: number;

  @IsOptional()
  @IsInt()
  washerId?: number;

  @IsString()
  @IsIn(KINDS as unknown as string[])
  kind!: string;

  @IsOptional()
  @IsString()
  @IsIn(SOURCES as unknown as string[])
  source?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reason!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  dueAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class UpdateDeductionDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @IsString()
  dueAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;

  @IsOptional()
  @IsString()
  @IsIn(SOURCES as unknown as string[])
  source?: string;
}

export class RecoverDeductionDto {
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

  /**
   * The total period pay for this payout run (salary for the period, or the
   * commission payout). Used to enforce the tenant's % cap. When omitted the cap
   * is checked against a default of the deduction balance only.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  periodPay?: number;
}

export class SweepDeductionsDto {
  @IsOptional()
  @IsInt()
  userId?: number;

  @IsOptional()
  @IsInt()
  washerId?: number;

  @IsString()
  @IsIn(SOURCES as unknown as string[])
  source!: string;

  /** The payout amount for the period (basis for the % cap). */
  @IsNumber()
  @Min(0)
  periodPay!: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
