import 'package:dio/dio.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/config/app_config.dart';
import '../../../core/network/api_failure.dart';
import '../../../core/network/dio_client.dart';
import '../domain/app_status.dart';
import '../domain/app_status_repository.dart';
import 'health_dto.dart';

part 'app_status_repository_impl.g.dart';

/// The adapter: it is the only class here that knows Dio exists.
class AppStatusRepositoryImpl implements AppStatusRepository {
  AppStatusRepositoryImpl(this._dio, this._config);

  final Dio _dio;
  final AppConfig _config;

  @override
  Future<(AppStatus?, ApiFailure?)> fetchStatus() async {
    try {
      // The health endpoints sit outside the versioned /api prefix so Kubernetes can
      // reach them directly. Passing an absolute URL makes Dio bypass its baseUrl.
      final response = await _dio.get<Map<String, dynamic>>(
        '${_stripApiPath(_config.apiBaseUrl)}/health/live',
      );

      final data = response.data;
      if (response.statusCode != 200 || data == null) {
        return (null, const ApiFailure.server(message: 'Health check returned no body'));
      }

      final dto = HealthDto.fromJson(data);

      return (
        AppStatus(
          apiReachable: dto.status == 'ok',
          environment: _config.environment,
          lastCheckedAt: DateTime.now(),
        ),
        null,
      );
    } on DioException catch (error) {
      return (null, mapDioError(error));
    }
  }

  /// `http://host:3000/api/v1` -> `http://host:3000`
  String _stripApiPath(String baseUrl) {
    final uri = Uri.parse(baseUrl);
    return uri.replace(path: '').toString();
  }
}

@riverpod
AppStatusRepository appStatusRepository(Ref ref) {
  return AppStatusRepositoryImpl(ref.watch(dioProvider), ref.watch(appConfigProvider));
}
