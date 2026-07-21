import 'package:cpe_mobile/core/database/app_database.dart';
import 'package:cpe_mobile/core/network/api_failure.dart';
import 'package:cpe_mobile/features/partner/data/partner_dtos.dart';
import 'package:cpe_mobile/features/partner/data/partner_repository.dart';
import 'package:cpe_mobile/features/partner/sync/sync_queue.dart';
import 'package:cpe_mobile/features/partner/sync/syncer.dart';
import 'package:cpe_mobile/features/pickups/data/pickup_dtos.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';

/// A partner repo whose sync result the test controls. `failure` is what the next send returns;
/// `outcomeCalls` counts how many times a delivery outcome was actually sent (to prove
/// single-flight and no-duplicate-send).
class _FakePartnerRepo implements PartnerRepository {
  ApiFailure? failure;
  int outcomeCalls = 0;
  int pickupCalls = 0;

  @override
  Future<(StopDto?, ApiFailure?)> recordOutcome(
    String stopId, {
    required String outcome,
    String? reason,
    String? photoKey,
  }) async {
    outcomeCalls++;
    if (failure != null) return (null, failure);
    return (
      StopDto(id: stopId, subscriptionId: 's', addressId: 'a', status: outcome, sequence: 1),
      null,
    );
  }

  @override
  Future<(CashbackResultDto?, ApiFailure?)> completePickup(
    String pickupId,
    List<WeightEntry> weights,
  ) async {
    pickupCalls++;
    if (failure != null) return (null, failure);
    return (
      CashbackResultDto(pickupId: pickupId, totalWeightKg: '1.000', totalRupees: '₹15.00'),
      null,
    );
  }

  @override
  Future<(List<RunDto>?, ApiFailure?)> fetchMyRuns({String? date}) async =>
      (const <RunDto>[], null);
  @override
  Future<(String?, ApiFailure?)> uploadPhoto(String stopId, String filePath) async => (null, null);
  @override
  Future<(PickupDto?, ApiFailure?)> scanPickup(String qrToken) async => (null, null);
  @override
  Future<(QuoteDto?, ApiFailure?)> quotePickup(List<WeightEntry> weights) async => (null, null);
}

void main() {
  late AppDatabase db;
  late SyncQueue queue;
  late _FakePartnerRepo repo;
  late Syncer syncer;

  setUp(() {
    db = AppDatabase.forTesting(NativeDatabase.memory());
    queue = SyncQueue(db);
    repo = _FakePartnerRepo();
    syncer = Syncer(queue, repo);
  });
  tearDown(() async => db.close());

  test('an action taken offline is PERSISTED and never lost', () async {
    repo.failure = const ApiFailure.network(); // offline
    await syncer.submitDeliveryOutcome('stop-1', outcome: 'DELIVERED');
    // Let the fire-and-forget sync attempt run.
    await syncer.processPending();

    final pending = await queue.pending();
    expect(pending, hasLength(1), reason: 'a failed-to-sync action stays queued');
    expect(pending.single.targetId, 'stop-1');
    expect(pending.single.attempts, greaterThanOrEqualTo(1));
    // The payload survived intact for the eventual sync.
    expect((await queue.payloadOf(pending.single))['outcome'], 'DELIVERED');
  });

  test('re-recording the same stop before it syncs replaces, not duplicates', () async {
    repo.failure = const ApiFailure.network();
    await queue.enqueue(
      kind: ActionKind.deliveryOutcome,
      targetId: 'stop-1',
      payload: {'outcome': 'FAILED', 'reason': 'gate locked'},
    );
    await queue.enqueue(
      kind: ActionKind.deliveryOutcome,
      targetId: 'stop-1',
      payload: {'outcome': 'DELIVERED'},
    );

    final pending = await queue.pending();
    expect(pending, hasLength(1), reason: 'one target => one queued action');
    expect((await queue.payloadOf(pending.single))['outcome'], 'DELIVERED', reason: 'latest wins');
  });

  test('the queue drains once connectivity returns (offline -> online)', () async {
    repo.failure = const ApiFailure.network();
    await syncer.submitPickupCompletion('pickup-1', const [
      WeightEntry(paperType: 'NEWSPAPER', weightGrams: 1000),
    ]);
    await syncer.processPending();
    expect(await queue.pending(), hasLength(1)); // still queued while offline

    repo.failure = null; // connectivity returns
    await syncer.processPending();
    expect(await queue.pending(), isEmpty, reason: 'a synced action is removed');
    expect(repo.pickupCalls, greaterThanOrEqualTo(1));
  });

  test('a CONFLICT on sync is treated as done (idempotent), not an error', () async {
    await queue.enqueue(
      kind: ActionKind.deliveryOutcome,
      targetId: 'stop-1',
      payload: {'outcome': 'DELIVERED'},
    );
    repo.failure = const ApiFailure.badRequest(code: 'CONFLICT', message: 'Already recorded');

    await syncer.processPending();
    expect(await queue.pending(), isEmpty);
    expect(await queue.failed(), isEmpty, reason: 'a duplicate is a success, not a failure');
  });

  test('a permanent validation error is parked as FAILED, not dropped and not looped', () async {
    await queue.enqueue(
      kind: ActionKind.deliveryOutcome,
      targetId: 'stop-1',
      payload: {'outcome': 'FAILED'},
    );
    repo.failure = const ApiFailure.badRequest(code: 'VALIDATION', message: 'reason required');

    await syncer.processPending();
    expect(await queue.pending(), isEmpty);
    final failed = await queue.failed();
    expect(failed, hasLength(1), reason: 'visible to the partner, not silently dropped');
    expect(failed.single.lastError, contains('reason'));
  });

  test('concurrent drains do not double-send (single-flight)', () async {
    await queue.enqueue(
      kind: ActionKind.deliveryOutcome,
      targetId: 'stop-1',
      payload: {'outcome': 'DELIVERED'},
    );

    // Fire two drains without awaiting the first — the second must join the in-flight one.
    await Future.wait([syncer.processPending(), syncer.processPending()]);

    expect(repo.outcomeCalls, 1, reason: 'the action is sent exactly once');
    expect(await queue.pending(), isEmpty);
  });

  test('the unsynced stream reflects the queue for the pending-sync badge', () async {
    repo.failure = const ApiFailure.network();
    expect(await queue.watchUnsynced().first, isEmpty);

    await syncer.submitDeliveryOutcome('stop-1', outcome: 'DELIVERED');
    await syncer.processPending();
    expect(await queue.watchUnsynced().first, hasLength(1));
  });
}
