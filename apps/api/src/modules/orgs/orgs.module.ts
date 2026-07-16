import { forwardRef, Module } from '@nestjs/common';

import { AuthModule } from '@/modules/auth/auth.module';
import { ImpactModule } from '@/modules/impact/impact.module';
import { ORG_MEMBERSHIP_RESOLVER } from '@/modules/impact/domain/ports/impact.repository';
import { PickupsModule } from '@/modules/pickups/pickups.module';
import { UsersModule } from '@/modules/users/users.module';
import { OrgUseCases } from './application/org.use-cases';
import { ESG_REPORT_RENDERER } from './domain/esg-report';
import { ORG_REPOSITORY } from './domain/ports/org.repository';
import { OrgMembershipResolverImpl } from './infrastructure/org-membership.resolver';
import { PdfKitEsgRenderer } from './infrastructure/pdf/pdfkit-esg-renderer';
import { PrismaOrgRepository } from './infrastructure/persistence/prisma-org.repository';
import { OrgController } from './presentation/org.controller';

@Module({
  imports: [
    // forwardRef because the dependency is genuinely mutual: OrgUseCases builds ESG reports and
    // invoices from ImpactUseCases, and ImpactUseCases rolls org impact up via the membership
    // resolver that lives here. This is the seam Phase 6 built and Phase 7 fills.
    forwardRef(() => ImpactModule),
    // AuthModule for CLOCK, UsersModule to resolve a member by phone, PickupsModule for the
    // common-area pickup repository.
    AuthModule,
    UsersModule,
    PickupsModule,
  ],
  controllers: [OrgController],
  providers: [
    { provide: ORG_REPOSITORY, useClass: PrismaOrgRepository },
    { provide: ESG_REPORT_RENDERER, useClass: PdfKitEsgRenderer },
    // The real membership resolver, replacing Phase 6's empty stand-in. Exported so
    // ImpactModule consumes it.
    { provide: ORG_MEMBERSHIP_RESOLVER, useClass: OrgMembershipResolverImpl },
    OrgUseCases,
  ],
  exports: [ORG_MEMBERSHIP_RESOLVER, ORG_REPOSITORY],
})
export class OrgsModule {}
