import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Photo payload for the AI car-wash vehicle assistant (base64 in-memory). */
export class AnalyzeVehiclePhotoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(15_000_000)
  base64Image!: string;
}
