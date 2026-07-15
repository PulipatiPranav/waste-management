import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '@/modules/auth/presentation/decorators/current-user.decorator';
import { Roles } from '@/modules/auth/presentation/decorators/roles.decorator';
import { gramsToKg } from '@/modules/wallet/domain/money';
import { RecyclingUseCases } from '../application/recycling.use-cases';
import { type BatchRecord, type DispatchRecord } from '../domain/ports/recycling.repository';
import {
  BatchDto,
  BatchQueryDto,
  ChainOfCustodyDto,
  ConfirmDispatchDto,
  DispatchBatchDto,
  DispatchDto,
  OnboardPartnerDto,
  PartnerQueryDto,
  RejectDispatchDto,
  UpdatePartnerDto,
} from './dto/recycling.dto';

const toBatchDto = (batch: BatchRecord): BatchDto => ({
  id: batch.id,
  reference: batch.reference,
  zoneName: batch.zoneName,
  paperType: batch.paperType,
  status: batch.status,
  collectedWeightGrams: batch.collectedWeightGrams,
  collectedWeightKg: gramsToKg(batch.collectedWeightGrams),
  itemCount: batch.itemCount,
  closedAt: batch.closedAt?.toISOString() ?? null,
});

const toDispatchDto = (dispatch: DispatchRecord): DispatchDto => ({
  id: dispatch.id,
  batchId: dispatch.batchId,
  partnerName: dispatch.partnerName,
  status: dispatch.status,
  dispatchedAt: dispatch.dispatchedAt.toISOString(),
  transporterName: dispatch.transporterName,
  transporterVehicleNo: dispatch.transporterVehicleNo,
  confirmedWeightGrams: dispatch.confirmedWeightGrams,
  discrepancyGrams: dispatch.discrepancyGrams,
  discrepancyBps: dispatch.discrepancyBps,
  discrepancyFlagged: dispatch.discrepancyFlagged,
  confirmedAt: dispatch.confirmedAt?.toISOString() ?? null,
  rejectionReason: dispatch.rejectionReason,
  weighbridgeSlipRef: dispatch.weighbridgeSlipRef,
});

@ApiTags('admin/recycling')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Requires OPS_STAFF or SUPER_ADMIN.' })
@Roles('OPS_STAFF', 'SUPER_ADMIN')
@Controller({ path: 'admin/recycling', version: '1' })
export class AdminRecyclingController {
  constructor(private readonly recycling: RecyclingUseCases) {}

  // --- Partners -------------------------------------------------------------

  @Post('partners')
  @ApiOperation({
    summary: 'Onboard a recycling partner',
    description:
      'Starts PENDING. A mill is not verified by the act of being typed into a form, and an ' +
      'unverified mill never receives a dispatch — the same rule as delivery-partner KYC, for ' +
      'the same reason.',
  })
  @ApiCreatedResponse()
  onboard(@Body() dto: OnboardPartnerDto) {
    return this.recycling.onboardPartner({
      name: dto.name,
      acceptedPaperTypes: dto.acceptedPaperTypes,
      dailyCapacityGrams: dto.dailyCapacityGrams,
      city: dto.city,
      state: dto.state,
      pincode: dto.pincode,
      addressLine: dto.addressLine,
      gstin: dto.gstin ?? null,
      pollutionBoardId: dto.pollutionBoardId ?? null,
      contactName: dto.contactName,
      contactPhone: dto.contactPhone,
    });
  }

  @Get('partners')
  @ApiOkResponse()
  listPartners(@Query() query: PartnerQueryDto) {
    return this.recycling.listPartners(query.status);
  }

  @Patch('partners/:id')
  @ApiOperation({ summary: 'Verify, suspend, or update a partner' })
  @ApiOkResponse()
  updatePartner(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePartnerDto,
  ) {
    return this.recycling.updatePartner(id, dto, current.id);
  }

  // --- Batches --------------------------------------------------------------

