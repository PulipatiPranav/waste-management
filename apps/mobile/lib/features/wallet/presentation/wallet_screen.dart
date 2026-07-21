import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/async_value_view.dart';
import '../../../core/widgets/empty_state.dart';
import '../data/wallet_dtos.dart';
import 'wallet_controllers.dart';
import 'withdrawal_screen.dart';

class WalletScreen extends ConsumerWidget {
  const WalletScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final balance = ref.watch(walletBalanceProvider);
    final transactions = ref.watch(walletTransactionsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Wallet')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref
            ..invalidate(walletBalanceProvider)
            ..invalidate(walletTransactionsProvider)
            ..invalidate(walletWithdrawalsProvider);
          await ref.read(walletBalanceProvider.future);
        },
        child: ListView(
          padding: const EdgeInsets.all(AppSpacing.md),
          children: [
            _BalanceCard(
              balance: balance,
              onWithdraw: () => _openWithdrawal(context, ref, balance.value),
            ),
            const SizedBox(height: AppSpacing.lg),
            Text('Transactions', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: AppSpacing.sm),
            AsyncValueView<List<LedgerEntryDto>>(
              value: transactions,
              onRetry: () => ref.invalidate(walletTransactionsProvider),
              data: (rows) => rows.isEmpty
                  ? const EmptyState(
                      title: 'No transactions yet',
                      message: 'Cashback from your paper pickups will show up here.',
                      icon: Icons.receipt_long_outlined,
                    )
                  : Column(children: rows.map(_LedgerRow.new).toList()),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openWithdrawal(BuildContext context, WidgetRef ref, WalletDto? wallet) async {
    final didWithdraw = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => WithdrawalScreen(currentBalance: wallet?.balanceRupees)),
    );
    if (didWithdraw ?? false) {
      ref
        ..invalidate(walletBalanceProvider)
        ..invalidate(walletTransactionsProvider)
        ..invalidate(walletWithdrawalsProvider);
    }
  }
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard({required this.balance, required this.onWithdraw});

  final AsyncValue<WalletDto> balance;
  final VoidCallback onWithdraw;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      color: theme.colorScheme.primaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Balance',
              style: theme.textTheme.labelLarge?.copyWith(
                color: theme.colorScheme.onPrimaryContainer,
              ),
            ),
            const SizedBox(height: AppSpacing.xs),
            balance.when(
              loading: () =>
                  const SizedBox(height: 40, child: Center(child: CircularProgressIndicator())),
              error: (_, _) => Text(
                'Unavailable',
                style: theme.textTheme.headlineMedium?.copyWith(
                  color: theme.colorScheme.onPrimaryContainer,
                ),
              ),
              data: (wallet) => Text(
                wallet.balanceRupees,
                style: theme.textTheme.displaySmall?.copyWith(
                  color: theme.colorScheme.onPrimaryContainer,
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            AppButton(
              label: 'Withdraw to bank',
              icon: Icons.account_balance_outlined,
              variant: AppButtonVariant.secondary,
              onPressed: balance.hasValue ? onWithdraw : null,
            ),
          ],
        ),
      ),
    );
  }
}

class _LedgerRow extends StatelessWidget {
  const _LedgerRow(this.entry);
  final LedgerEntryDto entry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isCredit = entry.direction == 'CREDIT';
    final color = isCredit ? theme.colorScheme.primary : theme.colorScheme.error;

    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: CircleAvatar(
        backgroundColor: color.withValues(alpha: 0.12),
        child: Icon(isCredit ? Icons.south_west : Icons.north_east, color: color, size: 20),
      ),
      title: Text(_label(entry.type)),
      subtitle: Text(entry.note ?? formatDateTime(entry.createdAt)),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(
            '${isCredit ? '+' : '−'}${entry.amountRupees}',
            style: theme.textTheme.titleMedium?.copyWith(color: color),
          ),
          Text(
            entry.balanceAfterRupees,
            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline),
          ),
        ],
      ),
    );
  }

  String _label(String type) => switch (type) {
    'PICKUP_CASHBACK' => 'Pickup cashback',
    'WITHDRAWAL_DEBIT' => 'Withdrawal',
    'WITHDRAWAL_REVERSAL' => 'Withdrawal refunded',
    'ORDER_PAYMENT' => 'Marketplace order',
    'ORDER_REFUND' => 'Order refund',
    'ADJUSTMENT' => 'Adjustment',
    _ => type,
  };
}
