import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../sync/sync_queue.dart';
import '../sync/syncer.dart';
import 'partner_history_screen.dart';
import 'partner_pickups_screen.dart';
import 'partner_runs_screen.dart';

/// The delivery-partner shell: three tabs, plus an app-wide "pending sync" banner so a partner is
/// never unsure whether their offline actions were recorded. Building this shell also starts the
/// connectivity watcher (via `connectivitySyncProvider`), so a partner who regains signal has their
/// queue flushed automatically.
class PartnerShell extends ConsumerStatefulWidget {
  const PartnerShell({super.key});

  @override
  ConsumerState<PartnerShell> createState() => _PartnerShellState();
}

class _PartnerShellState extends ConsumerState<PartnerShell> {
  int _index = 0;

  static const _tabs = [PartnerRunsScreen(), PartnerPickupsScreen(), PartnerHistoryScreen()];

  @override
  Widget build(BuildContext context) {
    // Keep the connectivity-driven sync alive for the partner's whole session.
    ref.watch(connectivitySyncProvider);
    final pending = ref.watch(pendingSyncCountProvider).value ?? 0;

    return Scaffold(
      body: Column(
        children: [
          if (pending > 0) _PendingSyncBanner(count: pending),
          Expanded(
            child: IndexedStack(index: _index, children: _tabs),
          ),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.route_outlined),
            selectedIcon: Icon(Icons.route),
            label: 'Route',
          ),
          NavigationDestination(icon: Icon(Icons.qr_code_scanner), label: 'Pickups'),
          NavigationDestination(icon: Icon(Icons.history), label: 'History'),
        ],
      ),
    );
  }
}

class _PendingSyncBanner extends ConsumerWidget {
  const _PendingSyncBanner({required this.count});
  final int count;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    return Material(
      color: theme.colorScheme.tertiaryContainer,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            children: [
              Icon(Icons.sync, size: 18, color: theme.colorScheme.onTertiaryContainer),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '$count action${count == 1 ? '' : 's'} waiting to sync',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onTertiaryContainer,
                  ),
                ),
              ),
              TextButton(
                onPressed: () => ref.read(syncerProvider).processPending(),
                child: const Text('Sync now'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
