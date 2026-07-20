import 'package:flutter/material.dart';

/// Design tokens and themes — the single source of visual truth.
///
/// Every screen from Phase 12 onward pulls spacing, radii, type and colour from HERE.
/// The rule is deliberate: a shared token set built before the feature screens is what
/// keeps them consistent, instead of each screen inventing its own button padding and
/// the app slowly turning into twelve slightly different apps.
abstract final class AppSpacing {
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 16;
  static const double lg = 24;
  static const double xl = 32;
  static const double xxl = 48;
}

abstract final class AppRadii {
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 20;
}

abstract final class AppColors {
  /// Recycled-paper green. The brand palette is not settled; this is a placeholder
  /// seed, not a decision.
  static const seed = Color(0xFF1F7A4D);
}

/// The type scale. Named by role, not size, so a screen asks for "the title style"
/// and the scale — not the screen — owns what that means.
abstract final class AppTypography {
  static TextTheme textTheme(TextTheme base) {
    return base.copyWith(
      displaySmall: base.displaySmall?.copyWith(fontWeight: FontWeight.w700, letterSpacing: -0.5),
      headlineMedium: base.headlineMedium?.copyWith(
        fontWeight: FontWeight.w700,
        letterSpacing: -0.3,
      ),
      titleLarge: base.titleLarge?.copyWith(fontWeight: FontWeight.w600),
      titleMedium: base.titleMedium?.copyWith(fontWeight: FontWeight.w600),
      bodyLarge: base.bodyLarge?.copyWith(height: 1.4),
      bodyMedium: base.bodyMedium?.copyWith(height: 1.4),
      labelLarge: base.labelLarge?.copyWith(fontWeight: FontWeight.w600, letterSpacing: 0.1),
    );
  }
}

abstract final class AppTheme {
  static ThemeData light() => _build(Brightness.light);
  static ThemeData dark() => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    final scheme = ColorScheme.fromSeed(seedColor: AppColors.seed, brightness: brightness);
    final base = ThemeData(brightness: brightness, useMaterial3: true);

    return base.copyWith(
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
      textTheme: AppTypography.textTheme(base.textTheme),
      appBarTheme: const AppBarTheme(centerTitle: false, scrolledUnderElevation: 0.5),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          // 48dp is the accessible minimum tap target. Delivery partners tap these
          // one-handed, in the rain, wearing gloves.
          minimumSize: const Size.fromHeight(48),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadii.md)),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(48),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadii.md)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surfaceContainerHighest.withValues(alpha: 0.4),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadii.md),
          borderSide: BorderSide.none,
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.md,
        ),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.lg),
          side: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.5)),
        ),
      ),
    );
  }
}
