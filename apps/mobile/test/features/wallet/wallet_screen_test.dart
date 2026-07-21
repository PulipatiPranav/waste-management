import 'package:cpe_mobile/core/network/api_failure.dart';
import 'package:cpe_mobile/features/wallet/data/wallet_dtos.dart';
import 'package:cpe_mobile/features/wallet/data/wallet_repository.dart';
import 'package:cpe_mobile/features/wallet/presentation/wallet_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeWalletRepo implements WalletRepository {
  _FakeWalletRepo({this.balance, this.transactions = const [], this.fail});
  final WalletDto? balance;
  final List<LedgerEntryDto> transactions;
  final ApiFailure? fail;

  @override
  Future<(WalletDto?, ApiFailure?)> fetchBalance() async =>
      fail != null ? (null, fail) : (balance, null);
  @override
  Future<(List<LedgerEntryDto>?, ApiFailure?)> fetchTransactions() async =>
      fail != null ? (null, fail) : (transactions, null);
  @override
  Future<(List<WithdrawalDto>?, ApiFailure?)> fetchWithdrawals() async =>
      (const <WithdrawalDto>[], null);
  @override
  Future<(WithdrawalDto?, ApiFailure?)> requestWithdrawal(RequestWithdrawal request) async =>
      (null, null);
}

Widget _harness(_FakeWalletRepo repo) {
  return ProviderScope(
    overrides: [walletRepositoryProvider.overrideWithValue(repo)],
    child: const MaterialApp(home: WalletScreen()),
  );
}

const _wallet = WalletDto(
  id: 'w1',
  balancePaise: '48000',
  balanceRupees: '₹480.00',
  currency: 'INR',
);

const _cashback = LedgerEntryDto(
  id: 't1',
  type: 'PICKUP_CASHBACK',
  direction: 'CREDIT',
  amountPaise: '48000',
  amountRupees: '₹480.00',
  balanceAfterRupees: '₹480.00',
  note: 'Pickup #42',
  createdAt: '2026-07-10T09:00:00.000Z',
);

void main() {
  testWidgets('shows the balance, the ledger, and a withdraw action', (tester) async {
    await tester.pumpWidget(_harness(_FakeWalletRepo(balance: _wallet, transactions: [_cashback])));
    await tester.pumpAndSettle();

    expect(find.text('₹480.00'), findsWidgets); // balance + the entry's amount
    expect(find.text('Pickup cashback'), findsOneWidget);
    expect(find.text('+₹480.00'), findsOneWidget); // a credit is shown with a plus
    expect(find.widgetWithText(OutlinedButton, 'Withdraw to bank'), findsOneWidget);
  });

  testWidgets('shows an empty state when there are no transactions', (tester) async {
    await tester.pumpWidget(_harness(_FakeWalletRepo(balance: _wallet)));
    await tester.pumpAndSettle();

    expect(find.text('No transactions yet'), findsOneWidget);
  });

  testWidgets('shows the offline state when the wallet cannot be loaded', (tester) async {
    await tester.pumpWidget(_harness(_FakeWalletRepo(fail: const ApiFailure.network())));
    await tester.pumpAndSettle();

    // The transactions section renders the typed offline error (the balance card says Unavailable).
    expect(find.textContaining("Can't reach the server"), findsWidgets);
  });
}
