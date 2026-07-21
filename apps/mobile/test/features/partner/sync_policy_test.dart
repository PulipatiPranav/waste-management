import 'package:cpe_mobile/core/network/api_failure.dart';
import 'package:cpe_mobile/features/partner/sync/sync_policy.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('decideSync', () {
    test('a successful send (null failure) is synced', () {
      expect(decideSync(null), SyncDecision.synced);
    });

    test('transient failures are retried, never dropped', () {
      expect(decideSync(const ApiFailure.network()), SyncDecision.retry);
      expect(decideSync(const ApiFailure.timeout()), SyncDecision.retry);
      expect(decideSync(const ApiFailure.server(message: 'boom')), SyncDecision.retry);
      // An expired session is transient too — the action is valid, it just needs a signed-in user.
      expect(decideSync(const ApiFailure.unauthorized()), SyncDecision.retry);
    });

    test('an "already recorded" conflict is treated as SUCCESS (idempotent), not an error', () {
      expect(
        decideSync(const ApiFailure.badRequest(code: 'CONFLICT', message: 'Already recorded')),
        SyncDecision.synced,
      );
      expect(
        decideSync(
          const ApiFailure.badRequest(
            code: 'PICKUP_ALREADY_COMPLETED',
            message: 'This pickup has already been completed.',
          ),
        ),
        SyncDecision.synced,
      );
      // Even when the code is generic, an "already …" message counts as applied.
      expect(
        decideSync(
          const ApiFailure.badRequest(code: 'BAD_REQUEST', message: 'Stop already actioned'),
        ),
        SyncDecision.synced,
      );
    });

    test('a genuine validation error is parked as FAILED, not retried forever', () {
      expect(
        decideSync(
          const ApiFailure.badRequest(code: 'VALIDATION', message: 'reason is required for FAILED'),
        ),
        SyncDecision.failed,
      );
    });
  });
}
