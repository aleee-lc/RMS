import { IsString, MinLength } from 'class-validator';

export class JoinHotelDto {
  @IsString()
  @MinLength(4)
  declare code: string;
}
