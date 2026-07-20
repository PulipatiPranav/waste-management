import 'dart:math';

import 'package:dio/dio.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../config/app_config.dart';
import '../storage/token_store.dart';
import 'api_failure.dart';
import 'auth_interceptor.dart';

part 'dio_client.g.dart';

@Riverpod(keepAlive: true)
AppConfig appConfig(Ref ref) => AppConfig.fromEnvironment();

/// A monotonically-incrementing "the session was revoked" signal.
///
/// Lives in core (not the auth feature) so the Dio interceptor can raise it without core
/// depending on a feature. The auth controller listens and flips to unauthenticated. It is
/// a counter rather than a bool because the interesting event is the TRANSITION — a repeat
/// signal must still notify listeners so a second silent 401 still routes to login.
@Riverpod(keepAlive: true)
class SessionRevoked extends _$SessionRevoked {
  @override
  int build() => 0;

  void signal() => state++;
}

BaseOptions _baseOptions(AppConfig config) => BaseOptions(
  baseUrl: config.apiBaseUrl,
  // Deliberately generous: delivery partners work on 2G/3G at apartment gates.
  connectTimeout: const Duration(seconds: 15),
  receiveTimeout: const Duration(seconds: 20),
  sendTimeout: const Duration(seconds: 20),
  headers: {'Content-Type': 'application/json'},
  // Let the app map status codes itself rather than have Dio throw on 4xx.
  validateStatus: (status) => status != null && status < 500,
);

/// The app's single authenticated Dio instance: correlation id, then the auth interceptor
/// (attach the access token; on a 401, refresh once and replay the request).
@Riverpod(keepAlive: true)
Dio dio(Ref ref) {
  final config = ref.watch(appConfigProvider);
  final tokenStore = ref.watch(tokenStoreProvider);

  final dio = Dio(_baseOptions(config));

  // A BARE client for /auth/refresh only — it must never carry the auth interceptor, or a
  // failing refresh would try to refresh itself.
  final refreshDio = Dio(_baseOptions(config));

  final authInterceptor = AuthInterceptor(
    tokenStore: tokenStore,
    refreshDio: refreshDio,
    onAuthenticationLost: () => ref.read(sessionRevokedProvider.notifier).signal(),
  )..retryClient = dio;

  dio.interceptors.add(authInterceptor);
  dio.interceptors.add(CorrelationIdInterceptor());
  ref.onDispose(() {
    dio.close();
    refreshDio.close();
  });

  return dio;
}

/// Tags every outbound request with an ID the backend echoes into its logs.
///
/// This is what lets support answer "where did my cashback go?" — the app can show
/// the ID, and it resolves to the exact request chain server-side. See the API's
/// CorrelationIdMiddleware.
class CorrelationIdInterceptor extends Interceptor {
  static const header = 'x-correlation-id';

  final _random = Random();

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    options.headers[header] = _generateId();
    handler.next(options);
  }

  String _generateId() {
    const chars = 'abcdef0123456789';
    return List.generate(16, (_) => chars[_random.nextInt(chars.length)]).join();
  }
}

/// Maps a [DioException] onto the [ApiFailure] union the UI switches on.
///
/// Lives here so exactly one place decides what "offline" means; a repository that
/// invents its own mapping is how inconsistent error states creep in.
ApiFailure mapDioError(DioException error) {
  switch (error.type) {
    case DioExceptionType.connectionTimeout:
    case DioExceptionType.sendTimeout:
    case DioExceptionType.receiveTimeout:
    case DioExceptionType.transformTimeout:
      return const ApiFailure.timeout();
    case DioExceptionType.connectionError:
      return const ApiFailure.network();
    case DioExceptionType.badCertificate:
      return const ApiFailure.server(message: 'Invalid server certificate');
    case DioExceptionType.cancel:
    case DioExceptionType.unknown:
    case DioExceptionType.badResponse:
      final status = error.response?.statusCode;
      if (status == 401 || status == 403) return const ApiFailure.unauthorized();
      return ApiFailure.server(message: error.message ?? 'Unexpected error');
  }
}
