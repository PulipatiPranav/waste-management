import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import { CLOCK, type Clock } from '@/modules/auth/domain/ports/clock.port';
import { PhoneNumber } from '@/modules/auth/domain/value-objects/phone-number';
import { ImpactUseCases } from '@/modules/impact/application/impact.use-cases';
import {
  PICKUP_REPOSITORY,
  type PickupRepository,
} from '@/modules/pickups/domain/ports/pickup.repository';
import { Day } from '@/modules/subscriptions/domain/value-objects/day';
import { USER_REPOSITORY, type UserRepository } from '@/modules/users/domain/ports/user.repository';
import { ConflictError, NotFoundError } from '@/shared/domain/errors/domain.error';
import { computeInvoiceAmount, monthlyPeriod, type ContractType } from '../domain/contract-billing';
import { assembleEsgReport, type EsgReport } from '../domain/esg-report';
import {
  ORG_REPOSITORY,
  type ContractRecord,
  type InvoiceRecord,
  type OrgMemberRecord,
  type OrgRepository,
} from '../domain/ports/org.repository';
import {
  assertOrgAdmin,
  type Membership,
  type OrgKind,
  type OrgRole,
} from '../domain/tenant-access';

@Injectable()
export class OrgUseCases {
  private readonly logger = new Logger(OrgUseCases.name);

  constructor(
    @Inject(ORG_REPOSITORY) private readonly orgs: OrgRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PICKUP_REPOSITORY) private readonly pickups: PickupRepository,
    private readonly impact: ImpactUseCases,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * THE tenant-isolation gate. Every method below calls this before touching org data.
   *
   * It resolves the caller's memberships fresh from the database (never from the token — an
   * org admin's grant can be revoked mid-session) and asserts they administer the exact org.
   * A denial is a 403 that reveals nothing about the target org. Because every path goes
   * through here, isolation is a property of the module, not of each author remembering to
   * check.
   */
  private async requireOrgAdmin(userId: string, kind: OrgKind, orgId: string): Promise<void> {
    const memberships: Membership[] = await this.orgs.membershipsForUser(userId);
    assertOrgAdmin(memberships, kind, orgId);

    // The org must also exist. Checked after the access assertion so a non-admin cannot use
    // this endpoint to probe which org ids are real.
    const org = await this.orgs.findOrg(kind, orgId);
    if (org === null) {
      throw new NotFoundError('Organisation not found');
    }
  }

  // --- Membership -----------------------------------------------------------

  async listMembers(actorId: string, kind: OrgKind, orgId: string): Promise<OrgMemberRecord[]> {
    await this.requireOrgAdmin(actorId, kind, orgId);
    return this.orgs.listMembers(kind, orgId);
  }

  /**
   * Adds a resident/employee by phone. By phone, not user id, because an org admin knows their
   * residents by phone number, not by an internal uuid they never see.
   */
  async addMember(input: {
    actorId: string;
    kind: OrgKind;
    orgId: string;
    memberPhone: string;
    orgRole: OrgRole;
  }): Promise<OrgMemberRecord> {
    await this.requireOrgAdmin(input.actorId, input.kind, input.orgId);

    // Normalise to E.164 before the lookup. Users are stored normalised (Phase 1), and an
    // admin types a resident's number however they like — "9876543210", "+91 98765 43210".
    // Without this, a member could never be added because the raw string never matches the
    // stored E.164 form.
    const phone = PhoneNumber.create(input.memberPhone);

    const user = await this.users.findByPhone(phone.e164);
    if (user === null) {
      throw new NotFoundError('No user with that phone number. They must sign up first.');
    }

    return this.orgs.addMember({
      userId: user.id,
      kind: input.kind,
      orgId: input.orgId,
      orgRole: input.orgRole,
    });
  }

  async removeMember(input: {
    actorId: string;
    kind: OrgKind;
    orgId: string;
    memberUserId: string;
  }): Promise<void> {
    await this.requireOrgAdmin(input.actorId, input.kind, input.orgId);

    // An admin cannot remove themselves — the one-admin-per-org rule would leave the org
    // headless. Transferring admin is a separate, deliberate operation (not built this phase).
    if (input.memberUserId === input.actorId) {
      throw new ConflictError('You cannot remove yourself. Assign another admin first.');
    }

    await this.orgs.removeMember(input.kind, input.orgId, input.memberUserId);
  }

