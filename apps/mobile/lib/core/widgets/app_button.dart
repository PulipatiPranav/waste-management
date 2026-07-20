import 'package:flutter/material.dart';

/// The app's one button. Every tappable primary/secondary action goes through here so
/// padding, height, radius and the loading state are identical everywhere — the whole
/// point of a design system is that a screen never reaches for a raw `FilledButton`.
///
/// The loading state is built in because it is the one everyone forgets: a button that
/// stays tappable while its request is in flight is how a customer double-submits a
/// withdrawal. When [isLoading] is true the button is disabled and shows a spinner.
enum AppButtonVariant { primary, secondary }

class AppButton extends StatelessWidget {
  const AppButton({
    required this.label,
    required this.onPressed,
    this.variant = AppButtonVariant.primary,
    this.isLoading = false,
    this.icon,
    super.key,
  });

  final String label;

  /// Null disables the button. A disabled button reads as "not yet", not "broken".
  final VoidCallback? onPressed;
  final AppButtonVariant variant;
  final bool isLoading;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final effectiveOnPressed = isLoading ? null : onPressed;
    final child = isLoading
        ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2.5))
        : _content(context);

    return switch (variant) {
      AppButtonVariant.primary => FilledButton(onPressed: effectiveOnPressed, child: child),
      AppButtonVariant.secondary => OutlinedButton(onPressed: effectiveOnPressed, child: child),
    };
  }

  Widget _content(BuildContext context) {
    if (icon == null) return Text(label);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [Icon(icon, size: 20), const SizedBox(width: 8), Text(label)],
    );
  }
}
