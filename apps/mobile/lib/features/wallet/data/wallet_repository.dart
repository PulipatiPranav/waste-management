import 'dart:convert';

import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/network/api_failure.dart';
import '../../../core/network/rest_client.dart';
import 'wallet_dtos.dart';

part 'wallet_repository.g.dart';

/// The wallet is ALWAYS LIVE — never served from the offline cache. A stale balance is worse
/// than a spinner: a customer who is shown ₹500 that is really ₹0 files a complaint, and the
/// whole ledger-reconciliation design on the server exists precisely because the number must be
/// exact. So every read here hits the network; there is no `LocalCache` in this repository by
/// design, and that omission is the decision, not an oversight.
abstract interface class WalletRepository {
  Future<(WalletDto?, ApiFailure?)> fetchBalance();
  Future<(List<LedgerEntryDto>?, ApiFailure?)> fetchTransactions();
  Future<(List<WithdrawalDto>?, ApiFailure?)> fetchWithdrawals();
  Future<(WithdrawalDto?, ApiFailure?)> requestWithdrawal(RequestWithdrawal request);
}

class WalletRepositoryImpl implements WalletRepository {
  WalletRepositoryImpl(this._client);
  final RestClient _client;

  @override
  Future<(WalletDto?, ApiFailure?)> fetchBalance() =>
      _client.getObject('/wallet', WalletDto.fromJson);

  @override
  Future<(List<LedgerEntryDto>?, ApiFailure?)> fetchTransactions() =>
      _client.getList('/wallet/transactions', LedgerEntryDto.fromJson);

  @override
  Future<(List<WithdrawalDto>?, ApiFailure?)> fetchWithdrawals() =>
      _client.getList('/wallet/withdrawals', WithdrawalDto.fromJson);

  @override
  Future<(WithdrawalDto?, ApiFailure?)> requestWithdrawal(RequestWithdrawal request) {
    // Idempotency-Key REQUIRED by the API on this money-moving endpoint. A UUID-ish key from
    // the request contents + time is enough to collapse an accidental double-tap.
    final key = base64Url.encode(
      utf8.encode('${request.toJson()}-${DateTime.now().toIso8601String()}'),
    );
    return _client.send(
      '/wallet/withdrawals',
      WithdrawalDto.fromJson,
      body: request.toJson(),
      headers: {'Idempotency-Key': key},
    );
  }
}

@riverpod
WalletRepository walletRepository(Ref ref) => WalletRepositoryImpl(ref.watch(restClientProvider));
