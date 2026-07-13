import 'package:flutter/material.dart';

/// Design tokens and themes.
///
/// Phase 11 builds the real design system on top of this (typography scale, spacing
/// tokens, the shared widget library). It exists now so early screens do not each
/// invent their own button padding — that is the drift that later phases cannot
/// afford to unwind.
abstract final class AppSpacing {
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 16;
  static const double lg = 24;
  static const double xl = 32;
}

abstract final class AppColors {
  /// Recycled-paper green. The brand palette is not settled; this is a placeholder
  /// seed, not a decision.
  static const seed = Color(0xFF1F7A4D);
}

abstract final class AppTheme {
  static ThemeData light() => _build(Brightness.light);
  static ThemeData dark() => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    final scheme = ColorScheme.fromSeed(seedColor: AppColors.seed, brightness: brightness);

    return ThemeData(
      colorScheme: scheme,
      useMaterial3: true,
      appBarTheme: const AppBarTheme(centerTitle: false),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          // 48dp is the accessible minimum tap target. Delivery partners tap these
          // one-handed, in the rain, wearing gloves.
          minimumSize: const Size.fromHeight(48),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      ),
    );
  }
}
