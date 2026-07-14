import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { type Env } from '@/config/env.schema';
import {
  type AuthenticatedUser,
  CurrentUser,
} from '@/modules/auth/presentation/decorators/current-user.decorator';
import { Roles } from '@/modules/auth/presentation/decorators/roles.decorator';
import { Day } from '@/modules/subscriptions/domain/value-objects/day';
import { PartnerDeliveryUseCases } from '../application/delivery.use-cases';
import { type RunRecord, type StopRecord } from '../domain/ports/delivery.repository';
import { DayQueryDto, RecordOutcomeDto, RunDto, StopDto } from './dto/delivery.dto';

/** Phone cameras produce JPEG; some Android share sheets produce PNG or HEIC. */
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png'];

/**
 * The delivery partner's own view. @Roles at class level, so every route added later is
 * partner-only by construction.
 *
 * Nothing here takes a partner id from the client: it is always derived from the token.
 * A partner must not be able to read — let alone complete — another partner's round.
 */
@ApiTags('delivery/partner')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Requires DELIVERY_PARTNER.' })
@Roles('DELIVERY_PARTNER')
@Controller({ path: 'delivery', version: '1' })
export class PartnerDeliveryController {
  constructor(
    private readonly delivery: PartnerDeliveryUseCases,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get('my-runs')
  @ApiOperation({
    summary: 'The partner’s run sheets for a day',
    description: 'Defaults to today. Stops are ordered by sequence.',
  })
  @ApiOkResponse({ type: [RunDto] })
  async myRuns(
    @CurrentUser() current: AuthenticatedUser,
    @Query() query: DayQueryDto,
  ): Promise<RunDto[]> {
    const { runs } = await this.delivery.myRuns(
      current.id,
      query.date === undefined ? undefined : Day.parse(query.date),
    );

    return Promise.all(runs.map((run) => this.toRunDto(run)));
  }

  /**
   * Upload the proof photo BEFORE recording the outcome.
   *
   * Two steps rather than one multipart request that does both. A partner on a bad
   * connection can retry a failed 3MB upload without losing the delivery record, and
   * Phase 13's offline queue can retry the two independently. Coupling them means one
   * flaky upload throws away the fact that the paper was delivered.
   */
  @Post('stops/:id/photo')
  @UseInterceptors(FileInterceptor('photo'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { photo: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Attach proof of delivery' })
  async uploadPhoto(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ photoKey: string }> {
    if (file === undefined) {
      throw new BadRequestException('A photo file is required.');
    }

    // Content type and size are checked HERE, not trusted from the client. An
    // unvalidated upload endpoint is a free file-host and a memory-exhaustion vector,
    // and it is on the OWASP list Phase 14 will audit against.
    if (!ALLOWED_PHOTO_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported image type ${file.mimetype}. Allowed: ${ALLOWED_PHOTO_TYPES.join(', ')}.`,
      );
    }

    const maxBytes = this.config.get('DELIVERY_PHOTO_MAX_BYTES', { infer: true });

    if (file.size > maxBytes) {
      throw new BadRequestException(
        `Photo is ${file.size} bytes; the maximum is ${maxBytes}. Compress it on the device.`,
      );
    }

    return this.delivery.attachPhoto({
      userId: current.id,
      stopId: id,
      body: file.buffer,
      contentType: file.mimetype,
    });
  }

  @Post('stops/:id/outcome')
  @ApiOperation({
    summary: 'Record a delivery as DELIVERED, FAILED or SKIPPED',
    description:
      'Recorded once. A second submission — a double-tap, or a retry on a flaky network — ' +
      'returns 409 rather than overwriting the first.',
  })
  @ApiOkResponse({ type: StopDto })
  @ApiConflictResponse({ description: 'Already recorded.' })
  async recordOutcome(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordOutcomeDto,
  ): Promise<StopDto> {
    const stop = await this.delivery.recordOutcome({
      userId: current.id,
      stopId: id,
      outcome: dto.outcome,
      reason: dto.reason ?? null,
      photoKey: dto.photoKey ?? null,
    });

    return this.toStopDto(stop);
  }

  private async toRunDto(run: RunRecord): Promise<RunDto> {
    return {
      id: run.id,
      runDate: run.runDate.toString(),
      zoneId: run.zoneId,
      partnerId: run.partnerId,
      status: run.status,
      stops: await Promise.all(run.stops.map((stop) => this.toStopDto(stop))),
    };
  }

  private async toStopDto(stop: StopRecord): Promise<StopDto> {
    return {
      id: stop.id,
      subscriptionId: stop.subscriptionId,
      addressId: stop.addressId,
      status: stop.status,
      reason: stop.reason,
      sequence: stop.sequence,
      completedAt: stop.completedAt?.toISOString() ?? null,
      photoUrl: stop.photoKey === null ? null : await this.delivery.signedPhotoUrl(stop.photoKey),
    };
  }
}
