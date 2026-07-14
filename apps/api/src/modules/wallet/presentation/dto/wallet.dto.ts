import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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

import { WALLET_TXN_TYPES } from '../../domain/ledger';
import { WITHDRAWAL_STATUSES } from '../../domain/withdrawal-state-machine';

export class RequestWithdrawalDto {
  @ApiProperty({ example: 50000, description: 'INTEGER PAISE. ₹500.00 = 50000. Minimum ₹100.' })
  @Type(() => Number)
  @IsInt({ message: 'amountPaise must be an integer number of PAISE, not rupees' })
  @Min(10_000, { message: 'The minimum withdrawal is ₹100 (10000 paise).' })
  // ₹1,00,000 in one request. Above this, ops should be talking to the customer.
  @Max(10_000_000)
  amountPaise!: number;

  @ApiProperty({ example: '4321', description: 'Last 4 digits only. We do not store the rest.' })
  @Matches(/^\d{4}$/, { message: 'bankAccountLast4 must be exactly 4 digits' })
  bankAccountLast4!: string;

  @ApiProperty({ example: 'HDFC0001234' })
  @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, { message: 'bankIfsc must be a valid IFSC code' })
  bankIfsc!: string;

  @ApiProperty({ example: 'Priya Sharma' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  accountHolder!: string;
}

export class RejectWithdrawalDto {
  @ApiProperty({ example: 'Bank details do not match the account holder’s KYC name.' })
  @IsString()
  @MinLength(10, { message: 'A rejection reason must explain itself — the customer will read it.' })
  @MaxLength(500)
  reason!: string;
}

export class MarkPaidDto {
  @ApiProperty({ example: 'NEFT-2026-07-14-88213', description: 'The bank’s transfer reference.' })
  @IsString()
  @MinLength(4)
  @MaxLength(100)
  paymentRef!: string;
}

export class AdjustWalletDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId!: string;

  @ApiProperty({ enum: ['CREDIT', 'DEBIT'] })
  @IsEnum(['CREDIT', 'DEBIT'])
  direction!: 'CREDIT' | 'DEBIT';

  @ApiProperty({
    example: 5000,
    description: 'INTEGER PAISE. Always positive; direction has the sign.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  amountPaise!: number;

  @ApiProperty({
    example: 'Goodwill credit for pickup #123 where the scale under-read by 2 kg (ticket OPS-451).',
    description: 'An auditor will read this. Vague reasons are rejected.',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  note!: string;
}

export class WithdrawalQueryDto {
  @ApiPropertyOptional({ enum: WITHDRAWAL_STATUSES })
  @IsOptional()
  @IsEnum(WITHDRAWAL_STATUSES)
  status?: (typeof WITHDRAWAL_STATUSES)[number];
}

// --- Responses ---------------------------------------------------------------

export class WalletDto {
  @ApiProperty({ format: 'uuid' }) id!: string;

  @ApiProperty({
    example: '36500',
    description: 'INTEGER PAISE, as a string — a JS number cannot safely hold a BigInt.',
  })
  balancePaise!: string;

  @ApiProperty({ example: '365.00' }) balanceRupees!: string;
  @ApiProperty({ example: 'INR' }) currency!: string;
}

export class LedgerEntryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: WALLET_TXN_TYPES }) type!: string;
  @ApiProperty({ enum: ['CREDIT', 'DEBIT'] }) direction!: string;
  @ApiProperty({ example: '11565' }) amountPaise!: string;
  @ApiProperty({ example: '115.65' }) amountRupees!: string;
  @ApiProperty({ example: '36500' }) balanceAfterPaise!: string;
  @ApiProperty({ example: '365.00' }) balanceAfterRupees!: string;
  @ApiProperty({ nullable: true, type: String }) pickupId!: string | null;
  @ApiProperty({ nullable: true, type: String }) withdrawalId!: string | null;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
  @ApiProperty() createdAt!: string;
}

export class WithdrawalDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: '50000' }) amountPaise!: string;
  @ApiProperty({ example: '500.00' }) amountRupees!: string;
  @ApiProperty({ enum: WITHDRAWAL_STATUSES }) status!: string;
  @ApiProperty() bankAccountLast4!: string;
  @ApiProperty() bankIfsc!: string;
  @ApiProperty() accountHolder!: string;
  @ApiProperty({ nullable: true, type: String }) rejectionReason!: string | null;
  @ApiProperty({ nullable: true, type: String }) paymentRef!: string | null;
  @ApiProperty() createdAt!: string;
}

export class ReconciliationDto {
  @ApiProperty({
    description: 'False means a write escaped the row lock. Investigate immediately.',
  })
  ok!: boolean;

  @ApiProperty({ example: '36500' }) cachedBalancePaise!: string;
  @ApiProperty({ example: '36500', description: 'Recomputed by replaying every ledger entry.' })
  ledgerBalancePaise!: string;
  @ApiProperty() entryCount!: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Index of the first entry whose balanceAfter disagrees with the replay.',
  })
  brokenAtIndex!: number | null;
}
