import 'package:freezed_annotation/freezed_annotation.dart';

import '../domain/session.dart';

part 'session_dto.freezed.dart';
part 'session_dto.g.dart';

/// The wire shape of `SessionResponseDto` from the auth API. Kept separate from the domain
/// [Session] so a field the API adds (a new token type, a scope) does not ripple into the
/// app until a mapper chooses to surface it.
@freezed
sealed class SessionDto with _$SessionDto {
  const SessionDto._();

  const factory SessionDto({
    required String accessToken,
    required String refreshToken,
    required String tokenType,
    required int expiresInSeconds,
  }) = _SessionDto;

  factory SessionDto.fromJson(Map<String, dynamic> json) => _$SessionDtoFromJson(json);

  Session toDomain() => Session(accessToken: accessToken, refreshToken: refreshToken);
}
