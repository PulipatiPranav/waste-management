import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { type Response } from 'express';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '@/modules/auth/presentation/decorators/current-user.decorator';
import { Roles } from '@/modules/auth/presentation/decorators/roles.decorator';
import { paiseToRupees, gramsToKg } from '@/modules/wallet/domain/money';
import { Day } from '@/modules/subscriptions/domain/value-objects/day';
import { OrgUseCases } from '../application/org.use-cases';
import { ESG_REPORT_RENDERER, type EsgReportRenderer } from '../domain/esg-report';
import { Inject } from '@nestjs/common';
import {
  type ContractRecord,
  type InvoiceRecord,
  type OrgMemberRecord,
} from '../domain/ports/org.repository';
import { type OrgKind } from '../domain/tenant-access';
import {
  AddMemberDto,
  ContractDto,
  CreateContractDto,
  GenerateInvoiceDto,
  InvoiceDto,
  OrgMemberDto,
  RequestOrgPickupDto,
} from './dto/org.dto';

/** Maps the URL segment (`apartments` / `businesses`) to the domain OrgKind. */
const KIND_BY_PATH: Record<string, OrgKind> = {
  apartments: 'APARTMENT',
  businesses: 'BUSINESS',
};

function kindFromPath(segment: string): OrgKind {
  const kind = KIND_BY_PATH[segment];
  if (kind === undefined) {
    throw new BadRequestException(`Unknown org type: ${segment}`);
  }
  return kind;
}

const toMemberDto = (member: OrgMemberRecord): OrgMemberDto => ({
  id: member.id,
  userId: member.userId,
  name: member.name,
  phone: member.phone,
  orgRole: member.orgRole,
});

const toContractDto = (contract: ContractRecord): ContractDto => ({
  id: contract.id,
  type: contract.type,
  flatAmountPaise: contract.flatAmountPaise,
  perKgRatePaise: contract.perKgRatePaise,
  status: contract.status,
  startDate: contract.startDate.toString(),
});

const toInvoiceDto = (invoice: InvoiceRecord): InvoiceDto => ({
  id: invoice.id,
  contractId: invoice.contractId,
  periodLabel: invoice.periodLabel,
  contractType: invoice.contractType,
  recycledGrams: invoice.recycledGrams,
  recycledKg: gramsToKg(invoice.recycledGrams),
  amountPaise: invoice.amountPaise,
  amountRupees: paiseToRupees(invoice.amountPaise),
  status: invoice.status,
  issuedAt: invoice.issuedAt?.toISOString() ?? null,
});

/**
 * Org-admin endpoints. The URL is `/orgs/:orgType/:orgId/...`, and EVERY handler passes the
 * org through the tenant gate in the use case before touching data — an authenticated org
 * admin reaching for another org's `:orgId` gets a 403 that reveals nothing.
 *
 * Requires the coarse APARTMENT_ADMIN / BUSINESS_ADMIN global role to reach these routes at
 * all; the per-org membership check inside decides WHICH org they may act on.
 */
@ApiTags('orgs')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Not an admin of this organisation.' })
@Roles('APARTMENT_ADMIN', 'BUSINESS_ADMIN', 'OPS_STAFF', 'SUPER_ADMIN')
@Controller({ path: 'orgs/:orgType/:orgId', version: '1' })
export class OrgController {
  constructor(
    private readonly orgs: OrgUseCases,
    @Inject(ESG_REPORT_RENDERER) private readonly reportRenderer: EsgReportRenderer,
  ) {}

  // --- Members --------------------------------------------------------------

  @Get('members')
  @ApiOperation({ summary: 'List the org’s members' })
  @ApiOkResponse({ type: [OrgMemberDto] })
  async listMembers(
    @CurrentUser() current: AuthenticatedUser,
    @Param('orgType') orgType: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ): Promise<OrgMemberDto[]> {
    const members = await this.orgs.listMembers(current.id, kindFromPath(orgType), orgId);
    return members.map(toMemberDto);
  }

  @Post('members')
  @ApiOperation({ summary: 'Add a resident/employee by phone' })
  async addMember(
    @CurrentUser() current: AuthenticatedUser,
    @Param('orgType') orgType: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: AddMemberDto,
  ): Promise<OrgMemberDto> {
    const member = await this.orgs.addMember({
      actorId: current.id,
      kind: kindFromPath(orgType),
      orgId,
      memberPhone: dto.memberPhone,
      orgRole: dto.orgRole ?? 'MEMBER',
    });
    return toMemberDto(member);
  }

