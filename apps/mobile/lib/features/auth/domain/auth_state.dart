import 'package:freezed_annotation/freezed_annotation.dart';

import 'auth_user.dart';

part 'auth_state.freezed.dart';

/// The app's authentication state, as a sealed union the router redirect switches on.
///
/// `unknown` is the load-bearing case: on cold start we do not yet know if the stored
/// token is still valid, so the router must show a splash and redirect NOWHERE until it
/// resolves. Collapsing `unknown` into `unauthenticated` would bounce every returning
/// user to the login screen for a frame before snapping them home — the flicker that
/// makes an app feel broken.
@freezed
sealed class AuthState with _$AuthState {
  /// Cold start: storage not yet checked. Router waits.
  const factory AuthState.unknown() = AuthUnknown;

  /// No valid session. Router sends to /login.
  const factory AuthState.unauthenticated() = AuthUnauthenticated;

  /// Signed in. Router allows the app; role decides which shell.
  const factory AuthState.authenticated(AuthUser user) = AuthAuthenticated;
}

extension AuthStateX on AuthState {
  bool get isAuthenticated => this is AuthAuthenticated;
  bool get isResolved => this is! AuthUnknown;
  AuthUser? get userOrNull => switch (this) {
    AuthAuthenticated(:final user) => user,
    _ => null,
  };
}
