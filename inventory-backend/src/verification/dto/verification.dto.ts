import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** Which kind of verification document is being uploaded (form field). */
export class UploadDocumentDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['NATIONAL_ID', 'TRADE_LICENSE', 'TIN_CERTIFICATE'])
  documentType!: string;
}

/** Admin rejection payload: the reason shown to the user. */
export class RejectVerificationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

/** Admin can move an account to ANY verification status (from any current one). */
export class SetVerificationStatusDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED', 'FLAGGED', 'BLOCKED'])
  status!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
