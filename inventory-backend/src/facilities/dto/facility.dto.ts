// src/facilities/dto/facility.dto.ts
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';
import { FacilityVisitType } from '@prisma/client';

/** How an uncovered facility charge is routed (aliases normalized server-side). */
export type FacilitySettlementMode = 'DEFER_TO_FOLIO' | 'PAY_NOW';

export class CheckInDto {
  @IsEnum(FacilityVisitType) type!: FacilityVisitType;
  // MEMBER check-in: the active membership id.
  @IsString() @IsOptional() membershipId?: string;
  // WALK_IN entry: guest info + day pass + payment.
  @IsString() @IsOptional() guestName?: string;
  @IsString() @IsOptional() guestPhone?: string;
  @IsString() @IsOptional() dayPassTypeId?: string;
  @IsInt() @IsOptional() paymentMethodId?: number;
  // PACKAGE check-in: the package guest whose pass/credit entitlement covers
  // this visit at $0; any overage is routed by `settlementMode`.
  @IsString() @IsOptional() packageGuestId?: string;
  // Charge for the visit (spa treatment, day pass…). Defaults to the selected
  // day-pass price when one is provided.
  @IsNumber() @Type(() => Number) @IsOptional() amount?: number;
  // PAY_NOW = collect the overage at the terminal; DEFER_TO_FOLIO = post it to
  // the guest's room folio. Defaults from the company hospitality policy.
  @IsString() @IsOptional() settlementMode?: FacilitySettlementMode;
}
