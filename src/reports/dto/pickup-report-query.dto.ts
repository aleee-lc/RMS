import { IsDateString, IsInt, IsOptional, IsPositive } from 'class-validator';

export class PickupReportQueryDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  hotelId?: number;

  @IsOptional()
  @IsDateString()
  bookingStartDate?: string;

  @IsOptional()
  @IsDateString()
  bookingEndDate?: string;

  @IsOptional()
  @IsDateString()
  stayStartDate?: string;

  @IsOptional()
  @IsDateString()
  stayEndDate?: string;
}
