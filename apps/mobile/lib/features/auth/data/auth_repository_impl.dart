import 'package:dio/dio.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/network/api_failure.dart';
import '../../../core/network/dio_client.dart';
import '../../../core/storage/token_store.dart';
import '../domain/auth_repository.dart';
import '../domain/auth_user.dart';
import '../domain/session.dart';
import 'session_dto.dart';
import 'user_profile_dto.dart';

part 'auth_repository_impl.g.dart';

/// The only class that knows the auth API's URLs and how Dio surfaces its errors.
///
/// Dio here is configured with `validateStatus: status < 500`, so a 4xx comes back as a
/// normal response, not a thrown exception — every method therefore inspects the status
/// code AND catches [DioException] (which still fires for connection/timeout). Missing
/// either half is how a 400 slips through as a "success".
class AuthRepositoryImpl implements AuthRepository {
  AuthRepositoryImpl(this._dio, this._tokenStore);

  final Dio _dio;
  final TokenStore _tokenStore;

  @override
  Future<ApiFailure?> requestOtp(String phone) async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        '/auth/otp/request',
        data: {'phone': phone},
      );
      if (_isSuccess(response.statusCode)) return null;
      return _failureFromResponse(response);
    } on DioException catch (error) {
      return mapDioError(error);
    }
  }

  @override
  Future<(Session?, ApiFailure?)> verifyOtp({required String phone, required String code}) async {
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        '/auth/otp/verify',
        data: {'phone': phone, 'code': code},
      );
      final data = response.data;
      if (!_isSuccess(response.statusCode) || data == null) {
        return (null, _failureFromResponse(response));
      }

      final session = SessionDto.fromJson(data);
      // Persist BEFORE returning: the next request (fetchCurrentUser) reads the token from
      // storage via the interceptor, so it must already be there.
      await _tokenStore.saveTokens(
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
      );
      return (session.toDomain(), null);
    } on DioException catch (error) {
      return (null, mapDioError(error));
    }
  }

  @override
  Future<(AuthUser?, ApiFailure?)> fetchCurrentUser() async {
    try {
      final response = await _dio.get<Map<String, dynamic>>('/users/me');
      final data = response.data;
      if (!_isSuccess(response.statusCode) || data == null) {
        return (null, _failureFromResponse(response));
      }
      return (UserProfileDto.fromJson(data).toDomain(), null);
    } on DioException catch (error) {
      return (null, mapDioError(error));
    }
  }

  @override
  Future<void> logout() async {
    final refreshToken = await _tokenStore.readRefreshToken();
    // Best-effort server revocation. Whatever happens, the local tokens go — a user who
    // taps "sign out" is signed out even if the network call fails.
    if (refreshToken != null) {
      try {
        await _dio.post<void>('/auth/logout', data: {'refreshToken': refreshToken});
      } on DioException {
        // Swallowed on purpose: see above.
      }
    }
    await _tokenStore.clear();
  }

  bool _isSuccess(int? status) => status != null && status >= 200 && status < 300;

  /// Maps a non-2xx response body onto the [ApiFailure] union. The API's error envelope is
  /// `{ statusCode, code, message, details }`; we read what is there and fall back sanely.
  ApiFailure _failureFromResponse(Response<Map<String, dynamic>> response) {
    final status = response.statusCode;
    if (status == 401 || status == 403) return const ApiFailure.unauthorized();

    final body = response.data;
    final code = body?['code'] as String?;
    final message = body?['message'] as String?;

    if (status != null && status >= 400 && status < 500) {
      return ApiFailure.badRequest(
        code: code ?? 'BAD_REQUEST',
        message: message ?? 'Request could not be completed',
        details: _parseDetails(body?['details']),
      );
    }
    return ApiFailure.server(message: message ?? 'Unexpected error (${status ?? 'no status'})');
  }

  Map<String, List<String>>? _parseDetails(Object? raw) {
    if (raw is! Map) return null;
    return raw.map(
      (key, value) => MapEntry(
        key.toString(),
        (value is List) ? value.map((e) => e.toString()).toList() : <String>[value.toString()],
      ),
    );
  }
}

@riverpod
AuthRepository authRepository(Ref ref) {
  return AuthRepositoryImpl(ref.watch(dioProvider), ref.watch(tokenStoreProvider));
}
