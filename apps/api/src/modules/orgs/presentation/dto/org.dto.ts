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
  ValidateIf,
} from 'class-validator';

const ORG_ROLES = ['ADMIN', 'MEMBER'] as const;
const CONTRACT_TYPES = ['FLAT_MONTHLY', 'PER_KG'] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export class AddMemberDto {
  @ApiProperty({
    example: '+919876543210',
    description: 'The member’s phone. They must have signed up.',
  })
  @IsString()
  @MaxLength(20)
  memberPhone!: string;

  @ApiPropertyOptional({ enum: ORG_ROLES, default: 'MEMBER' })
  @IsOptional()
  @IsEnum(ORG_ROLES)
  orgRole?: (typeof ORG_ROLES)[number];
}

export class RequestOrgPickupDto {
  @ApiProperty({ format: 'uuid', description: 'An address owned by THIS org.' })
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

export class CreateContractDto {
  @ApiProperty({ enum: CONTRACT_TYPES })
  @IsEnum(CONTRACT_TYPES)
  type!: (typeof CONTRACT_TYPES)[number];

  @ApiPropertyOptional({
    example: 500_000,
    description: 'INTEGER PAISE. Required for FLAT_MONTHLY.',
  })
  @ValidateIf((dto: CreateContractDto) => dto.type === 'FLAT_MONTHLY')
  @Type(() => Number)
  @IsInt({ message: 'flatAmountPaise must be an integer number of paise' })
  @Min(0)
  @Max(1_000_000_000)
  flatAmountPaise?: number;

  @ApiPropertyOptional({ example: 800, description: 'INTEGER PAISE PER KG. Required for PER_KG.' })
  @ValidateIf((dto: CreateContractDto) => dto.type === 'PER_KG')
  @Type(() => Number)
  @IsInt({ message: 'perKgRatePaise must be an integer number of paise per kg' })
  @Min(0)
  @Max(1_000_000)
  perKgRatePaise?: number;

  @ApiProperty({ example: '2026-07-01' })
  @Matches(ISO_DATE, { message: 'startDate must be YYYY-MM-DD' })
  startDate!: string;
}

export class GenerateInvoiceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  contractId!: string;

  @ApiProperty({ example: '2026-07', description: 'The billing month, YYYY-MM.' })
  @Matches(YEAR_MONTH, { message: 'yearMonth must be YYYY-MM' })
  yearMonth!: string;
}

export class OrgMemberDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ nullable: true, type: String }) name!: string | null;
  @ApiProperty() phone!: string;
  @ApiProperty({ enum: ORG_ROLES }) orgRole!: string;
}

export class ContractDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: CONTRACT_TYPES }) type!: string;
  @ApiProperty({ nullable: true, type: Number }) flatAmountPaise!: number | null;
  @ApiProperty({ nullable: true, type: Number }) perKgRatePaise!: number | null;
  @ApiProperty() status!: string;
  @ApiProperty({ example: '2026-07-01' }) startDate!: string;
}

export class InvoiceDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) contractId!: string;
  @ApiProperty() periodLabel!: string;
  @ApiProperty() contractType!: string;
  @ApiProperty({ example: 40_000 }) recycledGrams!: number;
  @ApiProperty({ example: '40.000' }) recycledKg!: string;
  @ApiProperty({ example: 500_000 }) amountPaise!: number;
  @ApiProperty({ example: '5000.00' }) amountRupees!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ nullable: true, type: String }) issuedAt!: string | null;
}
