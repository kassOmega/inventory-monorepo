import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** Photo payload for the AI guest-ID check-in assistant (base64 in-memory). */
export class AnalyzeGuestIdDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(15_000_000)
  base64Image!: string;

  /** Optional second photo (e.g. the back of the ID) for a better extraction. */
  @IsString()
  @IsOptional()
  @MaxLength(15_000_000)
  base64Image2?: string;
}
