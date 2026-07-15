import { Injectable, Logger } from '@nestjs/common';

import { type OrgMembershipResolver } from '../domain/ports/impact.repository';

/**
 * The Phase-6 stand-in for org membership, which does not exist until Phase 7.
 *
 * Apartments and businesses are tables with no members yet, so there is genuinely nobody to
 * roll an org's impact up over. This returns an empty list, and the org dashboards correctly
 * report zero rather than guessing.
 *
 * It is a real, wired implementation — not a `throw new Error('not implemented')` — because a
 * business admin opening their dashboard before Phase 7 should see an honest "0 kg recycled so
 * far", not a 500. When Phase 7 adds a members table, it replaces this one class in the module
 * wiring and the dashboards populate with no change to the impact engine.
 */
@Injectable()
export class EmptyOrgMembershipResolver implements OrgMembershipResolver {
  private readonly logger = new Logger(EmptyOrgMembershipResolver.name);

  usersInApartment(apartmentId: string): Promise<string[]> {
    this.logger.debug(
      `Apartment ${apartmentId} impact requested, but org membership arrives in Phase 7; returning empty.`,
    );
    return Promise.resolve([]);
  }

  usersInBusiness(businessId: string): Promise<string[]> {
    this.logger.debug(
      `Business ${businessId} impact requested, but org membership arrives in Phase 7; returning empty.`,
    );
    return Promise.resolve([]);
  }
}
