import { Injectable } from '@nestjs/common';
import {
  type ContractType as PrismaContractType,
  type OrgKind as PrismaOrgKind,
  Prisma,
} from '@prisma/client';

import { Day } from '@/modules/subscriptions/domain/value-objects/day';
import { ConflictError } from '@/shared/domain/errors/domain.error';
import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';
import { type ContractType } from '../../domain/contract-billing';
import {
  type ContractRecord,
  type InvoiceRecord,
  type OrgMemberRecord,
  type OrgRepository,
  type OrgSummary,
} from '../../domain/ports/org.repository';
import { type Membership, type OrgKind, type OrgRole } from '../../domain/tenant-access';

/** Which FK column an org kind maps to. Keeps the apartment/business fork in one place. */
function orgColumns(
  kind: OrgKind,
  orgId: string,
): { apartmentId: string | null; businessId: string | null } {
  return {
    apartmentId: kind === 'APARTMENT' ? orgId : null,
    businessId: kind === 'BUSINESS' ? orgId : null,
  };
}

@Injectable()
export class PrismaOrgRepository implements OrgRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findOrg(kind: OrgKind, id: string): Promise<OrgSummary | null> {
    if (kind === 'APARTMENT') {
      const row = await this.prisma.apartment.findUnique({ where: { id } });
      return row === null ? null : { id: row.id, kind, name: row.name, verified: row.verified };
    }

