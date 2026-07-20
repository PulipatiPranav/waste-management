import 'package:freezed_annotation/freezed_annotation.dart';

import '../domain/auth_user.dart';
import '../domain/user_role.dart';

part 'user_profile_dto.freezed.dart';
part 'user_profile_dto.g.dart';

/// The wire shape of `UserProfileDto` from `GET /users/me`.
@freezed
sealed class UserProfileDto with _$UserProfileDto {
  const UserProfileDto._();

  const factory UserProfileDto({
    required String id,
    required String phone,
    required String role,
    required bool isActive,
    String? email,
    String? name,
  }) = _UserProfileDto;

  factory UserProfileDto.fromJson(Map<String, dynamic> json) => _$UserProfileDtoFromJson(json);

  AuthUser toDomain() =>
      AuthUser(id: id, phone: phone, role: UserRole.fromApi(role), name: name, email: email);
}
