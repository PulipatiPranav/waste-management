import { Inject, Injectable } from '@nestjs/common';

import { type OrgMembershipResolver } from '@/modules/impact/domain/ports/impact.repository';
import { ORG_REPOSITORY, type OrgRepository } from '../domain/ports/org.repository';

/**
 * The real implementation of Phase 6's OrgMembershipResolver, backed by the org member table.
 *
 * Phase 6 built the seam and shipped an empty stand-in; this is the class that lights up the
 * org impact dashboards. An org's impact is the sum over its member users — a resident's
 * recycling is theirs and rolls up to their building wherever they dropped the paper, which is
 * the only definition that stays correct when they move flats.
 */
@Injectable()
export class OrgMembershipResolverImpl implements OrgMembershipResolver {
  constructor(@Inject(ORG_REPOSITORY) private readonly orgs: OrgRepository) {}

  usersInApartment(apartmentId: string): Promise<string[]> {
    return this.orgs.memberUserIds('APARTMENT', apartmentId);
  }

  usersInBusiness(businessId: string): Promise<string[]> {
    return this.orgs.memberUserIds('BUSINESS', businessId);
  }
}
