import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_failure.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/async_value_view.dart';
import '../../../core/widgets/empty_state.dart';
import '../../addresses/data/address_dtos.dart';
import '../../addresses/data/address_repository.dart';
import '../../addresses/presentation/add_address_screen.dart';
import '../data/catalog_dtos.dart';
import '../data/catalog_repository.dart';

/// Subscribe to an edition: choose frequency, billing cycle and delivery address, then confirm.
/// Pops `true` on success so the subscriptions list refetches.
class SubscribeScreen extends ConsumerStatefulWidget {
  const SubscribeScreen({required this.edition, super.key});

  final EditionDto edition;

  @override
  ConsumerState<SubscribeScreen> createState() => _SubscribeScreenState();
}

class _SubscribeScreenState extends ConsumerState<SubscribeScreen> {
  String _frequency = 'DAILY';
  String _billing = 'MONTHLY';
  String? _addressId;
  bool _submitting = false;
  String? _error;

  Future<void> _submit() async {
    if (_addressId == null) {
      setState(() => _error = 'Select a delivery address.');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });

    final (sub, failure) = await ref
        .read(catalogRepositoryProvider)
        .createSubscription(
          CreateSubscription(
            editionId: widget.edition.id,
            deliveryAddressId: _addressId!,
            frequency: _frequency,
            billingCycle: _billing,
          ),
        );

    if (!mounted) return;
    setState(() => _submitting = false);
    if (failure != null || sub == null) {
      setState(() => _error = _messageFor(failure));
      return;
    }
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final addressesValue = ref.watch(addressesProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Subscribe')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(widget.edition.newspaper.name, style: theme.textTheme.titleLarge),
                    Text(
                      '${widget.edition.city} · ${widget.edition.pricePerIssueRupees}/issue',
                      style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.outline),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.lg),
              Text('Frequency', style: theme.textTheme.titleMedium),
              const SizedBox(height: AppSpacing.sm),
              _choices(deliveryFrequencies, _frequency, (v) => setState(() => _frequency = v)),
              const SizedBox(height: AppSpacing.lg),
              Text('Billing', style: theme.textTheme.titleMedium),
              const SizedBox(height: AppSpacing.sm),
              _choices(billingCycles, _billing, (v) => setState(() => _billing = v)),
              const SizedBox(height: AppSpacing.lg),
              Text('Delivery address', style: theme.textTheme.titleMedium),
              const SizedBox(height: AppSpacing.sm),
              AsyncValueView<List<AddressDto>>(
                value: addressesValue,
                onRetry: () => ref.invalidate(addressesProvider),
                data: (addresses) {
                  if (addresses.isEmpty) {
                    return EmptyState(
                      title: 'No saved addresses',
                      message: 'Add where the paper should be delivered.',
                      icon: Icons.location_off_outlined,
                      actionLabel: 'Add address',
                      onAction: _addAddress,
                    );
                  }
                  _addressId ??= addresses
                      .firstWhere((a) => a.isDefault, orElse: () => addresses.first)
                      .id;
                  return Column(
                    children: [
                      DropdownButtonFormField<String>(
                        initialValue: _addressId,
                        isExpanded: true,
                        items: [
                          for (final a in addresses)
                            DropdownMenuItem(
                              value: a.id,
                              child: Text(a.summary, overflow: TextOverflow.ellipsis),
                            ),
                        ],
                        onChanged: (v) => setState(() => _addressId = v),
                      ),
                      Align(
                        alignment: Alignment.centerLeft,
                        child: TextButton.icon(
                          onPressed: _addAddress,
                          icon: const Icon(Icons.add),
                          label: const Text('Add a new address'),
                        ),
                      ),
                    ],
                  );
                },
              ),
              if (_error != null) ...[
                const SizedBox(height: AppSpacing.md),
                Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
              ],
              const SizedBox(height: AppSpacing.xl),
              AppButton(label: 'Confirm subscription', onPressed: _submit, isLoading: _submitting),
            ],
          ),
        ),
      ),
    );
  }

  Widget _choices(Map<String, String> options, String selected, ValueChanged<String> onSelect) {
    return Wrap(
      spacing: AppSpacing.sm,
      children: [
        for (final entry in options.entries)
          ChoiceChip(
            label: Text(entry.value),
            selected: selected == entry.key,
            onSelected: (_) => onSelect(entry.key),
          ),
      ],
    );
  }

  Future<void> _addAddress() async {
    final created = await Navigator.of(
      context,
    ).push<AddressDto>(MaterialPageRoute<AddressDto>(builder: (_) => const AddAddressScreen()));
    if (created != null) setState(() => _addressId = created.id);
  }

  String _messageFor(ApiFailure? failure) => switch (failure) {
    NetworkFailure() => "Can't reach the server.",
    TimeoutFailure() => 'The server took too long.',
    BadRequestFailure(:final message) => message,
    ServerFailure(:final message) => message,
    UnauthorizedFailure() => 'Please sign in again.',
    null => 'Could not create the subscription.',
  };
}
