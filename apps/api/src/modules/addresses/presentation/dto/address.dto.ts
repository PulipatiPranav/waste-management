import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateAddressDto {
  @ApiPropertyOptional({ example: 'Home' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  label?: string;

  @ApiProperty({ example: 'Flat 402, Prestige Apartments' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  line1!: string;

  @ApiPropertyOptional({ example: '12th Main, Indiranagar' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  line2?: string;

  @ApiProperty({ example: 'Bengaluru' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  city!: string;

  @ApiProperty({ example: 'Karnataka' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  state!: string;

  @ApiProperty({ example: '560038' })
  @IsString()
  // Indian PIN: six digits, never starting with 0. Pickup routing and zone assignment
  // (Phase 3) key off this, so garbage here silently strands a customer outside every
  // delivery zone.
  @Matches(/^[1-9]\d{5}$/, { message: 'pincode must be a valid 6-digit Indian PIN code' })
  pincode!: string;

  @ApiPropertyOptional({ example: 'Opposite the metro station' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  landmark?: string;

  @ApiPropertyOptional({ description: 'The first address added becomes the default anyway.' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAddressDto extends CreateAddressDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  declare line1: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  declare city: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  declare state: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[1-9]\d{5}$/, { message: 'pincode must be a valid 6-digit Indian PIN code' })
  declare pincode: string;
}

export class AddressDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ nullable: true, type: String })
  label!: string | null;

  @ApiProperty()
  line1!: string;

  @ApiProperty({ nullable: true, type: String })
  line2!: string | null;

  @ApiProperty()
  city!: string;

  @ApiProperty()
  state!: string;

  @ApiProperty()
  pincode!: string;

  @ApiProperty()
  country!: string;

  @ApiProperty({ nullable: true, type: String })
  landmark!: string | null;

  @ApiProperty()
  isDefault!: boolean;

  @ApiProperty()
  createdAt!: string;
}
