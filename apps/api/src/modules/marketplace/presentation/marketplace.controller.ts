import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '@/modules/auth/presentation/decorators/current-user.decorator';
import { Public } from '@/modules/auth/presentation/decorators/public.decorator';
import { Idempotent } from '@/shared/presentation/interceptors/idempotency.interceptor';
import { MarketplaceUseCases } from '../application/marketplace.use-cases';
import {
  AddToCartDto,
  CartDto,
  CheckoutDto,
  CheckoutResultDto,
  OrderDto,
  ProductDto,
  SetCartItemDto,
} from './dto/marketplace.dto';
import { toCartDto, toOrderDto, toProductDto } from './marketplace.mappers';

/**
 * The storefront: browse the catalogue, manage a cart, check out, and track orders.
 *
 * Browsing is public; everything that touches a cart or an order requires a logged-in
 * customer, and an order is only ever visible to the customer who placed it.
 */
@ApiTags('marketplace')
@Controller({ path: 'marketplace', version: '1' })
export class MarketplaceController {
  constructor(private readonly marketplace: MarketplaceUseCases) {}

  // --- Catalogue (public) ---------------------------------------------------

  @Public()
  @Get('products')
  @ApiOperation({ summary: 'Browse the catalogue (active products from verified sellers)' })
  @ApiOkResponse({ type: [ProductDto] })
  async listProducts(): Promise<ProductDto[]> {
    const products = await this.marketplace.listProducts();
    return products.map(toProductDto);
  }

  @Public()
  @Get('products/:slug')
  @ApiOperation({ summary: 'Product detail by slug' })
  @ApiOkResponse({ type: ProductDto })
  async getProduct(@Param('slug') slug: string): Promise<ProductDto> {
    return toProductDto(await this.marketplace.getProductBySlug(slug));
  }

  // --- Cart -----------------------------------------------------------------

  @ApiBearerAuth()
  @Get('cart')
  @ApiOperation({ summary: 'My cart' })
  @ApiOkResponse({ type: CartDto })
  async getCart(@CurrentUser() current: AuthenticatedUser): Promise<CartDto> {
    return toCartDto(await this.marketplace.getCart(current.id));
  }

  @ApiBearerAuth()
  @Post('cart/items')
  @ApiOperation({ summary: 'Add a variant to the cart (accumulates)' })
  @ApiCreatedResponse({ type: CartDto })
  async addToCart(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: AddToCartDto,
  ): Promise<CartDto> {
    return toCartDto(
      await this.marketplace.addToCart({
        userId: current.id,
        variantId: dto.variantId,
        quantity: dto.quantity,
      }),
    );
  }

  @ApiBearerAuth()
  @Put('cart/items/:variantId')
  @ApiOperation({ summary: 'Set a line to an absolute quantity (0 removes it)' })
  @ApiOkResponse({ type: CartDto })
  async setCartItem(
    @CurrentUser() current: AuthenticatedUser,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: SetCartItemDto,
  ): Promise<CartDto> {
    return toCartDto(
      await this.marketplace.setCartItemQuantity({
        userId: current.id,
        variantId,
        quantity: dto.quantity,
      }),
    );
  }

  // --- Checkout & orders ----------------------------------------------------

  @ApiBearerAuth()
  @Post('checkout')
  @Idempotent()
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'REQUIRED. Checkout creates an order and may move money.',
  })
  @ApiOperation({
    summary: 'Check out the cart',
    description:
      'Snapshots prices, splits payment between wallet and gateway, and either confirms ' +
      'immediately (fully wallet-paid) or returns a gateway handoff for the card leg. Inventory ' +
      'and the wallet are only touched at confirmation.',
  })
  @ApiCreatedResponse({ type: CheckoutResultDto })
  @ApiConflictResponse({ description: 'Empty cart, an unavailable item, or a sold-out line.' })
  async checkout(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: CheckoutDto,
  ): Promise<CheckoutResultDto> {
    const result = await this.marketplace.checkout({
      userId: current.id,
      requestedWalletPaise: dto.requestedWalletPaise ?? 0,
      shippingAddressId: dto.shippingAddressId ?? null,
    });

    return { order: toOrderDto(result.order), gateway: result.gateway };
  }

  @ApiBearerAuth()
  @Get('orders')
  @ApiOperation({ summary: 'My orders' })
  @ApiOkResponse({ type: [OrderDto] })
  async listOrders(@CurrentUser() current: AuthenticatedUser): Promise<OrderDto[]> {
    const orders = await this.marketplace.listMyOrders(current.id);
    return orders.map(toOrderDto);
  }

  @ApiBearerAuth()
  @Get('orders/:id')
  @ApiOperation({ summary: 'One of my orders (status tracking)' })
  @ApiOkResponse({ type: OrderDto })
  async getOrder(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderDto> {
    return toOrderDto(await this.marketplace.getMyOrder(current.id, id));
  }
}
