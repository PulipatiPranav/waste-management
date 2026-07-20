import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/app_card.dart';
import '../../auth/domain/auth_state.dart';
import '../../auth/presentation/auth_controller.dart';

/// The delivery-partner landing. Same app, different shell — the role guard in the router
/// keeps customers out of here. Its own feature screens (today's route, offline pickup
/// completion) arrive in Phase 13; this is the frame they hang on.
class PartnerHomeScreen extends ConsumerWidget {
  const PartnerHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).userOrNull;
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Partner'),
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
          Text('Delivery partner', style: theme.textTheme.headlineMedium),
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
                Text("Today's route and pickups"),
                SizedBox(height: AppSpacing.xs),
                Text(
                  'The route, delivery proof and offline pickup completion arrive in a later phase.',
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
