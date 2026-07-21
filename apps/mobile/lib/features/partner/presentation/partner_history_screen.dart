import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/async_value_view.dart';
import '../../../core/widgets/empty_state.dart';
import '../../../core/widgets/status_chip.dart';
import '../data/partner_dtos.dart';
import '../data/partner_repository.dart';

/// Completed-runs history for a chosen date, with per-run completion counts. The backend does not
/// yet model a partner PAYOUT, so this shows work done (delivered/failed/skipped) rather than an
/// invented rupee figure — honest about what the API actually provides.
class PartnerHistoryScreen extends ConsumerStatefulWidget {
  const PartnerHistoryScreen({super.key});

  @override
  ConsumerState<PartnerHistoryScreen> createState() => _PartnerHistoryScreenState();
}

class _PartnerHistoryScreenState extends ConsumerState<PartnerHistoryScreen> {
  DateTime _date = DateTime.now();

  String get _iso =>
      '${_date.year.toString().padLeft(4, '0')}-${_date.month.toString().padLeft(2, '0')}-${_date.day.toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    final runsValue = ref.watch(myRunsProvider(date: _iso));

    return Scaffold(
      appBar: AppBar(title: const Text('History')),
      body: Column(
        children: [
          ListTile(
            leading: const Icon(Icons.calendar_today_outlined),
            title: Text(formatDate(_date.toIso8601String())),
            trailing: const Icon(Icons.chevron_right),
            onTap: _pickDate,
          ),
          const Divider(height: 1),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () async {
                ref.invalidate(myRunsProvider(date: _iso));
                await ref.read(myRunsProvider(date: _iso).future);
              },
              child: AsyncValueView<List<RunDto>>(
                value: runsValue,
                onRetry: () => ref.invalidate(myRunsProvider(date: _iso)),
                data: (runs) => runs.isEmpty
                    ? const EmptyState(
                        title: 'No runs on this day',
                        message: 'Pick another date to see your delivery history.',
                        icon: Icons.history,
                      )
                    : ListView(
                        padding: const EdgeInsets.all(AppSpacing.md),
                        children: [for (final run in runs) _RunSummary(run: run)],
                      ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: now.subtract(const Duration(days: 90)),
      lastDate: now,
    );
    if (picked != null) setState(() => _date = picked);
  }
}

class _RunSummary extends StatelessWidget {
  const _RunSummary({required this.run});
  final RunDto run;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final delivered = run.stops.where((s) => s.status == 'DELIVERED').length;
    final failed = run.stops.where((s) => s.status == 'FAILED').length;
    final skipped = run.stops.where((s) => s.status == 'SKIPPED').length;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(formatDate(run.runDate), style: theme.textTheme.titleMedium),
              StatusChip(run.status),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            '$delivered delivered · $failed failed · $skipped skipped · ${run.stops.length} stops',
            style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.outline),
          ),
        ],
      ),
    );
  }
}
