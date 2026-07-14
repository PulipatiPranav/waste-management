import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
  ValidateNested,
} from 'class-validator';

import { PAPER_TYPES, type PaperType } from '@/modules/wallet/domain/money';
import { PICKUP_STATUSES } from '../../domain/pickup-state-machine';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class RequestPickupDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  addressId!: string;

  @ApiProperty({ example: '2026-07-20' })
  @Matches(ISO_DATE, { message: 'scheduledDate must be YYYY-MM-DD' })
  scheduledDate!: string;

  @ApiProperty({ example: 9, minimum: 0, maximum: 23 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  windowStartHour!: number;

  @ApiProperty({ example: 12, minimum: 1, maximum: 24 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  windowEndHour!: number;
}

export class WeightEntryDto {
  @ApiProperty({ enum: PAPER_TYPES })
  @IsEnum(PAPER_TYPES)
  paperType!: PaperType;

  @ApiProperty({
    example: 5250,
    description: 'INTEGER GRAMS. Never kilograms, never a float — 5.25 kg is 5250.',
  })
  @Type(() => Number)
  @IsInt({ message: 'weightGrams must be a whole number of GRAMS, not kilograms' })
  @Min(1)
  @Max(200_000)
  weightGrams!: number;
}

export class CompletePickupDto {
  @ApiProperty({ type: [WeightEntryDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PAPER_TYPES.length)
  @ValidateNested({ each: true })
  @Type(() => WeightEntryDto)
  weights!: WeightEntryDto[];
}

export class ScanPickupDto {
  @ApiProperty({ description: 'The token encoded in the customer’s QR code.' })
  @IsString()
  @MinLength(20)
  @MaxLength(100)
  qrToken!: string;
}

export class QuotePickupDto {
  @ApiProperty({ type: [WeightEntryDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => WeightEntryDto)
  weights!: WeightEntryDto[];
}

// --- Rate cards --------------------------------------------------------------

export class RateDto {
  @ApiProperty({ enum: PAPER_TYPES })
  @IsEnum(PAPER_TYPES)
  paperType!: PaperType;

  @ApiProperty({ example: 1500, description: 'INTEGER PAISE per kg. ₹15.00/kg = 1500.' })
  @Type(() => Number)
  @IsInt({ message: 'ratePerKgPaise must be an integer number of PAISE, not rupees' })
  @Min(0)
  // ₹1000/kg for waste paper is a fat finger (rupees typed into a paise field), and it
  // would credit a customer ₹5,000 for a 5 kg bundle.
  @Max(100_000)
  ratePerKgPaise!: number;
}

export class CreateRateCardDto {
  @ApiProperty({ example: 'July 2026 rates' })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ type: [RateDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PAPER_TYPES.length)
  @ValidateNested({ each: true })
  @Type(() => RateDto)
  rates!: RateDto[];

  @ApiPropertyOptional({
    default: false,
    description: 'Activating this retires the current card. At most one is ever active.',
  })
  @IsOptional()
  @IsBoolean()
  activate?: boolean;
}

// --- Responses ---------------------------------------------------------------

export class PickupItemDto {
  @ApiProperty({ enum: PAPER_TYPES }) paperType!: string;
  @ApiProperty({ example: 5250 }) weightGrams!: number;
  @ApiProperty({ example: '5.250' }) weightKg!: string;
  @ApiProperty({ example: 1500, description: 'The rate at PICKUP time — a snapshot.' })
  ratePerKgPaise!: number;
  @ApiProperty({ example: 7875 }) amountPaise!: number;
  @ApiProperty({ example: '78.75' }) amountRupees!: string;
}

export class PickupDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) addressId!: string;
  @ApiProperty({ example: '2026-07-20' }) scheduledDate!: string;
  @ApiProperty({ example: 9 }) windowStartHour!: number;
  @ApiProperty({ example: 12 }) windowEndHour!: number;
  @ApiProperty({ enum: PICKUP_STATUSES }) status!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Shown ONLY to the owning customer, for display as a QR code at the door.',
  })
  qrToken!: string | null;

  @ApiProperty({ type: [PickupItemDto] }) items!: PickupItemDto[];
  @ApiProperty({ example: 11565 }) totalPaise!: number;
  @ApiProperty({ example: '115.65' }) totalRupees!: string;
  @ApiProperty({ nullable: true, type: String }) completedAt!: string | null;
}

export class CashbackResultDto {
  @ApiProperty({ format: 'uuid' }) pickupId!: string;
  @ApiProperty({ example: 9100 }) totalWeightGrams!: number;
  @ApiProperty({ example: '9.100' }) totalWeightKg!: string;
  @ApiProperty({ example: 11565 }) totalPaise!: number;
  @ApiProperty({ example: '115.65' }) totalRupees!: string;

  @ApiProperty({
    example: '365.00',
    description: 'The customer’s wallet balance after the credit.',
  })
  walletBalanceRupees!: string;

  @ApiProperty({ example: 36500 }) walletBalancePaise!: string;
  @ApiProperty({ type: [PickupItemDto] }) lines!: PickupItemDto[];
}

export class QuoteDto {
  @ApiProperty({ type: [PickupItemDto] }) lines!: PickupItemDto[];
  @ApiProperty() totalWeightGrams!: number;
  @ApiProperty() totalPaise!: number;
  @ApiProperty({ example: '115.65' }) totalRupees!: string;
}

export class RateCardDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() rates!: { paperType: string; ratePerKgPaise: number; ratePerKgRupees: string }[];
}
