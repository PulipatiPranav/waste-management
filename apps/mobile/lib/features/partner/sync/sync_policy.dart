import '../../../core/network/api_failure.dart';

/// What to do with a queued action after one sync attempt. Pure, because "did we correctly treat
/// an already-recorded action as done rather than retrying it forever, or dropping it?" is exactly
/// the decision that, if wrong, loses or duplicates a delivery — the highest-risk bug in this
/// phase. It is a function so it can be tested exhaustively.
enum SyncDecision {
  /// The server has this action (a fresh success, or it was already applied). Remove it.
  synced,

  /// A transient failure (offline, timeout, 5xx, an expired token about to refresh). Keep the
  /// action PENDING and try again later. Never dropped.
  retry,

  /// A permanent, actionable error (a real validation failure). Park it as FAILED for the partner
  /// to see — do NOT retry it into an infinite loop, and do NOT silently drop it.
  failed,
}

/// Turns the result of a sync attempt (a null failure means success) into a decision.
///
/// The subtle case is a CONFLICT: if the server says this stop is "already recorded" or this pickup
/// is "already completed", the action ALREADY SUCCEEDED — most likely a earlier attempt got through
/// before the ack came back, or the partner re-tapped. Treating that as `synced` (not `failed`, not
/// an endless `retry`) is what makes the queue idempotent and safe against duplicates.
SyncDecision decideSync(ApiFailure? failure) {
  if (failure == null) return SyncDecision.synced;

  return switch (failure) {
    NetworkFailure() || TimeoutFailure() || ServerFailure() => SyncDecision.retry,
    // An expired session: the action is still valid, it just needs the partner signed in. Keep it.
    UnauthorizedFailure() => SyncDecision.retry,
    BadRequestFailure(:final code, :final message) =>
      _alreadyApplied(code, message) ? SyncDecision.synced : SyncDecision.failed,
  };
}

/// Whether a 4xx means "the server already has this outcome", which for an idempotent action is a
/// success, not an error. Matches the backend's conflict code and its "already …" messages.
bool _alreadyApplied(String code, String message) {
  final c = code.toUpperCase();
  if (c == 'CONFLICT' || c.contains('ALREADY')) return true;
  return message.toLowerCase().contains('already');
}