    const row = await this.prisma.business.findUnique({ where: { id } });
    return row === null ? null : { id: row.id, kind, name: row.name, verified: row.verified };
  }

  // --- Membership -----------------------------------------------------------

  async membershipsForUser(userId: string): Promise<Membership[]> {
    const rows = await this.prisma.orgMember.findMany({ where: { userId } });
    return rows.map((row) => this.toMembership(row));
  }

  async listMembers(kind: OrgKind, orgId: string): Promise<OrgMemberRecord[]> {
    const rows = await this.prisma.orgMember.findMany({
      where: orgColumns(kind, orgId),
      include: { user: { select: { name: true, phone: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      name: row.user.name,
      phone: row.user.phone,
      orgRole: row.orgRole,
    }));
  }

  async addMember(input: {
    userId: string;
    kind: OrgKind;
    orgId: string;
    orgRole: OrgRole;
  }): Promise<OrgMemberRecord> {
    try {
      const row = await this.prisma.orgMember.create({
        data: {
          userId: input.userId,
          orgKind: input.kind,
          orgRole: input.orgRole,
          ...orgColumns(input.kind, input.orgId),
        },
        include: { user: { select: { name: true, phone: true } } },
      });

      return {
        id: row.id,
        userId: row.userId,
        name: row.user.name,
        phone: row.user.phone,
        orgRole: row.orgRole,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Either the user is already a member, or (for an ADMIN add) the org already has one —
        // the one-admin-per-org partial index. Both are conflicts, not 500s.
        throw new ConflictError(
          'That user is already a member of this org, or the org already has an admin.',
        );
      }
      throw error;
    }
  }

  async removeMember(kind: OrgKind, orgId: string, userId: string): Promise<void> {
    await this.prisma.orgMember.deleteMany({ where: { userId, ...orgColumns(kind, orgId) } });
  }

  async findMembership(userId: string, kind: OrgKind, orgId: string): Promise<Membership | null> {
    const row = await this.prisma.orgMember.findFirst({
      where: { userId, ...orgColumns(kind, orgId) },
    });

    return row === null ? null : this.toMembership(row);
  }

  async memberUserIds(kind: OrgKind, orgId: string): Promise<string[]> {
    const rows = await this.prisma.orgMember.findMany({
      where: orgColumns(kind, orgId),
      select: { userId: true },
    });

    return rows.map((row) => row.userId);
  }

  // --- Contracts ------------------------------------------------------------

  async createContract(input: {
    kind: OrgKind;
    orgId: string;
    type: ContractType;
    flatAmountPaise: number | null;
    perKgRatePaise: number | null;
    startDate: Day;
  }): Promise<ContractRecord> {
    const row = await this.prisma.orgContract.create({
      data: {
        orgKind: input.kind,
        type: input.type,
        flatAmountPaise: input.flatAmountPaise,
        perKgRatePaise: input.perKgRatePaise,
        startDate: input.startDate.toUtcDate(),
        ...orgColumns(input.kind, input.orgId),
      },
    });

    return this.toContract(row);
  }

  async findContract(id: string): Promise<ContractRecord | null> {
    const row = await this.prisma.orgContract.findUnique({ where: { id } });
    return row === null ? null : this.toContract(row);
  }

  async listContracts(kind: OrgKind, orgId: string): Promise<ContractRecord[]> {
    const rows = await this.prisma.orgContract.findMany({
      where: orgColumns(kind, orgId),
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((row) => this.toContract(row));
  }

  async activeContract(kind: OrgKind, orgId: string): Promise<ContractRecord | null> {
    const row = await this.prisma.orgContract.findFirst({
      where: { ...orgColumns(kind, orgId), status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });

    return row === null ? null : this.toContract(row);
  }

  // --- Invoices -------------------------------------------------------------

  async createInvoice(input: {
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
  }): Promise<{ invoice: InvoiceRecord; created: boolean }> {
    try {
      const row = await this.prisma.orgInvoice.create({
        data: {
          contractId: input.contractId,
          orgKind: input.kind,
          periodLabel: input.periodLabel,
          periodStart: input.periodStart.toUtcDate(),
          periodEnd: input.periodEnd.toUtcDate(),
          contractType: input.contractType,
          flatAmountPaise: input.flatAmountPaise,
          perKgRatePaise: input.perKgRatePaise,
          recycledGrams: input.recycledGrams,
          amountPaise: input.amountPaise,
          ...orgColumns(input.kind, input.orgId),
        },
      });

      return { invoice: this.toInvoice(row), created: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Idempotent: an invoice for this (contract, period) already exists. Return it rather
        // than double-billing.
        const existing = await this.prisma.orgInvoice.findFirstOrThrow({
          where: { contractId: input.contractId, periodLabel: input.periodLabel },
        });
        return { invoice: this.toInvoice(existing), created: false };
      }
      throw error;
    }
  }

  async findInvoice(id: string): Promise<InvoiceRecord | null> {
    const row = await this.prisma.orgInvoice.findUnique({ where: { id } });
    return row === null ? null : this.toInvoice(row);
  }

  async listInvoices(kind: OrgKind, orgId: string): Promise<InvoiceRecord[]> {
    const rows = await this.prisma.orgInvoice.findMany({
      where: orgColumns(kind, orgId),
      orderBy: { periodLabel: 'desc' },
    });

    return rows.map((row) => this.toInvoice(row));
  }

  async markInvoiceIssued(id: string): Promise<InvoiceRecord> {
    const row = await this.prisma.orgInvoice.update({
      where: { id },
      data: { status: 'ISSUED', issuedAt: new Date() },
    });

    return this.toInvoice(row);
  }

  // --- Org pickups ----------------------------------------------------------

  async orgAddress(
    addressId: string,
  ): Promise<{ kind: OrgKind; orgId: string; pincode: string } | null> {
    const row = await this.prisma.address.findUnique({
      where: { id: addressId },
      select: { apartmentId: true, businessId: true, pincode: true },
    });

    if (row === null) return null;
    if (row.apartmentId !== null) {
      return { kind: 'APARTMENT', orgId: row.apartmentId, pincode: row.pincode };
    }
    if (row.businessId !== null) {
      return { kind: 'BUSINESS', orgId: row.businessId, pincode: row.pincode };
    }
    // A user-owned address is not an org address.
    return null;
  }

  // --- Mapping --------------------------------------------------------------

  private toMembership(row: {
    orgKind: PrismaOrgKind;
    apartmentId: string | null;
    businessId: string | null;
    orgRole: string;
  }): Membership {
    const orgId = row.apartmentId ?? row.businessId ?? '';
    return { orgKind: row.orgKind, orgId, orgRole: row.orgRole as OrgRole };
  }

  private toContract(row: {
    id: string;
    orgKind: PrismaOrgKind;
    apartmentId: string | null;
    businessId: string | null;
    type: PrismaContractType;
    flatAmountPaise: number | null;
    perKgRatePaise: number | null;
    status: string;
    startDate: Date;
    endDate: Date | null;
  }): ContractRecord {
    return {
      id: row.id,
      orgKind: row.orgKind,
      orgId: row.apartmentId ?? row.businessId ?? '',
      type: row.type,
      flatAmountPaise: row.flatAmountPaise,
      perKgRatePaise: row.perKgRatePaise,
      status: row.status as 'ACTIVE' | 'ENDED',
      startDate: Day.fromUtcDate(row.startDate),
      endDate: row.endDate === null ? null : Day.fromUtcDate(row.endDate),
    };
  }

  private toInvoice(row: {
    id: string;
    contractId: string;
    orgKind: PrismaOrgKind;
    apartmentId: string | null;
    businessId: string | null;
    periodLabel: string;
    periodStart: Date;
    periodEnd: Date;
    contractType: PrismaContractType;
    recycledGrams: number;
    amountPaise: number;
    status: string;
    issuedAt: Date | null;
    createdAt: Date;
  }): InvoiceRecord {
    return {
      id: row.id,
      contractId: row.contractId,
      orgKind: row.orgKind,
      orgId: row.apartmentId ?? row.businessId ?? '',
      periodLabel: row.periodLabel,
      periodStart: Day.fromUtcDate(row.periodStart),
      periodEnd: Day.fromUtcDate(row.periodEnd),
      contractType: row.contractType,
      recycledGrams: row.recycledGrams,
      amountPaise: row.amountPaise,
      status: row.status as 'DRAFT' | 'ISSUED' | 'PAID',
      issuedAt: row.issuedAt,
      createdAt: row.createdAt,
    };
  }
}
