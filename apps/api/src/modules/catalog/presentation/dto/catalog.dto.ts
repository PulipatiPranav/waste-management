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
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { LANGUAGES, type Language } from '../../domain/catalog.types';

const PINCODE = /^[1-9]\d{5}$/;

// --- Browse ------------------------------------------------------------------

export class BrowseCatalogQueryDto {
  @ApiPropertyOptional({ example: '560038' })
  @IsOptional()
  @Matches(PINCODE, { message: 'pincode must be a valid 6-digit Indian PIN code' })
  pincode?: string;

  @ApiPropertyOptional({ example: 'Bengaluru' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ enum: LANGUAGES })
  @IsOptional()
  @IsEnum(LANGUAGES)
  language?: Language;
}

// --- Admin: publisher --------------------------------------------------------

export class CreatePublisherDto {
  @ApiProperty({ example: 'The Times Group' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: 'https://timesgroup.com' })
  @IsOptional()
  @IsUrl()
  @MaxLength(300)
  website?: string;
}

export class UpdatePublisherDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  @MaxLength(300)
  website?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// --- Admin: newspaper --------------------------------------------------------

export class CreateNewspaperDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  publisherId!: string;

  @ApiProperty({ example: 'The Times of India' })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name!: string;

  @ApiProperty({ enum: LANGUAGES })
  @IsEnum(LANGUAGES)
  language!: Language;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  coverImageUrl?: string;
}

export class UpdateNewspaperDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({ enum: LANGUAGES })
  @IsOptional()
  @IsEnum(LANGUAGES)
  language?: Language;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  coverImageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// --- Admin: edition ----------------------------------------------------------

export class CreateEditionDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  newspaperId!: string;

  @ApiProperty({ example: 'Bengaluru' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  city!: string;

  @ApiProperty({ example: 'Karnataka' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  state!: string;

  @ApiProperty({ example: ['560001', '560038'], type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @Matches(PINCODE, { each: true, message: 'each pincode must be a valid 6-digit Indian PIN code' })
  servicePincodes!: string[];

  @ApiProperty({
    example: 450,
    description: 'Price per ISSUE in paise (₹4.50 = 450). Never rupees, never a float.',
  })
  @Type(() => Number)
  @IsInt({ message: 'pricePerIssuePaise must be an integer number of paise, not rupees' })
  @Min(0)
  // ₹1000 for a single newspaper is a fat-finger, not a price. Without a ceiling, a
  // stray "45000" typed as rupees-not-paise bills a daily subscriber ₹13,950 a month.
  @Max(100_000)
  pricePerIssuePaise!: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;
}

export class UpdateEditionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  state?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @Matches(PINCODE, { each: true })
  servicePincodes?: string[];

  @ApiPropertyOptional({
    description:
      'Changing this does NOT re-price existing subscriptions — each copied its price at signup.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  pricePerIssuePaise?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;
}

// --- Responses ---------------------------------------------------------------

export class PublisherDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) website!: string | null;
  @ApiProperty() isActive!: boolean;
}

export class NewspaperDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: LANGUAGES }) language!: Language;
  @ApiProperty({ nullable: true, type: String }) coverImageUrl!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() publisherName!: string;
  @ApiProperty({ format: 'uuid' }) publisherId!: string;
}

export class EditionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() city!: string;
  @ApiProperty() state!: string;
  @ApiProperty({ type: [String] }) servicePincodes!: string[];

  @ApiProperty({ example: 450, description: 'Per issue, in paise.' })
  pricePerIssuePaise!: number;

  /** Convenience for clients, so no one divides by 100 in five different places. */
  @ApiProperty({ example: '4.50', description: 'Same value, formatted for display.' })
  pricePerIssueRupees!: string;

  @ApiProperty() isAvailable!: boolean;
  @ApiProperty({ type: NewspaperDto }) newspaper!: NewspaperDto;
}
