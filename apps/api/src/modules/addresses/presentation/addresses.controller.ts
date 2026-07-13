import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '@/modules/auth/presentation/decorators/current-user.decorator';
import { AddressUseCases } from '../application/address.use-cases';
import { type Address } from '../domain/entities/address';
import { AddressDto, CreateAddressDto, UpdateAddressDto } from './dto/address.dto';

/**
 * Every route is scoped to the authenticated user. The owner id comes from the token,
 * never from the request — so there is no route on which one customer can reach
 * another's address, even by guessing a valid uuid.
 */
@ApiTags('addresses')
@ApiBearerAuth()
@Controller({ path: 'addresses', version: '1' })
export class AddressesController {
  constructor(private readonly addresses: AddressUseCases) {}

  @Post()
  @ApiOperation({ summary: 'Add an address' })
  @ApiCreatedResponse({ type: AddressDto })
  async create(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: CreateAddressDto,
  ): Promise<AddressDto> {
    const address = await this.addresses.create({
      userId: current.id,
      label: dto.label ?? null,
      line1: dto.line1,
      line2: dto.line2 ?? null,
      city: dto.city,
      state: dto.state,
      pincode: dto.pincode,
      country: 'IN',
      landmark: dto.landmark ?? null,
      ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
    });

    return this.toDto(address);
  }

  @Get()
  @ApiOperation({ summary: 'List the authenticated user’s addresses' })
  @ApiOkResponse({ type: [AddressDto] })
  async list(@CurrentUser() current: AuthenticatedUser): Promise<AddressDto[]> {
    const addresses = await this.addresses.list(current.id);
    return addresses.map((address) => this.toDto(address));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one address' })
  @ApiOkResponse({ type: AddressDto })
  @ApiNotFoundResponse({ description: 'Not found, or not yours — the two are indistinguishable.' })
  async get(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AddressDto> {
    return this.toDto(await this.addresses.get(current.id, id));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an address' })
  @ApiOkResponse({ type: AddressDto })
  @ApiNotFoundResponse({ description: 'Not found, or not yours.' })
  async update(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddressDto,
  ): Promise<AddressDto> {
    const address = await this.addresses.update({
      userId: current.id,
      addressId: id,
      data: {
        ...(dto.label !== undefined ? { label: dto.label } : {}),
        ...(dto.line1 !== undefined ? { line1: dto.line1 } : {}),
        ...(dto.line2 !== undefined ? { line2: dto.line2 } : {}),
        ...(dto.city !== undefined ? { city: dto.city } : {}),
        ...(dto.state !== undefined ? { state: dto.state } : {}),
        ...(dto.pincode !== undefined ? { pincode: dto.pincode } : {}),
        ...(dto.landmark !== undefined ? { landmark: dto.landmark } : {}),
        ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
      },
    });

    return this.toDto(address);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an address' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Not found, or not yours.' })
  async remove(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.addresses.remove(current.id, id);
  }

  private toDto(address: Address): AddressDto {
    const view = address.toPublic();

    return {
      id: view.id,
      label: view.label,
      line1: view.line1,
      line2: view.line2,
      city: view.city,
      state: view.state,
      pincode: view.pincode,
      country: view.country,
      landmark: view.landmark,
      isDefault: view.isDefault,
      createdAt: view.createdAt.toISOString(),
    };
  }
}
