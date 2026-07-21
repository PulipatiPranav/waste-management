import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/async_value_view.dart';
import '../../../core/widgets/empty_state.dart';
import '../../../core/widgets/status_chip.dart';
import '../data/marketplace_dtos.dart';
import '../data/marketplace_repository.dart';

class OrdersScreen extends ConsumerWidget {
  const OrdersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ordersValue = ref.watch(ordersProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('My orders')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(ordersProvider);
          await ref.read(ordersProvider.future);
        },
        child: AsyncValueView<List<OrderDto>>(
          value: ordersValue,
          onRetry: () => ref.invalidate(ordersProvider),
          data: (orders) => orders.isEmpty
              ? const EmptyState(
                  title: 'No orders yet',
                  message: 'Your marketplace orders will show up here.',
                  icon: Icons.receipt_long_outlined,
                )
              : ListView.separated(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  itemCount: orders.length,
                  separatorBuilder: (_, _) => const SizedBox(height: AppSpacing.sm),
                  itemBuilder: (context, i) => _OrderCard(orders[i]),
                ),
        ),
      ),
    );
  }
}

class _OrderCard extends StatelessWidget {
  const _OrderCard(this.order);
  final OrderDto order;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final itemCount = order.items.fold<int>(0, (sum, i) => sum + i.quantity);

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(order.totalRupees, style: theme.textTheme.titleMedium),
              StatusChip(order.status),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            '$itemCount item${itemCount == 1 ? '' : 's'} · ${formatDate(order.createdAt)}',
            style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.outline),
          ),
          for (final item in order.items)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                '${item.quantity}× ${item.productName} (${item.variantName})',
                style: theme.textTheme.bodySmall,
              ),
            ),
          if (order.failureReason != null) ...[
            const SizedBox(height: AppSpacing.xs),
            Text(
              order.failureReason!,
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error),
            ),
          ],
        ],
      ),
    );
  }
}
