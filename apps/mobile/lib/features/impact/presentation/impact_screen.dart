import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/async_value_view.dart';
import '../data/impact_dtos.dart';
import '../data/impact_repository.dart';

/// The personal sustainability dashboard.
///
/// HONEST FRAMING is the whole point of this screen, and it is enforced in three ways: measured
/// figures (recycled weight, landfill diverted) are labelled plainly, estimated figures (CO2e,
/// water, energy, trees) carry the word "estimated" in their label, and the server's disclaimer is
/// shown VERBATIM at the bottom. There is no "carbon negative"/"net zero" copy anywhere — the app
/// never makes a claim the backend's methodology does not support.
class ImpactScreen extends ConsumerWidget {
  const ImpactScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final impact = ref.watch(myImpactProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Your impact')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(myImpactProvider);
          await ref.read(myImpactProvider.future);
        },
        child: AsyncValueView<ImpactReportDto>(
          value: impact,
          onRetry: () => ref.invalidate(myImpactProvider),
          data: (report) => ListView(
            padding: const EdgeInsets.all(AppSpacing.md),
            children: [
              _MeasuredCard(metrics: report.lifetime),
              const SizedBox(height: AppSpacing.md),
              _EstimatedGrid(metrics: report.lifetime),
              const SizedBox(height: AppSpacing.lg),
              _DisclaimerCard(text: report.disclaimer),
            ],
          ),
        ),
      ),
    );
  }
}

String _num(double v) {
  // Trim to at most 2 decimals without dragging in intl.
  final rounded = (v * 100).round() / 100;
  return rounded == rounded.roundToDouble() ? rounded.toStringAsFixed(0) : rounded.toString();
}

class _MeasuredCard extends StatelessWidget {
  const _MeasuredCard({required this.metrics});
  final ImpactMetricsDto metrics;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      color: theme.colorScheme.primaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Paper recycled',
              style: theme.textTheme.labelLarge?.copyWith(
                color: theme.colorScheme.onPrimaryContainer,
              ),
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              '${_num(metrics.recycledKg)} kg',
              style: theme.textTheme.displaySmall?.copyWith(
                color: theme.colorScheme.onPrimaryContainer,
              ),
            ),
            Text(
              '${_num(metrics.landfillDivertedKg)} kg kept out of landfill (measured)',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onPrimaryContainer,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EstimatedGrid extends StatelessWidget {
  const _EstimatedGrid({required this.metrics});
  final ImpactMetricsDto metrics;

  @override
  Widget build(BuildContext context) {
    final items = <({IconData icon, String value, String label})>[
      (
        icon: Icons.cloud_outlined,
        value: '${_num(metrics.estimatedCo2eAvoidedKg)} kg',
        label: 'Est. CO₂e avoided',
      ),
      (
        icon: Icons.water_drop_outlined,
        value: '${_num(metrics.estimatedWaterSavedLitres)} L',
        label: 'Est. water saved',
      ),
      (
        icon: Icons.bolt_outlined,
        value: '${_num(metrics.estimatedEnergySavedKwh)} kWh',
        label: 'Est. energy saved',
      ),
      (
        icon: Icons.park_outlined,
        value: _num(metrics.estimatedTreesEquivalent),
        label: 'Est. trees-equivalent',
      ),
    ];

    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: AppSpacing.md,
      crossAxisSpacing: AppSpacing.md,
      childAspectRatio: 1.5,
      children: [
        for (final item in items)
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(item.icon, color: Theme.of(context).colorScheme.primary),
                const Spacer(),
                Text(item.value, style: Theme.of(context).textTheme.titleLarge),
                Text(
                  item.label,
                  style: Theme.of(
                    context,
                  ).textTheme.bodySmall?.copyWith(color: Theme.of(context).colorScheme.outline),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class _DisclaimerCard extends StatelessWidget {
  const _DisclaimerCard({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return AppCard(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, size: 20, color: theme.colorScheme.outline),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              text,
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline),
            ),
          ),
        ],
      ),
    );
  }
}
