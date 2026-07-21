import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_button.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/async_value_view.dart';
import '../../../core/widgets/status_chip.dart';
import '../data/pickup_dtos.dart';
import '../data/pickup_repository.dart';

/// A pickup's detail. The centrepiece for an upcoming pickup is the QR CODE — the delivery partner
/// scans it at the door to open this exact pickup for weighing, so it must be big, high-contrast,
/// and shown against a white card regardless of theme (a dark-mode QR on a dark background does not
/// scan).
class PickupDetailScreen extends ConsumerWidget {
  const PickupDetailScreen({required this.pickupId, super.key});

  final String pickupId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pickupValue = ref.watch(pickupProvider(pickupId));

    return Scaffold(
      appBar: AppBar(title: const Text('Pickup')),
      body: AsyncValueView<PickupDto>(
        value: pickupValue,
        onRetry: () => ref.invalidate(pickupProvider(pickupId)),
        data: (pickup) => ListView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  formatDate(pickup.scheduledDate),
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                StatusChip(pickup.status),
              ],
            ),
            Text(
              '${pickup.windowStartHour}:00 – ${pickup.windowEndHour}:00',
              style: Theme.of(
                context,
              ).textTheme.bodyLarge?.copyWith(color: Theme.of(context).colorScheme.outline),
            ),
            const SizedBox(height: AppSpacing.lg),

            // The scan code — only while the pickup is still upcoming and has a token.
            if (pickup.qrToken != null &&
                (pickup.status == 'REQUESTED' || pickup.status == 'ASSIGNED'))
              _QrCard(token: pickup.qrToken!),

            if (pickup.status == 'COMPLETED') _CompletedSummary(pickup: pickup),

            if (pickup.status == 'REQUESTED') ...[
              const SizedBox(height: AppSpacing.lg),
              AppButton(
                label: 'Cancel pickup',
                variant: AppButtonVariant.secondary,
                onPressed: () => _cancel(context, ref),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _cancel(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Cancel this pickup?'),
        content: const Text('You can schedule a new one any time.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Keep')),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Cancel pickup'),
          ),
        ],
      ),
    );
    if (!(confirmed ?? false)) return;
    if (!context.mounted) return;

    final failure = await ref.read(pickupRepositoryProvider).cancelPickup(pickupId);
    if (!context.mounted) return;
    if (failure == null) {
      ref
        ..invalidate(pickupProvider(pickupId))
        ..invalidate(pickupsProvider);
    } else {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Could not cancel.')));
    }
  }
}

class _QrCard extends StatelessWidget {
  const _QrCard({required this.token});
  final String token;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Container(
          padding: const EdgeInsets.all(AppSpacing.lg),
          decoration: BoxDecoration(
            color: Colors.white, // fixed white so the code scans in any theme
            borderRadius: BorderRadius.circular(AppRadii.lg),
          ),
          child: QrImageView(
            data: token,
            size: 220,
            backgroundColor: Colors.white,
            // Pinned black-on-white for scannability, via the current eye/module style API.
            eyeStyle: const QrEyeStyle(eyeShape: QrEyeShape.square, color: Colors.black),
            dataModuleStyle: const QrDataModuleStyle(
              dataModuleShape: QrDataModuleShape.square,
              color: Colors.black,
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        Text(
          'Show this to the delivery partner to scan at pickup.',
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodyMedium,
        ),
      ],
    );
  }
}

class _CompletedSummary extends StatelessWidget {
  const _CompletedSummary({required this.pickup});
  final PickupDto pickup;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Collected', style: theme.textTheme.titleMedium),
          const SizedBox(height: AppSpacing.sm),
          for (final item in pickup.items)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('${_paper(item.paperType)} · ${item.weightKg} kg'),
                  Text(item.amountRupees),
                ],
              ),
            ),
          const Divider(),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Cashback', style: theme.textTheme.titleMedium),
              Text(pickup.totalRupees, style: theme.textTheme.titleMedium),
            ],
          ),
        ],
      ),
    );
  }

  String _paper(String type) => switch (type) {
    'NEWSPAPER' => 'Newspaper',
    'MAGAZINE' => 'Magazine',
    'OFFICE_PAPER' => 'Office paper',
    'CARDBOARD' => 'Cardboard',
    _ => 'Other',
  };
}
