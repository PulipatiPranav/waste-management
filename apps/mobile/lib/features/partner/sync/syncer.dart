import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/network/api_failure.dart';
import '../data/partner_dtos.dart';
import '../data/partner_repository.dart';
import 'sync_policy.dart';
import 'sync_queue.dart';

part 'syncer.g.dart';

/// The engine that drains the offline queue.
///
/// Field actions (a delivery outcome, a completed pickup) are ALWAYS enqueued first, durably, then
/// a sync is attempted immediately — so an action taken online syncs at once, and one taken offline
/// simply waits in the queue until connectivity returns. `processPending` is single-flight, so a
/// burst of triggers (three requests finishing, connectivity flapping) drains the queue once, not
/// three racing times that could double-send.
class Syncer {
  Syncer(this._queue, this._partner);

  final SyncQueue _queue;
  final PartnerRepository _partner;
  Future<void>? _inFlight;

  /// Record a delivery outcome offline-first: queue it, then try to sync now.
  Future<void> submitDeliveryOutcome(
    String stopId, {
    required String outcome,
    String? reason,
    String? photoKey,
  }) async {
    await _queue.enqueue(
      kind: ActionKind.deliveryOutcome,
      targetId: stopId,
      payload: {'outcome': outcome, 'reason': reason, 'photoKey': photoKey},
    );
    unawaited(processPending());
  }

  /// Record a completed pickup offline-first. The weights were entered by hand, so this needs no
  /// network to CAPTURE — only to sync — which is exactly why it belongs in the queue.
  Future<void> submitPickupCompletion(String pickupId, List<WeightEntry> weights) async {
    await _queue.enqueue(
      kind: ActionKind.pickupComplete,
      targetId: pickupId,
      payload: {'weights': weights.map((w) => w.toJson()).toList()},
    );
    unawaited(processPending());
  }

  /// Drain the queue. Safe to call anytime; a no-op if already running or nothing is pending.
  Future<void> processPending() {
    return _inFlight ??= _drain().whenComplete(() => _inFlight = null);
  }

  Future<void> _drain() async {
    final actions = await _queue.pending();
    for (final action in actions) {
      final payload = await _queue.payloadOf(action);
      final failure = await _send(action.kind, action.targetId, payload);
      final decision = decideSync(failure);
      await _queue.applyDecision(action, decision, error: _errorText(failure));
    }
  }

  Future<ApiFailure?> _send(String kind, String targetId, Map<String, dynamic> payload) async {
    switch (kind) {
      case ActionKind.deliveryOutcome:
        final (_, failure) = await _partner.recordOutcome(
          targetId,
          outcome: payload['outcome'] as String,
          reason: payload['reason'] as String?,
          photoKey: payload['photoKey'] as String?,
        );
        return failure;
      case ActionKind.pickupComplete:
        final weights = (payload['weights'] as List)
            .map(
              (w) => WeightEntry(
                paperType: (w as Map)['paperType'] as String,
                weightGrams: w['weightGrams'] as int,
              ),
            )
            .toList();
        final (_, failure) = await _partner.completePickup(targetId, weights);
        return failure;
      default:
        // An unknown kind cannot be sent; park it so it is visible, never looped.
        return const ApiFailure.badRequest(code: 'UNKNOWN_ACTION', message: 'Unknown action kind');
    }
  }

  String? _errorText(ApiFailure? failure) => switch (failure) {
    null => null,
    NetworkFailure() => 'Offline',
    TimeoutFailure() => 'Timed out',
    UnauthorizedFailure() => 'Signed out',
    BadRequestFailure(:final message) => message,
    ServerFailure(:final message) => message,
  };
}

@Riverpod(keepAlive: true)
Syncer syncer(Ref ref) =>
    Syncer(ref.watch(syncQueueProvider), ref.watch(partnerRepositoryProvider));

/// Watches connectivity and drains the queue whenever a connection returns. Kept alive for the
/// app's lifetime and started from the partner shell, so a partner who regains signal mid-route has
/// their queued actions flushed without doing anything.
@Riverpod(keepAlive: true)
class ConnectivitySync extends _$ConnectivitySync {
  StreamSubscription<List<ConnectivityResult>>? _sub;

  @override
  void build() {
    // Defensive: on a platform (or a test) without the connectivity plugin, fall back gracefully —
    // sync still runs on the on-start attempt below and on any manual "Sync now".
    try {
      _sub = Connectivity().onConnectivityChanged.listen((results) {
        final online = results.any((r) => r != ConnectivityResult.none);
        if (online) unawaited(ref.read(syncerProvider).processPending());
      }, onError: (Object _) {});
    } catch (_) {
      _sub = null;
    }
    ref.onDispose(() => _sub?.cancel());
    // Also attempt once on start, in case actions were left pending from a previous session.
    unawaited(ref.read(syncerProvider).processPending());
  }
}
