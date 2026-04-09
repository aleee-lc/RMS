import { IsBooleanString, IsDateString, IsInt, IsOptional, IsPositive } from 'class-validator';

export class AlertsQueryDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  hotelId?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsBooleanString()
  resolved?: string;
}
