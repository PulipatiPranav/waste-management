import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { STOP_OUTCOMES, type StopOutcome } from '../../domain/stop-status';

const PINCODE = /^[1-9]\d{5}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const KYC_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'] as const;
const VEHICLE_TYPES = ['ON_FOOT', 'BICYCLE', 'SCOOTER', 'MOTORCYCLE', 'CAR'] as const;

// --- Partner -----------------------------------------------------------------

export class RecordOutcomeDto {
  @ApiProperty({ enum: STOP_OUTCOMES })
  @IsEnum(STOP_OUTCOMES)
  outcome!: StopOutcome;

  @ApiPropertyOptional({
    example: 'Gate locked, nobody answered',
    description: 'Required for FAILED and SKIPPED. Forbidden for DELIVERED.',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason?: string;

  @ApiPropertyOptional({
    description: 'From POST /delivery/stops/:id/photo. Upload first, then record the outcome.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  photoKey?: string;
}

export class DayQueryDto {
  @ApiPropertyOptional({ example: '2026-07-14', description: 'Defaults to today.' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'date must be YYYY-MM-DD' })
  date?: string;
}

// --- Admin -------------------------------------------------------------------

export class CreateZoneDto {
  @ApiProperty({ example: 'Bengaluru East' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'Bengaluru' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  city!: string;

  @ApiProperty({ example: ['560038', '560008'], type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @Matches(PINCODE, { each: true, message: 'each pincode must be a valid 6-digit Indian PIN code' })
  pincodes!: string[];
}

export class OnboardPartnerDto {
  @ApiProperty({ format: 'uuid', description: 'A user whose role is already DELIVERY_PARTNER.' })
  @IsUUID()
  userId!: string;

  @ApiProperty({ enum: VEHICLE_TYPES })
  @IsEnum(VEHICLE_TYPES)
  vehicleType!: (typeof VEHICLE_TYPES)[number];

  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  zoneIds!: string[];
}

export class UpdatePartnerDto {
  @ApiPropertyOptional({
    enum: KYC_STATUSES,
    description: 'Only VERIFIED partners are ever assigned work.',
  })
  @IsOptional()
  @IsEnum(KYC_STATUSES)
  kycStatus?: (typeof KYC_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Offboard by setting false. History is kept.' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'On leave. Still onboarded, just not assigned tomorrow.' })
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @ApiPropertyOptional({ enum: VEHICLE_TYPES })
  @IsOptional()
  @IsEnum(VEHICLE_TYPES)
  vehicleType?: (typeof VEHICLE_TYPES)[number];

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  zoneIds?: string[];
}

export class ReassignRunDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  toPartnerId!: string;
}

export class PlanRunsDto {
  @ApiPropertyOptional({ example: '2026-07-15', description: 'Defaults to tomorrow.' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'runDate must be YYYY-MM-DD' })
  runDate?: string;
}

// --- Responses ---------------------------------------------------------------

export class StopDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) subscriptionId!: string;
  @ApiProperty({ format: 'uuid' }) addressId!: string;
  @ApiProperty({ enum: ['PENDING', ...STOP_OUTCOMES] }) status!: string;
  @ApiProperty({ nullable: true, type: String }) reason!: string | null;
  @ApiProperty() sequence!: number;
  @ApiProperty({ nullable: true, type: String }) completedAt!: string | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Short-lived signed URL. Null when no proof photo was taken.',
  })
  photoUrl!: string | null;
}

export class RunDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: '2026-07-14' }) runDate!: string;
  @ApiProperty({ format: 'uuid' }) zoneId!: string;
  @ApiProperty({ format: 'uuid' }) partnerId!: string;
  @ApiProperty({ enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED'] }) status!: string;
  @ApiProperty({ type: [StopDto] }) stops!: StopDto[];
}

export class PartnerDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ nullable: true, type: String }) name!: string | null;
  @ApiProperty() phone!: string;
  @ApiProperty({ enum: KYC_STATUSES }) kycStatus!: string;
  @ApiProperty({ enum: VEHICLE_TYPES }) vehicleType!: string;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() isAvailable!: boolean;
  @ApiProperty({ type: [String] }) zoneIds!: string[];
}

export class CompletionStatsDto {
  @ApiProperty({ example: '2026-07-14' }) runDate!: string;
  @ApiProperty({ format: 'uuid' }) zoneId!: string;
  @ApiProperty() zoneName!: string;
  @ApiProperty({ format: 'uuid' }) partnerId!: string;
  @ApiProperty({ nullable: true, type: String }) partnerName!: string | null;
  @ApiProperty() total!: number;
  @ApiProperty() delivered!: number;
  @ApiProperty() failed!: number;
  @ApiProperty() skipped!: number;
  @ApiProperty() pending!: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    example: 0.96,
    description:
      'delivered / total. Null for an empty run — NOT 0%, which would read as a failure.',
  })
  completionRate!: number | null;
}

export class PlanResultDto {
  @ApiProperty({ example: '2026-07-15' }) runDate!: string;
  @ApiProperty({ description: 'Run sheets newly created.' }) created!: number;
  @ApiProperty({ description: 'Already existed — the job is idempotent.' }) skipped!: number;
  @ApiProperty() totalStops!: number;

  @ApiProperty({
    description:
      'Customers who will receive NO paper. Every entry needs an ops fix: extend a zone, or ' +
      'onboard/verify a partner.',
  })
  unassigned!: { subscriptionId: string; pincode: string; reason: string }[];

  @ApiProperty({ type: [String], description: 'Pincodes appearing in more than one active zone.' })
  ambiguousPincodes!: string[];
}
