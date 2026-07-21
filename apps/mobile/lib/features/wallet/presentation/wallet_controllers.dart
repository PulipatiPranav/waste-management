import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../data/wallet_dtos.dart';
import '../data/wallet_repository.dart';

part 'wallet_controllers.g.dart';

/// Read providers throw the [ApiFailure] on error so the widget's `AsyncValue` carries it into
/// `AsyncValueView`, which renders the right typed state (offline, etc.).
@riverpod
Future<WalletDto> walletBalance(Ref ref) async {
  final (wallet, failure) = await ref.watch(walletRepositoryProvider).fetchBalance();
  if (failure != null) throw failure;
  return wallet!;
}

@riverpod
Future<List<LedgerEntryDto>> walletTransactions(Ref ref) async {
  final (txns, failure) = await ref.watch(walletRepositoryProvider).fetchTransactions();
  if (failure != null) throw failure;
  return txns!;
}

@riverpod
Future<List<WithdrawalDto>> walletWithdrawals(Ref ref) async {
  final (withdrawals, failure) = await ref.watch(walletRepositoryProvider).fetchWithdrawals();
  if (failure != null) throw failure;
  return withdrawals!;
}
