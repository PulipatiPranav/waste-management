import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '@/modules/auth/presentation/decorators/current-user.decorator';
import { Roles } from '@/modules/auth/presentation/decorators/roles.decorator';
import { Idempotent } from '@/shared/presentation/interceptors/idempotency.interceptor';
import { WalletUseCases } from '../application/wallet.use-cases';
import { paiseToRupees } from '../domain/money';
import {
  type LedgerRow,
  type WalletSummary,
  type WithdrawalRow,
} from '../domain/ports/wallet.repository';
import {
  AdjustWalletDto,
  LedgerEntryDto,
  MarkPaidDto,
  ReconciliationDto,
  RejectWithdrawalDto,
  RequestWithdrawalDto,
  WalletDto,
  WithdrawalDto,
  WithdrawalQueryDto,
} from './dto/wallet.dto';

/**
 * BigInt is not JSON-serialisable, and a JS number cannot hold one safely. Every money
 * value leaves this API as a STRING of paise, plus a formatted rupee string for display.
 * Silently coercing to a number would corrupt large balances without any error.
 */
const toWalletDto = (wallet: WalletSummary): WalletDto => ({
  id: wallet.id,
  balancePaise: wallet.balancePaise.toString(),
  balanceRupees: paiseToRupees(wallet.balancePaise),
  currency: wallet.currency,
});

const toLedgerDto = (row: LedgerRow): LedgerEntryDto => ({
  id: row.id,
  type: row.type,
  direction: row.direction,
  amountPaise: row.amountPaise.toString(),
  amountRupees: paiseToRupees(row.amountPaise),
  balanceAfterPaise: row.balanceAfterPaise.toString(),
  balanceAfterRupees: paiseToRupees(row.balanceAfterPaise),
  pickupId: row.pickupId,
  withdrawalId: row.withdrawalId,
  note: row.note,
  createdAt: row.createdAt.toISOString(),
});

const toWithdrawalDto = (row: WithdrawalRow): WithdrawalDto => ({
  id: row.id,
  amountPaise: row.amountPaise.toString(),
  amountRupees: paiseToRupees(row.amountPaise),
  status: row.status,
  bankAccountLast4: row.bankAccountLast4,
  bankIfsc: row.bankIfsc,
  accountHolder: row.accountHolder,
  rejectionReason: row.rejectionReason,
  paymentRef: row.paymentRef,
  createdAt: row.createdAt.toISOString(),
});

@ApiTags('wallet')
@ApiBearerAuth()
@Controller({ path: 'wallet', version: '1' })
export class WalletController {
  constructor(private readonly wallet: WalletUseCases) {}

  @Get()
  @ApiOperation({ summary: 'My wallet balance' })
  @ApiOkResponse({ type: WalletDto })
  async get(@CurrentUser() current: AuthenticatedUser): Promise<WalletDto> {
    return toWalletDto(await this.wallet.getWallet(current.id));
  }

  @Get('transactions')
  @ApiOperation({
    summary: 'My wallet statement',
    description: 'The append-only ledger. Every entry carries the balance it produced.',
  })
  @ApiOkResponse({ type: [LedgerEntryDto] })
  async transactions(@CurrentUser() current: AuthenticatedUser): Promise<LedgerEntryDto[]> {
    const rows = await this.wallet.getTransactions(current.id, 100);
    return rows.map(toLedgerDto);
  }

  @Post('withdrawals')
  @Idempotent()
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'REQUIRED. This endpoint moves money.',
  })
  @ApiOperation({
    summary: 'Request a payout to a bank account',
    description:
      'The wallet is DEBITED IMMEDIATELY and the funds held. If the money stayed put until ops ' +
      'reviewed it, a customer could request their whole balance twice. Nothing is auto-disbursed: ' +
      'a human approves, and a second human action records that the transfer actually went out.',
  })
  @ApiCreatedResponse({ type: WithdrawalDto })
  @ApiConflictResponse({ description: 'Below the minimum, or more than the balance.' })
  async requestWithdrawal(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: RequestWithdrawalDto,
  ): Promise<WithdrawalDto> {
    const { withdrawal } = await this.wallet.requestWithdrawal({
      userId: current.id,
      amountPaise: BigInt(dto.amountPaise),
      bankAccountLast4: dto.bankAccountLast4,
      bankIfsc: dto.bankIfsc,
      accountHolder: dto.accountHolder,
    });

    return toWithdrawalDto(withdrawal);
  }

  @Get('withdrawals')
  @ApiOkResponse({ type: [WithdrawalDto] })
  async listWithdrawals(@CurrentUser() current: AuthenticatedUser): Promise<WithdrawalDto[]> {
    const rows = await this.wallet.listWithdrawals(current.id);
    return rows.map(toWithdrawalDto);
  }

  @Get('withdrawals/:id')
  @ApiOkResponse({ type: WithdrawalDto })
  async getWithdrawal(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WithdrawalDto> {
    return toWithdrawalDto(await this.wallet.getWithdrawalForUser(current.id, id));
  }
}

