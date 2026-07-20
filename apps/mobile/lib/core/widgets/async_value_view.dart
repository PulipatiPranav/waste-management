import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../network/api_failure.dart';
import 'empty_state.dart';
import 'loading_skeleton.dart';

/// Renders an [AsyncValue] with the app's standard loading / error states, so a screen
/// only has to describe the DATA case. This is how "every screen has explicit loading
/// and error states" stops being a rule people forget and becomes the default: forget
/// nothing, and you still get a skeleton and a typed error view.
///
/// The error branch understands [ApiFailure], so an offline error shows the offline
/// empty-state (with a retry) rather than a raw exception string.
class AsyncValueView<T> extends StatelessWidget {
  const AsyncValueView({
    required this.value,
    required this.data,
    this.onRetry,
    this.loading,
    super.key,
  });

  final AsyncValue<T> value;
  final Widget Function(T data) data;
  final VoidCallback? onRetry;

  /// Override the default skeleton when a screen has a more specific loading shape.
  final Widget? loading;

  @override
  Widget build(BuildContext context) {
    return value.when(
      skipLoadingOnRefresh: false,
      loading: () => loading ?? const Padding(padding: EdgeInsets.all(16), child: SkeletonList()),
      error: (error, _) => _error(error),
      data: data,
    );
  }

  Widget _error(Object error) {
    if (error is ApiFailure) {
      return error.when(
        network: () => EmptyState.offline(onAction: onRetry),
        timeout: () => EmptyState.offline(onAction: onRetry),
        unauthorized: () => const EmptyState(
          title: 'Session expired',
          message: 'Please sign in again.',
          icon: Icons.lock_outline,
        ),
        badRequest: (code, message, details) => EmptyState(
          title: 'Something needs attention',
          message: message,
          icon: Icons.error_outline,
          actionLabel: onRetry == null ? null : 'Retry',
          onAction: onRetry,
        ),
        server: (message, correlationId) => EmptyState(
          title: 'Something went wrong',
          message: message,
          icon: Icons.error_outline,
          actionLabel: onRetry == null ? null : 'Retry',
          onAction: onRetry,
        ),
      );
    }
    return EmptyState(
      title: 'Something went wrong',
      message: error.toString(),
      icon: Icons.error_outline,
      actionLabel: onRetry == null ? null : 'Retry',
      onAction: onRetry,
    );
  }
}
