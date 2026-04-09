import { IsDateString, IsInt, IsOptional, IsPositive } from 'class-validator';

export class DateRangeQueryDto {
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
}
