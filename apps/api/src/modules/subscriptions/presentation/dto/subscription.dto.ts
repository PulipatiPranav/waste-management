import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

import { SUBSCRIPTION_STATUSES } from '../../domain/subscription-state-machine';
import { DELIVERY_FREQUENCIES } from '../../domain/value-objects/delivery-frequency';

const BILLING_CYCLES = ['MONTHLY', 'QUARTERLY'] as const;

/** YYYY-MM-DD, and only that — a date, never an instant. See the Day value object. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateSubscriptionDto {
  @ApiProperty({ format: 'uuid', description: 'The city edition, not the newspaper.' })
  @IsUUID()
  editionId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  deliveryAddressId!: string;

  @ApiProperty({ enum: DELIVERY_FREQUENCIES, default: 'DAILY' })
  @IsEnum(DELIVERY_FREQUENCIES)
  frequency!: (typeof DELIVERY_FREQUENCIES)[number];

  @ApiProperty({ enum: BILLING_CYCLES, default: 'MONTHLY' })
  @IsEnum(BILLING_CYCLES)
  billingCycle!: (typeof BILLING_CYCLES)[number];

  @ApiPropertyOptional({
    example: '2026-07-17',
    description: 'Defaults to today. Cannot be in the past.',
  })
  @IsOptional()
  @IsString()
  @Matches(ISO_DATE, { message: 'startDate must be YYYY-MM-DD' })
  startDate?: string;
}

export class ChangeAddressDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  deliveryAddressId!: string;
}

export class QuoteQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  editionId!: string;

  @ApiProperty({ enum: DELIVERY_FREQUENCIES })
  @IsEnum(DELIVERY_FREQUENCIES)
  frequency!: (typeof DELIVERY_FREQUENCIES)[number];

  @ApiProperty({ enum: BILLING_CYCLES })
  @IsEnum(BILLING_CYCLES)
  billingCycle!: (typeof BILLING_CYCLES)[number];

  @ApiPropertyOptional({ example: '2026-07-17' })
  @IsOptional()
  @Matches(ISO_DATE, { message: 'startDate must be YYYY-MM-DD' })
  startDate?: string;
}

// --- Responses ---------------------------------------------------------------

export class SubscriptionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) editionId!: string;
  @ApiProperty({ format: 'uuid' }) deliveryAddressId!: string;

  @ApiProperty({ enum: SUBSCRIPTION_STATUSES })
  status!: (typeof SUBSCRIPTION_STATUSES)[number];

  @ApiProperty({ enum: DELIVERY_FREQUENCIES })
  frequency!: (typeof DELIVERY_FREQUENCIES)[number];

  @ApiProperty({ enum: BILLING_CYCLES })
  billingCycle!: (typeof BILLING_CYCLES)[number];

  @ApiProperty({ example: '2026-07-17' }) startDate!: string;
  @ApiProperty({ nullable: true, type: String, example: null }) cancelledOn!: string | null;

  @ApiProperty({
    example: 450,
    description: 'The price copied at signup. A later catalogue price rise does not change this.',
  })
  pricePerIssuePaise!: number;

  @ApiProperty({ example: '4.50' }) pricePerIssueRupees!: string;
}

export class ChargePreviewDto {
  @ApiProperty({ example: '2026-07-01' }) periodFrom!: string;
  @ApiProperty({ example: '2026-07-31' }) periodTo!: string;

  @ApiProperty({ example: 15, description: 'Issues actually delivered in this period.' })
  billableIssues!: number;

  @ApiProperty({ example: 31, description: 'Issues a full period would carry.' })
  fullPeriodIssues!: number;

  @ApiProperty({ example: 0, description: 'Issues skipped because the subscription was paused.' })
  pausedIssues!: number;

  @ApiProperty({ example: 6750, description: 'billableIssues × pricePerIssuePaise. Exact.' })
  amountPaise!: number;

  @ApiProperty({ example: '67.50' }) amountRupees!: string;

  @ApiProperty({ description: 'True when charged less than a full period.' })
  isProrated!: boolean;
}
