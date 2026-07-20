import 'package:flutter/material.dart';

/// Shown while the auth state is `unknown` — the cold-start moment when we hold a token but
/// have not yet confirmed it. It exists so a returning user sees a brand frame, not a flash
/// of the login screen, before the router resolves where they belong.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.eco_rounded, size: 64, color: theme.colorScheme.primary),
            const SizedBox(height: 24),
            const SizedBox(
              height: 24,
              width: 24,
              child: CircularProgressIndicator(strokeWidth: 2.5),
            ),
          ],
        ),
      ),
    );
  }
}
