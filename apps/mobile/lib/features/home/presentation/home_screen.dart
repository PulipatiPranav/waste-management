import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_failure.dart';
import '../../../core/theme/app_theme.dart';
import 'home_controller.dart';

/// Phase 0 placeholder. It exists to prove the stack end to end — Riverpod ->
/// repository -> Dio -> the API's /health/live — and to set the precedent that every
/// screen handles loading, error and data explicitly. Phase 12 replaces it.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(homeControllerProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Circular Paper Economy')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: switch (status) {
            AsyncLoading() => const CircularProgressIndicator(),
            AsyncError(:final error) => _ErrorView(
              error: error,
              onRetry: () => ref.read(homeControllerProvider.notifier).refresh(),
            ),
            AsyncData(:final value) => Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  value.isHealthy ? Icons.check_circle_outline : Icons.error_outline,
                  size: 48,
                  color: Theme.of(context).colorScheme.primary,
                ),
                const SizedBox(height: AppSpacing.md),
                Text('API reachable', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  'Environment: ${value.environment}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          },
        ),
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.cloud_off, size: 48),
        const SizedBox(height: AppSpacing.md),
        Text(_message(error), textAlign: TextAlign.center),
        const SizedBox(height: AppSpacing.lg),
        FilledButton(onPressed: onRetry, child: const Text('Retry')),
      ],
    );
  }

  /// Exhaustive over the failure union — adding a case to [ApiFailure] makes this a
  /// compile error rather than a silently unhandled state.
  String _message(Object error) {
    if (error is! ApiFailure) return 'Something went wrong.';

    return switch (error) {
      NetworkFailure() => "Can't reach the server.\nCheck your connection and try again.",
      TimeoutFailure() => 'The server took too long to respond.',
      UnauthorizedFailure() => 'Your session has expired. Please sign in again.',
      BadRequestFailure(:final message) => message,
      ServerFailure() => 'Something went wrong on our side.\nWe are looking into it.',
    };
  }
}
