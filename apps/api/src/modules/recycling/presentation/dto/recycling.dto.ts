import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { PAPER_TYPES, type PaperType } from '@/modules/wallet/domain/money';
import { BATCH_STATUSES } from '../../domain/batch-state-machine';

const PARTNER_STATUSES = ['PENDING', 'VERIFIED', 'SUSPENDED'] as const;

export class OnboardPartnerDto {
  @ApiProperty({ example: 'Bengaluru Paper Mills Pvt Ltd' })
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  name!: string;

  @ApiProperty({ enum: PAPER_TYPES, isArray: true })
  @IsArray()
  @ArrayMinSize(1, { message: 'A mill that accepts nothing can never receive a batch.' })
  @IsEnum(PAPER_TYPES, { each: true })
  acceptedPaperTypes!: PaperType[];

  @ApiProperty({ example: 5_000_000, description: 'INTEGER GRAMS per day. 5 tonnes = 5000000.' })
  @Type(() => Number)
  @IsInt({ message: 'dailyCapacityGrams must be a whole number of GRAMS' })
  @Min(1)
  @Max(1_000_000_000)
  dailyCapacityGrams!: number;

  @ApiProperty({ example: 'Bengaluru' })
  @IsString()
  @MaxLength(100)
  city!: string;

  @ApiProperty({ example: 'Karnataka' })
  @IsString()
  @MaxLength(100)
  state!: string;

  @ApiProperty({ example: '560099' })
  @Matches(/^[1-9]\d{5}$/, { message: 'pincode must be a valid 6-digit Indian PIN code' })
  pincode!: string;

  @ApiProperty({ example: 'Plot 14, Bommasandra Industrial Area' })
  @IsString()
  @MaxLength(300)
  addressLine!: string;

  @ApiPropertyOptional({
    example: '29ABCDE1234F1Z5',
    description: 'An ESG auditor will ask who received the paper. "A recycler" is not an answer.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  gstin?: string;

  @ApiPropertyOptional({ description: 'State pollution control board consent number.' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  pollutionBoardId?: string;

  @ApiProperty({ example: 'Suresh Kumar' })
  @IsString()
  @MaxLength(120)
  contactName!: string;

  @ApiProperty({ example: '+919876543210' })
  @IsString()
  @MaxLength(20)
  contactPhone!: string;
}

export class UpdatePartnerDto {
  @ApiPropertyOptional({
    enum: PARTNER_STATUSES,
    description: 'Only VERIFIED partners can receive a dispatch.',
  })
  @IsOptional()
  @IsEnum(PARTNER_STATUSES)
  status?: (typeof PARTNER_STATUSES)[number];

  @ApiPropertyOptional({ enum: PAPER_TYPES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(PAPER_TYPES, { each: true })
  acceptedPaperTypes?: PaperType[];

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  dailyCapacityGrams?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  contactPhone?: string;
}

export class DispatchBatchDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  partnerId!: string;

  @ApiProperty({ example: 'Karnataka Roadlines' })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  transporterName!: string;

  @ApiProperty({ example: 'KA-01-AB-1234' })
  @IsString()
  @MinLength(4)
  @MaxLength(20)
  transporterVehicleNo!: string;

  @ApiProperty({ example: '+919876543210' })
  @IsString()
  @MaxLength(20)
  transporterContact!: string;
}

export class ConfirmDispatchDto {
  @ApiProperty({
    example: 97_500,
    description:
      'INTEGER GRAMS, as read on the MILL’s weighbridge. Recorded alongside our collected ' +
      'weight, never over it — the gap between them is the finding.',
  })
  @Type(() => Number)
  @IsInt({ message: 'confirmedWeightGrams must be a whole number of GRAMS' })
  @Min(0)
  @Max(100_000_000)
  confirmedWeightGrams!: number;

  @ApiPropertyOptional({ example: 'WB-2026-07-14-0091', description: 'The mill’s docket number.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  weighbridgeSlipRef?: string;
}

export class RejectDispatchDto {
  @ApiProperty({ example: 'Load contaminated with plastic; refused at the gate.' })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}

export class BatchQueryDto {
  @ApiPropertyOptional({ enum: BATCH_STATUSES })
  @IsOptional()
  @IsEnum(BATCH_STATUSES)
  status?: (typeof BATCH_STATUSES)[number];
}

export class PartnerQueryDto {
  @ApiPropertyOptional({ enum: PARTNER_STATUSES })
  @IsOptional()
  @IsEnum(PARTNER_STATUSES)
  status?: (typeof PARTNER_STATUSES)[number];
}

// --- Responses ---------------------------------------------------------------

export class BatchDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'BATCH-2026-07-14-A3F9' }) reference!: string;
  @ApiProperty() zoneName!: string;
  @ApiProperty({ enum: PAPER_TYPES }) paperType!: string;
  @ApiProperty({ enum: BATCH_STATUSES }) status!: string;

  @ApiProperty({ example: 97_500, description: 'What WE weighed, at customers’ doors.' })
  collectedWeightGrams!: number;

  @ApiProperty({ example: '97.500' }) collectedWeightKg!: string;
  @ApiProperty() itemCount!: number;
  @ApiProperty({ nullable: true, type: String }) closedAt!: string | null;
}

export class DispatchDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) batchId!: string;
  @ApiProperty() partnerName!: string;
  @ApiProperty({ enum: ['IN_TRANSIT', 'CONFIRMED', 'REJECTED'] }) status!: string;
  @ApiProperty() dispatchedAt!: string;
  @ApiProperty() transporterName!: string;
  @ApiProperty() transporterVehicleNo!: string;

  @ApiProperty({ nullable: true, type: Number, description: 'What the MILL weighed.' })
  confirmedWeightGrams!: number | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'confirmed − collected. Negative = the load arrived light.',
  })
  discrepancyGrams!: number | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Signed basis points of the collected weight. -250 = 2.5% light.',
  })
  discrepancyBps!: number | null;

  @ApiProperty({
    description: 'True when the gap exceeds tolerance. Physics below; incident above.',
  })
  discrepancyFlagged!: boolean;

  @ApiProperty({ nullable: true, type: String }) confirmedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) rejectionReason!: string | null;
  @ApiProperty({ nullable: true, type: String }) weighbridgeSlipRef!: string | null;
}

export class ChainOfCustodyDto {
  @ApiProperty({ type: BatchDto }) batch!: BatchDto;
  @ApiProperty({ type: DispatchDto, nullable: true }) dispatch!: DispatchDto | null;

  @ApiProperty({ nullable: true, type: Object, description: 'The mill that received it.' })
  partner!: { id: string; name: string; city: string; gstin: string | null } | null;

  @ApiProperty({ description: 'Every gram, attributed to the customer who handed it over.' })
  items!: {
    pickupItemId: string;
    pickupId: string;
    customerId: string;
    paperType: string;
    weightGrams: number;
    collectedAt: string | null;
    collectedByPartnerId: string | null;
  }[];

  @ApiProperty() totalItemWeightGrams!: number;

  @ApiProperty({
    description:
      'False means the batch’s cached weight disagrees with the sum of its items — the chain ' +
      'is not trustworthy and no ESG number should be built on it.',
  })
  itemsReconcile!: boolean;
}
