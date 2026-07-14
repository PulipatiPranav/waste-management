import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '@/modules/auth/presentation/decorators/roles.decorator';
import { PickupUseCases } from '../application/pickup.use-cases';
import { CreateRateCardDto, RateCardDto } from './dto/pickup.dto';
import { toRateCardDto } from './pickup.mapper';

/**
 * Rate card management.
 *
 * Cards are VERSIONED, never edited. A PickupItem snapshots the rate that applied when it
 * was weighed, so publishing a new card changes what future pickups pay and nothing else —
 * a customer's March cashback still recomputes to exactly what they were paid in March.
 * Editing rates in place would silently rewrite history and the ledger would stop
 * reconciling against the items.
 */
@ApiTags('admin/rates')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Requires OPS_STAFF or SUPER_ADMIN.' })
@Roles('OPS_STAFF', 'SUPER_ADMIN')
@Controller({ path: 'admin/rates', version: '1' })
export class AdminRatesController {
  constructor(private readonly pickups: PickupUseCases) {}

  @Post()
  @ApiOperation({
    summary: 'Publish a new rate card',
    description:
      'Activating it retires the current one, in a single transaction. At most one card is ever ' +
      'active — two would mean the cashback a customer receives depends on which row the query ' +
      'planner happened to return first.',
  })
  @ApiCreatedResponse({ type: RateCardDto })
  async create(@Body() dto: CreateRateCardDto): Promise<RateCardDto> {
    const card = await this.pickups.createRateCard({
      name: dto.name,
      rates: dto.rates,
      activate: dto.activate ?? false,
    });

    return toRateCardDto(card);
  }

  @Get()
  @ApiOperation({ summary: 'All rate cards, current and retired' })
  @ApiOkResponse({ type: [RateCardDto] })
  async list(): Promise<RateCardDto[]> {
    const cards = await this.pickups.listRateCards();
    return cards.map(toRateCardDto);
  }

  @Get('active')
  @ApiOperation({ summary: 'The card pickups are currently priced against' })
  @ApiOkResponse({ type: RateCardDto })
  @ApiConflictResponse({ description: 'No active card — no pickup can be priced.' })
  async active(): Promise<RateCardDto> {
    return toRateCardDto(await this.pickups.activeRateCard());
  }

  @Post(':id/activate')
  @ApiOperation({ summary: 'Make an existing card the active one' })
  @ApiOkResponse({ type: RateCardDto })
  async activate(@Param('id', ParseUUIDPipe) id: string): Promise<RateCardDto> {
    return toRateCardDto(await this.pickups.activateRateCard(id));
  }
}
