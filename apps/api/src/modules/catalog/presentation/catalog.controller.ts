import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { BrowseCatalogUseCase } from '../application/catalog.use-cases';
import { BrowseCatalogQueryDto, EditionDto } from './dto/catalog.dto';
import { toEditionDto } from './catalog.mapper';

/**
 * Customer-facing catalog. Authenticated (the global guard) but not role-restricted.
 *
 * Left authenticated rather than @Public deliberately: browsing is not sensitive, but
 * an unauthenticated catalog endpoint is a free scraping target for competitors, and
 * we lose the ability to personalise by the user's saved pincode later.
 */
@ApiTags('catalog')
@ApiBearerAuth()
@Controller({ path: 'catalog', version: '1' })
export class CatalogController {
  constructor(private readonly browse: BrowseCatalogUseCase) {}

  @Get('editions')
  @ApiOperation({
    summary: 'Browse subscribable newspapers by pincode, city or language',
    description:
      'Only returns editions that are available AND whose newspaper is active — a customer ' +
      'must never be shown a product they cannot actually buy.',
  })
  @ApiOkResponse({ type: [EditionDto] })
  async editions(@Query() query: BrowseCatalogQueryDto): Promise<EditionDto[]> {
    const editions = await this.browse.execute({
      pincode: query.pincode,
      city: query.city,
      language: query.language,
    });

    return editions.map(toEditionDto);
  }

  @Get('editions/:id')
  @ApiOperation({ summary: 'Get one edition' })
  @ApiOkResponse({ type: EditionDto })
  @ApiNotFoundResponse()
  async edition(@Param('id', ParseUUIDPipe) id: string): Promise<EditionDto> {
    return toEditionDto(await this.browse.getEdition(id));
  }
}
