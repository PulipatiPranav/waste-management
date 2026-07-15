import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { AuthModule } from '@/modules/auth/auth.module';
import { ImpactUseCases } from './application/impact.use-cases';
import { IMPACT_REPOSITORY, ORG_MEMBERSHIP_RESOLVER } from './domain/ports/impact.repository';
import { EmptyOrgMembershipResolver } from './infrastructure/empty-org-membership.resolver';
import { IMPACT_QUEUE, ImpactScheduler, ImpactWorker } from './infrastructure/jobs/impact.queue';
import { PrismaImpactRepository } from './infrastructure/persistence/prisma-impact.repository';
import { AdminImpactController, ImpactController } from './presentation/impact.controller';

@Module({
  // BullModule.forRoot is registered once by DeliveryModule; registerQueue attaches to it.
  imports: [AuthModule, BullModule.registerQueue({ name: IMPACT_QUEUE })],
  controllers: [ImpactController, AdminImpactController],
  providers: [
    { provide: IMPACT_REPOSITORY, useClass: PrismaImpactRepository },
    // The Phase-7 seam: swap this one binding for a real members-backed resolver and the org
    // dashboards populate with no other change.
    { provide: ORG_MEMBERSHIP_RESOLVER, useClass: EmptyOrgMembershipResolver },
    ImpactUseCases,
    ImpactScheduler,
    ImpactWorker,
  ],
})
export class ImpactModule {}
