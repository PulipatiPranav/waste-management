import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { AuditUseCases } from './application/audit.use-cases';
import { AUDIT_REPOSITORY } from './domain/ports/audit.repository';
import { AuditInterceptor } from './infrastructure/audit.interceptor';
import { PrismaAuditRepository } from './infrastructure/persistence/prisma-audit.repository';
import { AdminAuditController } from './presentation/admin-audit.controller';

/**
 * The audit trail. Registers a GLOBAL interceptor, so every mutating staff action across every
 * module is recorded without each controller opting in — the coverage is a property of the app,
 * not of each author remembering. Exposes a read-only, admin-gated view of the trail.
 */
@Module({
  controllers: [AdminAuditController],
  providers: [
    { provide: AUDIT_REPOSITORY, useClass: PrismaAuditRepository },
    AuditUseCases,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AuditModule {}
