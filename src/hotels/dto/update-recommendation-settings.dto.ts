import { IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateRecommendationSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  highOccupancyThreshold?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  lowOccupancyThreshold?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  significantDiffPct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  demandWeight?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  marketWeight?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(40)
  maxAdjustmentPct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(20)
  minActionStepPct?: number;
}
