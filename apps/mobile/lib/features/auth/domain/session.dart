import 'package:freezed_annotation/freezed_annotation.dart';

part 'session.freezed.dart';

/// A pair of tokens from the auth API. Domain type — the interceptor and token store deal
/// in this, not the raw DTO.
@freezed
sealed class Session with _$Session {
  const factory Session({required String accessToken, required String refreshToken}) = _Session;
}
