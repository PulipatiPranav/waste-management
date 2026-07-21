import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_failure.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/async_value_view.dart';
import '../../../core/widgets/empty_state.dart';
import '../../addresses/data/address_dtos.dart';
import '../../addresses/data/address_repository.dart';
import '../../addresses/presentation/add_address_screen.dart';
import '../data/pickup_dtos.dart';
import '../data/pickup_repository.dart';

/// Schedule a pickup: pick an address, a date, and a time window. Pops `true` on success so the
/// history refetches.
class SchedulePickupScreen extends ConsumerStatefulWidget {
  const SchedulePickupScreen({super.key});

  @override
  ConsumerState<SchedulePickupScreen> createState() => _SchedulePickupScreenState();
}

class _SchedulePickupScreenState extends ConsumerState<SchedulePickupScreen> {
  String? _addressId;
  DateTime _date = DateTime.now().add(const Duration(days: 1));
  int _startHour = 9;
  int _endHour = 12;
  bool _submitting = false;
  String? _error;

  Future<void> _submit() async {
    if (_addressId == null) {
      setState(() => _error = 'Select a pickup address.');
      return;
    }
    if (_endHour <= _startHour) {
      setState(() => _error = 'The end time must be after the start time.');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });

    final iso =
        '${_date.year.toString().padLeft(4, '0')}-${_date.month.toString().padLeft(2, '0')}-${_date.day.toString().padLeft(2, '0')}';
    final (pickup, failure) = await ref
        .read(pickupRepositoryProvider)
        .requestPickup(
          RequestPickup(
            addressId: _addressId!,
            scheduledDate: iso,
            windowStartHour: _startHour,
            windowEndHour: _endHour,
          ),
        );

    if (!mounted) return;
    setState(() => _submitting = false);
    if (failure != null || pickup == null) {
      setState(() => _error = _messageFor(failure));
      return;
    }
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final addressesValue = ref.watch(addressesProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Schedule pickup')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Pickup address', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: AppSpacing.sm),
              AsyncValueView<List<AddressDto>>(
                value: addressesValue,
                onRetry: () => ref.invalidate(addressesProvider),
                data: (addresses) {
                  if (addresses.isEmpty) {
                    return EmptyState(
                      title: 'No saved addresses',
                      message: 'Add an address to schedule a pickup there.',
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
              const SizedBox(height: AppSpacing.lg),
              Text('Date', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: AppSpacing.sm),
              ListTile(
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppRadii.md),
                  side: BorderSide(color: Theme.of(context).colorScheme.outlineVariant),
                ),
                leading: const Icon(Icons.calendar_today_outlined),
                title: Text(formatDate(_date.toIso8601String())),
                trailing: const Icon(Icons.chevron_right),
                onTap: _pickDate,
              ),
              const SizedBox(height: AppSpacing.lg),
              Text('Time window', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: AppSpacing.sm),
              Row(
                children: [
                  Expanded(
                    child: _hourDropdown('From', _startHour, (v) => setState(() => _startHour = v)),
                  ),
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: _hourDropdown('To', _endHour, (v) => setState(() => _endHour = v)),
                  ),
                ],
              ),
              if (_error != null) ...[
                const SizedBox(height: AppSpacing.md),
                Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ],
              const SizedBox(height: AppSpacing.xl),
              AppButton(label: 'Schedule pickup', onPressed: _submit, isLoading: _submitting),
            ],
          ),
        ),
      ),
    );
  }

  Widget _hourDropdown(String label, int value, ValueChanged<int> onChanged) {
    return DropdownButtonFormField<int>(
      initialValue: value,
      decoration: InputDecoration(labelText: label),
      items: [for (var h = 6; h <= 21; h++) DropdownMenuItem(value: h, child: Text('$h:00'))],
      onChanged: (v) => v == null ? null : onChanged(v),
    );
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: now.add(const Duration(days: 1)),
      lastDate: now.add(const Duration(days: 30)),
    );
    if (picked != null) setState(() => _date = picked);
  }

  Future<void> _addAddress() async {
    final created = await Navigator.of(
      context,
    ).push<AddressDto>(MaterialPageRoute(builder: (_) => const AddAddressScreen()));
    if (created != null) setState(() => _addressId = created.id);
  }

  String _messageFor(ApiFailure? failure) => switch (failure) {
    NetworkFailure() => "Can't reach the server.",
    TimeoutFailure() => 'The server took too long.',
    BadRequestFailure(:final message) => message,
    ServerFailure(:final message) => message,
    UnauthorizedFailure() => 'Please sign in again.',
    null => 'Could not schedule the pickup.',
  };
}
