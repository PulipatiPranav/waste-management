import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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
} from 'class-validator';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PRODUCT_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;

// ---------------------------------------------------------------------------
// Seller admin
// ---------------------------------------------------------------------------

export class CreateSellerDto {
  @ApiProperty({ example: 'GreenLeaf Stationery' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: '29ABCDE1234F1Z5' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  gstin?: string;

  @ApiProperty({ example: 'Asha Rao' })
  @IsString()
  @MaxLength(120)
  contactName!: string;

  @ApiProperty({ example: '+919876543210' })
  @IsString()
  @MaxLength(20)
  contactPhone!: string;

  @ApiProperty({ example: 'Pune' })
  @IsString()
  @MaxLength(80)
  city!: string;

  @ApiProperty({ example: 'Maharashtra' })
  @IsString()
  @MaxLength(80)
  state!: string;
}

export class SellerActionDto {
  @ApiProperty({ enum: ['VERIFY', 'SUSPEND', 'REINSTATE'] })
  @IsEnum(['VERIFY', 'SUSPEND', 'REINSTATE'] as const)
  action!: 'VERIFY' | 'SUSPEND' | 'REINSTATE';
}

// ---------------------------------------------------------------------------
// Products & variants
// ---------------------------------------------------------------------------

export class CreateProductDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  sellerId!: string;

  @ApiProperty({ example: 'Recycled A5 Notebook' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @ApiProperty({ example: 'recycled-a5-notebook', description: 'lowercase-hyphenated, unique' })
  @Matches(SLUG, { message: 'slug must be lowercase-hyphenated' })
  @MaxLength(180)
  slug!: string;

  @ApiProperty({ example: 'A6-friendly notebook made from post-consumer waste.' })
  @IsString()
  @MaxLength(2000)
  description!: string;

  @ApiPropertyOptional({ example: '100% post-consumer recycled paper' })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  recycledContent?: string;
}

export class SetProductStatusDto {
  @ApiProperty({ enum: PRODUCT_STATUSES })
  @IsEnum(PRODUCT_STATUSES)
  status!: (typeof PRODUCT_STATUSES)[number];
}

export class CreateVariantDto {
  @ApiProperty({ example: 'NB-A5-160-RULED', description: 'Unique SKU' })
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  sku!: string;

  @ApiProperty({ example: 'A5 / 160 pages / ruled' })
  @IsString()
  @MaxLength(160)
  name!: string;

  @ApiProperty({ example: 14999, description: 'INTEGER PAISE' })
  @Type(() => Number)
  @IsInt({ message: 'pricePaise must be an integer number of paise' })
  @Min(0)
  @Max(100_000_000)
  pricePaise!: number;

  @ApiProperty({ example: 100, description: 'Units in stock' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  stock!: number;
}

export class UpdateVariantDto {
  @ApiPropertyOptional({ example: 12999, description: 'INTEGER PAISE' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  pricePaise?: number;

  @ApiPropertyOptional({ example: 250, description: 'Absolute stock level (not a delta)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  stock?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

export class AddToCartDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  variantId!: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity!: number;
}

export class SetCartItemDto {
  @ApiProperty({ example: 3, minimum: 0, description: '0 removes the line' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  quantity!: number;
}

// ---------------------------------------------------------------------------
// Checkout & fulfilment
// ---------------------------------------------------------------------------

export class CheckoutDto {
  @ApiPropertyOptional({
    example: 20000,
    description:
      'INTEGER PAISE of wallet to apply. Capped at balance and order total. 0 = card only.',
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'requestedWalletPaise must be an integer number of paise' })
  @Min(0)
  @Max(100_000_000)
  requestedWalletPaise?: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  shippingAddressId?: string;
}

export class FulfilOrderDto {
  @ApiProperty({ enum: ['SHIP', 'DELIVER'] })
  @IsEnum(['SHIP', 'DELIVER'] as const)
  action!: 'SHIP' | 'DELIVER';
}

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

export class VariantDto {
  @ApiProperty() id!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: 14999 }) pricePaise!: number;
  @ApiProperty({ example: '149.99' }) priceRupees!: string;
  @ApiProperty({ example: 100 }) stock!: number;
  @ApiProperty() isActive!: boolean;
}

export class ProductDto {
  @ApiProperty() id!: string;
  @ApiProperty() sellerName!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ nullable: true, type: String }) recycledContent!: string | null;
  @ApiProperty() status!: string;
  @ApiProperty({ type: [VariantDto] }) variants!: VariantDto[];
}

export class SellerDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ nullable: true, type: String }) gstin!: string | null;
  @ApiProperty() contactName!: string;
  @ApiProperty() contactPhone!: string;
  @ApiProperty() city!: string;
  @ApiProperty() state!: string;
}

export class CartLineDto {
  @ApiProperty() variantId!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() productName!: string;
  @ApiProperty() variantName!: string;
  @ApiProperty({ example: 14999 }) unitPricePaise!: number;
  @ApiProperty({ example: 2 }) quantity!: number;
  @ApiProperty({ example: 29998 }) lineTotalPaise!: number;
  @ApiProperty({ example: '299.98' }) lineTotalRupees!: string;
  @ApiProperty({ example: 100 }) availableStock!: number;
  @ApiProperty() variantActive!: boolean;
}

export class CartDto {
  @ApiProperty({ type: [CartLineDto] }) lines!: CartLineDto[];
  @ApiProperty({ example: 29998 }) subtotalPaise!: number;
  @ApiProperty({ example: '299.98' }) subtotalRupees!: string;
}

export class OrderItemDto {
  @ApiProperty() sku!: string;
  @ApiProperty() productName!: string;
  @ApiProperty() variantName!: string;
  @ApiProperty() unitPricePaise!: number;
  @ApiProperty() quantity!: number;
  @ApiProperty() lineTotalPaise!: number;
}

export class OrderPaymentDto {
  @ApiProperty() provider!: string;
  @ApiProperty() gatewayOrderId!: string;
  @ApiProperty({ nullable: true, type: String }) gatewayPaymentId!: string | null;
  @ApiProperty() amountPaise!: number;
  @ApiProperty() status!: string;
}

export class OrderDto {
  @ApiProperty() id!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ example: 44997 }) subtotalPaise!: number;
  @ApiProperty({ example: 44997 }) totalPaise!: number;
  @ApiProperty({ example: '449.97' }) totalRupees!: string;
  @ApiProperty({ example: 20000 }) walletAppliedPaise!: number;
  @ApiProperty({ example: 24997 }) gatewayAmountPaise!: number;
  @ApiProperty({ nullable: true, type: String }) failureReason!: string | null;
  @ApiProperty({ type: [OrderItemDto] }) items!: OrderItemDto[];
  @ApiProperty({ type: OrderPaymentDto, nullable: true }) payment!: OrderPaymentDto | null;
  @ApiProperty() createdAt!: string;
}

export class GatewayHandoffDto {
  @ApiProperty() provider!: string;
  @ApiProperty() keyId!: string;
  @ApiProperty() gatewayOrderId!: string;
  @ApiProperty({ example: 24997 }) amountPaise!: number;
}

export class CheckoutResultDto {
  @ApiProperty({ type: OrderDto }) order!: OrderDto;
  @ApiProperty({
    type: GatewayHandoffDto,
    nullable: true,
    description: 'Null for a fully-wallet-paid order (already confirmed).',
  })
  gateway!: GatewayHandoffDto | null;
}
