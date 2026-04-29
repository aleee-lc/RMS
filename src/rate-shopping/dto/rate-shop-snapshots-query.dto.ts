import { IsDateString, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class RateShopSnapshotsQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  hotelId?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  competitorName?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;
}
