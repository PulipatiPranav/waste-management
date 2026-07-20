import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_failure.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/app_button.dart';
import 'auth_controller.dart';

/// Step 1 of login: enter a phone number and request a code. Deliberately says nothing
/// about whether the number is registered — the API is a non-oracle, and so is this screen.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _phoneController = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _phoneController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _error = null;
    });

    final phone = _phoneController.text.trim();
    final failure = await ref.read(authControllerProvider.notifier).requestOtp(phone);

    if (!mounted) return;
    setState(() => _submitting = false);

    if (failure != null) {
      setState(() => _error = _messageFor(failure));
      return;
    }
    context.go('/otp?phone=${Uri.encodeComponent(phone)}');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
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
                    Text('Welcome', style: theme.textTheme.displaySmall),
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      'Sign in with your phone number to continue.',
                      style: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.outline),
                    ),
                    const SizedBox(height: AppSpacing.xl),
                    TextFormField(
                      controller: _phoneController,
                      keyboardType: TextInputType.phone,
                      autofillHints: const [AutofillHints.telephoneNumber],
                      inputFormatters: [
                        FilteringTextInputFormatter.allow(RegExp(r'[0-9+ ]')),
                        LengthLimitingTextInputFormatter(20),
                      ],
                      decoration: const InputDecoration(
                        labelText: 'Phone number',
                        hintText: '+91 98765 43210',
                        prefixIcon: Icon(Icons.phone_outlined),
                      ),
                      validator: (value) {
                        final digits = (value ?? '').replaceAll(RegExp(r'\D'), '');
                        if (digits.length < 10) return 'Enter a valid phone number';
                        return null;
                      },
                      onFieldSubmitted: (_) => _submit(),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: AppSpacing.md),
                      Text(
                        _error!,
                        style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.error),
                      ),
                    ],
                    const SizedBox(height: AppSpacing.lg),
                    AppButton(label: 'Send code', onPressed: _submit, isLoading: _submitting),
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
    UnauthorizedFailure() => 'Something went wrong. Try again.',
  };
}
