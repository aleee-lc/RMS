import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class BootstrapAdminDto {
  @IsString()
  @MinLength(24)
  token!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  name?: string;
}
