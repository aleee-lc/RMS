import { IsEnum } from 'class-validator';

export class UpdateMemberRoleDto {
  @IsEnum(['MANAGER', 'ANALYST', 'VIEWER'])
  declare role: 'MANAGER' | 'ANALYST' | 'VIEWER';
}
