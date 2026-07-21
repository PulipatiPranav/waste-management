import 'package:flutter/material.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/app_button.dart';
import 'pickup_scan_screen.dart';

/// The partner's pickups landing. The camera lives on the pushed scan screen (not here) so it is
/// only active while actually scanning, never in the background of a tab.
class PartnerPickupsScreen extends StatelessWidget {
  const PartnerPickupsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Pickups')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.xl),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.qr_code_scanner, size: 72, color: theme.colorScheme.primary),
              const SizedBox(height: AppSpacing.lg),
              Text('Scan a pickup', style: theme.textTheme.headlineMedium),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Scan the QR the customer shows, then weigh their paper by type.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.outline),
              ),
              const SizedBox(height: AppSpacing.xl),
              AppButton(
                label: 'Open scanner',
                icon: Icons.qr_code_scanner,
                onPressed: () => Navigator.of(
                  context,
                ).push<void>(MaterialPageRoute<void>(builder: (_) => const PickupScanScreen())),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
