import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';
import {
  type AuditPage,
  type AuditQuery,
  type AuditRecordInput,
  type AuditRepository,
} from '../../domain/ports/audit.repository';

@Injectable()
export class PrismaAuditRepository implements AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditRecordInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        action: input.action,
        method: input.method,
        path: input.path,
        targetType: input.targetType,
        targetId: input.targetId,
        statusCode: input.statusCode,
        // Prisma's JSON columns reject `undefined`; a redacted-to-nothing payload stores as
        // DB NULL via JsonNull rather than throwing.
        metadata:
          input.metadata === undefined
            ? Prisma.JsonNull
            : (input.metadata as Prisma.InputJsonValue),
        ip: input.ip,
      },
    });
  }

  async query(query: AuditQuery): Promise<AuditPage> {
    const where: Prisma.AuditLogWhereInput = {
      actorUserId: query.actorUserId,
      action: query.action,
      targetId: query.targetId,
    };

    // Keyset pagination on the createdAt-desc index: fetch one extra row to know whether there
    // is a next page without a second count query.
    const rows = await this.prisma.auditLog.findMany({
      where,
      include: { actor: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: query.limit + 1,
      ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      rows: page.map((row) => ({
        id: row.id,
        actorUserId: row.actorUserId,
        actorName: row.actor.name,
        actorEmail: row.actor.email,
        actorRole: row.actorRole,
        action: row.action,
        method: row.method,
        path: row.path,
        targetType: row.targetType,
        targetId: row.targetId,
        statusCode: row.statusCode,
        metadata: row.metadata,
        ip: row.ip,
        createdAt: row.createdAt,
      })),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }
}
