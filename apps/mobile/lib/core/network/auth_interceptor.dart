import 'package:dio/dio.dart';

import '../storage/token_store.dart';

/// Attaches the access token to every request and transparently recovers from a 401 by
/// refreshing the token once and replaying the original request.
///
/// TWO details drive the shape of this class:
///
///  1. The Dio instance uses `validateStatus: status < 500`, so a 401 comes back as a
///     RESPONSE, not a thrown `DioException`. The 401 handling therefore lives in
///     `onResponse`, not `onError` — put it in `onError` and it never fires.
///
///  2. A burst of requests can 401 at the same moment (a token that just expired). Refresh
///     is SINGLE-FLIGHT: the first 401 kicks off one refresh, every other awaits the same
///     future, so N expired requests trigger one refresh, not N. Without this, a home
///     screen firing five calls at once would rotate the refresh token five times and log
///     the user out on the races it loses.
class AuthInterceptor extends Interceptor {
  AuthInterceptor({required this.tokenStore, required this.refreshDio, this.onAuthenticationLost});

  final TokenStore tokenStore;

  /// A BARE Dio (no auth interceptor) used only for `/auth/refresh`, so refreshing can
  /// never recurse back into this interceptor.
  final Dio refreshDio;

  /// Called when the refresh token itself is rejected — the session is truly over. The app
  /// wires this to clear auth state and route to /login.
  final void Function()? onAuthenticationLost;

  /// The main Dio, set after construction, used to replay the original request.
  late final Dio retryClient;

  Future<bool>? _refreshing;

  static const _retriedKey = 'auth_retried';
  static const _skipAuthKey = 'skip_auth';

  @override
  Future<void> onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    if (options.extra[_skipAuthKey] != true) {
      final token = await tokenStore.readAccessToken();
      if (token != null) {
        options.headers['Authorization'] = 'Bearer $token';
      }
    }
    handler.next(options);
  }

  @override
  Future<void> onResponse(Response<dynamic> response, ResponseInterceptorHandler handler) async {
    final options = response.requestOptions;
    final alreadyRetried = options.extra[_retriedKey] == true;

    if (response.statusCode != 401 || alreadyRetried) {
      handler.next(response);
      return;
    }

    final refreshed = await _refreshOnce();
    if (!refreshed) {
      // The refresh token is gone or rejected: the session is over.
      onAuthenticationLost?.call();
      handler.next(response); // surface the original 401 to the caller
      return;
    }

    try {
      options.extra[_retriedKey] = true; // guard against a second refresh on the replay
      final retried = await retryClient.fetch<dynamic>(options);
      handler.resolve(retried);
    } on DioException {
      handler.next(response); // replay itself failed; return the original 401
    }
  }

  Future<bool> _refreshOnce() {
    return _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);
  }

  Future<bool> _doRefresh() async {
    final refreshToken = await tokenStore.readRefreshToken();
    if (refreshToken == null) return false;

    try {
      final response = await refreshDio.post<Map<String, dynamic>>(
        '/auth/refresh',
        data: {'refreshToken': refreshToken},
        options: Options(extra: {_skipAuthKey: true}),
      );

      final data = response.data;
      final status = response.statusCode ?? 0;
      if (status >= 200 && status < 300 && data != null) {
        await tokenStore.saveTokens(
          accessToken: data['accessToken'] as String,
          refreshToken: data['refreshToken'] as String,
        );
        return true;
      }

      // A 4xx here means the refresh token is expired or already rotated away — a real
      // logout, so clear it. (A 5xx/transient error is handled by the catch below, which
      // does NOT clear: the session may still be valid once the server recovers.)
      if (status >= 400 && status < 500) {
        await tokenStore.clear();
      }
      return false;
    } on DioException {
      return false;
    }
  }
}
