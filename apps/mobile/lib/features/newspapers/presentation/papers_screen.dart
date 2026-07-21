import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/async_value_view.dart';
import '../../../core/widgets/empty_state.dart';
import '../../../core/widgets/status_chip.dart';
import '../../auth/presentation/auth_controller.dart';
import '../data/catalog_dtos.dart';
import '../data/catalog_repository.dart';
import 'browse_newspapers_screen.dart';
import 'manage_subscription_screen.dart';

/// The home tab: the customer's subscriptions, and the way in to browse and subscribe to more.
class PapersScreen extends ConsumerWidget {
  const PapersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final subs = ref.watch(subscriptionsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('My papers'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Sign out',
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        // Unique tag: several tabs in the shell's IndexedStack each have a FAB, and they would
        // otherwise share the default hero tag and clash.
        heroTag: 'papers-fab',
        onPressed: () => _browse(context, ref),
        icon: const Icon(Icons.add),
        label: const Text('Subscribe'),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(subscriptionsProvider);
          await ref.read(subscriptionsProvider.future);
        },
        child: AsyncValueView<List<SubscriptionDto>>(
          value: subs,
          onRetry: () => ref.invalidate(subscriptionsProvider),
          data: (list) {
            if (list.isEmpty) {
              return ListView(
                children: [
                  const SizedBox(height: 80),
                  EmptyState(
                    title: 'No subscriptions yet',
                    message: 'Subscribe to a newspaper and it will be delivered to your door.',
                    icon: Icons.newspaper_outlined,
                    actionLabel: 'Browse newspapers',
                    onAction: () => _browse(context, ref),
                  ),
                ],
              );
            }
            return ListView.separated(
              padding: const EdgeInsets.all(AppSpacing.md),
              itemCount: list.length,
              separatorBuilder: (_, _) => const SizedBox(height: AppSpacing.sm),
              itemBuilder: (context, i) => _SubscriptionCard(list[i]),
            );
          },
        ),
      ),
    );
  }

  Future<void> _browse(BuildContext context, WidgetRef ref) async {
    await Navigator.of(
      context,
    ).push<void>(MaterialPageRoute<void>(builder: (_) => const BrowseNewspapersScreen()));
    ref.invalidate(subscriptionsProvider);
  }
}

class _SubscriptionCard extends StatelessWidget {
  const _SubscriptionCard(this.sub);
  final SubscriptionDto sub;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return AppCard(
      onTap: () => Navigator.of(context).push<void>(
        MaterialPageRoute<void>(builder: (_) => ManageSubscriptionScreen(subscription: sub)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  deliveryFrequencies[sub.frequency] ?? sub.frequency,
                  style: theme.textTheme.titleMedium,
                ),
                const SizedBox(height: 2),
                Text(
                  '${sub.pricePerIssueRupees}/issue · ${billingCycles[sub.billingCycle] ?? sub.billingCycle}',
                  style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.outline),
                ),
                Text(
                  'Since ${formatDate(sub.startDate)}',
                  style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline),
                ),
              ],
            ),
          ),
          StatusChip(sub.status),
        ],
      ),
    );
  }
}
