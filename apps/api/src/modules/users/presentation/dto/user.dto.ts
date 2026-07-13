import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { ROLES, type Role } from '@/modules/auth/domain/value-objects/role';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Priya Sharma' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: 'priya@example.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  // `phone`, `role` and `isActive` are absent BY DESIGN, and ValidationPipe runs with
  // forbidNonWhitelisted, so sending them is a 400 rather than a silent no-op. A DTO
  // that accepts `role` is a one-request privilege escalation.
}

export class UserProfileDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '+919876543210' })
  phone!: string;

  @ApiProperty({ nullable: true, type: String })
  email!: string | null;

  @ApiProperty({ nullable: true, type: String })
  name!: string | null;

  @ApiProperty({ enum: ROLES })
  role!: Role;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  createdAt!: string;

  // No passwordHash, ever. The mapping goes through User.toPublic() so this cannot be
  // forgotten by returning an entity straight out of a handler.
}
