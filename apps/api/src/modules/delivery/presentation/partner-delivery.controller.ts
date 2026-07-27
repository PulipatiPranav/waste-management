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
import { sniffImage } from '@/shared/presentation/upload/image-signature';
import { PartnerDeliveryUseCases } from '../application/delivery.use-cases';
import { type RunRecord, type StopRecord } from '../domain/ports/delivery.repository';
import { DayQueryDto, RecordOutcomeDto, RunDto, StopDto } from './dto/delivery.dto';

/**
 * A hard ceiling on how many bytes multer will buffer for a photo, enforced at the stream level so a
 * malicious 2 GB upload is aborted mid-flight rather than fully read into memory before any check
 * runs. It sits generously ABOVE the per-photo policy (`DELIVERY_PHOTO_MAX_BYTES`, checked below): a
 * real phone JPEG is a few MB, so anything past this is an attack, not a large photo.
 */
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

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
  // `limits` makes multer abort the stream once the ceiling is crossed, so an oversized upload never
  // gets fully buffered in memory — the size check further down is the policy, this is the guard.
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
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

    // Size is checked HERE against the exact policy; the multer `limits` above is the memory guard
    // that already aborted anything past MAX_UPLOAD_BYTES before we got here.
    const maxBytes = this.config.get('DELIVERY_PHOTO_MAX_BYTES', { infer: true });
    if (file.size > maxBytes) {
      throw new BadRequestException(
        `Photo is ${file.size} bytes; the maximum is ${maxBytes}. Compress it on the device.`,
      );
    }

    // Type is verified from the actual bytes, NOT the client-supplied `file.mimetype` (which is just
    // the header the uploader wrote and can lie). Anything that is not really a JPEG/PNG is rejected,
    // and we store the SNIFFED type so a spoofed header cannot mislabel what we persist.
    const sniffed = sniffImage(file.buffer);
    if (sniffed === null) {
      throw new BadRequestException('Unsupported image. Only JPEG and PNG photos are accepted.');
    }

    return this.delivery.attachPhoto({
      userId: current.id,
      stopId: id,
      body: file.buffer,
      contentType: sniffed,
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
