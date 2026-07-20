import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/app_card.dart';
import '../../auth/domain/auth_state.dart';
import '../../auth/presentation/auth_controller.dart';

/// The authenticated customer landing. A deliberately thin shell for Phase 11 — the real
/// feature screens (subscriptions, wallet, pickups) land in Phase 12 and slot in here. It
/// proves the whole chain works end to end: a signed-in user, their profile, and sign-out.
class CustomerHomeScreen extends ConsumerWidget {
  const CustomerHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).userOrNull;
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Circular Paper'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Sign out',
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(AppSpacing.md),
        children: [
          Text(
            'Hello${user?.name != null ? ', ${user!.name}' : ''}',
            style: theme.textTheme.headlineMedium,
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            user?.phone ?? '',
            style: theme.textTheme.bodyLarge?.copyWith(color: theme.colorScheme.outline),
          ),
          const SizedBox(height: AppSpacing.lg),
          const AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Your subscriptions, wallet and pickups'),
                SizedBox(height: AppSpacing.xs),
                Text(
                  'These screens arrive in the next phase and slot in here.',
                  style: TextStyle(color: Colors.grey),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
