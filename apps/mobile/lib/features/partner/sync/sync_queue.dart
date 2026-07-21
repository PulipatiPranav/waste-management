import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/database/app_database.dart';
import 'sync_policy.dart';

part 'sync_queue.g.dart';

/// The kinds of action that can be queued offline.
abstract final class ActionKind {
  static const deliveryOutcome = 'delivery_outcome';
  static const pickupComplete = 'pickup_complete';
}

/// The durable queue of offline actions, over the Drift [PendingActions] table. Every mutation a
/// partner makes in the field goes through here FIRST, so nothing is lost when there is no signal.
///
/// The one invariant that matters: a synced action is DELETED (the server is then the record); a
/// pending action is never dropped, only retried; a permanently-failed action is parked visibly,
/// never silently discarded. Everything the sync policy decides is applied here.
class SyncQueue {
  SyncQueue(this._db, {DateTime Function()? clock}) : _clock = clock ?? DateTime.now;

  final AppDatabase _db;
  final DateTime Function() _clock;

  /// Adds (or replaces) a pending action. Upserts on the dedupe key, so re-recording the same
  /// target before it syncs yields ONE action carrying the latest payload — never two.
  Future<void> enqueue({
    required String kind,
    required String targetId,
    required Map<String, dynamic> payload,
  }) async {
    final now = _clock();
    await _db
        .into(_db.pendingActions)
        .insert(
          PendingActionsCompanion.insert(
            dedupeKey: '$kind:$targetId',
            kind: kind,
            targetId: targetId,
            payload: jsonEncode(payload),
            createdAt: now,
            updatedAt: now,
          ),
          onConflict: DoUpdate(
            (_) => PendingActionsCompanion.custom(
              payload: Variable(jsonEncode(payload)),
              status: const Variable('pending'),
              attempts: const Variable(0),
              lastError: const Variable(null),
              updatedAt: Variable(now),
            ),
            target: [_db.pendingActions.dedupeKey],
          ),
        );
  }

  /// Pending actions, oldest first — the order they should sync in.
  Future<List<PendingAction>> pending() {
    return (_db.select(_db.pendingActions)
          ..where((t) => t.status.equals('pending'))
          ..orderBy([(t) => OrderingTerm(expression: t.createdAt)]))
        .get();
  }

  /// A live view of everything not yet synced (pending + failed), for the "pending sync" UI.
  Stream<List<PendingAction>> watchUnsynced() {
    return (_db.select(_db.pendingActions)
          ..where((t) => t.status.isIn(['pending', 'failed']))
          ..orderBy([(t) => OrderingTerm(expression: t.createdAt)]))
        .watch();
  }

  Future<List<PendingAction>> failed() {
    return (_db.select(_db.pendingActions)..where((t) => t.status.equals('failed'))).get();
  }

  Future<Map<String, dynamic>> payloadOf(PendingAction action) async =>
      jsonDecode(action.payload) as Map<String, dynamic>;

  /// Apply the policy's verdict to a row after a sync attempt.
  Future<void> applyDecision(PendingAction action, SyncDecision decision, {String? error}) async {
    switch (decision) {
      case SyncDecision.synced:
        await (_db.delete(_db.pendingActions)..where((t) => t.id.equals(action.id))).go();
      case SyncDecision.retry:
        await _touch(action.id, status: 'pending', error: error);
      case SyncDecision.failed:
        await _touch(action.id, status: 'failed', error: error);
    }
  }

  /// Re-queue a failed action for another attempt (a partner can retry from the UI).
  Future<void> retry(int id) async {
    await (_db.update(_db.pendingActions)..where((t) => t.id.equals(id))).write(
      PendingActionsCompanion(
        status: const Value('pending'),
        lastError: const Value(null),
        updatedAt: Value(_clock()),
      ),
    );
  }

  Future<void> _touch(int id, {required String status, String? error}) async {
    final current = await (_db.select(
      _db.pendingActions,
    )..where((t) => t.id.equals(id))).getSingleOrNull();
    if (current == null) return;
    await (_db.update(_db.pendingActions)..where((t) => t.id.equals(id))).write(
      PendingActionsCompanion(
        status: Value(status),
        attempts: Value(current.attempts + 1),
        lastError: Value(error),
        updatedAt: Value(_clock()),
      ),
    );
  }
}

@Riverpod(keepAlive: true)
SyncQueue syncQueue(Ref ref) => SyncQueue(ref.watch(appDatabaseProvider));

/// A live count of actions not yet on the server — drives the app-wide "N pending sync" badge.
@riverpod
Stream<int> pendingSyncCount(Ref ref) {
  return ref.watch(syncQueueProvider).watchUnsynced().map((rows) => rows.length);
}

/// A live map of targetId -> status ('pending' | 'failed') for the not-yet-synced actions, so a
/// list row can show "pending sync" / "sync failed" against the exact stop or pickup it belongs to.
@riverpod
Stream<Map<String, String>> pendingSyncByTarget(Ref ref) {
  return ref
      .watch(syncQueueProvider)
      .watchUnsynced()
      .map((rows) => {for (final r in rows) r.targetId: r.status});
}
