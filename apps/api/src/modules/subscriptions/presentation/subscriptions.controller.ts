import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '@/modules/auth/presentation/decorators/current-user.decorator';
import { paiseToRupeeString } from '@/modules/catalog/presentation/catalog.mapper';
import { SubscriptionUseCases } from '../application/subscription.use-cases';
import { type Subscription } from '../domain/entities/subscription';
import { type ProrationResult, billingPeriodFor } from '../domain/services/proration.service';
import { Day } from '../domain/value-objects/day';
import {
  ChangeAddressDto,
  ChargePreviewDto,
  CreateSubscriptionDto,
  QuoteQueryDto,
  SubscriptionDto,
} from './dto/subscription.dto';

/**
 * Every route is scoped to the authenticated user — the owner comes from the token,
 * never from the request body. There is no route by which one customer can reach
 * another's subscription, even with a valid uuid.
 */
@ApiTags('subscriptions')
@ApiBearerAuth()
@Controller({ path: 'subscriptions', version: '1' })
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionUseCases) {}

  @Post()
  @ApiOperation({ summary: 'Subscribe to a newspaper edition' })
  @ApiCreatedResponse({ type: SubscriptionDto })
  @ApiConflictResponse({ description: 'Already subscribed to this edition.' })
  async create(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: CreateSubscriptionDto,
  ): Promise<SubscriptionDto> {
    const subscription = await this.subscriptions.create({
      userId: current.id,
      editionId: dto.editionId,
      deliveryAddressId: dto.deliveryAddressId,
      frequency: dto.frequency,
      billingCycle: dto.billingCycle,
      startDate: dto.startDate === undefined ? undefined : Day.parse(dto.startDate),
    });

    return this.toDto(subscription);
  }

  @Get()
  @ApiOperation({ summary: 'List the authenticated user’s subscriptions' })
  @ApiOkResponse({ type: [SubscriptionDto] })
  async list(@CurrentUser() current: AuthenticatedUser): Promise<SubscriptionDto[]> {
    const subscriptions = await this.subscriptions.list(current.id);
    return subscriptions.map((subscription) => this.toDto(subscription));
  }

  /**
   * Declared BEFORE `:id`, or Nest would match "quote" as a subscription id and the
   * ParseUUIDPipe would 400 on it.
   */
  @Get('quote')
  @ApiOperation({
    summary: 'What would this cost?',
    description:
      'Prices an edition the customer has not subscribed to yet — so they can see, before ' +
      'committing, that starting on the 17th costs 15 issues and not a full month.',
  })
  @ApiOkResponse({ type: ChargePreviewDto })
  async quote(@Query() query: QuoteQueryDto): Promise<ChargePreviewDto> {
    const startDate = query.startDate === undefined ? undefined : Day.parse(query.startDate);

    const result = await this.subscriptions.quote(
      query.editionId,
      query.frequency,
      query.billingCycle,
      startDate,
    );

    const period = billingPeriodFor(startDate ?? Day.fromUtcDate(new Date()), query.billingCycle);

    return this.toPreviewDto(result, period.from, period.to);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one subscription' })
  @ApiOkResponse({ type: SubscriptionDto })
  @ApiNotFoundResponse({ description: 'Not found, or not yours — indistinguishable by design.' })
  async get(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SubscriptionDto> {
    return this.toDto(await this.subscriptions.get(current.id, id));
  }

  @Get(':id/charge-preview')
  @ApiOperation({
    summary: 'The prorated charge for the current billing period',
    description: 'A preview only — nothing is persisted and no money moves. Invoicing is Phase 4.',
  })
  @ApiOkResponse({ type: ChargePreviewDto })
  async chargePreview(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ChargePreviewDto> {
    const subscription = await this.subscriptions.get(current.id, id);
    const result = await this.subscriptions.previewCharge(current.id, id);
    const period = billingPeriodFor(Day.fromUtcDate(new Date()), subscription.billingCycle);

    return this.toPreviewDto(result, period.from, period.to);
  }

  // --- Lifecycle -----------------------------------------------------------
  //
  // POST on an action sub-resource rather than PATCH { status }. A client that can send
  // `{"status": "ACTIVE"}` is a client that can drive the subscription into any state it
  // likes, and the state machine's transition table becomes advisory. These four verbs
  // are the ONLY ways the status ever changes.

  @Post(':id/pause')
  @ApiOperation({ summary: 'Pause delivery from today' })
  @ApiOkResponse({ type: SubscriptionDto })
  @ApiConflictResponse({ description: 'Not pausable from the current state.' })
  async pause(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SubscriptionDto> {
    return this.toDto(await this.subscriptions.pause(current.id, id));
  }

  @Post(':id/resume')
  @ApiOperation({ summary: 'Resume delivery from today' })
  @ApiOkResponse({ type: SubscriptionDto })
  @ApiConflictResponse({ description: 'Not resumable from the current state.' })
  async resume(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SubscriptionDto> {
    return this.toDto(await this.subscriptions.resume(current.id, id));
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Cancel',
    description: 'Terminal. Today is still billed — the customer gets this morning’s paper.',
  })
  @ApiOkResponse({ type: SubscriptionDto })
  @ApiConflictResponse({ description: 'Already cancelled.' })
  async cancel(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SubscriptionDto> {
    return this.toDto(await this.subscriptions.cancel(current.id, id));
  }

  @Post(':id/change-address')
  @ApiOperation({ summary: 'Move delivery to another of the user’s addresses' })
  @ApiOkResponse({ type: SubscriptionDto })
  @ApiNotFoundResponse({ description: 'Address not found, or not yours.' })
  async changeAddress(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeAddressDto,
  ): Promise<SubscriptionDto> {
    return this.toDto(
      await this.subscriptions.changeAddress(current.id, id, dto.deliveryAddressId),
    );
  }

  // --- Mapping -------------------------------------------------------------

  private toDto(subscription: Subscription): SubscriptionDto {
    return {
      id: subscription.id,
      editionId: subscription.editionId,
      deliveryAddressId: subscription.deliveryAddressId,
      status: subscription.status,
      frequency: subscription.frequency,
      billingCycle: subscription.billingCycle,
      startDate: subscription.startDate.toString(),
      cancelledOn: subscription.cancelledOn?.toString() ?? null,
      pricePerIssuePaise: subscription.pricePerIssuePaise,
      pricePerIssueRupees: paiseToRupeeString(subscription.pricePerIssuePaise),
    };
  }

  private toPreviewDto(result: ProrationResult, from: Day, to: Day): ChargePreviewDto {
    return {
      periodFrom: from.toString(),
      periodTo: to.toString(),
      billableIssues: result.billableIssues,
      fullPeriodIssues: result.fullPeriodIssues,
      pausedIssues: result.pausedIssues,
      amountPaise: result.amountPaise,
      amountRupees: paiseToRupeeString(result.amountPaise),
      isProrated: result.isProrated,
    };
  }
}
