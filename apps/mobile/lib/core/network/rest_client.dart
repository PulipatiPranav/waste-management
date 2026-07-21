import 'package:dio/dio.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import 'api_failure.dart';
import 'dio_client.dart';

part 'rest_client.g.dart';

/// A thin wrapper over Dio that turns every call into the app's `(value?, failure?)` record and
/// centralises the two things every repository would otherwise repeat: the `validateStatus < 500`
/// status check (a 4xx is a response, not an exception here) and mapping a DioException to an
/// [ApiFailure]. Feature repositories parse; they never re-implement error handling.
class RestClient {
  RestClient(this._dio);

  final Dio _dio;

  Future<(T?, ApiFailure?)> getObject<T>(
    String path,
    T Function(Map<String, dynamic>) parse, {
    Map<String, dynamic>? query,
  }) async {
    try {
      final res = await _dio.get<dynamic>(path, queryParameters: query);
      if (!_ok(res.statusCode)) return (null, _failure(res));
      return (parse(res.data as Map<String, dynamic>), null);
    } on DioException catch (e) {
      return (null, mapDioError(e));
    }
  }

  Future<(List<T>?, ApiFailure?)> getList<T>(
    String path,
    T Function(Map<String, dynamic>) parse, {
    Map<String, dynamic>? query,
  }) async {
    try {
      final res = await _dio.get<dynamic>(path, queryParameters: query);
      if (!_ok(res.statusCode)) return (null, _failure(res));
      final list = (res.data as List<dynamic>)
          .map((e) => parse(e as Map<String, dynamic>))
          .toList();
      return (list, null);
    } on DioException catch (e) {
      return (null, mapDioError(e));
    }
  }

  Future<(T?, ApiFailure?)> send<T>(
    String path,
    T Function(Map<String, dynamic>) parse, {
    String method = 'POST',
    Object? body,
    Map<String, String>? headers,
  }) async {
    try {
      final res = await _dio.request<dynamic>(
        path,
        data: body,
        options: Options(method: method, headers: headers),
      );
      if (!_ok(res.statusCode)) return (null, _failure(res));
      return (parse(res.data as Map<String, dynamic>), null);
    } on DioException catch (e) {
      return (null, mapDioError(e));
    }
  }

  /// For actions whose success body we do not need (pause/resume/cancel).
  Future<ApiFailure?> sendNoContent(String path, {String method = 'POST', Object? body}) async {
    try {
      final res = await _dio.request<dynamic>(
        path,
        data: body,
        options: Options(method: method),
      );
      return _ok(res.statusCode) ? null : _failure(res);
    } on DioException catch (e) {
      return mapDioError(e);
    }
  }

  bool _ok(int? status) => status != null && status >= 200 && status < 300;

  ApiFailure _failure(Response<dynamic> res) {
    final status = res.statusCode;
    if (status == 401 || status == 403) return const ApiFailure.unauthorized();

    final body = res.data is Map<String, dynamic> ? res.data as Map<String, dynamic> : null;
    final code = body?['code'] as String?;
    final message = body?['message'] as String?;

    if (status != null && status >= 400 && status < 500) {
      return ApiFailure.badRequest(
        code: code ?? 'BAD_REQUEST',
        message: message ?? 'Request could not be completed',
      );
    }
    return ApiFailure.server(message: message ?? 'Unexpected error (${status ?? 'no status'})');
  }
}

@riverpod
RestClient restClient(Ref ref) => RestClient(ref.watch(dioProvider));
