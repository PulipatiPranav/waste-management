import 'dart:convert';
import 'dart:typed_data';

import 'package:cpe_mobile/core/network/auth_interceptor.dart';
import 'package:cpe_mobile/core/storage/token_store.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

/// In-memory token store — the real one talks to a platform keystore that does not exist
/// under `flutter test`.
class _FakeTokenStore implements TokenStore {
  _FakeTokenStore({this.access, this.refresh});
  String? access;
  String? refresh;

  @override
  Future<String?> readAccessToken() async => access;
  @override
  Future<String?> readRefreshToken() async => refresh;
  @override
  Future<void> saveTokens({required String accessToken, required String refreshToken}) async {
    access = accessToken;
    refresh = refreshToken;
  }

  @override
  Future<void> clear() async {
    access = null;
    refresh = null;
  }
}

/// A scriptable Dio adapter: the test decides the response for each request from its path
/// and headers. No network, no server.
class _ScriptedAdapter implements HttpClientAdapter {
  _ScriptedAdapter(this.handler);
  final ResponseBody Function(RequestOptions options) handler;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    // A microtask delay so concurrent requests genuinely overlap (for the single-flight test).
    await Future<void>.delayed(const Duration(milliseconds: 1));
    return handler(options);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody _json(int status, Map<String, dynamic> body) {
  return ResponseBody.fromString(
    jsonEncode(body),
    status,
    headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    },
  );
}

Dio _buildDio(TokenStore store, {void Function()? onAuthLost}) {
  final options = BaseOptions(
    baseUrl: 'https://api.test',
    validateStatus: (status) => status != null && status < 500,
  );
  final dio = Dio(options);
  final refreshDio = Dio(options);

  final interceptor = AuthInterceptor(
    tokenStore: store,
    refreshDio: refreshDio,
    onAuthenticationLost: onAuthLost,
  )..retryClient = dio;

  dio.interceptors.add(interceptor);
  return dio;
}

void main() {
  group('AuthInterceptor', () {
    test('attaches the access token to outgoing requests', () async {
      final store = _FakeTokenStore(access: 'tok-123');
      String? seenAuth;
      final dio = _buildDio(store);
      dio.httpClientAdapter = _ScriptedAdapter((options) {
        seenAuth = options.headers['Authorization'] as String?;
        return _json(200, {'ok': true});
      });
      // The refresh client shares no adapter; only /users/me is hit here.

      await dio.get<dynamic>('/users/me');
      expect(seenAuth, 'Bearer tok-123');
    });

    test('on 401, refreshes once and retries the original request with the new token', () async {
      final store = _FakeTokenStore(access: 'old-access', refresh: 'old-refresh');
      var refreshCount = 0;
      var meCalls = 0;

      final dio = _buildDio(store);
      final adapter = _ScriptedAdapter((options) {
        if (options.path == '/auth/refresh') {
          refreshCount++;
          return _json(200, {
            'accessToken': 'new-access',
            'refreshToken': 'new-refresh',
            'tokenType': 'Bearer',
            'expiresInSeconds': 900,
          });
        }
        // /users/me: 200 only for the refreshed token.
        meCalls++;
        final auth = options.headers['Authorization'];
        return auth == 'Bearer new-access'
            ? _json(200, {'id': 'u1'})
            : _json(401, {'code': 'UNAUTHORIZED'});
      });
      dio.httpClientAdapter = adapter;
      // The refresh client uses the same script.
      dio.interceptors.whereType<AuthInterceptor>().single.refreshDio.httpClientAdapter = adapter;

      final response = await dio.get<dynamic>('/users/me');

      expect(response.statusCode, 200);
      expect(refreshCount, 1);
      expect(meCalls, 2, reason: 'once with the stale token (401), once retried');
      expect(store.access, 'new-access');
    });

    test('when the refresh token is rejected, signals auth-lost and clears tokens', () async {
      final store = _FakeTokenStore(access: 'old-access', refresh: 'expired-refresh');
      var authLost = false;

      final dio = _buildDio(store, onAuthLost: () => authLost = true);
      final adapter = _ScriptedAdapter((options) {
        if (options.path == '/auth/refresh') return _json(401, {'code': 'INVALID_REFRESH'});
        return _json(401, {'code': 'UNAUTHORIZED'});
      });
      dio.httpClientAdapter = adapter;
      dio.interceptors.whereType<AuthInterceptor>().single.refreshDio.httpClientAdapter = adapter;

      final response = await dio.get<dynamic>('/users/me');

      expect(response.statusCode, 401);
      expect(authLost, isTrue);
      expect(store.access, isNull, reason: 'a rejected refresh token clears the session');
      expect(store.refresh, isNull);
    });

    test('a burst of concurrent 401s triggers exactly ONE refresh (single-flight)', () async {
      final store = _FakeTokenStore(access: 'old-access', refresh: 'old-refresh');
      var refreshCount = 0;

      final dio = _buildDio(store);
      final adapter = _ScriptedAdapter((options) {
        if (options.path == '/auth/refresh') {
          refreshCount++;
          return _json(200, {
            'accessToken': 'new-access',
            'refreshToken': 'new-refresh',
            'tokenType': 'Bearer',
            'expiresInSeconds': 900,
          });
        }
        final auth = options.headers['Authorization'];
        return auth == 'Bearer new-access'
            ? _json(200, {'ok': true})
            : _json(401, {'code': 'UNAUTHORIZED'});
      });
      dio.httpClientAdapter = adapter;
      dio.interceptors.whereType<AuthInterceptor>().single.refreshDio.httpClientAdapter = adapter;

      final responses = await Future.wait([
        dio.get<dynamic>('/a'),
        dio.get<dynamic>('/b'),
        dio.get<dynamic>('/c'),
      ]);

      expect(responses.every((r) => r.statusCode == 200), isTrue);
      expect(refreshCount, 1, reason: 'three racing 401s share one refresh');
    });

    test('does not retry more than once — a persistent 401 is surfaced, not looped', () async {
      final store = _FakeTokenStore(access: 'old-access', refresh: 'old-refresh');
      var refreshCount = 0;

      final dio = _buildDio(store);
      final adapter = _ScriptedAdapter((options) {
        if (options.path == '/auth/refresh') {
          refreshCount++;
          return _json(200, {
            'accessToken': 'new-access',
            'refreshToken': 'new-refresh',
            'tokenType': 'Bearer',
            'expiresInSeconds': 900,
          });
        }
        // Always 401, even after a successful refresh (e.g. a genuinely forbidden resource).
        return _json(401, {'code': 'UNAUTHORIZED'});
      });
      dio.httpClientAdapter = adapter;
      dio.interceptors.whereType<AuthInterceptor>().single.refreshDio.httpClientAdapter = adapter;

      final response = await dio.get<dynamic>('/forbidden');

      expect(response.statusCode, 401);
      expect(refreshCount, 1, reason: 'refresh happens once; the retry is not itself retried');
    });
  });
}
