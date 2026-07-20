import { type Role } from '@/modules/auth/domain/value-objects/role';

export interface AuditRecordInput {
  actorUserId: string;
  actorRole: Role;
  action: string;
  method: string;
  path: string;
  targetType: string | null;
  targetId: string | null;
  statusCode: number;
  metadata: unknown;
  ip: string | null;
}

export interface AuditLogRow {
  id: string;
  actorUserId: string;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: Role;
  action: string;
  method: string;
  path: string;
  targetType: string | null;
  targetId: string | null;
  statusCode: number;
  metadata: unknown;
  ip: string | null;
  createdAt: Date;
}

export interface AuditQuery {
  actorUserId?: string;
  action?: string;
  targetId?: string;
  limit: number;
  cursor?: string;
}

export interface AuditPage {
  rows: AuditLogRow[];
  /** The id to pass as the next `cursor`, or null when there are no more rows. */
  nextCursor: string | null;
}

export interface AuditRepository {
  /** Writes one audit row. Called by the interceptor after a mutating staff action succeeds. */
  record(input: AuditRecordInput): Promise<void>;

  /** Reads the trail, newest first, keyset-paginated. Joins the actor for a display name. */
  query(query: AuditQuery): Promise<AuditPage>;
}

export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');
