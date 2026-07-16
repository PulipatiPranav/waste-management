import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';

import { AuthModule } from '@/modules/auth/auth.module';
import { OrgsModule } from '@/modules/orgs/orgs.module';
import { ImpactUseCases } from './application/impact.use-cases';
import { IMPACT_REPOSITORY } from './domain/ports/impact.repository';
import { IMPACT_QUEUE, ImpactScheduler, ImpactWorker } from './infrastructure/jobs/impact.queue';
import { PrismaImpactRepository } from './infrastructure/persistence/prisma-impact.repository';
import { AdminImpactController, ImpactController } from './presentation/impact.controller';

@Module({
  imports: [
    AuthModule,
    BullModule.registerQueue({ name: IMPACT_QUEUE }),
    // The ORG_MEMBERSHIP_RESOLVER comes from OrgsModule (Phase 7). Phase 6 shipped an empty
    // stand-in here; now the real member-backed resolver lights up the org dashboards.
    // forwardRef because OrgsModule also depends on ImpactUseCases (for ESG reports/invoices).
    forwardRef(() => OrgsModule),
  ],
  controllers: [ImpactController, AdminImpactController],
  providers: [
    { provide: IMPACT_REPOSITORY, useClass: PrismaImpactRepository },
    ImpactUseCases,
    ImpactScheduler,
    ImpactWorker,
  ],
  // Exported so OrgUseCases can build ESG reports and per-kg invoices from the impact figures.
  exports: [ImpactUseCases],
})
export class ImpactModule {}
