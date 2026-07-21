import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/util/format.dart';
import '../../../core/widgets/app_card.dart';
import '../../../core/widgets/async_value_view.dart';
import '../../../core/widgets/empty_state.dart';
import '../../../core/widgets/status_chip.dart';
import '../../auth/presentation/auth_controller.dart';
import '../data/partner_dtos.dart';
import '../data/partner_repository.dart';
import '../sync/sync_queue.dart';
import 'stop_outcome_screen.dart';

enum _View { list, map }

/// Today's delivery runs, with a list/map toggle. The map view is honest: [StopDto] carries no
/// coordinates yet, so a real tile map cannot be drawn — the toggle is wired and the list is the
/// working view, with a clear note rather than a fake map.
class PartnerRunsScreen extends ConsumerStatefulWidget {
  const PartnerRunsScreen({super.key});

  @override
  ConsumerState<PartnerRunsScreen> createState() => _PartnerRunsScreenState();
}

class _PartnerRunsScreenState extends ConsumerState<PartnerRunsScreen> {
  _View _view = _View.list;

  @override
  Widget build(BuildContext context) {
    final runsValue = ref.watch(myRunsProvider());
    final pendingByTarget = ref.watch(pendingSyncByTargetProvider).value ?? const {};

    return Scaffold(
      appBar: AppBar(
        title: const Text("Today's route"),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Sign out',
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(52),
          child: Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: SegmentedButton<_View>(
              segments: const [
                ButtonSegment(value: _View.list, icon: Icon(Icons.list), label: Text('List')),
                ButtonSegment(value: _View.map, icon: Icon(Icons.map_outlined), label: Text('Map')),
              ],
              selected: {_view},
              onSelectionChanged: (s) => setState(() => _view = s.first),
            ),
          ),
        ),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(myRunsProvider());
          await ref.read(myRunsProvider().future);
        },
        child: AsyncValueView<List<RunDto>>(
          value: runsValue,
          onRetry: () => ref.invalidate(myRunsProvider()),
          data: (runs) {
            if (runs.isEmpty) {
              return ListView(
                children: const [
                  SizedBox(height: 80),
                  EmptyState(
                    title: 'No runs today',
                    message: "You have no delivery route assigned for today.",
                    icon: Icons.route_outlined,
                  ),
                ],
              );
            }
            return ListView(
              padding: const EdgeInsets.all(AppSpacing.md),
              children: [
                if (_view == _View.map) const _MapPlaceholder(),
                for (final run in runs) _RunSection(run: run, pendingByTarget: pendingByTarget),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _MapPlaceholder extends StatelessWidget {
  const _MapPlaceholder();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return AppCard(
      child: Row(
        children: [
          Icon(Icons.map_outlined, color: theme.colorScheme.outline),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Text(
              'Map view arrives once stops carry geocoded coordinates. Until then, work the list '
              'below in order.',
              style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.outline),
            ),
          ),
        ],
      ),
    );
  }
}

class _RunSection extends StatelessWidget {
  const _RunSection({required this.run, required this.pendingByTarget});
  final RunDto run;
  final Map<String, String> pendingByTarget;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final stops = [...run.stops]..sort((a, b) => a.sequence.compareTo(b.sequence));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
          child: Row(
            children: [
              Text(formatDate(run.runDate), style: theme.textTheme.titleMedium),
              const SizedBox(width: AppSpacing.sm),
              StatusChip(run.status),
            ],
          ),
        ),
        for (final stop in stops) _StopTile(stop: stop, pendingStatus: pendingByTarget[stop.id]),
      ],
    );
  }
}

class _StopTile extends StatelessWidget {
  const _StopTile({required this.stop, this.pendingStatus});
  final StopDto stop;
  final String? pendingStatus;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final done = stop.status != 'PENDING';

    return AppCard(
      onTap: done && pendingStatus == null
          ? null
          : () => Navigator.of(
              context,
            ).push<void>(MaterialPageRoute<void>(builder: (_) => StopOutcomeScreen(stop: stop))),
      child: Row(
        children: [
          CircleAvatar(
            radius: 16,
            backgroundColor: theme.colorScheme.secondaryContainer,
            child: Text('${stop.sequence}'),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Stop ${stop.sequence}', style: theme.textTheme.titleMedium),
                if (stop.reason != null)
                  Text(
                    stop.reason!,
                    style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.outline),
                  ),
              ],
            ),
          ),
          if (pendingStatus != null)
            _PendingBadge(status: pendingStatus!)
          else
            StatusChip(stop.status),
        ],
      ),
    );
  }
}

/// The "pending sync" / "sync failed" indicator — the whole point of the offline design is that a
/// partner is NEVER unsure whether their action was recorded.
class _PendingBadge extends StatelessWidget {
  const _PendingBadge({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final failed = status == 'failed';
    final color = failed ? theme.colorScheme.error : theme.colorScheme.tertiary;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(failed ? Icons.sync_problem : Icons.sync, size: 16, color: color),
        const SizedBox(width: 4),
        Text(
          failed ? 'Sync failed' : 'Pending sync',
          style: theme.textTheme.labelSmall?.copyWith(color: color),
        ),
      ],
    );
  }
}
