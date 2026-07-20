import 'package:freezed_annotation/freezed_annotation.dart';

import 'user_role.dart';

part 'auth_user.freezed.dart';

/// The signed-in user, as the app cares about it. A domain type, not the wire DTO — the
/// DTO carries `createdAt`, `isActive` and other fields no screen here needs, and mapping
/// at the data boundary keeps those from leaking into the UI.
@freezed
sealed class AuthUser with _$AuthUser {
  const factory AuthUser({
    required String id,
    required String phone,
    required UserRole role,
    String? name,
    String? email,
  }) = _AuthUser;
}