  @Delete('members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a member' })
  async removeMember(
    @CurrentUser() current: AuthenticatedUser,
    @Param('orgType') orgType: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.orgs.removeMember({
      actorId: current.id,
      kind: kindFromPath(orgType),
      orgId,
      memberUserId: userId,
    });
  }

  // --- Impact ---------------------------------------------------------------

  @Get('impact')
  @ApiOperation({ summary: 'The org’s aggregate recycling impact' })
  @ApiOkResponse()
  impact(
    @CurrentUser() current: AuthenticatedUser,
    @Param('orgType') orgType: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ) {
    return this.orgs.orgImpact(current.id, kindFromPath(orgType), orgId);
  }

  // --- Common-area pickups --------------------------------------------------

  @Post('pickups')
  @ApiOperation({
    summary: 'Schedule a common-area / bulk pickup for the org',
    description: 'The address must be one the org owns. Distinct from a resident’s own pickup.',
  })
  async requestPickup(
    @CurrentUser() current: AuthenticatedUser,
    @Param('orgType') orgType: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: RequestOrgPickupDto,
  ) {
    return this.orgs.requestOrgPickup({
      actorId: current.id,
      kind: kindFromPath(orgType),
      orgId,
      addressId: dto.addressId,
      scheduledDate: Day.parse(dto.scheduledDate),
      windowStartHour: dto.windowStartHour,
      windowEndHour: dto.windowEndHour,
    });
  }

  // --- Contracts & invoices -------------------------------------------------

  @Post('contracts')
  @ApiOperation({ summary: 'Create a paper-collection contract (flat or per-kg)' })
  async createContract(
    @CurrentUser() current: AuthenticatedUser,
    @Param('orgType') orgType: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateContractDto,
  ): Promise<ContractDto> {
    const contract = await this.orgs.createContract({
      actorId: current.id,
      kind: kindFromPath(orgType),
      orgId,
      type: dto.type,
      flatAmountPaise: dto.type === 'FLAT_MONTHLY' ? (dto.flatAmountPaise ?? 0) : null,
      perKgRatePaise: dto.type === 'PER_KG' ? (dto.perKgRatePaise ?? 0) : null,
      startDate: Day.parse(dto.startDate),
    });
    return toContractDto(contract);
  }

  @Get('contracts')
  @ApiOkResponse({ type: [ContractDto] })
  async listContracts(
    @CurrentUser() current: AuthenticatedUser,
    @Param('orgType') orgType: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ): Promise<ContractDto[]> {
    const contracts = await this.orgs.listContracts(current.id, kindFromPath(orgType), orgId);
    return contracts.map(toContractDto);
  }

  @Post('invoices')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate an invoice for a contract and month',
    description: 'Idempotent: re-running for the same period returns the existing invoice.',
  })
  @ApiOkResponse({ type: InvoiceDto })
  async generateInvoice(
    @CurrentUser() current: AuthenticatedUser,
    @Param('orgType') orgType: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: GenerateInvoiceDto,
  ): Promise<InvoiceDto> {
    const { invoice } = await this.orgs.generateInvoice({
      actorId: current.id,
      kind: kindFromPath(orgType),
      orgId,
      contractId: dto.contractId,
      yearMonth: dto.yearMonth,
    });
    return toInvoiceDto(invoice);
  }

  @Get('invoices')
  @ApiOkResponse({ type: [InvoiceDto] })
  async listInvoices(
    @CurrentUser() current: AuthenticatedUser,
    @Param('orgType') orgType: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ): Promise<InvoiceDto[]> {
    const invoices = await this.orgs.listInvoices(current.id, kindFromPath(orgType), orgId);
    return invoices.map(toInvoiceDto);
  }

  @Post('invoices/:invoiceId/issue')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark an invoice ISSUED' })
  @ApiOkResponse({ type: InvoiceDto })
  async issueInvoice(
    @CurrentUser() current: AuthenticatedUser,
    @Param('orgType') orgType: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
  ): Promise<InvoiceDto> {
    const invoice = await this.orgs.issueInvoice({
      actorId: current.id,
      kind: kindFromPath(orgType),
      orgId,
      invoiceId,
    });
    return toInvoiceDto(invoice);
  }

  // --- ESG report -----------------------------------------------------------

  @Get('esg-report')
  @ApiOperation({
    summary: 'Download an ESG report PDF for a period',
    description:
      'A defensible sustainability report for the org’s own CSR reporting. Carries the ' +
      'methodology and the honesty disclaimer on the document itself.',
  })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ description: 'A PDF document.' })
  @Header('Content-Type', 'application/pdf')
  async esgReport(
    @CurrentUser() current: AuthenticatedUser,
    @Param('orgType') orgType: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('yearMonth') yearMonth: string,
    @Res() res: Response,
  ): Promise<void> {
    if (yearMonth === undefined || !/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) {
      throw new BadRequestException('yearMonth query parameter is required, as YYYY-MM.');
    }

    const report = await this.orgs.esgReportData({
      actorId: current.id,
      kind: kindFromPath(orgType),
      orgId,
      yearMonth,
    });

    const rendered = await this.reportRenderer.render(report);

    res.setHeader('Content-Type', rendered.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="esg-report-${yearMonth}.${rendered.extension}"`,
    );
    res.send(rendered.body);
  }
}
