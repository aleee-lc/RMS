import { IsInt, IsOptional, IsPositive } from 'class-validator';

export class HotelQueryDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  hotelId?: number;
}
