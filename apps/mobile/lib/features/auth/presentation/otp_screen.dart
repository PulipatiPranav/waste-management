import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_failure.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/app_button.dart';
import 'auth_controller.dart';

/// Step 2 of login: enter the code. On success the auth state flips to authenticated and the
/// router's redirect takes the user to their role's home — this screen does NOT navigate
/// itself, so there is exactly one place (the redirect) that decides where an authed user goes.
class OtpScreen extends ConsumerStatefulWidget {
  const OtpScreen({required this.phone, super.key});

  final String phone;

  @override
  ConsumerState<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends ConsumerState<OtpScreen> {
  final _codeController = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
  }

  Future<void> _verify() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _error = null;
    });

    final failure = await ref
        .read(authControllerProvider.notifier)
        .verifyOtp(phone: widget.phone, code: _codeController.text.trim());

    if (!mounted) return;
    setState(() => _submitting = false);
    // On success we deliberately do nothing: the auth state changed, and the router redirect
    // moves us. Only a failure needs handling here.
    if (failure != null) {
      setState(() => _error = _messageFor(failure));
    }
  }

  Future<void> _resend() async {
    final failure = await ref.read(authControllerProvider.notifier).requestOtp(widget.phone);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(failure == null ? 'Code sent again.' : 'Could not resend the code.')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(leading: BackButton(onPressed: () => context.go('/login'))),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('Enter code', style: theme.textTheme.headlineMedium),
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      'We sent a code to ${widget.phone}.',
                      style: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.outline),
                    ),
                    const SizedBox(height: AppSpacing.xl),
                    TextFormField(
                      controller: _codeController,
                      keyboardType: TextInputType.number,
                      autofocus: true,
                      textAlign: TextAlign.center,
                      style: theme.textTheme.headlineMedium?.copyWith(letterSpacing: 8),
                      inputFormatters: [
                        FilteringTextInputFormatter.digitsOnly,
                        LengthLimitingTextInputFormatter(8),
                      ],
                      decoration: const InputDecoration(counterText: ''),
                      validator: (value) {
                        final code = (value ?? '').trim();
                        if (code.length < 4) return 'Enter the code from your SMS';
                        return null;
                      },
                      onFieldSubmitted: (_) => _verify(),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: AppSpacing.md),
                      Text(
                        _error!,
                        style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.error),
                      ),
                    ],
                    const SizedBox(height: AppSpacing.lg),
                    AppButton(label: 'Verify', onPressed: _verify, isLoading: _submitting),
                    const SizedBox(height: AppSpacing.sm),
                    TextButton(
                      onPressed: _submitting ? null : _resend,
                      child: const Text('Resend code'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  String _messageFor(ApiFailure failure) => switch (failure) {
    NetworkFailure() => "Can't reach the server. Check your connection.",
    TimeoutFailure() => 'The server took too long. Try again.',
    BadRequestFailure(:final message) => message,
    ServerFailure(:final message) => message,
    UnauthorizedFailure() => 'That code is not valid. Try again.',
  };
}
