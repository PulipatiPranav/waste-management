import { Inject, Injectable } from '@nestjs/common';

import {
  AUDIT_REPOSITORY,
  type AuditPage,
  type AuditRepository,
} from '../domain/ports/audit.repository';

@Injectable()
export class AuditUseCases {
  constructor(@Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository) {}

  list(input: {
    actorUserId?: string;
    action?: string;
    targetId?: string;
    limit?: number;
    cursor?: string;
  }): Promise<AuditPage> {
    // Cap the page so a support query can never ask for the whole table at once.
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    return this.audit.query({
      actorUserId: input.actorUserId,
      action: input.action,
      targetId: input.targetId,
      cursor: input.cursor,
      limit,
    });
  }
}