/**
 * Ops: the payout queue, support lookups, and manual corrections.
 *
 * Every action here is attributed to the staff member who took it. An unattributable
 * balance change in a financial system is indistinguishable from fraud.
 */
@ApiTags('admin/wallet')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Requires OPS_STAFF or SUPER_ADMIN.' })
@Roles('OPS_STAFF', 'SUPER_ADMIN')
@Controller({ path: 'admin/wallet', version: '1' })
export class AdminWalletController {
  constructor(private readonly wallet: WalletUseCases) {}

  @Get('withdrawals')
  @ApiOperation({
    summary: 'The payout queue',
    description: 'Default: everything. Filter by status to see what is waiting for approval.',
  })
  @ApiOkResponse({ type: [WithdrawalDto] })
  async queue(@Query() query: WithdrawalQueryDto): Promise<WithdrawalDto[]> {
    const rows = await this.wallet.listWithdrawalQueue(query.status ?? null);
    return rows.map(toWithdrawalDto);
  }

  @Post('withdrawals/:id/approve')
  @ApiOperation({
    summary: 'Approve a payout',
    description:
      'Records that a human agreed to pay. Does NOT send money — that is a separate action, ' +
      'and nothing in this system auto-disburses to a bank. See the RBI PPI note in the README.',
  })
  @ApiOkResponse({ type: WithdrawalDto })
  async approve(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WithdrawalDto> {
    return toWithdrawalDto(await this.wallet.approveWithdrawal(id, current.id));
  }

  @Post('withdrawals/:id/reject')
  @ApiOperation({
    summary: 'Reject a payout and return the money',
    description:
      'Appends a REVERSAL CREDIT. The original debit is never edited — the ledger is append-only ' +
      'and Postgres enforces that with a trigger. The customer sees both entries.',
  })
  @ApiOkResponse({ type: WithdrawalDto })
  async reject(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectWithdrawalDto,
  ): Promise<WithdrawalDto> {
    const { withdrawal } = await this.wallet.rejectWithdrawal(id, current.id, dto.reason);
    return toWithdrawalDto(withdrawal);
  }

  @Post('withdrawals/:id/mark-paid')
  @ApiOperation({
    summary: 'Confirm the bank transfer went out',
    description:
      'A human keyed the transfer and is recording its reference. No ledger entry — the money left the wallet at request time.',
  })
  @ApiOkResponse({ type: WithdrawalDto })
  async markPaid(
    @CurrentUser() current: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkPaidDto,
  ): Promise<WithdrawalDto> {
    return toWithdrawalDto(await this.wallet.markWithdrawalPaid(id, current.id, dto.paymentRef));
  }

  @Get('users/:userId')
  @ApiOperation({ summary: 'Look up a customer’s wallet (support)' })
  @ApiOkResponse({ type: WalletDto })
  async userWallet(@Param('userId', ParseUUIDPipe) userId: string): Promise<WalletDto> {
    return toWalletDto(await this.wallet.getWalletForStaff(userId));
  }

  @Get('users/:userId/transactions')
  @ApiOperation({
    summary: 'A customer’s full statement (support)',
    description: 'This is the answer to "why does my wallet say ₹240".',
  })
  @ApiOkResponse({ type: [LedgerEntryDto] })
  async userTransactions(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<LedgerEntryDto[]> {
    const rows = await this.wallet.getTransactionsForStaff(userId, 500);
    return rows.map(toLedgerDto);
  }

  @Get('users/:userId/reconcile')
  @ApiOperation({
    summary: 'Replay the ledger and check it against the cached balance',
    description:
      'The wallet balance is a CACHE; the ledger is the truth. If ok is false, a write escaped ' +
      'the row lock and the balance cannot be trusted — investigate immediately.',
  })
  @ApiOkResponse({ type: ReconciliationDto })
  async reconcile(@Param('userId', ParseUUIDPipe) userId: string): Promise<ReconciliationDto> {
    const result = await this.wallet.reconcileWallet(userId);

    return {
      ok: result.ok,
      cachedBalancePaise: result.cachedBalancePaise.toString(),
      ledgerBalancePaise: result.ledgerBalancePaise.toString(),
      entryCount: result.entryCount,
      brokenAtIndex: result.brokenAtIndex,
    };
  }

  @Post('adjustments')
  @Idempotent()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary: 'Manually correct a wallet balance',
    description:
      'A NEW ledger row, attributed to you, with a note an auditor will read. The ledger is ' +
      'append-only: this is the ONLY way to fix a wrong balance.',
  })
  @ApiOkResponse()
  async adjust(
    @CurrentUser() current: AuthenticatedUser,
    @Body() dto: AdjustWalletDto,
  ): Promise<{ balancePaise: string; balanceRupees: string }> {
    const result = await this.wallet.adjust({
      targetUserId: dto.userId,
      direction: dto.direction,
      amountPaise: BigInt(dto.amountPaise),
      note: dto.note,
      actorUserId: current.id,
    });

    return {
      balancePaise: result.balanceAfterPaise.toString(),
      balanceRupees: paiseToRupees(result.balanceAfterPaise),
    };
  }
}
