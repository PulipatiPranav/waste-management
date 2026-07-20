import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class AuditQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Filter to actions by this staff member' })
  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  @ApiPropertyOptional({ example: 'POST /admin/wallet/adjustments' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  action?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Everything done to this entity' })
  @IsOptional()
  @IsUUID()
  targetId?: string;

  @ApiPropertyOptional({ example: 50, minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ format: 'uuid', description: 'Keyset cursor (an audit row id)' })
  @IsOptional()
  @IsUUID()
  cursor?: string;
}

export class AuditLogDto {
  @ApiProperty() id!: string;
  @ApiProperty() actorUserId!: string;
  @ApiProperty({ nullable: true, type: String }) actorName!: string | null;
  @ApiProperty({ nullable: true, type: String }) actorEmail!: string | null;
  @ApiProperty() actorRole!: string;
  @ApiProperty({ example: 'POST /admin/wallet/adjustments' }) action!: string;
  @ApiProperty() method!: string;
  @ApiProperty() path!: string;
  @ApiProperty({ nullable: true, type: String }) targetType!: string | null;
  @ApiProperty({ nullable: true, type: String }) targetId!: string | null;
  @ApiProperty({ example: 201 }) statusCode!: number;
  @ApiProperty({ nullable: true, type: Object }) metadata!: unknown;
  @ApiProperty({ nullable: true, type: String }) ip!: string | null;
  @ApiProperty() createdAt!: string;
}

export class AuditPageDto {
  @ApiProperty({ type: [AuditLogDto] }) rows!: AuditLogDto[];
  @ApiProperty({ nullable: true, type: String }) nextCursor!: string | null;
}
