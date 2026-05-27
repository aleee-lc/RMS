import { IsEnum, IsInt, IsISO8601, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

export class CreateInviteCodeDto {
  @IsEnum(['MANAGER', 'ANALYST', 'VIEWER'])
  declare role: 'MANAGER' | 'ANALYST' | 'VIEWER';

  @IsString()
  @MaxLength(80)
  @IsOptional()
  label?: string;

  @IsISO8601()
  @IsOptional()
  expiresAt?: string;

  @IsInt()
  @IsPositive()
  @IsOptional()
  maxUses?: number;
}
