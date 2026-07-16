import { type Day } from '@/modules/subscriptions/domain/value-objects/day';
import { type ContractType } from '../contract-billing';
import { type Membership, type OrgKind, type OrgRole } from '../tenant-access';

export interface OrgSummary {
  id: string;
  kind: OrgKind;
  name: string;
  verified: boolean;
}

export interface OrgMemberRecord {
  id: string;
  userId: string;
  name: string | null;
  phone: string;
  orgRole: OrgRole;
}

export interface ContractRecord {
  id: string;
  orgKind: OrgKind;
  orgId: string;
  type: ContractType;
  flatAmountPaise: number | null;
  perKgRatePaise: number | null;
  status: 'ACTIVE' | 'ENDED';
  startDate: Day;
  endDate: Day | null;
}

export interface InvoiceRecord {
  id: string;
  contractId: string;
  orgKind: OrgKind;
  orgId: string;
  periodLabel: string;
  periodStart: Day;
  periodEnd: Day;
  contractType: ContractType;
  recycledGrams: number;
  amountPaise: number;
  status: 'DRAFT' | 'ISSUED' | 'PAID';
  issuedAt: Date | null;
  createdAt: Date;
}

export interface OrgRepository {
  // --- Orgs & membership ----------------------------------------------------

  findOrg(kind: OrgKind, id: string): Promise<OrgSummary | null>;

  /** Every membership a user holds. THE input to every tenant-access check. */
  membershipsForUser(userId: string): Promise<Membership[]>;

  listMembers(kind: OrgKind, orgId: string): Promise<OrgMemberRecord[]>;

  /**
   * Adds a user to an org, or updates their role. Idempotent on (user, org): the partial
   * unique index means a re-add cannot create a duplicate membership.
   */
  addMember(input: {
    userId: string;
    kind: OrgKind;
    orgId: string;
    orgRole: OrgRole;
  }): Promise<OrgMemberRecord>;

  removeMember(kind: OrgKind, orgId: string, userId: string): Promise<void>;

  findMembership(userId: string, kind: OrgKind, orgId: string): Promise<Membership | null>;

  /** The user ids of an org's members — powers the Phase 6 impact roll-up. */
  memberUserIds(kind: OrgKind, orgId: string): Promise<string[]>;

  // --- Contracts ------------------------------------------------------------

  createContract(input: {
    kind: OrgKind;
    orgId: string;
    type: ContractType;
    flatAmountPaise: number | null;
    perKgRatePaise: number | null;
    startDate: Day;
  }): Promise<ContractRecord>;

  findContract(id: string): Promise<ContractRecord | null>;
  listContracts(kind: OrgKind, orgId: string): Promise<ContractRecord[]>;
  activeContract(kind: OrgKind, orgId: string): Promise<ContractRecord | null>;

  // --- Invoices -------------------------------------------------------------

  /**
   * Creates an invoice, or returns the existing one for the same (contract, period).
   *
   * The unique index on (contractId, periodLabel) is what makes invoice generation idempotent:
   * a re-run for the same month collides here rather than double-billing the org.
   */
  createInvoice(input: {
    contractId: string;
    kind: OrgKind;
    orgId: string;
    periodLabel: string;
    periodStart: Day;
    periodEnd: Day;
    contractType: ContractType;
    flatAmountPaise: number | null;
    perKgRatePaise: number | null;
    recycledGrams: number;
    amountPaise: number;
  }): Promise<{ invoice: InvoiceRecord; created: boolean }>;

  findInvoice(id: string): Promise<InvoiceRecord | null>;
  listInvoices(kind: OrgKind, orgId: string): Promise<InvoiceRecord[]>;
  markInvoiceIssued(id: string): Promise<InvoiceRecord>;

  // --- Org pickups ----------------------------------------------------------

  /** Pincode of an org-owned address, and which org owns it — for the org-pickup guard. */
  orgAddress(addressId: string): Promise<{ kind: OrgKind; orgId: string; pincode: string } | null>;
}

export const ORG_REPOSITORY = Symbol('ORG_REPOSITORY');
