import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_failure.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/app_button.dart';
import '../data/address_dtos.dart';
import '../data/address_repository.dart';

/// Add a delivery/pickup address. Pops the created [AddressDto] so the caller (subscribe, schedule
/// pickup) can select it immediately without a round-trip refetch.
class AddAddressScreen extends ConsumerStatefulWidget {
  const AddAddressScreen({super.key});

  @override
  ConsumerState<AddAddressScreen> createState() => _AddAddressScreenState();
}

class _AddAddressScreenState extends ConsumerState<AddAddressScreen> {
  final _formKey = GlobalKey<FormState>();
  final _label = TextEditingController();
  final _line1 = TextEditingController();
  final _line2 = TextEditingController();
  final _city = TextEditingController();
  final _state = TextEditingController();
  final _pincode = TextEditingController();
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [_label, _line1, _line2, _city, _state, _pincode]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _error = null;
    });

    final (address, failure) = await ref
        .read(addressRepositoryProvider)
        .createAddress(
          CreateAddress(
            label: _label.text.trim(),
            line1: _line1.text.trim(),
            line2: _line2.text.trim(),
            city: _city.text.trim(),
            state: _state.text.trim(),
            pincode: _pincode.text.trim(),
          ),
        );

    if (!mounted) return;
    setState(() => _submitting = false);
    if (failure != null || address == null) {
      setState(() => _error = _messageFor(failure));
      return;
    }
    ref.invalidate(addressesProvider);
    Navigator.of(context).pop(address);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Add address')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _field(_label, 'Label (Home, Office)', required: false),
                _field(_line1, 'Address line 1'),
                _field(_line2, 'Address line 2', required: false),
                _field(_city, 'City'),
                _field(_state, 'State'),
                _field(
                  _pincode,
                  'Pincode',
                  keyboard: TextInputType.number,
                  formatters: [
                    FilteringTextInputFormatter.digitsOnly,
                    LengthLimitingTextInputFormatter(6),
                  ],
                  validator: (v) => (v ?? '').trim().length != 6 ? 'Pincode is 6 digits' : null,
                ),
                if (_error != null) ...[
                  const SizedBox(height: AppSpacing.md),
                  Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                ],
                const SizedBox(height: AppSpacing.lg),
                AppButton(label: 'Save address', onPressed: _submit, isLoading: _submitting),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _field(
    TextEditingController controller,
    String label, {
    bool required = true,
    TextInputType? keyboard,
    List<TextInputFormatter>? formatters,
    String? Function(String?)? validator,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: TextFormField(
        controller: controller,
        keyboardType: keyboard,
        inputFormatters: formatters,
        decoration: InputDecoration(labelText: label),
        validator:
            validator ?? (required ? (v) => (v ?? '').trim().isEmpty ? 'Required' : null : null),
      ),
    );
  }

  String _messageFor(ApiFailure? failure) => switch (failure) {
    NetworkFailure() => "Can't reach the server.",
    TimeoutFailure() => 'The server took too long.',
    BadRequestFailure(:final message) => message,
    ServerFailure(:final message) => message,
    UnauthorizedFailure() => 'Please sign in again.',
    null => 'Could not save the address.',
  };
}
