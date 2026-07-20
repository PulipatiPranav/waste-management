import '../../../core/network/api_failure.dart';
import 'auth_user.dart';
import 'session.dart';

/// The auth boundary. Presentation talks to this interface; the Dio implementation lives
/// in data/. Every method returns a `(value?, failure?)` record rather than throwing —
/// the same convention as the rest of the app, so a caller handles the failure in code
/// it can see rather than a try/catch it might forget.
abstract interface class AuthRepository {
  /// Ask the API to send an OTP. Succeeds (returns null failure) even for an unregistered
  /// number — the API is deliberately non-committal, so the app must not reveal otherwise.
  Future<ApiFailure?> requestOtp(String phone);

  /// Exchange a phone + code for a session. On success the tokens are already persisted.
  Future<(Session?, ApiFailure?)> verifyOtp({required String phone, required String code});

  /// The current user's profile, from the stored access token.
  Future<(AuthUser?, ApiFailure?)> fetchCurrentUser();

  /// Revoke the refresh token server-side. Best-effort; local tokens are cleared regardless.
  Future<void> logout();
}
