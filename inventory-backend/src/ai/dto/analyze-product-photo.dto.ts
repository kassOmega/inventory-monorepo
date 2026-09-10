import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** Photo payload for the AI product assistant (base64 in-memory, no uploads). */
export class AnalyzeProductPhotoDto {
  /**
   * JPEG/PNG/WEBP/HEIC image as a base64 string. May include the
   * `data:image/...;base64,` prefix; the service strips it.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(15_000_000)
  base64Image!: string;

  /** Optional second photo (e.g. a different angle) for a better prediction. */
  @IsString()
  @IsOptional()
  @MaxLength(15_000_000)
  base64Image2?: string;
}