  // --- Org impact (reuses Phase 6) ------------------------------------------

  async orgImpact(actorId: string, kind: OrgKind, orgId: string) {
    await this.requireOrgAdmin(actorId, kind, orgId);
    return kind === 'APARTMENT' ? this.impact.forApartment(orgId) : this.impact.forBusiness(orgId);
  }

  // --- Org (common-area) pickups --------------------------------------------

  /**
   * An org admin schedules a bulk / common-area pickup at an org-owned address.
   *
   * Distinct from a resident's individual-unit pickup (which they request themselves against
   * their own address). Both guards matter: the caller must administer the org, AND the
   * address must belong to that same org — otherwise an admin could route a pickup to any
   * address by id.
   */
  async requestOrgPickup(input: {
    actorId: string;
    kind: OrgKind;
    orgId: string;
    addressId: string;
    scheduledDate: Day;
    windowStartHour: number;
    windowEndHour: number;
  }): Promise<{ id: string; qrToken: string }> {
    await this.requireOrgAdmin(input.actorId, input.kind, input.orgId);

    const address = await this.orgs.orgAddress(input.addressId);

    if (address?.kind !== input.kind || address.orgId !== input.orgId) {
      // Not an address of THIS org. Same 404 whether the address is a user's, another org's,
      // or nonexistent — no probing.
      throw new NotFoundError('Address not found for this organisation.');
    }

    const today = Day.fromUtcDate(this.clock.now());
    if (input.scheduledDate.isBefore(today)) {
      throw new ConflictError('A pickup cannot be scheduled in the past.');
    }

    const qrToken = randomBytes(32).toString('base64url');

    const pickup = await this.pickups.create({
      // The admin is the human who requested it; the org attribution is carried on the pickup.
      userId: input.actorId,
      addressId: input.addressId,
      scheduledDate: input.scheduledDate,
      windowStartHour: input.windowStartHour,
      windowEndHour: input.windowEndHour,
      qrToken,
      apartmentId: input.kind === 'APARTMENT' ? input.orgId : null,
      businessId: input.kind === 'BUSINESS' ? input.orgId : null,
    });

    this.logger.log(`Common-area pickup ${pickup.id} scheduled for ${input.kind} ${input.orgId}`);

    return { id: pickup.id, qrToken: pickup.qrToken };
  }

  // --- Contracts ------------------------------------------------------------

  async createContract(input: {
    actorId: string;
    kind: OrgKind;
    orgId: string;
    type: ContractType;
    flatAmountPaise: number | null;
    perKgRatePaise: number | null;
    startDate: Day;
  }): Promise<ContractRecord> {
    await this.requireOrgAdmin(input.actorId, input.kind, input.orgId);

    // One active contract at a time keeps invoicing unambiguous.
    const active = await this.orgs.activeContract(input.kind, input.orgId);
    if (active !== null) {
      throw new ConflictError(
        'This org already has an active contract. End it before creating another.',
      );
    }

    return this.orgs.createContract({
      kind: input.kind,
      orgId: input.orgId,
      type: input.type,
      flatAmountPaise: input.flatAmountPaise,
      perKgRatePaise: input.perKgRatePaise,
      startDate: input.startDate,
    });
  }

  async listContracts(actorId: string, kind: OrgKind, orgId: string): Promise<ContractRecord[]> {
    await this.requireOrgAdmin(actorId, kind, orgId);
    return this.orgs.listContracts(kind, orgId);
  }

  // --- Invoices -------------------------------------------------------------

