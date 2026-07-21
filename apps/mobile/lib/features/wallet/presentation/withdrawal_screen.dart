import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_failure.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/app_button.dart';
import '../data/wallet_dtos.dart';
import '../data/wallet_repository.dart';

/// Request a payout to a bank account. On success it pops `true` so the wallet screen refetches —
/// the money left the wallet the instant this succeeded (the API debits at request time), so the
/// balance the caller was showing is now stale.
class WithdrawalScreen extends ConsumerStatefulWidget {
  const WithdrawalScreen({this.currentBalance, super.key});

  final String? currentBalance;

  @override
  ConsumerState<WithdrawalScreen> createState() => _WithdrawalScreenState();
}

class _WithdrawalScreenState extends ConsumerState<WithdrawalScreen> {
  final _formKey = GlobalKey<FormState>();
  final _amount = TextEditingController();
  final _accountNumber = TextEditingController();
  final _ifsc = TextEditingController();
  final _holder = TextEditingController();
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _amount.dispose();
    _accountNumber.dispose();
    _ifsc.dispose();
    _holder.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _error = null;
    });

    final account = _accountNumber.text.trim();
    final request = RequestWithdrawal(
      amountPaise: _paise(_amount.text.trim()),
      bankAccountLast4: account.substring(account.length - 4),
      bankIfsc: _ifsc.text.trim().toUpperCase(),
      accountHolder: _holder.text.trim(),
    );

    final (withdrawal, failure) = await ref
        .read(walletRepositoryProvider)
        .requestWithdrawal(request);

    if (!mounted) return;
    setState(() => _submitting = false);
    if (failure != null || withdrawal == null) {
      setState(() => _error = _messageFor(failure));
      return;
    }
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Withdraw')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (widget.currentBalance != null)
                  Text(
                    'Available: ${widget.currentBalance}',
                    style: Theme.of(context).textTheme.bodyLarge,
                  ),
                const SizedBox(height: AppSpacing.md),
                TextFormField(
                  controller: _amount,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
                  decoration: const InputDecoration(labelText: 'Amount (₹)', prefixText: '₹ '),
                  validator: (v) {
                    final paise = _paise((v ?? '').trim());
                    if (paise <= 0) return 'Enter an amount';
                    return null;
                  },
                ),
                const SizedBox(height: AppSpacing.md),
                TextFormField(
                  controller: _holder,
                  textCapitalization: TextCapitalization.words,
                  decoration: const InputDecoration(labelText: 'Account holder name'),
                  validator: (v) => (v ?? '').trim().isEmpty ? 'Required' : null,
                ),
                const SizedBox(height: AppSpacing.md),
                TextFormField(
                  controller: _accountNumber,
                  keyboardType: TextInputType.number,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: const InputDecoration(labelText: 'Bank account number'),
                  validator: (v) =>
                      (v ?? '').trim().length < 4 ? 'Enter a valid account number' : null,
                ),
                const SizedBox(height: AppSpacing.md),
                TextFormField(
                  controller: _ifsc,
                  textCapitalization: TextCapitalization.characters,
                  inputFormatters: [
                    FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9]')),
                    LengthLimitingTextInputFormatter(11),
                  ],
                  decoration: const InputDecoration(labelText: 'IFSC code'),
                  validator: (v) => (v ?? '').trim().length != 11 ? 'IFSC is 11 characters' : null,
                ),
                if (_error != null) ...[
                  const SizedBox(height: AppSpacing.md),
                  Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                ],
                const SizedBox(height: AppSpacing.lg),
                AppButton(label: 'Request withdrawal', onPressed: _submit, isLoading: _submitting),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  'The amount leaves your wallet immediately and is paid out after review. '
                  'A rejected request is refunded in full.',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// Rupee string -> integer paise, without floats. "123.4" -> 12340.
  int _paise(String rupees) {
    if (rupees.isEmpty) return 0;
    final parts = rupees.split('.');
    final whole = int.tryParse(parts[0].isEmpty ? '0' : parts[0]) ?? 0;
    final frac = parts.length > 1
        ? int.tryParse(parts[1].padRight(2, '0').substring(0, 2)) ?? 0
        : 0;
    return whole * 100 + frac;
  }

  String _messageFor(ApiFailure? failure) => switch (failure) {
    NetworkFailure() => "Can't reach the server. Check your connection.",
    TimeoutFailure() => 'The server took too long. Try again.',
    BadRequestFailure(:final message) => message,
    ServerFailure(:final message) => message,
    UnauthorizedFailure() => 'Please sign in again.',
    null => 'Could not request the withdrawal.',
  };
}
