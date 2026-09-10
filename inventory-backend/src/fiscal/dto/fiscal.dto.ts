import { IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class FiscalAckDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  fsNumber!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  ejNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  machineSerial?: string;
}

export class FiscalFailDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  message?: string;
}

export class FiscalConfigDto {
  @IsOptional() @IsString() @MaxLength(60) tin?: string;
  @IsOptional() @IsString() @MaxLength(100) taxName?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string | null;
  @IsOptional() @IsString() @MaxLength(40) phone?: string | null;
  @IsOptional() @IsString() @MaxLength(255) agentUrl?: string;
  @IsOptional() @IsString() @MaxLength(255) agentApiKey?: string | null;
  @IsOptional() @IsString() @MaxLength(40) printerVendor?: string;
  @IsOptional() @IsString() @MaxLength(20) comPort?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) baudRate?: number | null;
  @IsOptional() @IsBoolean() enableFiscal?: boolean;

  // MoR E-Invoicing & Security credentials
  @IsOptional() @IsString() @MaxLength(255) morLiveUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(100) morClientId?: string | null;
  @IsOptional() @IsString() @MaxLength(255) morClientSecret?: string | null;
  @IsOptional() @IsString() @MaxLength(100000) morCertificate?: string | null;
  @IsOptional() @IsString() @MaxLength(40) terminalId?: string | null;
  @IsOptional() @IsString() @MaxLength(40) branchCode?: string | null;
}

export class FiscalBatchDto {
  @IsOptional() @IsArray() @IsInt({ each: true }) orderIds?: number[];
  @IsOptional() @IsArray() @IsInt({ each: true }) saleIds?: number[];
}

export class FiscalBatchAckDto extends FiscalBatchDto {
  @IsString() @IsNotEmpty() @MaxLength(60) fsNumber!: string;
  @IsString() @IsNotEmpty() @MaxLength(60) ejNumber!: string;
  @IsOptional() @IsString() @MaxLength(60) machineSerial?: string;
}

export class FiscalBatchFailDto extends FiscalBatchDto {
  @IsOptional() @IsString() @MaxLength(255) message?: string;
}
