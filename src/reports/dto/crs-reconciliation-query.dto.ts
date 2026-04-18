import { IsDateString, IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

export class CrsReconciliationQueryDto {
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
  @IsString()
  whichDate?: string;
}
