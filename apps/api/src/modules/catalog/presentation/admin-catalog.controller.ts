import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '@/modules/auth/presentation/decorators/roles.decorator';
import { ManageCatalogUseCases } from '../application/catalog.use-cases';
import {
  CreateEditionDto,
  CreateNewspaperDto,
  CreatePublisherDto,
  EditionDto,
  NewspaperDto,
  PublisherDto,
  UpdateEditionDto,
  UpdateNewspaperDto,
  UpdatePublisherDto,
} from './dto/catalog.dto';
import { toEditionDto, toNewspaperDto } from './catalog.mapper';

/**
 * Catalog administration. @Roles is applied at the CLASS level, so every route here —
 * including any added later — is staff-only by construction. Per-method guards are one
 * forgotten decorator away from an open write endpoint on the price list.
 */
@ApiTags('admin/catalog')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Requires OPS_STAFF or SUPER_ADMIN.' })
@Roles('OPS_STAFF', 'SUPER_ADMIN')
@Controller({ path: 'admin/catalog', version: '1' })
export class AdminCatalogController {
  constructor(private readonly catalog: ManageCatalogUseCases) {}

  // --- Publishers ----------------------------------------------------------

  @Post('publishers')
  @ApiOperation({ summary: 'Create a publisher' })
  @ApiCreatedResponse({ type: PublisherDto })
  createPublisher(@Body() dto: CreatePublisherDto): Promise<PublisherDto> {
    return this.catalog.createPublisher({ name: dto.name, website: dto.website ?? null });
  }

  @Get('publishers')
  @ApiOkResponse({ type: [PublisherDto] })
  listPublishers(): Promise<PublisherDto[]> {
    return this.catalog.listPublishers();
  }

  @Patch('publishers/:id')
  @ApiOkResponse({ type: PublisherDto })
  updatePublisher(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePublisherDto,
  ): Promise<PublisherDto> {
    return this.catalog.updatePublisher(id, dto);
  }

  // --- Newspapers ----------------------------------------------------------

  @Post('newspapers')
  @ApiOperation({ summary: 'Create a newspaper' })
  @ApiCreatedResponse({ type: NewspaperDto })
  async createNewspaper(@Body() dto: CreateNewspaperDto): Promise<NewspaperDto> {
    const newspaper = await this.catalog.createNewspaper({
      publisherId: dto.publisherId,
      name: dto.name,
      language: dto.language,
      coverImageUrl: dto.coverImageUrl ?? null,
    });

    return toNewspaperDto(newspaper);
  }

  @Get('newspapers')
  @ApiOperation({ summary: 'List all newspapers, including deactivated ones' })
  @ApiOkResponse({ type: [NewspaperDto] })
  async listNewspapers(): Promise<NewspaperDto[]> {
    const newspapers = await this.catalog.listNewspapers();
    return newspapers.map(toNewspaperDto);
  }

  @Patch('newspapers/:id')
  @ApiOkResponse({ type: NewspaperDto })
  async updateNewspaper(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNewspaperDto,
  ): Promise<NewspaperDto> {
    return toNewspaperDto(await this.catalog.updateNewspaper(id, dto));
  }

  // --- Editions ------------------------------------------------------------

  @Post('editions')
  @ApiOperation({ summary: 'Create a city edition with its price and delivery footprint' })
  @ApiCreatedResponse({ type: EditionDto })
  async createEdition(@Body() dto: CreateEditionDto): Promise<EditionDto> {
    const edition = await this.catalog.createEdition({
      newspaperId: dto.newspaperId,
      city: dto.city,
      state: dto.state,
      servicePincodes: dto.servicePincodes,
      pricePerIssuePaise: dto.pricePerIssuePaise,
      isAvailable: dto.isAvailable ?? true,
    });

    return toEditionDto(edition);
  }

  @Get('editions')
  @ApiOkResponse({ type: [EditionDto] })
  async listEditions(@Query('newspaperId') newspaperId?: string): Promise<EditionDto[]> {
    const editions = await this.catalog.listEditions(newspaperId);
    return editions.map(toEditionDto);
  }

  @Patch('editions/:id')
  @ApiOperation({
    summary: 'Update an edition',
    description:
      'Changing the price does NOT re-price existing subscriptions: each copied its price at ' +
      'signup, so a rise applies to new subscribers only and past invoices still recompute ' +
      'to the figure they were issued at.',
  })
  @ApiOkResponse({ type: EditionDto })
  async updateEdition(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEditionDto,
  ): Promise<EditionDto> {
    return toEditionDto(await this.catalog.updateEdition(id, dto));
  }
}
