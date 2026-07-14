import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
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
import { Roles } from '@/modules/auth/presentation/decorators/roles.decorator';
import { Day } from '@/modules/subscriptions/domain/value-objects/day';
import { gramsToKg, paiseToRupees } from '@/modules/wallet/domain/money';
import { Idempotent } from '@/shared/presentation/interceptors/idempotency.interceptor';
import { PickupUseCases } from '../application/pickup.use-cases';
import {
  CashbackResultDto,
  CompletePickupDto,
  PickupDto,
  QuoteDto,
  QuotePickupDto,
  RequestPickupDto,
  ScanPickupDto,
} from './dto/pickup.dto';
import { toPickupDto, toPickupItemDto } from './pickup.mapper';

/** The customer's own pickups. Owner comes from the token, never the request. */
@ApiTags('pickups')
@ApiBearerAuth()
@Controller({ path: 'pickups', version: '1' })
export class PickupsController {
  constructor(private readonly pickups: PickupUseCases) {}

  @Post()
  @ApiOperation({ summary: 'Request a paper pickup' })
  @ApiCreatedResponse({ type: PickupDto })
  async request(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: RequestPickupDto,
  ): Promise<PickupDto> {
    const pickup = await this.pickups.request({
      userId: current.id,
      addressId: dto.addressId,
      scheduledDate: Day.parse(dto.scheduledDate),
      windowStartHour: dto.windowStartHour,
      windowEndHour: dto.windowEndHour,
    });

    // The owner gets the QR token — it is what they show the partner at the door.
    return toPickupDto(pickup, true);
  }

  @Get()
  @ApiOperation({ summary: 'List my pickups' })
  @ApiOkResponse({ type: [PickupDto] })
  async list(@CurrentUser() current: AuthenticatedUser): Promise<PickupDto[]> {
    const pickups = await this.pickups.list(current.id);
    return pickups.map((pickup) => toPickupDto(pickup, true));
  }

  @Get(':id')
  @ApiOkResponse({ type: PickupDto })
  async get(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PickupDto> {
    return toPickupDto(await this.pickups.get(current.id, id), true);
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Cancel a pickup',
    description: 'Refused once completed — the wallet has already been credited.',
  })
  @ApiOkResponse({ type: PickupDto })
  @ApiConflictResponse()
  async cancel(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PickupDto> {
    return toPickupDto(await this.pickups.cancel(current.id, id), true);
  }
}

/**
 * The delivery partner's side of a pickup: scan, weigh, pay.
 *
 * `POST /complete` is the single most consequential endpoint in the product. It moves real
 * money, so it requires an Idempotency-Key — a partner in a doorway on 2G will double-tap.
 */
@ApiTags('delivery/pickups')
@ApiBearerAuth()
@Roles('DELIVERY_PARTNER')
@Controller({ path: 'delivery/pickups', version: '1' })
export class PartnerPickupsController {
  constructor(private readonly pickups: PickupUseCases) {}

  @Post('scan')
  @ApiOperation({
    summary: 'Scan the customer’s QR code at the door',
    description:
      'The token alone is not authorisation: the pickup must also be assigned to THIS partner. ' +
      'Returns the pickup and the rates that will be applied.',
  })
  @ApiOkResponse({ type: PickupDto })
  async scan(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: ScanPickupDto,
  ): Promise<PickupDto & { rates: unknown }> {
    const result = await this.pickups.scan(current.id, dto.qrToken);

    return {
      // The partner does NOT get the token back. They already have it — echoing it just
      // puts a credential into another log and another response cache.
      ...toPickupDto(result, false),
      rates: result.rateCard.rates.map((rate) => ({
        paperType: rate.paperType,
        ratePerKgPaise: rate.ratePerKgPaise,
        ratePerKgRupees: paiseToRupees(rate.ratePerKgPaise),
      })),
    };
  }

  @Post('quote')
  @ApiOperation({
    summary: 'What would this weigh out to?',
    description: 'Shows the customer the figure before it is committed. Persists nothing.',
  })
  @ApiOkResponse({ type: QuoteDto })
  async quote(@Body() dto: QuotePickupDto): Promise<QuoteDto> {
    const breakdown = await this.pickups.quote(dto.weights);

    return {
      lines: breakdown.lines.map((line) => toPickupItemDto(line)),
      totalWeightGrams: breakdown.totalWeightGrams,
      totalPaise: breakdown.totalPaise,
      totalRupees: paiseToRupees(breakdown.totalPaise),
    };
  }

  @Post(':id/complete')
  @Idempotent()
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'REQUIRED. This endpoint moves money. A replay with the same key returns the original ' +
      'response instead of crediting the wallet twice.',
  })
  @ApiOperation({
    summary: 'Record weights and pay the customer',
    description:
      'One database transaction: the pickup is completed, its items are written, exactly one ' +
      'CREDIT is appended to the append-only ledger, and the balance moves. It cannot partially ' +
      'succeed.',
  })
  @ApiOkResponse({ type: CashbackResultDto })
  @ApiConflictResponse({ description: 'Already completed, or the pickup was cancelled.' })
  async complete(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompletePickupDto,
  ): Promise<CashbackResultDto> {
    const result = await this.pickups.complete({
      userId: current.id,
      pickupId: id,
      weights: dto.weights,
    });

    return {
      pickupId: result.pickupId,
      totalWeightGrams: result.totalWeightGrams,
      totalWeightKg: gramsToKg(result.totalWeightGrams),
      totalPaise: result.totalPaise,
      totalRupees: paiseToRupees(result.totalPaise),
      // BigInt is not JSON-serialisable; the string is the honest representation.
      walletBalancePaise: result.balanceAfterPaise.toString(),
      walletBalanceRupees: paiseToRupees(result.balanceAfterPaise),
      lines: result.lines.map((line) => toPickupItemDto(line)),
    };
  }
}
