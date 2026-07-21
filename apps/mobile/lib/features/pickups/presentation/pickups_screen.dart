import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/async_value_view.dart';
import '../../../core/widgets/empty_state.dart';
import '../../../core/widgets/status_chip.dart';
import '../data/pickup_dtos.dart';
import '../data/pickup_repository.dart';
import 'pickup_detail_screen.dart';
import 'schedule_pickup_screen.dart';

class PickupsScreen extends ConsumerWidget {
  const PickupsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pickupsValue = ref.watch(pickupsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Pickups')),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'pickups-fab', // unique across the shell's simultaneously-built tabs
        onPressed: () => _schedule(context, ref),
        icon: const Icon(Icons.add),
        label: const Text('Schedule'),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(pickupsProvider);
          await ref.read(pickupsProvider.future);
        },
        child: AsyncValueView<List<PickupDto>>(
          value: pickupsValue,
          onRetry: () => ref.invalidate(pickupsProvider),
          data: (pickups) {
            if (pickups.isEmpty) {
              return ListView(
                children: [
                  const SizedBox(height: 80),
                  EmptyState(
                    title: 'No pickups yet',
                    message: 'Schedule a pickup and keep your recyclable paper ready.',
                    icon: Icons.local_shipping_outlined,
                    actionLabel: 'Schedule a pickup',
                    onAction: () => _schedule(context, ref),
                  ),
                ],
              );
            }
            return ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.md),
              itemCount: pickups.length,
              separatorBuilder: (_, _) => const SizedBox(height: AppSpacing.sm),
              itemBuilder: (context, i) => _PickupCard(pickups[i]),
            );
          },
        ),
      ),
    );
  }

  Future<void> _schedule(BuildContext context, WidgetRef ref) async {
    final scheduled = await Navigator.of(
      context,
    ).push<bool>(MaterialPageRoute(builder: (_) => const SchedulePickupScreen()));
    if (scheduled ?? false) ref.invalidate(pickupsProvider);
  }
}

class _PickupCard extends StatelessWidget {
  const _PickupCard(this.pickup);
  final PickupDto pickup;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final completed = pickup.status == 'COMPLETED';

    return AppCard(
      onTap: () => Navigator.of(context).push<void>(
        MaterialPageRoute<void>(builder: (_) => PickupDetailScreen(pickupId: pickup.id)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(formatDate(pickup.scheduledDate), style: theme.textTheme.titleMedium),
                const SizedBox(height: 2),
                Text(
                  '${pickup.windowStartHour}:00 – ${pickup.windowEndHour}:00',
                  style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.outline),
                ),
                if (completed) ...[
                  const SizedBox(height: AppSpacing.xs),
                  Text('Earned ${pickup.totalRupees}', style: theme.textTheme.bodyMedium),
                ],
              ],
            ),
          ),
          StatusChip(pickup.status),
        ],
      ),
    );
  }
}
