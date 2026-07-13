import 'dart:math';

import 'package:dio/dio.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../config/app_config.dart';
import 'api_failure.dart';

part 'dio_client.g.dart';

@Riverpod(keepAlive: true)
AppConfig appConfig(Ref ref) => AppConfig.fromEnvironment();

/// The app's single Dio instance.
///
/// Phase 11 adds the auth interceptor here (attach access token; on 401, refresh
/// once and retry the original request). It is deliberately absent now rather than
/// stubbed, so nothing pretends to be authenticated when it is not.
@Riverpod(keepAlive: true)
Dio dio(Ref ref) {
  final config = ref.watch(appConfigProvider);

  final dio = Dio(
    BaseOptions(
      baseUrl: config.apiBaseUrl,
      // Deliberately generous: delivery partners work on 2G/3G at apartment gates.
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 20),
      sendTimeout: const Duration(seconds: 20),
      headers: {'Content-Type': 'application/json'},
      // Let the app map status codes itself rather than have Dio throw on 4xx.
      validateStatus: (status) => status != null && status < 500,
    ),
  );

  dio.interceptors.add(CorrelationIdInterceptor());
  ref.onDispose(dio.close);

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
