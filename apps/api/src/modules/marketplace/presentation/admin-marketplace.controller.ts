import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '@/modules/auth/presentation/decorators/current-user.decorator';
import { Roles } from '@/modules/auth/presentation/decorators/roles.decorator';
import { type PartnerStatus } from '@/shared/domain/partner-verification';
import { MarketplaceUseCases } from '../application/marketplace.use-cases';
import {
  CreateProductDto,
  CreateSellerDto,
  CreateVariantDto,
  FulfilOrderDto,
  OrderDto,
  ProductDto,
  SellerActionDto,
  SellerDto,
  SetProductStatusDto,
  UpdateVariantDto,
  VariantDto,
} from './dto/marketplace.dto';
import { toOrderDto, toProductDto, toSellerDto, toVariantDto } from './marketplace.mappers';

/**
 * Marketplace back-office: onboard and verify sellers, manage the catalogue and stock, and
 * move confirmed orders through fulfilment. Every route requires ops/admin.
 *
 * Seller verification deliberately reuses the SAME PENDING → VERIFIED → SUSPENDED lifecycle
 * as recycling partners (Phase 5), rather than a bespoke flow — see shared/domain.
 */
@ApiTags('admin/marketplace')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Requires OPS_STAFF or SUPER_ADMIN.' })
@Roles('OPS_STAFF', 'SUPER_ADMIN')
@Controller({ path: 'admin/marketplace', version: '1' })
export class AdminMarketplaceController {
  constructor(private readonly marketplace: MarketplaceUseCases) {}

  // --- Sellers --------------------------------------------------------------

  @Post('sellers')
  @ApiOperation({ summary: 'Onboard a seller (starts PENDING)' })
  @ApiCreatedResponse({ type: SellerDto })
  async createSeller(@Body() dto: CreateSellerDto): Promise<SellerDto> {
    const seller = await this.marketplace.createSeller({
      name: dto.name,
      gstin: dto.gstin ?? null,
      contactName: dto.contactName,
      contactPhone: dto.contactPhone,
      city: dto.city,
      state: dto.state,
    });
    return toSellerDto(seller);
  }

  @Get('sellers')
  @ApiOperation({ summary: 'List sellers, optionally by status' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'VERIFIED', 'SUSPENDED'] })
  @ApiOkResponse({ type: [SellerDto] })
  async listSellers(@Query('status') status?: PartnerStatus): Promise<SellerDto[]> {
    const sellers = await this.marketplace.listSellers(status ?? null);
    return sellers.map(toSellerDto);
  }

  @Post('sellers/:id/transition')
  @ApiOperation({ summary: 'Verify, suspend, or reinstate a seller' })
  @ApiOkResponse({ type: SellerDto })
  async transitionSeller(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SellerActionDto,
  ): Promise<SellerDto> {
    const seller = await this.marketplace.transitionSeller({
      sellerId: id,
      action: dto.action,
      actorUserId: current.id,
    });
    return toSellerDto(seller);
  }

  // --- Products & variants --------------------------------------------------

  @Post('products')
  @ApiOperation({ summary: 'Create a product (starts DRAFT)' })
  @ApiCreatedResponse({ type: ProductDto })
  async createProduct(@Body() dto: CreateProductDto): Promise<ProductDto> {
    const product = await this.marketplace.createProduct({
      sellerId: dto.sellerId,
      name: dto.name,
      slug: dto.slug,
      description: dto.description,
      recycledContent: dto.recycledContent ?? null,
    });
    return toProductDto(product);
  }

  @Post('products/:id/status')
  @ApiOperation({
    summary: 'Publish/archive a product',
    description: 'Going ACTIVE requires a VERIFIED seller and at least one variant.',
  })
  @ApiOkResponse({ type: ProductDto })
  async setProductStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetProductStatusDto,
  ): Promise<ProductDto> {
    return toProductDto(
      await this.marketplace.setProductStatus({ productId: id, status: dto.status }),
    );
  }

  @Post('products/:id/variants')
  @ApiOperation({ summary: 'Add a variant to a product' })
  @ApiCreatedResponse({ type: VariantDto })
  async createVariant(
    @Param('id', ParseUUIDPipe) productId: string,
    @Body() dto: CreateVariantDto,
  ): Promise<VariantDto> {
    const variant = await this.marketplace.createVariant({
      productId,
      sku: dto.sku,
      name: dto.name,
      pricePaise: dto.pricePaise,
      stock: dto.stock,
    });
    return toVariantDto(variant);
  }

  @Post('variants/:id')
  @ApiOperation({ summary: 'Restock / reprice / (de)activate a variant' })
  @ApiOkResponse({ type: VariantDto })
  async updateVariant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVariantDto,
  ): Promise<VariantDto> {
    return toVariantDto(
      await this.marketplace.updateVariant({
        id,
        pricePaise: dto.pricePaise,
        stock: dto.stock,
        isActive: dto.isActive,
      }),
    );
  }

  // --- Fulfilment -----------------------------------------------------------

  @Post('orders/:id/fulfil')
  @ApiOperation({ summary: 'Move a confirmed order to SHIPPED or DELIVERED' })
  @ApiOkResponse({ type: OrderDto })
  async fulfil(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FulfilOrderDto,
  ): Promise<OrderDto> {
    return toOrderDto(
      await this.marketplace.advanceFulfilment({ orderId: id, action: dto.action }),
    );
  }
}
