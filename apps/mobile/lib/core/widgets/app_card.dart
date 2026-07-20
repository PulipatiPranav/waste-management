import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// A padded surface. The default container for grouped content (a wallet summary, a
/// delivery row). Uses the card theme, so its border, radius and elevation are the
/// same everywhere without each caller restating them.
class AppCard extends StatelessWidget {
  const AppCard({required this.child, this.onTap, this.padding, super.key});

  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry? padding;

  @override
  Widget build(BuildContext context) {
    final content = Padding(padding: padding ?? const EdgeInsets.all(AppSpacing.md), child: child);

    return Card(
      clipBehavior: Clip.antiAlias,
      child: onTap == null ? content : InkWell(onTap: onTap, child: content),
    );
  }
}
