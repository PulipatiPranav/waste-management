import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import 'app_button.dart';

/// The empty / error placeholder. One widget for "nothing here yet", "couldn't load",
/// and "you're offline", so those states look considered rather than like a blank
/// screen a developer forgot to fill in. Phase 12's rule — every screen has explicit
/// empty and error states — is built on this being trivial to drop in.
class EmptyState extends StatelessWidget {
  const EmptyState({
    required this.title,
    this.message,
    this.icon = Icons.inbox_outlined,
    this.actionLabel,
    this.onAction,
    super.key,
  });

  /// A network-failure variant, so offline states read consistently across the app.
  const EmptyState.offline({this.onAction, this.actionLabel = 'Retry', super.key})
    : title = "Can't reach the server",
      message = 'Check your connection and try again.',
      icon = Icons.wifi_off_rounded;

  final String title;
  final String? message;
  final IconData icon;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 56, color: theme.colorScheme.outline),
            const SizedBox(height: AppSpacing.md),
            Text(title, style: theme.textTheme.titleMedium, textAlign: TextAlign.center),
            if (message != null) ...[
              const SizedBox(height: AppSpacing.xs),
              Text(
                message!,
                style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.outline),
                textAlign: TextAlign.center,
              ),
            ],
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: AppSpacing.lg),
              AppButton(
                label: actionLabel!,
                onPressed: onAction,
                variant: AppButtonVariant.secondary,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
