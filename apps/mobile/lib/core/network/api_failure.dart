import 'package:freezed_annotation/freezed_annotation.dart';

part 'api_failure.freezed.dart';

/// Every network error the app can encounter, as a sealed union.
///
/// A sealed type rather than a thrown `Exception` so the compiler forces each UI to
/// handle each case: Phase 12 requires explicit loading/empty/error states, and an
/// exhaustive `switch` is what makes "we forgot the offline state" a build failure
/// instead of a support ticket.
///
/// Mirrors the API's `ApiErrorResponse` contract (see packages/shared-types).
@freezed
sealed class ApiFailure with _$ApiFailure {
  /// No usable connection. The partner app should queue and retry, not error out.
  const factory ApiFailure.network() = NetworkFailure;

  /// The request reached the server but it took too long to answer.
  const factory ApiFailure.timeout() = TimeoutFailure;

  /// 401/403 — the token is missing, expired past refresh, or the role is wrong.
  const factory ApiFailure.unauthorized() = UnauthorizedFailure;

  /// 4xx the caller can act on. [code] is the API's stable machine-readable code.
  const factory ApiFailure.badRequest({
    required String code,
    required String message,
    Map<String, List<String>>? details,
  }) = BadRequestFailure;

  /// 5xx, or anything we could not classify.
  const factory ApiFailure.server({required String message, String? correlationId}) = ServerFailure;
}
