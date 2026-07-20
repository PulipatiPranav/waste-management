import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '@/modules/auth/presentation/decorators/roles.decorator';
import { AuditUseCases } from '../application/audit.use-cases';
import { type AuditLogRow } from '../domain/ports/audit.repository';
import { AuditLogDto, AuditPageDto, AuditQueryDto } from './dto/audit.dto';

const toDto = (row: AuditLogRow): AuditLogDto => ({
  id: row.id,
  actorUserId: row.actorUserId,
  actorName: row.actorName,
  actorEmail: row.actorEmail,
  actorRole: row.actorRole,
  action: row.action,
  method: row.method,
  path: row.path,
  targetType: row.targetType,
  targetId: row.targetId,
  statusCode: row.statusCode,
  metadata: row.metadata,
  ip: row.ip,
  createdAt: row.createdAt.toISOString(),
});

/**
 * The audit trail, for the ops console. SUPER_ADMIN and OPS_STAFF only — the log of who did what
 * is itself sensitive, and reading it is a privileged action.
 */
@ApiTags('admin/audit')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Requires OPS_STAFF or SUPER_ADMIN.' })
@Roles('OPS_STAFF', 'SUPER_ADMIN')
@Controller({ path: 'admin/audit', version: '1' })
export class AdminAuditController {
  constructor(private readonly audit: AuditUseCases) {}

  @Get()
  @ApiOperation({
    summary: 'The audit trail',
    description:
      'Every mutating staff action, newest first. Filter by actor, action, or target entity; ' +
      'paginate with the returned cursor.',
  })
  @ApiOkResponse({ type: AuditPageDto })
  async list(@Query() query: AuditQueryDto): Promise<AuditPageDto> {
    const page = await this.audit.list({
      actorUserId: query.actorUserId,
      action: query.action,
      targetId: query.targetId,
      limit: query.limit,
      cursor: query.cursor,
    });

    return { rows: page.rows.map(toDto), nextCursor: page.nextCursor };
  }
}
