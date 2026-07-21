import 'package:freezed_annotation/freezed_annotation.dart';

part 'wallet_dtos.freezed.dart';
part 'wallet_dtos.g.dart';

/// Money crosses the wire as STRINGS of paise (a BigInt is not safe as a JS number), plus a
/// pre-formatted rupee string for display. The app shows `*Rupees` and never does arithmetic on
/// these — the server is the one place money is added up.
@freezed
sealed class WalletDto with _$WalletDto {
  const factory WalletDto({
    required String id,
    required String balancePaise,
    required String balanceRupees,
    required String currency,
  }) = _WalletDto;

  factory WalletDto.fromJson(Map<String, dynamic> json) => _$WalletDtoFromJson(json);
}

@freezed
sealed class LedgerEntryDto with _$LedgerEntryDto {
  const factory LedgerEntryDto({
    required String id,
    required String type,
    required String direction,
    required String amountPaise,
    required String amountRupees,
    required String balanceAfterRupees,
    String? note,
    String? pickupId,
    String? withdrawalId,
    required String createdAt,
  }) = _LedgerEntryDto;

  factory LedgerEntryDto.fromJson(Map<String, dynamic> json) => _$LedgerEntryDtoFromJson(json);
}

@freezed
sealed class WithdrawalDto with _$WithdrawalDto {
  const factory WithdrawalDto({
    required String id,
    required String amountRupees,
    required String status,
    required String bankAccountLast4,
    required String bankIfsc,
    required String accountHolder,
    String? rejectionReason,
    String? paymentRef,
    required String createdAt,
  }) = _WithdrawalDto;

  factory WithdrawalDto.fromJson(Map<String, dynamic> json) => _$WithdrawalDtoFromJson(json);
}

/// The request body for a withdrawal. amountPaise is an int here (it fits — a single withdrawal
/// is nowhere near the BigInt range) even though balances are read back as strings.
class RequestWithdrawal {
  const RequestWithdrawal({
    required this.amountPaise,
    required this.bankAccountLast4,
    required this.bankIfsc,
    required this.accountHolder,
  });

  final int amountPaise;
  final String bankAccountLast4;
  final String bankIfsc;
  final String accountHolder;

  Map<String, dynamic> toJson() => {
    'amountPaise': amountPaise,
    'bankAccountLast4': bankAccountLast4,
    'bankIfsc': bankIfsc,
    'accountHolder': accountHolder,
  };
}
