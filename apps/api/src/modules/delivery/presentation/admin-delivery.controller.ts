import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
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
import { Day } from '@/modules/subscriptions/domain/value-objects/day';
import { AdminDeliveryUseCases, PlanDeliveryRunsUseCase } from '../application/delivery.use-cases';
import { type DeliveryPartnerRecord, type RunRecord } from '../domain/ports/delivery.repository';
import {
  CompletionStatsDto,
  CreateZoneDto,
  DayQueryDto,
  OnboardPartnerDto,
  PartnerDto,
  PlanResultDto,
  PlanRunsDto,
  ReassignRunDto,
  RunDto,
  UpdatePartnerDto,
} from './dto/delivery.dto';

@ApiTags('admin/delivery')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Requires OPS_STAFF or SUPER_ADMIN.' })
@Roles('OPS_STAFF', 'SUPER_ADMIN')
@Controller({ path: 'admin/delivery', version: '1' })
export class AdminDeliveryController {
  constructor(
    private readonly admin: AdminDeliveryUseCases,
    private readonly planner: PlanDeliveryRunsUseCase,
  ) {}

  // --- Zones ---------------------------------------------------------------

  @Post('zones')
  @ApiOperation({ summary: 'Create a delivery zone (a list of pincodes)' })
  @ApiCreatedResponse()
  createZone(@Body() dto: CreateZoneDto) {
    return this.admin.createZone(dto);
  }

  @Get('zones')
  @ApiOkResponse()
  listZones() {
    return this.admin.listZones();
  }

  // --- Partners ------------------------------------------------------------

  @Post('partners')
  @ApiOperation({
    summary: 'Onboard a delivery partner',
    description: 'The user’s role must already be DELIVERY_PARTNER. KYC starts PENDING.',
  })
  @ApiCreatedResponse({ type: PartnerDto })
  @ApiConflictResponse({ description: 'Wrong role, or already onboarded.' })
  async onboard(@Body() dto: OnboardPartnerDto): Promise<PartnerDto> {
    return this.toPartnerDto(await this.admin.onboardPartner(dto));
  }

  @Get('partners')
  @ApiOkResponse({ type: [PartnerDto] })
  async listPartners(): Promise<PartnerDto[]> {
    const partners = await this.admin.listPartners();
    return partners.map((partner) => this.toPartnerDto(partner));
  }

  @Patch('partners/:id')
  @ApiOperation({
    summary: 'Verify KYC, offboard, mark on-leave, or change zones',
    description:
      'Offboarding (isActive=false) keeps all history but stops any future assignment. ' +
      'Only VERIFIED partners are ever given work.',
  })
  @ApiOkResponse({ type: PartnerDto })
  async updatePartner(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePartnerDto,
  ): Promise<PartnerDto> {
    return this.toPartnerDto(await this.admin.updatePartner(id, dto));
  }

  // --- Runs ----------------------------------------------------------------

  @Post('plan')
  @ApiOperation({
    summary: 'Force a re-plan',
    description:
      'The same operation the nightly job runs, exposed so ops can re-plan after fixing a zone ' +
      'that had no partners, instead of waiting until 21:00. Idempotent: existing run sheets are ' +
      'left alone, not duplicated.',
  })
  @ApiOkResponse({ type: PlanResultDto })
  async plan(@Body() dto: PlanRunsDto): Promise<PlanResultDto> {
    const plan = await this.planner.execute(
      dto.runDate === undefined ? undefined : Day.parse(dto.runDate),
    );

    return {
      runDate: plan.runDate.toString(),
      created: plan.created,
      skipped: plan.skipped,
      totalStops: plan.runs.reduce((sum, run) => sum + run.stops.length, 0),
      unassigned: plan.unassigned.map((item) => ({
        subscriptionId: item.subscriptionId,
        pincode: item.pincode,
        reason: item.reason,
      })),
      ambiguousPincodes: plan.ambiguousPincodes,
    };
  }

  @Get('completion')
  @ApiOperation({
    summary: 'Delivery completion rates by run',
    description: 'Defaults to today. completionRate is null — not 0 — for an empty run.',
  })
  @ApiOkResponse({ type: [CompletionStatsDto] })
  async completion(@Query() query: DayQueryDto): Promise<CompletionStatsDto[]> {
    const stats = await this.admin.completionStats(
      query.date === undefined ? undefined : Day.parse(query.date),
    );

    return stats.map((stat) => ({ ...stat, runDate: stat.runDate.toString() }));
  }

  @Get('runs/:id')
  @ApiOkResponse({ type: RunDto })
  async run(@Param('id', ParseUUIDPipe) id: string): Promise<RunDto> {
    return this.toRunDto(await this.admin.runById(id));
  }

  @Post('runs/:id/reassign')
  @ApiOperation({
    summary: 'Hand a run to another partner',
    description:
      'Refused once ANY stop has been actioned: moving a half-done run would attribute one ' +
      'partner’s completed deliveries to another, and in Phase 4 those records decide billing. ' +
      'The target partner must be active, KYC-verified, and work the run’s zone.',
  })
  @ApiOkResponse({ type: RunDto })
  @ApiConflictResponse({ description: 'Run already started, or the target partner is ineligible.' })
  async reassign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReassignRunDto,
  ): Promise<RunDto> {
    return this.toRunDto(await this.admin.reassignRun(id, dto.toPartnerId));
  }

  // --- Mapping -------------------------------------------------------------

  private toPartnerDto(partner: DeliveryPartnerRecord): PartnerDto {
    return {
      id: partner.id,
      userId: partner.userId,
      name: partner.name,
      phone: partner.phone,
      kycStatus: partner.kycStatus,
      vehicleType: partner.vehicleType,
      isActive: partner.isActive,
      isAvailable: partner.isAvailable,
      zoneIds: partner.zoneIds,
    };
  }

  /** No signed photo URLs here — the admin run view is a list, not a gallery. */
  private toRunDto(run: RunRecord): RunDto {
    return {
      id: run.id,
      runDate: run.runDate.toString(),
      zoneId: run.zoneId,
      partnerId: run.partnerId,
      status: run.status,
      stops: run.stops.map((stop) => ({
        id: stop.id,
        subscriptionId: stop.subscriptionId,
        addressId: stop.addressId,
        status: stop.status,
        reason: stop.reason,
        sequence: stop.sequence,
        completedAt: stop.completedAt?.toISOString() ?? null,
        photoUrl: null,
      })),
    };
  }
}
