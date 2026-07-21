import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_failure.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/async_value_view.dart';
import '../../../core/widgets/status_chip.dart';
import '../../addresses/data/address_dtos.dart';
import '../../addresses/data/address_repository.dart';
import '../data/catalog_dtos.dart';
import '../data/catalog_repository.dart';

/// Manage one subscription: pause/resume/cancel, and change the delivery address. Actions are
/// disabled while one is in flight, and a cancel confirms first — it is not reversible.
class ManageSubscriptionScreen extends ConsumerStatefulWidget {
  const ManageSubscriptionScreen({required this.subscription, super.key});

  final SubscriptionDto subscription;

  @override
  ConsumerState<ManageSubscriptionScreen> createState() => _ManageSubscriptionScreenState();
}

class _ManageSubscriptionScreenState extends ConsumerState<ManageSubscriptionScreen> {
  late SubscriptionDto _sub = widget.subscription;
  bool _busy = false;

  Future<void> _run(Future<ApiFailure?> Function() action, {String? newStatus}) async {
    setState(() => _busy = true);
    final failure = await action();
    if (!mounted) return;
    setState(() => _busy = false);

    if (failure != null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(_messageFor(failure))));
      return;
    }
    ref.invalidate(subscriptionsProvider);
    if (newStatus != null) setState(() => _sub = _sub.copyWith(status: newStatus));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final repo = ref.read(catalogRepositoryProvider);
    final active = _sub.status == 'ACTIVE';
    final paused = _sub.status == 'PAUSED';
    final cancelled = _sub.status == 'CANCELLED';

    return Scaffold(
      appBar: AppBar(title: const Text('Manage subscription')),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        children: [
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      deliveryFrequencies[_sub.frequency] ?? _sub.frequency,
                      style: theme.textTheme.titleLarge,
                    ),
                    StatusChip(_sub.status),
                  ],
                ),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  '${_sub.pricePerIssueRupees}/issue · ${billingCycles[_sub.billingCycle] ?? _sub.billingCycle}',
                  style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.outline),
                ),
                Text(
                  'Started ${formatDate(_sub.startDate)}',
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          if (!cancelled) ...[
            if (active)
              ListTile(
                leading: const Icon(Icons.pause_circle_outline),
                title: const Text('Pause deliveries'),
                enabled: !_busy,
                onTap: () => _run(() => repo.pause(_sub.id), newStatus: 'PAUSED'),
              ),
            if (paused)
              ListTile(
                leading: const Icon(Icons.play_circle_outline),
                title: const Text('Resume deliveries'),
                enabled: !_busy,
                onTap: () => _run(() => repo.resume(_sub.id), newStatus: 'ACTIVE'),
              ),
            ListTile(
              leading: const Icon(Icons.edit_location_alt_outlined),
              title: const Text('Change delivery address'),
              enabled: !_busy,
              onTap: _busy ? null : _changeAddress,
            ),
            ListTile(
              leading: Icon(Icons.cancel_outlined, color: theme.colorScheme.error),
              title: Text('Cancel subscription', style: TextStyle(color: theme.colorScheme.error)),
              enabled: !_busy,
              onTap: _busy ? null : _cancel,
            ),
          ],
          if (_busy)
            const Padding(
              padding: EdgeInsets.all(AppSpacing.md),
              child: Center(child: CircularProgressIndicator()),
            ),
        ],
      ),
    );
  }

  Future<void> _changeAddress() async {
    final repo = ref.read(catalogRepositoryProvider);
    final selected = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => _AddressPickerSheet(),
    );
    if (selected == null || !mounted) return;
    await _run(() => repo.changeAddress(_sub.id, selected));
    if (mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Delivery address updated.')));
    }
  }

  Future<void> _cancel() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Cancel subscription?'),
        content: const Text('Deliveries will stop. This cannot be undone.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Keep')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Cancel it')),
        ],
      ),
    );
    if (!(confirmed ?? false) || !mounted) return;
    await _run(() => ref.read(catalogRepositoryProvider).cancel(_sub.id), newStatus: 'CANCELLED');
  }

  String _messageFor(ApiFailure failure) => switch (failure) {
    NetworkFailure() => "Can't reach the server.",
    TimeoutFailure() => 'The server took too long.',
    BadRequestFailure(:final message) => message,
    ServerFailure(:final message) => message,
    UnauthorizedFailure() => 'Please sign in again.',
  };
}

/// A bottom sheet listing the customer's addresses to pick a new delivery target.
class _AddressPickerSheet extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final addressesValue = ref.watch(addressesProvider);
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: AsyncValueView<List<AddressDto>>(
          value: addressesValue,
          onRetry: () => ref.invalidate(addressesProvider),
          data: (addresses) => Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              for (final a in addresses)
                ListTile(
                  leading: const Icon(Icons.location_on_outlined),
                  title: Text(a.summary),
                  onTap: () => Navigator.of(context).pop(a.id),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