  @Post('batches/run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Force a batching run',
    description:
      'The same operation the nightly job runs. Idempotent: it only looks at items with no ' +
      'batch, so running it twice batches nothing the second time.',
  })
  @ApiOkResponse()
  async runBatching() {
    const result = await this.recycling.runBatching();

    return {
      groupsProcessed: result.groupsProcessed,
      itemsBatched: result.itemsBatched,
      batchesReadyToDispatch: result.batchesReadyToDispatch,
      batches: result.batches.map(toBatchDto),
    };
  }

  @Get('batches')
  @ApiOkResponse({ type: [BatchDto] })
  async listBatches(@Query() query: BatchQueryDto): Promise<BatchDto[]> {
    const batches = await this.recycling.listBatches(query.status);
    return batches.map(toBatchDto);
  }

  @Post('batches/:id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Close a batch, fixing its collected weight',
    description:
      'OPEN -> READY. Closing is what FIXES the weight the mill’s weighbridge will be compared ' +
      'against; a batch that could still grow while the truck is on the road has no meaningful ' +
      'discrepancy.',
  })
  @ApiOkResponse({ type: BatchDto })
  @ApiConflictResponse()
  async closeBatch(@Param('id', ParseUUIDPipe) id: string): Promise<BatchDto> {
    return toBatchDto(await this.recycling.closeBatch(id));
  }

  // --- Dispatch -------------------------------------------------------------

  @Post('batches/:id/dispatch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Put a batch on a truck to a mill',
    description:
      'Refused if the mill is unverified or does not accept this paper type — otherwise the ' +
      'lorry arrives and is turned away at the gate. Over-capacity is a WARNING, not a refusal: ' +
      'a mill briefly over its stated ceiling will usually still take the load.',
  })
  @ApiCreatedResponse()
  @ApiConflictResponse({ description: 'Batch not READY, or the partner cannot take it.' })
  async dispatchBatch(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DispatchBatchDto) {
    const { dispatch, warning } = await this.recycling.dispatchBatch({
      batchId: id,
      partnerId: dto.partnerId,
      transporterName: dto.transporterName,
      transporterVehicleNo: dto.transporterVehicleNo,
      transporterContact: dto.transporterContact,
    });

    return { ...toDispatchDto(dispatch), warning };
  }

  @Post('dispatches/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record the mill’s weighbridge reading',
    description:
      'Stored ALONGSIDE our collected weight, never over it. Both are real measurements by ' +
      'different parties with different instruments, and the gap between them IS the finding — ' +
      'moisture, spillage, a mis-keyed number, or theft. Overwrite one with the other and the ' +
      'evidence that anything happened is gone.',
  })
  @ApiOkResponse({ type: DispatchDto })
  async confirm(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmDispatchDto,
  ): Promise<DispatchDto> {
    const dispatch = await this.recycling.confirmDispatch({
      dispatchId: id,
      confirmedWeightGrams: dto.confirmedWeightGrams,
      weighbridgeSlipRef: dto.weighbridgeSlipRef ?? null,
      actorUserId: current.id,
    });

    return toDispatchDto(dispatch);
  }

  @Post('dispatches/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'The mill refused the load',
    description:
      'The batch returns to READY so it can be sent to a different mill. The paper still exists.',
  })
  @ApiOkResponse({ type: DispatchDto })
  async reject(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDispatchDto,
  ): Promise<DispatchDto> {
    const dispatch = await this.recycling.rejectDispatch({
      dispatchId: id,
      reason: dto.reason,
      actorUserId: current.id,
    });

    return toDispatchDto(dispatch);
  }

  @Get('dispatches/flagged')
  @ApiOperation({
    summary: 'Dispatches whose weighbridge reading is outside tolerance',
    description:
      'The incident queue. A few percent is physics; these are the ones a human must look at.',
  })
  @ApiOkResponse({ type: [DispatchDto] })
  async flagged(): Promise<DispatchDto[]> {
    const dispatches = await this.recycling.listFlaggedDispatches();
    return dispatches.map(toDispatchDto);
  }

  // --- Traceability ---------------------------------------------------------

  @Get('batches/:id/chain-of-custody')
  @ApiOperation({
    summary: 'The full chain for a batch',
    description:
      'PickupItem -> CollectionBatch -> BatchDispatch -> RecyclingPartner. This is what an ESG ' +
      'auditor is really asking for behind "substantiate that tonnage": every gram attributed to ' +
      'the customer who handed it over, the partner who collected it, the truck it rode on, and ' +
      'the mill that weighed it at the far end.',
  })
  @ApiOkResponse({ type: ChainOfCustodyDto })
  async chainOfCustody(@Param('id', ParseUUIDPipe) id: string): Promise<ChainOfCustodyDto> {
    const chain = await this.recycling.chainOfCustody(id);

    return {
      batch: toBatchDto(chain.batch),
      dispatch: chain.dispatch === null ? null : toDispatchDto(chain.dispatch),
      partner:
        chain.partner === null
          ? null
          : {
              id: chain.partner.id,
              name: chain.partner.name,
              city: chain.partner.city,
              gstin: chain.partner.gstin,
            },
      items: chain.items.map((item) => ({
        pickupItemId: item.pickupItemId,
        pickupId: item.pickupId,
        customerId: item.customerId,
        paperType: item.paperType,
        weightGrams: item.weightGrams,
        collectedAt: item.collectedAt?.toISOString() ?? null,
        collectedByPartnerId: item.collectedByPartnerId,
      })),
      totalItemWeightGrams: chain.totalItemWeightGrams,
      itemsReconcile: chain.itemsReconcile,
    };
  }

  @Get('customers/:userId/trace')
  @ApiOperation({
    summary: 'Where did THIS customer’s paper actually go?',
    description:
      'The reverse walk. A customer who asks "was my newspaper really recycled, and by whom" ' +
      'gets a named mill and a confirmation date — not a marketing claim.',
  })
  @ApiOkResponse()
  trace(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.recycling.traceCustomerPaper(userId);
  }
}