  /**
   * Generates (or returns the existing) invoice for a contract and month.
   *
   * Idempotent: the unique (contract, period) index means a re-run returns the same invoice
   * rather than billing twice. The amount and the terms are SNAPSHOTTED onto the invoice, so a
   * later contract change never rewrites a past bill.
   */
  async generateInvoice(input: {
    actorId: string;
    kind: OrgKind;
    orgId: string;
    contractId: string;
    yearMonth: string;
  }): Promise<{ invoice: InvoiceRecord; created: boolean }> {
    await this.requireOrgAdmin(input.actorId, input.kind, input.orgId);

    const contract = await this.orgs.findContract(input.contractId);
    if (contract?.orgKind !== input.kind || contract.orgId !== input.orgId) {
      // The contract must belong to THIS org — an admin cannot invoice against another org's
      // contract by id.
      throw new NotFoundError('Contract not found for this organisation.');
    }

    const period = monthlyPeriod(input.yearMonth);

    // The recycled weight for the period, from the Phase 6 impact report (member roll-up).
    const report =
      input.kind === 'APARTMENT'
        ? await this.impact.forApartment(input.orgId)
        : await this.impact.forBusiness(input.orgId);

    const monthImpact = report.monthly.find((month) => month.yearMonth === input.yearMonth);
    const recycledGrams = monthImpact
      ? Object.values(monthImpact.recycledGramsByType).reduce((sum, grams) => sum + (grams ?? 0), 0)
      : 0;

    const { amountPaise } = computeInvoiceAmount(
      {
        type: contract.type,
        flatAmountPaise: contract.flatAmountPaise,
        perKgRatePaise: contract.perKgRatePaise,
      },
      recycledGrams,
    );

    return this.orgs.createInvoice({
      contractId: contract.id,
      kind: input.kind,
      orgId: input.orgId,
      periodLabel: period.label,
      periodStart: period.start,
      periodEnd: period.end,
      contractType: contract.type,
      flatAmountPaise: contract.flatAmountPaise,
      perKgRatePaise: contract.perKgRatePaise,
      recycledGrams,
      amountPaise,
    });
  }

  async listInvoices(actorId: string, kind: OrgKind, orgId: string): Promise<InvoiceRecord[]> {
    await this.requireOrgAdmin(actorId, kind, orgId);
    return this.orgs.listInvoices(kind, orgId);
  }

  async issueInvoice(input: {
    actorId: string;
    kind: OrgKind;
    orgId: string;
    invoiceId: string;
  }): Promise<InvoiceRecord> {
    await this.requireOrgAdmin(input.actorId, input.kind, input.orgId);

    const invoice = await this.orgs.findInvoice(input.invoiceId);
    if (invoice?.orgKind !== input.kind || invoice.orgId !== input.orgId) {
      throw new NotFoundError('Invoice not found for this organisation.');
    }

    return this.orgs.markInvoiceIssued(input.invoiceId);
  }

  // --- ESG report -----------------------------------------------------------

  /**
   * Assembles the ESG report DATA for an org and period. Rendering (PDF) is the controller's
   * job via the renderer port; this produces the figures, tenant-checked.
   */
  async esgReportData(input: {
    actorId: string;
    kind: OrgKind;
    orgId: string;
    yearMonth: string;
  }): Promise<EsgReport> {
    await this.requireOrgAdmin(input.actorId, input.kind, input.orgId);

    const org = await this.orgs.findOrg(input.kind, input.orgId);
    if (org === null) throw new NotFoundError('Organisation not found');

    const period = monthlyPeriod(input.yearMonth);
    const members = await this.orgs.memberUserIds(input.kind, input.orgId);

    const report =
      input.kind === 'APARTMENT'
        ? await this.impact.forApartment(input.orgId)
        : await this.impact.forBusiness(input.orgId);

    return assembleEsgReport({
      orgName: org.name,
      orgKind: input.kind,
      periodLabel: period.label,
      periodStart: period.start.toString(),
      periodEnd: period.end.toString(),
      generatedAt: this.clock.now().toISOString(),
      memberCount: members.length,
      totals: report.lifetime,
      monthly: report.monthly.map((month) => ({
        yearMonth: month.yearMonth,
        recycledKg: month.impact.recycledKg,
        estimatedCo2eAvoidedKg: month.impact.estimatedCo2eAvoidedKg,
      })),
    });
  }
}
