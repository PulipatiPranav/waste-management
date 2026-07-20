import 'dart:async';

import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/database/local_cache.dart';
import '../../../core/network/api_failure.dart';
import '../../../core/network/dio_client.dart';
import '../../../core/storage/token_store.dart';
import '../data/auth_repository_impl.dart';
import '../domain/auth_state.dart';
import '../domain/auth_user.dart';
import '../domain/user_role.dart';

part 'auth_controller.g.dart';

/// The app's authentication state machine, and the single source the router redirect reads.
///
/// It starts in `unknown` and resolves asynchronously from storage on cold start, so a
/// returning user is never flashed the login screen while their stored token is being
/// checked. It also listens to the interceptor's session-revoked signal: when a refresh
/// fails deep inside a request, THIS is what flips the app to unauthenticated and lets the
/// router redirect to login.
@Riverpod(keepAlive: true)
class AuthController extends _$AuthController {
  @override
  AuthState build() {
    ref.listen(sessionRevokedProvider, (previous, next) {
      // A refresh-token rejection inside the Dio interceptor. The tokens are already
      // cleared there; here we flip the in-memory state so the router reacts.
      if (previous != null && next != previous) {
        state = const AuthState.unauthenticated();
      }
    });

    unawaited(_restore());
    return const AuthState.unknown();
  }

  /// Cold-start restore: no token -> login; valid token -> authenticated; a token we cannot
  /// verify because we are OFFLINE -> fall back to the cached profile (offline-first), so a
  /// partner opening the app in a basement is not bounced to login.
  Future<void> _restore() async {
    final tokenStore = ref.read(tokenStoreProvider);
    final token = await tokenStore.readAccessToken();
    if (token == null) {
      state = const AuthState.unauthenticated();
      return;
    }

    final (user, failure) = await ref.read(authRepositoryProvider).fetchCurrentUser();
    if (user != null) {
      await _cacheProfile(user);
      state = AuthState.authenticated(user);
      return;
    }

    if (failure is UnauthorizedFailure) {
      // Token invalid and the interceptor's refresh already failed: truly signed out.
      await tokenStore.clear();
    } else {
      final cached = await _readCachedProfile();
      if (cached != null) {
        state = AuthState.authenticated(cached);
        return;
      }
    }
    state = const AuthState.unauthenticated();
  }

  /// Step 1 of login: ask the API to send a code. Non-committal by design — a null return
  /// means "accepted", NOT "this number is registered".
  Future<ApiFailure?> requestOtp(String phone) {
    return ref.read(authRepositoryProvider).requestOtp(phone);
  }

  /// Step 2: verify the code (which stores the tokens), then load the profile and flip to
  /// authenticated. Returns a failure to show, or null on success.
  Future<ApiFailure?> verifyOtp({required String phone, required String code}) async {
    final (session, failure) = await ref
        .read(authRepositoryProvider)
        .verifyOtp(phone: phone, code: code);
    if (session == null) {
      return failure ?? const ApiFailure.server(message: 'Verification failed');
    }

    final (user, profileFailure) = await ref.read(authRepositoryProvider).fetchCurrentUser();
    if (user == null) {
      return profileFailure ?? const ApiFailure.server(message: 'Could not load your profile');
    }
    await _cacheProfile(user);
    state = AuthState.authenticated(user);
    return null;
  }

  Future<void> logout() async {
    await ref.read(authRepositoryProvider).logout();
    await ref.read(localCacheProvider).delete(CacheKeys.authProfile);
    state = const AuthState.unauthenticated();
  }

  Future<void> _cacheProfile(AuthUser user) {
    return ref.read(localCacheProvider).putJson(CacheKeys.authProfile, {
      'id': user.id,
      'phone': user.phone,
      'role': user.role.name,
      'name': user.name,
      'email': user.email,
    });
  }

  Future<AuthUser?> _readCachedProfile() async {
    final json = await ref.read(localCacheProvider).getJson(CacheKeys.authProfile);
    if (json == null) return null;
    return AuthUser(
      id: json['id'] as String,
      phone: json['phone'] as String,
      role: UserRole.values.byName(json['role'] as String),
      name: json['name'] as String?,
      email: json['email'] as String?,
    );
  }
}
