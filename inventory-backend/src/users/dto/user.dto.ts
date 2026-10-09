import { SalaryPeriod, UserStatus } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PASSWORD_MESSAGE, PASSWORD_RULE } from '../../common/validators/password';

export class UserDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @Length(8, 72)
  @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  roleId?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  locationId?: number | null;

  // Per-user daily AI chat limit; null/undefined = global default (15).
  @IsOptional()
  @IsInt()
  @Min(0)
  dailyAiQuota?: number | null;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  // Payroll: base salary + how often it is paid (drives the deduction cap).
  @IsOptional()
  @IsNumber()
  @Min(0)
  salaryAmount?: number | null;

  @IsOptional()
  @IsEnum(SalaryPeriod)
  salaryPeriod?: SalaryPeriod | null;
}

export class ResetPasswordDto {
  @IsString()
  @Length(8, 72)
  @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  password!: string;
}

export class UpdateUserStatusDto {
  @IsEnum(UserStatus)
  status!: UserStatus;
}
